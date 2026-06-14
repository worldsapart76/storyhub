"""/api/queue — extension/bookmarklet enqueue, worker drain + ack."""

from __future__ import annotations

from uuid import UUID

import asyncpg
from fastapi import APIRouter, Depends, HTTPException, Query, status

from ..db import get_conn
from ..models import QueueItem, QueueItemAck, QueueItemCreate, QueueStatus

router = APIRouter(prefix="/queue", tags=["queue"])


@router.post("", response_model=QueueItem, status_code=status.HTTP_201_CREATED)
async def add_to_queue(
    item: QueueItemCreate, conn: asyncpg.Connection = Depends(get_conn)
) -> QueueItem:
    row = await conn.fetchrow(
        """
        INSERT INTO queue_items (work_id, metadata_json, epub_r2_path, source)
        VALUES ($1, $2, $3, $4)
        RETURNING *
        """,
        item.work_id,
        item.metadata_json,
        item.epub_r2_path,
        item.source,
    )
    return QueueItem(**dict(row))


@router.get("", response_model=list[QueueItem])
async def list_queue(
    status_filter: QueueStatus | None = Query(None, alias="status"),
    limit: int = Query(100, ge=1, le=1000),
    conn: asyncpg.Connection = Depends(get_conn),
) -> list[QueueItem]:
    if status_filter is None:
        rows = await conn.fetch(
            "SELECT * FROM queue_items ORDER BY created_at LIMIT $1", limit
        )
    else:
        rows = await conn.fetch(
            "SELECT * FROM queue_items WHERE status = $1 ORDER BY created_at LIMIT $2",
            status_filter.value,
            limit,
        )
    return [QueueItem(**dict(r)) for r in rows]


@router.post("/{item_id}/ack", response_model=QueueItem)
async def ack_queue_item(
    item_id: UUID,
    ack: QueueItemAck,
    conn: asyncpg.Connection = Depends(get_conn),
) -> QueueItem:
    row = await conn.fetchrow(
        """
        UPDATE queue_items
           SET status = $2,
               calibre_id_assigned = COALESCE($3, calibre_id_assigned),
               review_payload = COALESCE($4, review_payload),
               error_message = $5,
               updated_at = now()
         WHERE id = $1
        RETURNING *
        """,
        item_id,
        ack.status.value,
        ack.calibre_id_assigned,
        ack.review_payload,
        ack.error_message,
    )
    if row is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Queue item not found")
    return QueueItem(**dict(row))
