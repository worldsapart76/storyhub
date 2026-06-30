"""The worker engine: heartbeat + pc_jobs dispatch loop (redesign §12.4).

The worker is a thin agent. Each tick it heartbeats (liveness for the dashboard's
Transfer button) and, if a `pc_jobs` row is pending, claims the oldest one, runs
its handler (X4 transfer / backup pull), and reports the terminal status + log.
One job at a time — single user, single device.

The loop runs on its own thread; a threading.Event drives clean shutdown so the
tray's Quit (or Ctrl-C headless) stops it promptly between sleeps. Per-request
errors are caught and logged so a transient Railway/network blip never kills the
worker — it just retries on the next tick. A job that raises is reported `failed`
with the error in its log, never crashing the loop.
"""

from __future__ import annotations

import logging
import threading
import time

import httpx

from . import jobs
from .api import RailwayClient
from .config import Settings
from .logging_setup import recent_log_lines

log = logging.getLogger("storyhub_worker")


class WorkerEngine:
    def __init__(self, settings: Settings) -> None:
        self.settings = settings
        self._stop = threading.Event()
        self._thread: threading.Thread | None = None

    # --- lifecycle -----------------------------------------------------------

    def start(self) -> None:
        """Run the loop on a background daemon thread (for the tray app)."""
        if self._thread and self._thread.is_alive():
            return
        self._stop.clear()
        self._thread = threading.Thread(target=self.run, name="worker-engine", daemon=True)
        self._thread.start()

    def stop(self, timeout: float = 5.0) -> None:
        self._stop.set()
        if self._thread:
            self._thread.join(timeout=timeout)

    # --- main loop -----------------------------------------------------------

    def run(self) -> None:
        """Run the loop on the current thread (blocks; used by headless mode)."""
        log.info(
            "Worker '%s' starting - Railway=%s, poll=%ss, heartbeat=%ss",
            self.settings.worker_id,
            self.settings.railway_url,
            self.settings.poll_interval_seconds,
            self.settings.heartbeat_interval_seconds,
        )
        client = RailwayClient(self.settings)
        next_heartbeat = 0.0  # 0 forces an immediate first beat
        try:
            while not self._stop.is_set():
                now = time.monotonic()
                if now >= next_heartbeat:
                    self._safe_heartbeat(client)
                    next_heartbeat = now + self.settings.heartbeat_interval_seconds
                self._poll_job(client)
                self._stop.wait(self.settings.poll_interval_seconds)
        finally:
            client.close()
            log.info("Worker '%s' stopped", self.settings.worker_id)

    # --- steps (each isolates its own failures) ------------------------------

    def _safe_heartbeat(self, client: RailwayClient) -> None:
        try:
            client.heartbeat(recent_log_lines(20))
            log.debug("heartbeat ok")
        except httpx.HTTPError as exc:
            log.warning("heartbeat failed: %s", exc)

    def _poll_job(self, client: RailwayClient) -> None:
        """Claim and run one pending job, if any."""
        try:
            job = client.claim_job()
        except httpx.HTTPError as exc:
            log.warning("job claim failed: %s", exc)
            return
        if job is None:
            return
        self._run_job(client, job)

    def _run_job(self, client: RailwayClient, job: dict) -> None:
        job_id = job.get("id")
        job_type = job.get("job_type")
        log.info("running job %s (%s)", job_id, job_type)
        lines: list[str] = []

        def progress(msg: str) -> None:
            lines.append(msg)
            log.info("[job %s] %s", job_id, msg)
            # Stream the log AND beat — a long transfer would otherwise miss its
            # heartbeat window and show the worker offline mid-run.
            try:
                client.job_progress(job_id, "\n".join(lines))
            except httpx.HTTPError as exc:
                log.warning("progress update failed for %s: %s", job_id, exc)
            try:
                client.heartbeat(recent_log_lines(20))
            except httpx.HTTPError:
                pass

        try:
            summary = jobs.run(job, self.settings, client, progress)
            lines.append(summary or "done")
            client.finish_job(job_id, "done", "\n".join(lines))
            log.info("job %s done", job_id)
        except Exception as exc:  # noqa: BLE001 - report, never crash the loop
            log.exception("job %s failed", job_id)
            lines.append(f"ERROR: {exc}")
            try:
                client.finish_job(job_id, "failed", "\n".join(lines))
            except httpx.HTTPError as e2:
                log.warning("could not report failure for %s: %s", job_id, e2)
