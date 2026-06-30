"""Worker job handlers (redesign §12.4). The engine claims a `pc_jobs` row and
dispatches it here by `job_type`.

A handler has the signature ``handler(job, settings, client, progress) -> str``:
  - ``job``      — the claimed pc_jobs row (dict): id, job_type, params, ...
  - ``settings`` — the worker Settings
  - ``client``   — the RailwayClient (snapshot pointer, etc.)
  - ``progress`` — ``Callable[[str], None]``; call it with a human line as the job
                   advances (streams to the dashboard + keeps the worker alive).
It returns a final summary string (the terminal log) or raises on failure.

H2 lands the dispatch skeleton; H3 fills in x4_transfer, H5 backup_pull.
"""

from __future__ import annotations

from typing import Any, Callable

from ..config import Settings
from . import backup_pull, xteink_transfer


class UnknownJobType(Exception):
    pass


# job_type -> handler.
HANDLERS: dict[str, Callable[..., str]] = {
    "x4_transfer": xteink_transfer.run,
    "backup_pull": backup_pull.run,
}


def run(job: dict[str, Any], settings: Settings, client, progress: Callable[[str], None]) -> str:
    """Dispatch a claimed job to its handler. Raises UnknownJobType for an
    unrecognized job_type; propagates whatever the handler raises."""
    job_type = job.get("job_type")
    handler = HANDLERS.get(job_type)
    if handler is None:
        raise UnknownJobType(f"no handler for job_type {job_type!r}")
    return handler(job, settings, client, progress)
