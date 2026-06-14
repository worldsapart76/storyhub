"""/api/status-updates — read-status changes in; worker drains + acks."""

from __future__ import annotations

from uuid import UUID

import asyncpg
from fastapi import APIRouter, Depends, HTTPException, Query, status

from ..db import get_conn
from ..models import StatusUpdate, StatusUpdateCreate

router = APIRouter(prefix="/status-updates", tags=["status-updates"])


@router.post("", response_model=StatusUpdate, status_code=status.HTTP_201_CREATED)
async def add_status_update(
    upd: StatusUpdateCreate, conn: asyncpg.Connection = Depends(get_conn)
) -> StatusUpdate:
    row = await conn.fetchrow(
        """
        INSERT INTO status_updates (work_id, calibre_id, new_status, old_status, source)
        VALUES ($1, $2, $3, $4, $5)
        RETURNING *
        """,
        upd.work_id,
        upd.calibre_id,
        upd.new_status.value,
        upd.old_status,
        upd.source,
    )
    return StatusUpdate(**dict(row))


@router.get("", response_model=list[StatusUpdate])
async def list_status_updates(
    status_filter: str | None = Query(None, alias="status"),
    limit: int = Query(100, ge=1, le=1000),
    conn: asyncpg.Connection = Depends(get_conn),
) -> list[StatusUpdate]:
    # The only meaningful filter is pending (applied_at IS NULL).
    if status_filter == "pending":
        rows = await conn.fetch(
            "SELECT * FROM status_updates WHERE applied_at IS NULL "
            "ORDER BY created_at LIMIT $1",
            limit,
        )
    else:
        rows = await conn.fetch(
            "SELECT * FROM status_updates ORDER BY created_at DESC LIMIT $1", limit
        )
    return [StatusUpdate(**dict(r)) for r in rows]


@router.post("/{update_id}/ack", response_model=StatusUpdate)
async def ack_status_update(
    update_id: UUID, conn: asyncpg.Connection = Depends(get_conn)
) -> StatusUpdate:
    row = await conn.fetchrow(
        "UPDATE status_updates SET applied_at = now() WHERE id = $1 RETURNING *",
        update_id,
    )
    if row is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Status update not found")
    return StatusUpdate(**dict(row))
