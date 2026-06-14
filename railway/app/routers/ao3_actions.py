"""/api/ao3-actions — worker enqueues; extension drains + acks."""

from __future__ import annotations

from uuid import UUID

import asyncpg
from fastapi import APIRouter, Depends, HTTPException, Query, status

from ..db import get_conn
from ..models import AO3Action, AO3ActionCreate, AO3ActionStatus

router = APIRouter(prefix="/ao3-actions", tags=["ao3-actions"])


@router.post("", response_model=AO3Action, status_code=status.HTTP_201_CREATED)
async def add_ao3_action(
    action: AO3ActionCreate, conn: asyncpg.Connection = Depends(get_conn)
) -> AO3Action:
    row = await conn.fetchrow(
        """
        INSERT INTO ao3_actions (work_id, action, status_update_id)
        VALUES ($1, $2, $3)
        RETURNING *
        """,
        action.work_id,
        action.action.value,
        action.status_update_id,
    )
    return AO3Action(**dict(row))


@router.get("", response_model=list[AO3Action])
async def list_ao3_actions(
    status_filter: AO3ActionStatus | None = Query(None, alias="status"),
    limit: int = Query(100, ge=1, le=1000),
    conn: asyncpg.Connection = Depends(get_conn),
) -> list[AO3Action]:
    if status_filter is None:
        rows = await conn.fetch(
            "SELECT * FROM ao3_actions ORDER BY created_at LIMIT $1", limit
        )
    else:
        rows = await conn.fetch(
            "SELECT * FROM ao3_actions WHERE status = $1 ORDER BY created_at LIMIT $2",
            status_filter.value,
            limit,
        )
    return [AO3Action(**dict(r)) for r in rows]


@router.post("/{action_id}/ack", response_model=AO3Action)
async def ack_ao3_action(
    action_id: UUID, conn: asyncpg.Connection = Depends(get_conn)
) -> AO3Action:
    row = await conn.fetchrow(
        "UPDATE ao3_actions SET status = 'done', completed_at = now() "
        "WHERE id = $1 RETURNING *",
        action_id,
    )
    if row is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "AO3 action not found")
    return AO3Action(**dict(row))
