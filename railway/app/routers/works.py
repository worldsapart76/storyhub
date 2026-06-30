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

from .. import r2, snapshot_builder
from ..db import get_conn
from ..models import (
    ReadStatus, ReconcileFavoritesRequest, ReviewDecision, Work,
    WorkCollectionAdd, WorkPatch, WorkUpsert)

router = APIRouter(prefix="/works", tags=["works"])


def _safe_filename(title: str | None) -> str:
    name = re.sub(r'[<>:"/\\|?*\x00-\x1f]', "", (title or "work")).strip() or "work"
    return name[:120] + ".epub"

_COLUMNS = (
    "work_id, source, work_type, source_url, title, summary_html, short_summary, "
    "wordcount, chapter_count, is_complete, language, series_name, series_index, "
    "rating, read_status, is_favorite, pinned, personal_notes, date_read, date_added, "
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
            epub_hash, cover_r2_key, personal_notes
        ) VALUES (
            $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,
            COALESCE($19, now()),$20,$21,$22,$23,$24,$25
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
            -- never wipe a user's note on a re-commit / re-scrape (upsert is
            -- import/migration only; notes are written via PATCH). Preserve unless
            -- the caller explicitly supplies one.
            personal_notes = COALESCE(EXCLUDED.personal_notes, works.personal_notes),
            updated_at = now()
        RETURNING {_COLUMNS}
        """,
        work.work_id, work.source.value, work.work_type.value, work.source_url,
        work.title, work.summary_html, work.short_summary, work.wordcount,
        work.chapter_count, work.is_complete, work.language, work.series_name,
        work.series_index, work.rating.value if work.rating else None,
        work.read_status.value, work.is_favorite, work.pinned, work.date_read,
        work.date_added, work.availability.value, work.last_seen_on_ao3,
        work.epub_r2_key, work.epub_hash, work.cover_r2_key, work.personal_notes,
    )
    return Work(**dict(row))


@router.post("/{work_id}/primaries")
async def set_primaries(
    work_id: int, decision: ReviewDecision, conn: asyncpg.Connection = Depends(get_conn)
) -> dict:
    """Re-assign a committed work's primary ship / primary collection — the same
    per-work decision the Review Queue makes at capture, for works already in the
    library (the user fixes ones missed or changed their mind on). Primaries are
    `work_tags` flags, so this never touches Tag Management's grouping/category work
    (hard rule). The chosen tags must be the work's own (ship = a relationship tag,
    collection = a fandom tag); null clears the axis (Gen / no collection). Takes
    effect in Browse on the next snapshot rebuild."""
    own = await conn.fetch(
        "SELECT wt.tag_id, t.kind FROM work_tags wt JOIN tags t ON t.tag_id = wt.tag_id "
        "WHERE wt.work_id = $1", work_id)
    if not own:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Work not found or has no tags")
    ships = {r["tag_id"] for r in own if r["kind"] == "relationship"}
    fandoms = {r["tag_id"] for r in own if r["kind"] == "fandom"}
    sid, cid = decision.primary_ship_tag_id, decision.primary_collection_tag_id
    if sid is not None and sid not in ships:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY,
                            f"tag {sid} is not one of this work's relationship tags")
    if cid is not None and cid not in fandoms:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY,
                            f"tag {cid} is not one of this work's fandom tags")
    # Clear-then-set in a txn: the partial unique indexes (one primary ship /
    # collection per work) are checked per-row, so flipping old→new in a single
    # statement transiently has two rows flagged and raises. Clearing first avoids
    # that; the txn keeps it atomic.
    async with conn.transaction():
        await conn.execute(
            "UPDATE work_tags SET is_primary_ship = false, is_primary_collection = false "
            "WHERE work_id = $1", work_id)
        if sid is not None or cid is not None:
            await conn.execute(
                "UPDATE work_tags SET is_primary_ship = ((tag_id = $2) IS TRUE), "
                "is_primary_collection = ((tag_id = $3) IS TRUE) "
                "WHERE work_id = $1 AND tag_id IN ($2, $3)",
                work_id, sid, cid)
        await conn.execute("UPDATE works SET updated_at = now() WHERE work_id = $1", work_id)
    return {"ok": True, "primary_ship_tag_id": sid, "primary_collection_tag_id": cid}


@router.post("/{work_id}/collections")
async def add_collection(
    work_id: int, body: WorkCollectionAdd, conn: asyncpg.Connection = Depends(get_conn)
) -> dict:
    """Add a fandom tag edge to a work (curation: the correct fandom was never on the
    work because the author filed only a ship-as-fandom). Idempotent on the edge;
    `set_primary` makes it the primary collection (clear-then-set in a txn, like
    set_primaries, to avoid the one-primary-per-work partial-index violation). Takes
    effect in Browse on the next snapshot rebuild."""
    if await conn.fetchrow("SELECT 1 FROM works WHERE work_id = $1", work_id) is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Work not found")
    tag = await conn.fetchrow("SELECT kind FROM tags WHERE tag_id = $1", body.tag_id)
    if tag is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Tag not found")
    if tag["kind"] != "fandom":
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY,
                            f"tag {body.tag_id} is not a fandom (kind={tag['kind']})")
    async with conn.transaction():
        pos = await conn.fetchval(
            "SELECT COALESCE(MAX(position), 0) + 1 FROM work_tags WHERE work_id = $1",
            work_id)
        await conn.execute(
            "INSERT INTO work_tags (work_id, tag_id, position, is_primary_collection) "
            "VALUES ($1, $2, $3, false) ON CONFLICT (work_id, tag_id) DO NOTHING",
            work_id, body.tag_id, pos)
        if body.set_primary:
            await conn.execute(
                "UPDATE work_tags SET is_primary_collection = false WHERE work_id = $1",
                work_id)
            await conn.execute(
                "UPDATE work_tags SET is_primary_collection = true "
                "WHERE work_id = $1 AND tag_id = $2", work_id, body.tag_id)
        await conn.execute("UPDATE works SET updated_at = now() WHERE work_id = $1", work_id)
    return {"ok": True, "work_id": work_id, "tag_id": body.tag_id,
            "set_primary": body.set_primary}


@router.post("/reconcile-favorites")
async def reconcile_favorites(
    body: ReconcileFavoritesRequest, conn: asyncpg.Connection = Depends(get_conn)
) -> dict:
    """Backfill is_favorite from the AO3 bookmark set. The extension scrapes the AO3
    bookmarks list (only it has the session) and POSTs the work ids; any AO3 bookmark =
    Favorite (§12.2). The user only ever bookmarks fics they've READ, so for each
    supplied work in the library: set is_favorite=true, and force read_status=Read on
    any that isn't already Read (the odd Unread, or a stray DNF as a correction).
    date_read is NOT stamped — these are historical bookmarks with no real read date, so
    faking now() would spike Stats; they stay out of the day-bars (unknown date). No AO3
    write-back (the bookmark already exists). Idempotent.

    Returns a report: counts of newly favorited / already-favorite / newly Read, and the
    ids NOT in the library (capture candidates the extension surfaces separately). The
    reverse gap — favorited here but not bookmarked on AO3 — is computed client-side."""
    ids = list(dict.fromkeys(body.work_ids))  # de-dupe, preserve order
    if not ids:
        return {"favorited": 0, "already": 0, "newly_read": 0, "not_in_library": []}
    rows = await conn.fetch(
        "SELECT work_id, is_favorite, read_status FROM works "
        "WHERE work_id = ANY($1::bigint[])",
        ids,
    )
    present = {r["work_id"] for r in rows}
    not_in_library = [i for i in ids if i not in present]
    to_favorite = [r["work_id"] for r in rows if not r["is_favorite"]]
    to_read = [r["work_id"] for r in rows if r["read_status"] != ReadStatus.read.value]

    if to_favorite:
        await conn.execute(
            "UPDATE works SET is_favorite = true, updated_at = now() "
            "WHERE work_id = ANY($1::bigint[])", to_favorite)
    if to_read:
        await conn.execute(
            "UPDATE works SET read_status = 'Read', updated_at = now() "
            "WHERE work_id = ANY($1::bigint[])", to_read)

    result = {
        "favorited": len(to_favorite),
        "already": len(present) - len(to_favorite),
        "newly_read": len(to_read),
        "not_in_library": not_in_library,
    }
    if (to_favorite or to_read) and r2.is_configured():
        snap = await snapshot_builder.build_and_upload(conn)
        result["snapshot_version"] = snap.get("version")
    return result


@router.patch("/{work_id}", response_model=Work)
async def patch_work(
    work_id: int, patch: WorkPatch, conn: asyncpg.Connection = Depends(get_conn)
) -> Work:
    """Partial update — deliberate status/favorite writes from the PWA/extension
    (Phase F). Unread IS allowed here: PATCH is always a deliberate user action
    (re-marks for later on AO3 in Phase E). The "never clobber to Unread" rule is
    enforced on IMPORT (fresh-only default), not on this deliberate path."""
    fields = patch.model_dump(exclude_unset=True)
    if not fields:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "No fields to update")
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
