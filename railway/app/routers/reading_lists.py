"""/api/reading-lists — CRUD + membership for manual reading lists (§6.4).

The system "Favorites" smart list is derived from works.is_favorite and is
synthesized client-side (the PWA already holds every work), so this router only
manages ordinary, user-created lists. Cover-image upload to R2 (the 200×200 crop,
§6.4) is a later sub-step; cover_image_r2_key is accepted but not yet produced.
"""

from __future__ import annotations

from uuid import UUID

import asyncpg
from fastapi import APIRouter, Depends, HTTPException, Response, status

from ..db import get_conn
from ..models import (
    ReadingList, ReadingListCreate, ReadingListMembers, ReadingListOrder,
    ReadingListPatch,
)

router = APIRouter(prefix="/reading-lists", tags=["reading-lists"])

_COLS = (
    "id, name, description, color, cover_image_r2_key, auto_pin, is_system, "
    "starred, membership_rule, display_order, created_at, updated_at"
)


async def _members(conn: asyncpg.Connection, list_id: UUID) -> list[int]:
    rows = await conn.fetch(
        "SELECT work_id FROM reading_list_members WHERE reading_list_id = $1 "
        "ORDER BY position NULLS LAST, added_at",
        list_id,
    )
    return [r["work_id"] for r in rows]


async def _get(conn: asyncpg.Connection, list_id: UUID) -> ReadingList:
    row = await conn.fetchrow(f"SELECT {_COLS} FROM reading_lists WHERE id = $1", list_id)
    if row is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Reading list not found")
    return ReadingList(**dict(row), member_ids=await _members(conn, list_id))


@router.get("", response_model=list[ReadingList])
async def list_lists(conn: asyncpg.Connection = Depends(get_conn)) -> list[ReadingList]:
    rows = await conn.fetch(
        f"SELECT {_COLS} FROM reading_lists ORDER BY display_order NULLS LAST, name"
    )
    mem = {
        r["reading_list_id"]: r["ids"]
        for r in await conn.fetch(
            "SELECT reading_list_id, array_agg(work_id ORDER BY position NULLS LAST, added_at) AS ids "
            "FROM reading_list_members GROUP BY reading_list_id"
        )
    }
    return [ReadingList(**dict(r), member_ids=list(mem.get(r["id"], []))) for r in rows]


@router.post("", response_model=ReadingList, status_code=status.HTTP_201_CREATED)
async def create_list(
    body: ReadingListCreate, conn: asyncpg.Connection = Depends(get_conn)
) -> ReadingList:
    row = await conn.fetchrow(
        f"INSERT INTO reading_lists (name, description, color, auto_pin, starred) "
        f"VALUES ($1,$2,$3,$4,$5) RETURNING {_COLS}",
        body.name, body.description, body.color, body.auto_pin, body.starred,
    )
    return ReadingList(**dict(row), member_ids=[])


@router.patch("/{list_id}", response_model=ReadingList)
async def patch_list(
    list_id: UUID, patch: ReadingListPatch, conn: asyncpg.Connection = Depends(get_conn)
) -> ReadingList:
    fields = patch.model_dump(exclude_unset=True)
    if not fields:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "No fields to update")
    sets, params = [], []
    for key, value in fields.items():
        params.append(value)
        sets.append(f"{key} = ${len(params)}")
    params.append(list_id)
    row = await conn.fetchrow(
        f"UPDATE reading_lists SET {', '.join(sets)}, updated_at = now() "
        f"WHERE id = ${len(params)} RETURNING {_COLS}",
        *params,
    )
    if row is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Reading list not found")
    return ReadingList(**dict(row), member_ids=await _members(conn, list_id))


@router.delete("/{list_id}")
async def delete_list(list_id: UUID, conn: asyncpg.Connection = Depends(get_conn)) -> Response:
    row = await conn.fetchrow("SELECT is_system FROM reading_lists WHERE id = $1", list_id)
    if row is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Reading list not found")
    if row["is_system"]:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "System lists cannot be deleted")
    await conn.execute("DELETE FROM reading_lists WHERE id = $1", list_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post("/{list_id}/members", response_model=ReadingList)
async def add_members(
    list_id: UUID, body: ReadingListMembers, conn: asyncpg.Connection = Depends(get_conn)
) -> ReadingList:
    """Idempotent add — appends to the end (max position + 1), skips duplicates."""
    await _get(conn, list_id)  # 404 if absent
    if body.work_ids:
        start = await conn.fetchval(
            "SELECT COALESCE(MAX(position), 0) FROM reading_list_members WHERE reading_list_id = $1",
            list_id,
        )
        await conn.executemany(
            "INSERT INTO reading_list_members (reading_list_id, work_id, position) "
            "VALUES ($1,$2,$3) ON CONFLICT (reading_list_id, work_id) DO NOTHING",
            [(list_id, wid, start + 1 + i) for i, wid in enumerate(body.work_ids)],
        )
    return await _get(conn, list_id)


@router.post("/{list_id}/members/remove", response_model=ReadingList)
async def remove_members(
    list_id: UUID, body: ReadingListMembers, conn: asyncpg.Connection = Depends(get_conn)
) -> ReadingList:
    await _get(conn, list_id)
    if body.work_ids:
        await conn.execute(
            "DELETE FROM reading_list_members WHERE reading_list_id = $1 AND work_id = ANY($2::bigint[])",
            list_id, body.work_ids,
        )
    return await _get(conn, list_id)


@router.put("/{list_id}/order", response_model=ReadingList)
async def reorder_members(
    list_id: UUID, body: ReadingListOrder, conn: asyncpg.Connection = Depends(get_conn)
) -> ReadingList:
    """Replace member ordering (Manual-sort drag-and-drop): position = index."""
    await _get(conn, list_id)
    async with conn.transaction():
        for i, wid in enumerate(body.work_ids):
            await conn.execute(
                "UPDATE reading_list_members SET position = $3 "
                "WHERE reading_list_id = $1 AND work_id = $2",
                list_id, wid, i + 1,
            )
    return await _get(conn, list_id)
