"""/api/snapshot — current-version pointer + worker bump.

version is the client cache-invalidation key. bump assigns the next integer;
HARD RULE (docs/data-model.md §6.5): the worker must bump on any snapshot
format change so clients invalidate their IndexedDB cache.
"""

from __future__ import annotations

import asyncpg
from fastapi import APIRouter, Depends, HTTPException, status

from ..db import get_conn
from ..models import SnapshotBump, SnapshotVersion

router = APIRouter(prefix="/snapshot", tags=["snapshot"])


@router.get("/current", response_model=SnapshotVersion)
async def current_snapshot(
    conn: asyncpg.Connection = Depends(get_conn),
) -> SnapshotVersion:
    row = await conn.fetchrow(
        "SELECT * FROM snapshot_versions ORDER BY version DESC LIMIT 1"
    )
    if row is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "No snapshot exists yet")
    return SnapshotVersion(**dict(row))


@router.post("/bump", response_model=SnapshotVersion, status_code=status.HTTP_201_CREATED)
async def bump_snapshot(
    bump: SnapshotBump, conn: asyncpg.Connection = Depends(get_conn)
) -> SnapshotVersion:
    row = await conn.fetchrow(
        """
        INSERT INTO snapshot_versions (version, r2_path, book_count)
        VALUES (
            (SELECT COALESCE(MAX(version), 0) + 1 FROM snapshot_versions),
            $1, $2
        )
        RETURNING *
        """,
        bump.r2_path,
        bump.book_count,
    )
    return SnapshotVersion(**dict(row))
