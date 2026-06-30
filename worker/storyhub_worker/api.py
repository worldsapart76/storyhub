"""Thin Railway REST client (docs/components/railway-service.md).

Phase H surface: heartbeat (liveness) + the pc_jobs lifecycle (claim the oldest
pending job, stream progress, report the terminal result). Every request carries
the shared bearer token (docs/auth.md). Network/HTTP errors are raised to the
caller; the engine loop catches and logs them so one bad poll doesn't take the
worker down.
"""

from __future__ import annotations

from typing import Any

import httpx

from .config import Settings


class RailwayClient:
    def __init__(self, settings: Settings, timeout: float = 30.0) -> None:
        self._settings = settings
        self._client = httpx.Client(
            base_url=settings.api_base,
            headers={"Authorization": f"Bearer {settings.auth_token}"},
            timeout=timeout,
        )

    def close(self) -> None:
        self._client.close()

    def __enter__(self) -> RailwayClient:
        return self

    def __exit__(self, *exc: object) -> None:
        self.close()

    # --- liveness ----------------------------------------------------------

    def heartbeat(self, recent_log_lines: list[str] | None = None) -> None:
        """POST /api/worker/heartbeat — liveness ping (204)."""
        resp = self._client.post(
            "/worker/heartbeat",
            json={
                "worker_id": self._settings.worker_id,
                "recent_log_lines": recent_log_lines,
            },
        )
        resp.raise_for_status()

    # --- snapshot pointer --------------------------------------------------

    def get_current_snapshot(self) -> dict[str, Any]:
        """GET /api/snapshot/current — the current snapshot pointer. Carries
        `version` (the freshness guard) and `r2_path` (the SQLite key in R2 the
        worker downloads directly via boto3)."""
        resp = self._client.get("/snapshot/current")
        resp.raise_for_status()
        return resp.json()

    # --- pc_jobs (§12.4) ---------------------------------------------------

    def claim_job(self) -> dict[str, Any] | None:
        """POST /api/pc-jobs/claim — atomically take the oldest pending job
        (pending → running). Returns the job dict, or None when nothing is pending
        (the endpoint replies 204)."""
        resp = self._client.post(
            "/pc-jobs/claim", json={"worker_id": self._settings.worker_id}
        )
        resp.raise_for_status()
        if resp.status_code == 204 or not resp.content:
            return None
        return resp.json()

    def job_progress(self, job_id: str, log: str) -> None:
        """POST /api/pc-jobs/{id}/progress — replace the running log so the
        dashboard shows progress mid-run."""
        resp = self._client.post(f"/pc-jobs/{job_id}/progress", json={"log": log})
        resp.raise_for_status()

    def finish_job(self, job_id: str, status: str, log: str | None = None) -> dict[str, Any]:
        """POST /api/pc-jobs/{id}/finish — terminal report (status done | failed)."""
        resp = self._client.post(
            f"/pc-jobs/{job_id}/finish", json={"status": status, "log": log}
        )
        resp.raise_for_status()
        return resp.json()
