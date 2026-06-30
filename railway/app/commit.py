"""Commit a queue item to the library (redesign §12.1 commit sequence).

Runs when an item is approved (auto-resolved or review-confirmed) AND its epub
has been staged. Sequence:
  1. copy staging epub -> /epubs/{work_id}.epub (R2; skipped if R2 unconfigured)
  2. transactionally upsert works + work_authors + work_tags
  3. delete the staging object (best-effort)
  4. (Phase C) trigger snapshot rebuild + version bump

Pure-ish: all DB writes share one transaction; R2 copy precedes it (so a work is
never committed without its epub) and the staging delete follows it.
"""

from __future__ import annotations

import asyncpg

from . import r2
from .models import NormalizationProposals, RawCapture


async def maybe_commit(conn: asyncpg.Connection, queue_item_id) -> str:
    """Commit the item iff it is approved + epub-staged. Returns the new state."""
    row = await conn.fetchrow(
        "SELECT queue_item_id, work_id, raw_metadata, staging_key, state, proposals "
        "FROM queue_items WHERE queue_item_id = $1",
        queue_item_id,
    )
    if row is None:
        return "missing"
    if row["state"] not in ("normalized", "needs_review"):
        return row["state"]
    proposals = NormalizationProposals(**(row["proposals"] or {}))
    if not (proposals.auto or proposals.approved) or not proposals.epub_staged:
        return row["state"]

    try:
        await _commit(conn, row, proposals)
    except Exception as exc:  # noqa: BLE001 - record failure, don't crash the request
        await conn.execute(
            "UPDATE queue_items SET state='failed', error=$2, updated_at=now() "
            "WHERE queue_item_id=$1",
            queue_item_id, str(exc),
        )
        return "failed"
    return "committed"


async def upsert_work(
    conn: asyncpg.Connection,
    work_id: int,
    capture: RawCapture,
    proposals: NormalizationProposals,
    staging_key: str | None,
) -> None:
    """Copy the staged epub to its permanent key, then upsert works + work_authors +
    work_tags in one transaction, then drop the staging object. Shared by the legacy
    queue_items commit and the pending-queue capture apply. Idempotent (edges are
    replaced), so a re-commit is safe. Never commits a work without its epub: the R2
    copy precedes the DB write."""
    epub_r2_key: str | None = None
    if r2.is_configured() and staging_key:
        epub_r2_key = r2.epub_key(work_id)
        await r2.copy(staging_key, epub_r2_key)

    async with conn.transaction():
        await conn.execute(
            """
            INSERT INTO works (
                work_id, source, work_type, source_url, title, summary_html,
                wordcount, chapter_count, is_complete, language, series_name,
                series_index, rating, read_status, is_favorite, pinned,
                date_added, availability, epub_r2_key, epub_hash
            ) VALUES (
                $1,'ao3','fanfiction',$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,
                'Unread',false,false,now(),'live',$12,$13
            )
            ON CONFLICT (work_id) DO UPDATE SET
                source_url = EXCLUDED.source_url,
                title = EXCLUDED.title,
                summary_html = EXCLUDED.summary_html,
                wordcount = EXCLUDED.wordcount,
                chapter_count = EXCLUDED.chapter_count,
                is_complete = EXCLUDED.is_complete,
                language = EXCLUDED.language,
                series_name = EXCLUDED.series_name,
                series_index = EXCLUDED.series_index,
                rating = EXCLUDED.rating,
                epub_r2_key = COALESCE(EXCLUDED.epub_r2_key, works.epub_r2_key),
                epub_hash = COALESCE(EXCLUDED.epub_hash, works.epub_hash),
                updated_at = now()
            """,
            work_id, capture.source_url, capture.title, capture.summary_html,
            capture.wordcount, capture.chapter_count, capture.is_complete,
            capture.language, capture.series_name, capture.series_index,
            proposals.rating.value if proposals.rating else None,
            epub_r2_key, proposals.epub_hash,
        )

        # authors (byline order) — replace edges for idempotent re-commit.
        await conn.execute("DELETE FROM work_authors WHERE work_id = $1", work_id)
        for position, name in enumerate(capture.authors):
            name = (name or "").strip()
            if not name:
                continue
            author = await conn.fetchrow(
                "INSERT INTO authors (name) VALUES ($1) "
                "ON CONFLICT (name) DO UPDATE SET name = EXCLUDED.name "
                "RETURNING author_id",
                name,
            )
            await conn.execute(
                "INSERT INTO work_authors (work_id, author_id, position) "
                "VALUES ($1,$2,$3) ON CONFLICT (work_id, author_id) "
                "DO UPDATE SET position = EXCLUDED.position",
                work_id, author["author_id"], position,
            )

        # tags — replace edges; tag rows themselves were created at insert.
        await conn.execute("DELETE FROM work_tags WHERE work_id = $1", work_id)
        for prop in proposals.tags:
            tag_id = prop.tag_id
            if tag_id is None:
                found = await conn.fetchrow(
                    "SELECT tag_id FROM tags WHERE name=$1 AND kind=$2",
                    prop.name, prop.kind.value,
                )
                if found is None:
                    continue
                tag_id = found["tag_id"]
            await conn.execute(
                "INSERT INTO work_tags (work_id, tag_id, position, "
                "is_primary_ship, is_primary_collection) VALUES ($1,$2,$3,$4,$5)",
                work_id, tag_id, prop.position,
                prop.is_primary_ship, prop.is_primary_collection,
            )

    # clean up staging (best-effort; a leftover is harmless).
    if r2.is_configured() and staging_key:
        try:
            await r2.delete(staging_key)
        except Exception:  # noqa: BLE001
            pass


async def _commit(
    conn: asyncpg.Connection, row, proposals: NormalizationProposals
) -> None:
    work_id: int = row["work_id"]
    await upsert_work(
        conn, work_id, RawCapture(**(row["raw_metadata"] or {})), proposals, row["staging_key"]
    )
    await conn.execute(
        "UPDATE queue_items SET state='committed', error=NULL, updated_at=now() "
        "WHERE queue_item_id = $1",
        row["queue_item_id"],
    )
    # Resolve sibling queue items for the same work (duplicate captures) so an orphan
    # row for an already-committed work stops relisting.
    await conn.execute(
        "UPDATE queue_items SET state='committed', error=NULL, updated_at=now() "
        "WHERE work_id = $1 AND queue_item_id <> $2 "
        "AND state IN ('pending','normalized','needs_review','auto_committed')",
        work_id, row["queue_item_id"],
    )
