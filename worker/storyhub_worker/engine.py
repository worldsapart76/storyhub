"""The worker engine: heartbeat + queue-drain loop.

Phase 1 is a *shell*. It drains pending queue items and acks each as `done`
WITHOUT doing any work — no Calibre, no R2. This proves the round-trip
(something enqueues -> worker drains -> Railway shows it done) and the heartbeat
liveness path. Real processing lands in Phase 2.

The loop runs on its own thread; a threading.Event drives clean shutdown so the
tray's Quit (or Ctrl-C headless) stops it promptly between sleeps. Per-request
errors are caught and logged so a transient Railway/network blip never kills the
worker — it just retries on the next tick.
"""

from __future__ import annotations

import logging
import threading
import time

import httpx

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
                self._safe_drain(client)
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

    def _safe_drain(self, client: RailwayClient) -> None:
        try:
            items = client.pending_queue(self.settings.queue_batch_limit)
        except httpx.HTTPError as exc:
            log.warning("queue poll failed: %s", exc)
            return

        if not items:
            return
        if len(items) >= self.settings.queue_batch_limit:
            # No silent caps (FFF principle): say what's deferred to next poll.
            log.warning(
                "queue drain hit batch limit %d — more items remain, continuing next poll",
                self.settings.queue_batch_limit,
            )

        acked = 0
        for item in items:
            if self._stop.is_set():
                break
            item_id = item.get("id")
            try:
                client.ack(item_id, status="done")
                acked += 1
            except httpx.HTTPError as exc:
                log.warning("ack failed for %s: %s", item_id, exc)
        if acked:
            log.info("drained %d queue item(s) (Phase 1 no-op -> done)", acked)
