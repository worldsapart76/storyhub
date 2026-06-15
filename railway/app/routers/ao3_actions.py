"""/api/ao3-actions — the one real queue (redesign §12.2).

The app enqueues AO3 side-effects (mark_read / bookmark / remove_bookmark); the
browser extension drains them on the next AO3 page load and acks. Bookmarks are
always private (params {private: true}) — baked into the action, not a choice.
"""

from __future__ import annotations

from uuid import UUID

import asyncpg
from fastapi import APIRouter, Depends, HTTPException, Query, status

from ..db import get_conn
from ..models import AO3Action, AO3ActionCreate, AO3ActionStatus

router = APIRouter(prefix="/ao3-actions", tags=["ao3-actions"])

_COLUMNS = "id, work_id, action, params, status, created_at, done_at"


@router.post("", response_model=AO3Action, status_code=status.HTTP_201_CREATED)
async def add_ao3_action(
    action: AO3ActionCreate, conn: asyncpg.Connection = Depends(get_conn)
) -> AO3Action:
    row = await conn.fetchrow(
        f"INSERT INTO ao3_actions (work_id, action, params) VALUES ($1,$2,$3) "
        f"RETURNING {_COLUMNS}",
        action.work_id, action.action.value, action.params,
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
            f"SELECT {_COLUMNS} FROM ao3_actions ORDER BY created_at LIMIT $1", limit
        )
    else:
        rows = await conn.fetch(
            f"SELECT {_COLUMNS} FROM ao3_actions WHERE status = $1 "
            f"ORDER BY created_at LIMIT $2",
            status_filter.value, limit,
        )
    return [AO3Action(**dict(r)) for r in rows]


@router.post("/{action_id}/ack", response_model=AO3Action)
async def ack_ao3_action(
    action_id: UUID,
    result: AO3ActionStatus = Query(AO3ActionStatus.done),
    conn: asyncpg.Connection = Depends(get_conn),
) -> AO3Action:
    """Extension acks a drained action as done (default) or failed."""
    row = await conn.fetchrow(
        f"UPDATE ao3_actions SET status = $2, done_at = now() "
        f"WHERE id = $1 RETURNING {_COLUMNS}",
        action_id, result.value,
    )
    if row is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "AO3 action not found")
    return AO3Action(**dict(row))
