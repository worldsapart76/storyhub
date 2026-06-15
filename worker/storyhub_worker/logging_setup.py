"""Logging: rotating file at ~/.storyhub/worker.log + console, plus an
in-memory ring buffer whose recent lines ride along on each heartbeat so the
dashboard can show worker activity (docs/components/worker.md: "post recent
events to Railway for dashboard display").
"""

from __future__ import annotations

import logging
from collections import deque
from logging.handlers import RotatingFileHandler

from .config import LOG_PATH, STORYHUB_DIR

_RECENT_MAXLEN = 50
_recent: deque[str] = deque(maxlen=_RECENT_MAXLEN)

_FORMAT = logging.Formatter("%(asctime)s %(levelname)-7s %(message)s", "%Y-%m-%d %H:%M:%S")


class _RingBufferHandler(logging.Handler):
    """Keeps the last N formatted log lines for the heartbeat payload."""

    def emit(self, record: logging.LogRecord) -> None:
        _recent.append(self.format(record))


def setup_logging(level: int = logging.INFO) -> logging.Logger:
    STORYHUB_DIR.mkdir(parents=True, exist_ok=True)
    logger = logging.getLogger("storyhub_worker")
    if logger.handlers:  # idempotent — safe to call more than once
        logger.setLevel(level)
        return logger
    logger.setLevel(level)
    for handler in (
        RotatingFileHandler(LOG_PATH, maxBytes=1_000_000, backupCount=3, encoding="utf-8"),
        logging.StreamHandler(),
        _RingBufferHandler(),
    ):
        handler.setFormatter(_FORMAT)
        logger.addHandler(handler)
    return logger


def recent_log_lines(n: int = 20) -> list[str]:
    """The most recent log lines, oldest-first, for the heartbeat payload."""
    return list(_recent)[-n:]
