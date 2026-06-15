"""/api/queue — import pipeline (redesign §12.1).

Flow: extension POSTs raw AO3 metadata -> Railway normalizes (creates tag rows,
proposes lowest-position primaries, decides auto vs review) and mints a presigned
R2 PUT for the epub -> extension uploads bytes, then POSTs /uploaded -> auto
items commit; ambiguous items wait for POST /review (primaries only) -> commit.
"""

from __future__ import annotations

from uuid import UUID

import asyncpg
from fastapi import APIRouter, Depends, HTTPException, Query, status

from .. import commit, r2
from ..db import get_conn
from ..models import (
    NormalizationProposals,
    QueueCreateResponse,
    QueueItem,
    QueueState,
    RawCapture,
    ReviewDecision,
    UploadedNotice,
)
from ..normalize import normalize_capture

router = APIRouter(prefix="/queue", tags=["queue"])

_COLUMNS = (
    "queue_item_id, work_id, source, raw_metadata, staging_key, state, "
    "proposals, error, created_at, updated_at"
)


async def _load(conn: asyncpg.Connection, queue_item_id: UUID) -> QueueItem:
    row = await conn.fetchrow(
        f"SELECT {_COLUMNS} FROM queue_items WHERE queue_item_id = $1", queue_item_id
    )
    if row is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Queue item not found")
    return QueueItem(**dict(row))


@router.post("", response_model=QueueCreateResponse, status_code=status.HTTP_201_CREATED)
async def capture(
    payload: RawCapture, conn: asyncpg.Connection = Depends(get_conn)
) -> QueueCreateResponse:
    proposals = normalize_capture(payload)

    item = await conn.fetchrow(
        "INSERT INTO queue_items (work_id, source, raw_metadata, state) "
        "VALUES ($1,$2,$3,'pending') RETURNING queue_item_id",
        payload.work_id, payload.source.value, payload.model_dump(mode="json"),
    )
    queue_item_id = item["queue_item_id"]
    staging_key = r2.staging_key(str(queue_item_id))

    # Create the raw tag rows (ungrouped/uncategorized — never blocks import) and
    # capture their tag_ids back into the proposals.
    for prop in proposals.tags:
        tag = await conn.fetchrow(
            "INSERT INTO tags (name, kind) VALUES ($1,$2) "
            "ON CONFLICT (name, kind) DO UPDATE SET updated_at = now() "
            "RETURNING tag_id",
            prop.name, prop.kind.value,
        )
        prop.tag_id = tag["tag_id"]

    proposals.approved = proposals.auto      # auto items skip the Review Queue
    state = QueueState.normalized if proposals.auto else QueueState.needs_review

    await conn.execute(
        "UPDATE queue_items SET staging_key=$2, proposals=$3, state=$4, "
        "updated_at=now() WHERE queue_item_id=$1",
        queue_item_id, staging_key, proposals.model_dump(mode="json"), state.value,
    )

    presigned = r2.presign_put(staging_key) if r2.is_configured() else None
    return QueueCreateResponse(
        queue_item=await _load(conn, queue_item_id),
        presigned_put_url=presigned,
        needs_review=not proposals.auto,
    )


@router.post("/{queue_item_id}/uploaded", response_model=QueueItem)
async def epub_uploaded(
    queue_item_id: UUID,
    notice: UploadedNotice,
    conn: asyncpg.Connection = Depends(get_conn),
) -> QueueItem:
    """Extension reports the staging epub is up. Auto items commit now."""
    row = await conn.fetchrow(
        "SELECT proposals FROM queue_items WHERE queue_item_id = $1", queue_item_id
    )
    if row is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Queue item not found")
    proposals = NormalizationProposals(**(row["proposals"] or {}))
    proposals.epub_staged = True
    if notice.epub_hash:
        proposals.epub_hash = notice.epub_hash
    await conn.execute(
        "UPDATE queue_items SET proposals=$2, updated_at=now() "
        "WHERE queue_item_id=$1",
        queue_item_id, proposals.model_dump(mode="json"),
    )
    await commit.maybe_commit(conn, queue_item_id)
    return await _load(conn, queue_item_id)


@router.post("/{queue_item_id}/review", response_model=QueueItem)
async def confirm_review(
    queue_item_id: UUID,
    decision: ReviewDecision,
    conn: asyncpg.Connection = Depends(get_conn),
) -> QueueItem:
    """Per-work Review Queue confirm — set which of the work's own tags carry the
    primary-ship / primary-collection flags. Never touches tags/groups (§12.1)."""
    row = await conn.fetchrow(
        "SELECT state, proposals FROM queue_items WHERE queue_item_id = $1",
        queue_item_id,
    )
    if row is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Queue item not found")
    proposals = NormalizationProposals(**(row["proposals"] or {}))
    valid_ids = {p.tag_id for p in proposals.tags}
    for tag_id in (decision.primary_ship_tag_id, decision.primary_collection_tag_id):
        if tag_id is not None and tag_id not in valid_ids:
            raise HTTPException(
                status.HTTP_422_UNPROCESSABLE_ENTITY,
                f"tag_id {tag_id} is not one of this work's tags",
            )

    for prop in proposals.tags:
        prop.is_primary_ship = prop.tag_id == decision.primary_ship_tag_id
        prop.is_primary_collection = prop.tag_id == decision.primary_collection_tag_id
    proposals.primary_ship_name = next(
        (p.name for p in proposals.tags if p.is_primary_ship), None
    )
    proposals.primary_collection_name = next(
        (p.name for p in proposals.tags if p.is_primary_collection), None
    )
    proposals.approved = True

    await conn.execute(
        "UPDATE queue_items SET proposals=$2, updated_at=now() "
        "WHERE queue_item_id=$1",
        queue_item_id, proposals.model_dump(mode="json"),
    )
    await commit.maybe_commit(conn, queue_item_id)
    return await _load(conn, queue_item_id)


@router.get("", response_model=list[QueueItem])
async def list_queue(
    state: QueueState | None = Query(None),
    limit: int = Query(100, ge=1, le=1000),
    conn: asyncpg.Connection = Depends(get_conn),
) -> list[QueueItem]:
    if state is None:
        rows = await conn.fetch(
            f"SELECT {_COLUMNS} FROM queue_items ORDER BY created_at LIMIT $1", limit
        )
    else:
        rows = await conn.fetch(
            f"SELECT {_COLUMNS} FROM queue_items WHERE state=$1 "
            f"ORDER BY created_at LIMIT $2",
            state.value, limit,
        )
    return [QueueItem(**dict(r)) for r in rows]


@router.get("/{queue_item_id}", response_model=QueueItem)
async def get_queue_item(
    queue_item_id: UUID, conn: asyncpg.Connection = Depends(get_conn)
) -> QueueItem:
    return await _load(conn, queue_item_id)
