"""/api/works — the central entity (redesign §6.1).

Read endpoints serve clients; write endpoints serve migration (Phase D), the
commit pipeline (Phase B), and the PWA's optimistic status/favorite writes
(Phase F). Tag/author edges are written by their own flows, not here.
"""

from __future__ import annotations

import re

import asyncpg
from fastapi import APIRouter, Depends, HTTPException, Query, status
from fastapi.responses import Response

from .. import r2
from ..db import get_conn
from ..models import ReadStatus, Work, WorkPatch, WorkUpsert

router = APIRouter(prefix="/works", tags=["works"])


def _safe_filename(title: str | None) -> str:
    name = re.sub(r'[<>:"/\\|?*\x00-\x1f]', "", (title or "work")).strip() or "work"
    return name[:120] + ".epub"

_COLUMNS = (
    "work_id, source, work_type, source_url, title, summary_html, short_summary, "
    "wordcount, chapter_count, is_complete, language, series_name, series_index, "
    "rating, read_status, is_favorite, pinned, date_read, date_added, "
    "availability, last_seen_on_ao3, epub_r2_key, epub_hash, cover_r2_key, "
    "created_at, updated_at"
)


@router.get("", response_model=list[Work])
async def list_works(
    read_status: ReadStatus | None = Query(None),
    is_favorite: bool | None = Query(None),
    limit: int = Query(500, ge=1, le=5000),
    offset: int = Query(0, ge=0),
    conn: asyncpg.Connection = Depends(get_conn),
) -> list[Work]:
    clauses: list[str] = []
    params: list[object] = []
    if read_status is not None:
        params.append(read_status.value)
        clauses.append(f"read_status = ${len(params)}")
    if is_favorite is not None:
        params.append(is_favorite)
        clauses.append(f"is_favorite = ${len(params)}")
    where = f"WHERE {' AND '.join(clauses)}" if clauses else ""
    params.extend([limit, offset])
    rows = await conn.fetch(
        f"SELECT {_COLUMNS} FROM works {where} "
        f"ORDER BY date_added DESC NULLS LAST, work_id "
        f"LIMIT ${len(params) - 1} OFFSET ${len(params)}",
        *params,
    )
    return [Work(**dict(r)) for r in rows]


@router.get("/{work_id}", response_model=Work)
async def get_work(
    work_id: int, conn: asyncpg.Connection = Depends(get_conn)
) -> Work:
    row = await conn.fetchrow(
        f"SELECT {_COLUMNS} FROM works WHERE work_id = $1", work_id
    )
    if row is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Work not found")
    return Work(**dict(row))


@router.get("/{work_id}/epub")
async def work_epub(
    work_id: int, conn: asyncpg.Connection = Depends(get_conn)
) -> Response:
    """Stream the work's epub (from R2), named by title at delivery (§12.1)."""
    row = await conn.fetchrow(
        "SELECT title, epub_r2_key FROM works WHERE work_id=$1", work_id)
    if row is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Work not found")
    if not row["epub_r2_key"]:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "No epub for this work")
    data = await r2.get_bytes(row["epub_r2_key"])
    if data is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Epub object missing from R2")
    return Response(
        content=data, media_type="application/epub+zip",
        headers={"Content-Disposition": f'attachment; filename="{_safe_filename(row["title"])}"'})


@router.put("/{work_id}", response_model=Work)
async def upsert_work(
    work_id: int, work: WorkUpsert, conn: asyncpg.Connection = Depends(get_conn)
) -> Work:
    """Create or replace a work (migration / commit). Path id is authoritative."""
    if work.work_id != work_id:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "work_id mismatch")
    row = await conn.fetchrow(
        f"""
        INSERT INTO works (
            work_id, source, work_type, source_url, title, summary_html,
            short_summary, wordcount, chapter_count, is_complete, language,
            series_name, series_index, rating, read_status, is_favorite, pinned,
            date_read, date_added, availability, last_seen_on_ao3, epub_r2_key,
            epub_hash, cover_r2_key
        ) VALUES (
            $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,
            COALESCE($19, now()),$20,$21,$22,$23,$24
        )
        ON CONFLICT (work_id) DO UPDATE SET
            source = EXCLUDED.source,
            work_type = EXCLUDED.work_type,
            source_url = EXCLUDED.source_url,
            title = EXCLUDED.title,
            summary_html = EXCLUDED.summary_html,
            short_summary = EXCLUDED.short_summary,
            wordcount = EXCLUDED.wordcount,
            chapter_count = EXCLUDED.chapter_count,
            is_complete = EXCLUDED.is_complete,
            language = EXCLUDED.language,
            series_name = EXCLUDED.series_name,
            series_index = EXCLUDED.series_index,
            rating = EXCLUDED.rating,
            read_status = EXCLUDED.read_status,
            is_favorite = EXCLUDED.is_favorite,
            pinned = EXCLUDED.pinned,
            date_read = EXCLUDED.date_read,
            availability = EXCLUDED.availability,
            last_seen_on_ao3 = EXCLUDED.last_seen_on_ao3,
            epub_r2_key = EXCLUDED.epub_r2_key,
            epub_hash = EXCLUDED.epub_hash,
            cover_r2_key = EXCLUDED.cover_r2_key,
            updated_at = now()
        RETURNING {_COLUMNS}
        """,
        work.work_id, work.source.value, work.work_type.value, work.source_url,
        work.title, work.summary_html, work.short_summary, work.wordcount,
        work.chapter_count, work.is_complete, work.language, work.series_name,
        work.series_index, work.rating.value if work.rating else None,
        work.read_status.value, work.is_favorite, work.pinned, work.date_read,
        work.date_added, work.availability.value, work.last_seen_on_ao3,
        work.epub_r2_key, work.epub_hash, work.cover_r2_key,
    )
    return Work(**dict(row))


@router.patch("/{work_id}", response_model=Work)
async def patch_work(
    work_id: int, patch: WorkPatch, conn: asyncpg.Connection = Depends(get_conn)
) -> Work:
    """Partial update — optimistic status/favorite writes (Phase F)."""
    fields = patch.model_dump(exclude_unset=True)
    if not fields:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "No fields to update")
    # Hard rule: never write 'Unread' from any source (it's the device default).
    if fields.get("read_status") == ReadStatus.unread:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_ENTITY,
            "read_status 'Unread' may not be written (hard rule)",
        )
    sets: list[str] = []
    params: list[object] = []
    for key, value in fields.items():
        params.append(value.value if hasattr(value, "value") else value)
        sets.append(f"{key} = ${len(params)}")
    params.append(work_id)
    row = await conn.fetchrow(
        f"UPDATE works SET {', '.join(sets)}, updated_at = now() "
        f"WHERE work_id = ${len(params)} RETURNING {_COLUMNS}",
        *params,
    )
    if row is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Work not found")
    return Work(**dict(row))
