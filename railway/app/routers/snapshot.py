"""/api/snapshot — current-version pointer + bump (redesign §12.3).

`version` is the CONTENT version (clients re-download when it differs);
`format_version` is the snapshot STRUCTURE version (bump on a projection code
change — the CLAUDE.md hard rule — so clients invalidate incompatible caches).
The snapshot builder itself is Phase C; these endpoints back it.
"""

from __future__ import annotations

import asyncpg
from fastapi import APIRouter, Depends, HTTPException, status

from .. import r2, snapshot_builder
from ..db import get_conn
from ..models import SnapshotBump, SnapshotVersion

router = APIRouter(prefix="/snapshot", tags=["snapshot"])

_COLUMNS = "version, format_version, r2_path, work_count, created_at"


@router.get("/current", response_model=SnapshotVersion)
async def current_snapshot(
    conn: asyncpg.Connection = Depends(get_conn),
) -> SnapshotVersion:
    row = await conn.fetchrow(
        f"SELECT {_COLUMNS} FROM snapshot_versions ORDER BY version DESC LIMIT 1"
    )
    if row is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "No snapshot exists yet")
    return SnapshotVersion(**dict(row))


@router.post("/build", status_code=status.HTTP_201_CREATED)
async def build_snapshot(conn: asyncpg.Connection = Depends(get_conn)) -> dict:
    """Build the snapshot from current Postgres state, upload to R2, write
    current.json, and bump the content version (redesign §12.3). Used after the
    migration bulk-load and (later) on capture commits."""
    if not r2.is_configured():
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, "R2 not configured")
    return await snapshot_builder.build_and_upload(conn)


@router.post("/bump", response_model=SnapshotVersion, status_code=status.HTTP_201_CREATED)
async def bump_snapshot(
    bump: SnapshotBump, conn: asyncpg.Connection = Depends(get_conn)
) -> SnapshotVersion:
    row = await conn.fetchrow(
        f"""
        INSERT INTO snapshot_versions (version, format_version, r2_path, work_count)
        VALUES (
            (SELECT COALESCE(MAX(version), 0) + 1 FROM snapshot_versions),
            $1, $2, $3
        )
        RETURNING {_COLUMNS}
        """,
        bump.format_version, bump.r2_path, bump.work_count,
    )
    return SnapshotVersion(**dict(row))
