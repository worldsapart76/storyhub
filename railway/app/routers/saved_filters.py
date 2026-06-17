"""/api/saved-filters — CRUD for saved Browse filter/sort state (§6.5).

filter_state_json stores the PWA's FilterState verbatim; sort_state_json stores
the sort selection. Starred filters surface as Browse quick-chips. The PWA reads
these live (not from the snapshot) so a newly saved filter appears immediately.
"""

from __future__ import annotations

from uuid import UUID

import asyncpg
from fastapi import APIRouter, Depends, HTTPException, Response, status

from ..db import get_conn
from ..models import SavedFilter, SavedFilterCreate, SavedFilterPatch

router = APIRouter(prefix="/saved-filters", tags=["saved-filters"])

_COLS = (
    "id, name, filter_state_json, sort_state_json, starred, display_order, "
    "created_at, updated_at"
)


@router.get("", response_model=list[SavedFilter])
async def list_filters(conn: asyncpg.Connection = Depends(get_conn)) -> list[SavedFilter]:
    rows = await conn.fetch(
        f"SELECT {_COLS} FROM saved_filters "
        f"ORDER BY starred DESC, display_order NULLS LAST, name"
    )
    return [SavedFilter(**dict(r)) for r in rows]


@router.post("", response_model=SavedFilter, status_code=status.HTTP_201_CREATED)
async def create_filter(
    body: SavedFilterCreate, conn: asyncpg.Connection = Depends(get_conn)
) -> SavedFilter:
    row = await conn.fetchrow(
        f"INSERT INTO saved_filters (name, filter_state_json, sort_state_json, starred) "
        f"VALUES ($1,$2,$3,$4) RETURNING {_COLS}",
        body.name, body.filter_state_json, body.sort_state_json, body.starred,
    )
    return SavedFilter(**dict(row))


@router.patch("/{filter_id}", response_model=SavedFilter)
async def patch_filter(
    filter_id: UUID, patch: SavedFilterPatch, conn: asyncpg.Connection = Depends(get_conn)
) -> SavedFilter:
    fields = patch.model_dump(exclude_unset=True)
    if not fields:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "No fields to update")
    sets, params = [], []
    for key, value in fields.items():
        params.append(value)
        sets.append(f"{key} = ${len(params)}")
    params.append(filter_id)
    row = await conn.fetchrow(
        f"UPDATE saved_filters SET {', '.join(sets)}, updated_at = now() "
        f"WHERE id = ${len(params)} RETURNING {_COLS}",
        *params,
    )
    if row is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Saved filter not found")
    return SavedFilter(**dict(row))


@router.delete("/{filter_id}")
async def delete_filter(filter_id: UUID, conn: asyncpg.Connection = Depends(get_conn)) -> Response:
    res = await conn.execute("DELETE FROM saved_filters WHERE id = $1", filter_id)
    if res.endswith(" 0"):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Saved filter not found")
    return Response(status_code=status.HTTP_204_NO_CONTENT)
