"""One-time load of the 102 deleted-on-AO3 salvage works (Phase D §7.1).

Sources:
  audit_deleted.json      recovered per-work data (title/summary/authors/tags by kind)
  audit_decisions.json    human decisions (primary ship/collection, rating, kind fixes)
  migration_cache.sqlite  epub_backfill (R2 key/hash) + calibre_books (wordcount/series/lang)

Inserts the 102 works + tags + epubs into Postgres with availability='deleted' (never
queue AO3 actions for these — the work is gone). Applies the kind-check fixes, the
per-work primaries, and — for the 3 works that recovered NO tags — adds the decided
primary ship (relationship) and the collection's representative fandom so the primary
flags have somewhere to land. display_name/category are NOT set here; run
`tag_curation.py apply` afterward to categorize the freeforms, then rebuild the snapshot.

    python load_deleted.py        # uses $DATABASE_PUBLIC_URL / $DATABASE_URL

Idempotent: upserts works, refreshes each work's authors + tags inside one transaction.
"""
from __future__ import annotations

import asyncio
import json
import os
import sqlite3
import sys
from collections import defaultdict
from datetime import datetime
from pathlib import Path

HERE = Path(__file__).parent
KIND_FIELDS = [("fandoms", "fandom"), ("relationships", "relationship"),
               ("characters", "character"), ("freeforms", "freeform"), ("warnings", "warning")]
READSTATUS_MAP = {"Unread": "Unread", "Read": "Read", "DNF": "DNF",
                  "Favorite": "Read", "Priority": "Unread"}
RATINGS = {"Explicit", "Mature", "Teen", "General", "Not Rated"}


def _parse_dt(s):
    try:
        return datetime.fromisoformat(s) if s else None
    except (ValueError, TypeError):
        return None


def _int(x):
    try:
        return int(x) if x not in (None, "") else None
    except (ValueError, TypeError):
        return None


def _num(x):
    try:
        return float(x) if x not in (None, "") else None
    except (ValueError, TypeError):
        return None


def _lang(s):
    try:
        a = json.loads(s) if s else []
        return a[0] if a else None
    except (ValueError, TypeError):
        return None


async def _run(db_url):
    import asyncpg

    rec = {int(w["work_id"]): w for w in json.loads((HERE / "audit_deleted.json").read_text(encoding="utf-8"))}
    dec = json.loads((HERE / "audit_decisions.json").read_text(encoding="utf-8"))
    tagkind = dec.get("tagKind", {})
    works_dec = {int(k): v for k, v in dec["works"].items()}

    cache = sqlite3.connect(HERE / "migration_cache.sqlite")
    epub = {r[0]: (r[1], r[2]) for r in
            cache.execute("SELECT work_id, r2_key, sha256 FROM epub_backfill WHERE status='ok'")}
    cmeta = {}
    for r in cache.execute("SELECT a.work_id, b.wordcount, b.series, b.series_index, b.languages, b.timestamp "
                           "FROM ao3_scrape a JOIN calibre_books b ON a.calibre_id=b.calibre_id"):
        cmeta[r[0]] = {"wordcount": r[1], "series": r[2], "series_index": r[3], "languages": r[4], "ts": r[5]}
    cache.close()

    conn = await asyncpg.connect(db_url)
    try:
        # collection group -> {fandom names} + representative (most-used) fandom, for
        # works that recovered no fandom of their own.
        grp = defaultdict(list)
        for r in await conn.fetch(
                "SELECT g.name gname, t.name fname, "
                "(SELECT COUNT(*) FROM work_tags wt WHERE wt.tag_id=t.tag_id) uses "
                "FROM tag_groups g JOIN tag_group_members m ON m.group_id=g.group_id "
                "JOIN tags t ON t.tag_id=m.tag_id WHERE g.group_type='collection'"):
            grp[r["gname"]].append((r["fname"], r["uses"]))
        rep = {g: max(v, key=lambda x: x[1])[0] for g, v in grp.items()}
        grp_fands = {g: {f for f, _ in v} for g, v in grp.items()}

        # Build per-work tag plan (name, kind, is_primary_ship, is_primary_collection).
        plan = {}
        all_tags, all_authors, priority = set(), set(), []
        added = []  # works where we synthesized a fandom/ship (no tags recovered)
        for wid, d in works_dec.items():
            r = rec[wid]
            coll = d.get("primary_collection")
            pship = d.get("primary_ship")
            occ, seen = [], set()
            for field, kind0 in KIND_FIELDS:
                for name in r.get(field, []):
                    kind = tagkind.get(name, kind0)   # apply kind-check fixes
                    if (name, kind) in seen:
                        continue
                    seen.add((name, kind)); occ.append((name, kind))
            fands = [n for n, k in occ if k == "fandom"]
            rels = [n for n, k in occ if k == "relationship"]
            # synthesize tags for the no-recovery works so primaries have a home
            if not fands and coll in rep:
                occ.append((rep[coll], "fandom")); fands = [rep[coll]]; added.append(wid)
            if pship and pship not in rels:
                occ.append((pship, "relationship")); rels.append(pship)
            gfands = grp_fands.get(coll, set())
            prim_fandom = next((f for f in fands if f in gfands), rep.get(coll))
            rows = []
            for name, kind in occ:
                rows.append((name, kind,
                             kind == "relationship" and name == pship,
                             kind == "fandom" and name == prim_fandom))
                all_tags.add((name, kind))
            plan[wid] = rows
            for a in r.get("authors", []):
                all_authors.add(a)
            if r.get("readstatus") == "Priority":
                priority.append(wid)

        async with conn.transaction():
            # 1. Upsert tags (with kind fixes applied) -> id map.
            tag_id = {}
            for row in await conn.fetch(
                    "INSERT INTO tags (name, kind) SELECT n,k FROM unnest($1::text[],$2::text[]) u(n,k) "
                    "ON CONFLICT (name, kind) DO UPDATE SET updated_at=now() RETURNING tag_id, name, kind",
                    [n for n, _ in all_tags], [k for _, k in all_tags]):
                tag_id[(row["name"], row["kind"])] = row["tag_id"]

            # 2. Authors -> id map.
            author_id = {}
            if all_authors:
                for row in await conn.fetch(
                        "INSERT INTO authors (name) SELECT n FROM unnest($1::text[]) n "
                        "ON CONFLICT (name) DO UPDATE SET name=EXCLUDED.name RETURNING author_id, name",
                        list(all_authors)):
                    author_id[row["name"]] = row["author_id"]

            # 3. Build + send works / work_authors / work_tags.
            wrows, warows, wtrows, seen_wa, seen_wt = [], [], [], set(), set()
            for wid, d in works_dec.items():
                r, m = rec[wid], cmeta.get(wid, {})
                ekey, ehash = epub.get(wid, (None, None))
                rating = d.get("rating") or r.get("rating")
                rating = rating if rating in RATINGS else None
                wrows.append((
                    wid, f"https://archiveofourown.org/works/{wid}", r.get("title") or f"(untitled {wid})",
                    r.get("summary"), None, _int(m.get("wordcount")), None, None, _lang(m.get("languages")),
                    m.get("series") or None, _num(m.get("series_index")), rating,
                    READSTATUS_MAP.get(r.get("readstatus"), "Unread"),
                    r.get("readstatus") == "Favorite", _parse_dt(m.get("ts")), ekey, ehash))
                for pos, a in enumerate(r.get("authors", [])):
                    aid = author_id[a]
                    if (wid, aid) in seen_wa:
                        continue
                    seen_wa.add((wid, aid)); warows.append((wid, aid, pos))
                for pos, (name, kind, is_ship, is_coll) in enumerate(plan[wid]):
                    tid = tag_id[(name, kind)]
                    if (wid, tid) in seen_wt:
                        continue
                    seen_wt.add((wid, tid)); wtrows.append((wid, tid, pos, is_ship, is_coll))

            await conn.executemany(
                """INSERT INTO works (work_id, source, work_type, source_url, title, summary_html,
                     short_summary, wordcount, chapter_count, is_complete, language, series_name,
                     series_index, rating, read_status, is_favorite, pinned, date_added, availability,
                     epub_r2_key, epub_hash)
                   VALUES ($1,'ao3','fanfiction',$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,false,$15,'deleted',$16,$17)
                   ON CONFLICT (work_id) DO UPDATE SET
                     title=EXCLUDED.title, summary_html=EXCLUDED.summary_html, wordcount=EXCLUDED.wordcount,
                     language=EXCLUDED.language, series_name=EXCLUDED.series_name, series_index=EXCLUDED.series_index,
                     rating=EXCLUDED.rating, read_status=EXCLUDED.read_status, is_favorite=EXCLUDED.is_favorite,
                     date_added=EXCLUDED.date_added, availability='deleted',
                     epub_r2_key=COALESCE(EXCLUDED.epub_r2_key, works.epub_r2_key),
                     epub_hash=COALESCE(EXCLUDED.epub_hash, works.epub_hash), updated_at=now()""",
                wrows)
            ids = [w[0] for w in wrows]
            await conn.execute("DELETE FROM work_authors WHERE work_id = ANY($1::bigint[])", ids)
            if warows:
                await conn.executemany(
                    "INSERT INTO work_authors (work_id, author_id, position) VALUES ($1,$2,$3) "
                    "ON CONFLICT (work_id, author_id) DO UPDATE SET position=EXCLUDED.position", warows)
            await conn.execute("DELETE FROM work_tags WHERE work_id = ANY($1::bigint[])", ids)
            if wtrows:
                await conn.executemany(
                    "INSERT INTO work_tags (work_id, tag_id, position, is_primary_ship, is_primary_collection) "
                    "VALUES ($1,$2,$3,$4,$5) ON CONFLICT (work_id, tag_id) DO NOTHING", wtrows)

            if priority:
                pl = await conn.fetchrow("SELECT id FROM reading_lists WHERE name='Priority'") \
                    or await conn.fetchrow("INSERT INTO reading_lists (name) VALUES ('Priority') RETURNING id")
                await conn.executemany(
                    "INSERT INTO reading_list_members (reading_list_id, work_id, position) "
                    "VALUES ($1,$2,$3) ON CONFLICT DO NOTHING",
                    [(pl["id"], wid, i) for i, wid in enumerate(priority)])

        c = await conn.fetchrow(
            "SELECT (SELECT COUNT(*) FROM works WHERE availability='deleted') d, "
            "(SELECT COUNT(*) FROM works) w")
        print(f"loaded {len(wrows)} salvage works (synthesized tags for {len(added)}: {added}).")
        print(f"  availability='deleted' works: {c['d']}   total works: {c['w']}")
    finally:
        await conn.close()


if __name__ == "__main__":
    url = os.environ.get("DATABASE_PUBLIC_URL") or os.environ.get("DATABASE_URL")
    if not url:
        sys.exit("set DATABASE_PUBLIC_URL")
    asyncio.run(_run(url))
