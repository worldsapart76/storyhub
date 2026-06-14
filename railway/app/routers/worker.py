"""/api/worker — liveness heartbeat (worker) + status read (dashboard)."""

from __future__ import annotations

import asyncpg
from fastapi import APIRouter, Depends, status

from ..config import Settings, get_settings
from ..db import get_conn
from ..models import HeartbeatCreate, WorkerStatus

router = APIRouter(prefix="/worker", tags=["worker"])


@router.post("/heartbeat", status_code=status.HTTP_204_NO_CONTENT, response_model=None)
async def heartbeat(
    hb: HeartbeatCreate, conn: asyncpg.Connection = Depends(get_conn)
) -> None:
    await conn.execute(
        """
        INSERT INTO worker_heartbeats (worker_id, last_seen_at, recent_log_lines)
        VALUES ($1, now(), $2)
        ON CONFLICT (worker_id) DO UPDATE
           SET last_seen_at = now(),
               recent_log_lines = EXCLUDED.recent_log_lines
        """,
        hb.worker_id,
        hb.recent_log_lines,
    )


@router.get("/status", response_model=list[WorkerStatus])
async def worker_status(
    conn: asyncpg.Connection = Depends(get_conn),
    settings: Settings = Depends(get_settings),
) -> list[WorkerStatus]:
    rows = await conn.fetch(
        """
        SELECT worker_id,
               last_seen_at,
               recent_log_lines,
               (now() - last_seen_at) < make_interval(secs => $1) AS alive
          FROM worker_heartbeats
         ORDER BY last_seen_at DESC
        """,
        settings.worker_alive_seconds,
    )
    return [WorkerStatus(**dict(r)) for r in rows]
