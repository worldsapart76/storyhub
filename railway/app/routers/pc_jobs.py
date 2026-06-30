"""/api/pc-jobs — the worker thin-agent job queue (redesign §12.4).

Two surfaces on one table:
  - Dashboard (PWA): POST to enqueue an X4 transfer / backup pull, GET to list +
    poll status/log.
  - Worker (Windows): POST /claim to take the oldest pending job (one at a time),
    POST /{id}/progress to stream log lines as it runs, POST /{id}/finish to report
    the terminal status.

Distinct from `pending_changes` (library/AO3 sync) and `queue_items` (capture
import) — this is machine-local work (SD-card transfer, backup), not data
stewardship.
"""

from __future__ import annotations

from uuid import UUID

import asyncpg
from fastapi import APIRouter, Depends, HTTPException, Query, Response, status

from ..db import get_conn
from ..models import PcJob, PcJobClaim, PcJobCreate, PcJobFinish, PcJobProgress

router = APIRouter(prefix="/pc-jobs", tags=["pc-jobs"])

_COLS = (
    "id, job_type, params, status, log, worker_id, "
    "created_at, started_at, finished_at"
)


async def _load(conn: asyncpg.Connection, jid: UUID) -> PcJob:
    row = await conn.fetchrow(f"SELECT {_COLS} FROM pc_jobs WHERE id = $1", jid)
    if row is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Job not found")
    return PcJob(**dict(row))


@router.post("", response_model=PcJob, status_code=status.HTTP_201_CREATED)
async def create_job(
    body: PcJobCreate, conn: asyncpg.Connection = Depends(get_conn)
) -> PcJob:
    """Dashboard enqueues a job. Status starts `pending`; the worker claims it."""
    row = await conn.fetchrow(
        f"INSERT INTO pc_jobs (job_type, params) VALUES ($1, $2) RETURNING {_COLS}",
        body.job_type.value, body.params,
    )
    return PcJob(**dict(row))


@router.get("", response_model=list[PcJob])
async def list_jobs(
    status_filter: str | None = Query(None, alias="status",
                                      pattern="^(pending|running|done|failed)$"),
    limit: int = Query(50, ge=1, le=500),
    conn: asyncpg.Connection = Depends(get_conn),
) -> list[PcJob]:
    """Recent jobs, newest first. `?status=` narrows; `?limit=` caps (default 50)."""
    if status_filter:
        rows = await conn.fetch(
            f"SELECT {_COLS} FROM pc_jobs WHERE status = $1 "
            f"ORDER BY created_at DESC LIMIT $2",
            status_filter, limit,
        )
    else:
        rows = await conn.fetch(
            f"SELECT {_COLS} FROM pc_jobs ORDER BY created_at DESC LIMIT $1", limit
        )
    return [PcJob(**dict(r)) for r in rows]


@router.post("/claim")
async def claim_job(
    body: PcJobClaim, response: Response, conn: asyncpg.Connection = Depends(get_conn)
):
    """Worker claims the oldest pending job atomically (pending → running). Returns
    the job, or 204 (empty) when nothing is pending. `FOR UPDATE SKIP LOCKED` keeps
    two workers from grabbing the same row, though single-user runs one worker."""
    row = await conn.fetchrow(
        f"""
        UPDATE pc_jobs SET status = 'running', started_at = now(), worker_id = $1
        WHERE id = (
            SELECT id FROM pc_jobs WHERE status = 'pending'
            ORDER BY created_at LIMIT 1 FOR UPDATE SKIP LOCKED
        )
        RETURNING {_COLS}
        """,
        body.worker_id,
    )
    if row is None:
        response.status_code = status.HTTP_204_NO_CONTENT
        return None
    return PcJob(**dict(row))


@router.post("/{job_id}/progress", response_model=PcJob)
async def update_progress(
    job_id: UUID, body: PcJobProgress, conn: asyncpg.Connection = Depends(get_conn)
) -> PcJob:
    """Replace the running log so the dashboard can show progress mid-run."""
    row = await conn.fetchrow(
        f"UPDATE pc_jobs SET log = $2 WHERE id = $1 RETURNING {_COLS}",
        job_id, body.log,
    )
    if row is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Job not found")
    return PcJob(**dict(row))


@router.post("/{job_id}/finish", response_model=PcJob)
async def finish_job(
    job_id: UUID, body: PcJobFinish, conn: asyncpg.Connection = Depends(get_conn)
) -> PcJob:
    """Worker's terminal report: status done | failed + the full run log."""
    if body.status.value not in ("done", "failed"):
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY,
                            "finish status must be 'done' or 'failed'")
    row = await conn.fetchrow(
        f"UPDATE pc_jobs SET status = $2, log = COALESCE($3, log), "
        f"finished_at = now() WHERE id = $1 RETURNING {_COLS}",
        job_id, body.status.value, body.log,
    )
    if row is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Job not found")
    return PcJob(**dict(row))


@router.get("/{job_id}", response_model=PcJob)
async def get_job(job_id: UUID, conn: asyncpg.Connection = Depends(get_conn)) -> PcJob:
    return await _load(conn, job_id)
