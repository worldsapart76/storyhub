"""Thin Railway REST client (docs/components/railway-service.md).

Phase-1 surface only: heartbeat, drain the pending queue, ack items. Every
request carries the shared bearer token (docs/auth.md). Network/HTTP errors are
raised to the caller; the engine loop catches and logs them so one bad poll
doesn't take the worker down.
"""

from __future__ import annotations

from typing import Any

import httpx

from .config import Settings


class RailwayClient:
    def __init__(self, settings: Settings, timeout: float = 15.0) -> None:
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

    def pending_queue(self, limit: int) -> list[dict[str, Any]]:
        """GET /api/queue?status=pending — items awaiting the worker."""
        resp = self._client.get("/queue", params={"status": "pending", "limit": limit})
        resp.raise_for_status()
        return resp.json()

    def ack(self, item_id: str, status: str = "done", **fields: Any) -> dict[str, Any]:
        """POST /api/queue/{id}/ack — mark an item processed.

        Phase 1 acks `done` with no other fields. Phase 2 will pass
        calibre_id_assigned / review_payload / error_message here.
        """
        resp = self._client.post(f"/queue/{item_id}/ack", json={"status": status, **fields})
        resp.raise_for_status()
        return resp.json()
