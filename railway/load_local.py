"""One-time load of the ~437 NO_AO3 local (pre-AO3) works (Phase D, 4th scenario).

These are Calibre books with no AO3 id (work_id='NO_AO3', is_ao3=0). They have
title/author/collection/primaryship/wordcount/series/read-status + a Calibre epub,
but no AO3 tags. Loaded as source='pre_ao3', availability='n/a', with synthetic
negative work_ids (= -calibre_id):
  - epub backfilled Calibre -> R2 at epubs/{neg}.epub (recorded in epub_backfill)
  - primary collection: a fandom tag named after the #collection, in a same-named
    collection group (so the snapshot resolves its collection)
  - primary ship: #primaryship when it looks like a ship (contains '/')
  - wordcount/author(s)/series/read-status/language/date from Calibre
No rating, characters, or freeforms (none exist). Short ship/fandom names can be
synonym'd to AO3 canonicals later in Tag Management.

Calibre must be reachable (CAL_URL, default http://localhost:8080); needs R2_* +
DATABASE_PUBLIC_URL in env. Idempotent: epub_backfill lets re-runs skip fetched
epubs; works/tags upsert.

    python load_local.py               # backfill epubs + load
    python load_local.py --load-only   # epubs already in R2; just load
"""
from __future__ import annotations

import asyncio
import hashlib
import json
import os
import sqlite3
import sys
import time
import urllib.request
from datetime import datetime
from pathlib import Path

HERE = Path(__file__).parent
CACHE = HERE / "migration_cache.sqlite"
CAL_URL = os.environ.get("CAL_URL", "http://localhost:8080").rstrip("/")
CAL_LIB = os.environ.get("CAL_LIB", "FanFiction")
READSTATUS_MAP = {"Unread": "Unread", "Read": "Read", "DNF": "DNF",
                  "Favorite": "Read", "Priority": "Unread"}
# #primaryship values that aren't real ships (skip → no primary ship).
NON_SHIP = {"", "general", "general fic", "gen", "poly", "none"}


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


def _parse_dt(s):
    try:
        return datetime.fromisoformat(s) if s else None
    except (ValueError, TypeError):
        return None


def _jl(v):
    try:
        return json.loads(v) if v else []
    except (ValueError, TypeError):
        return []


def _books():
    """NO_AO3 calibre rows -> list of dicts keyed by negative work_id."""
    c = sqlite3.connect(CACHE)
    c.row_factory = sqlite3.Row
    rows = [dict(r) for r in c.execute("SELECT * FROM calibre_books WHERE is_ao3=0")]
    c.close()
    for r in rows:
        r["wid"] = -int(r["calibre_id"])
    return rows


def backfill(books):
    import boto3
    from botocore.config import Config
    cli = boto3.client(
        "s3", endpoint_url=os.environ["R2_ENDPOINT_URL"],
        aws_access_key_id=os.environ["R2_ACCESS_KEY_ID"],
        aws_secret_access_key=os.environ["R2_SECRET_ACCESS_KEY"],
        region_name="auto", config=Config(signature_version="s3v4"))
    bucket = os.environ["R2_BUCKET_NAME"]
    c = sqlite3.connect(CACHE)
    done = {r[0] for r in c.execute("SELECT work_id FROM epub_backfill WHERE status='ok'")}
    todo = [b for b in books if b["wid"] not in done]
    print(f"backfilling {len(todo)} NO_AO3 epubs to R2 ({len(books) - len(todo)} already present)...")
    ok = fail = 0
    for i, b in enumerate(todo, 1):
        wid, cid = b["wid"], int(b["calibre_id"])
        ts = time.strftime("%Y-%m-%dT%H:%M:%S")
        try:
            data = urllib.request.urlopen(f"{CAL_URL}/get/EPUB/{cid}/{CAL_LIB}", timeout=120).read()
            key = f"epubs/{wid}.epub"
            cli.put_object(Bucket=bucket, Key=key, Body=data, ContentType="application/epub+zip")
            c.execute("INSERT OR REPLACE INTO epub_backfill VALUES (?,?,?,?,?,?,?,?)",
                      (wid, cid, key, hashlib.sha256(data).hexdigest(), len(data), "ok", None, ts))
            ok += 1
        except Exception as e:  # noqa: BLE001
            c.execute("INSERT OR REPLACE INTO epub_backfill VALUES (?,?,?,?,?,?,?,?)",
                      (wid, cid, None, None, None, "failed", str(e)[:300], ts))
            fail += 1
            print(f"   epub fail cid={cid}: {str(e)[:120]}")
        c.commit()
        if i % 50 == 0:
            print(f"  [{i}/{len(todo)}] ok={ok} fail={fail}")
    c.close()
    print(f"backfill done: ok={ok} fail={fail}")


async def load(db_url, books):
    import asyncpg
    c = sqlite3.connect(CACHE)
    epub = {r[0]: (r[1], r[2]) for r in
            c.execute("SELECT work_id, r2_key, sha256 FROM epub_backfill WHERE status='ok' AND work_id<0")}
    c.close()

    collections = sorted({b["collection"] for b in books if b["collection"]})
    ships = sorted({b["primaryship"] for b in books
                    if b["primaryship"] and "/" in b["primaryship"]
                    and b["primaryship"].strip().lower() not in NON_SHIP})

    conn = await asyncpg.connect(db_url)
    try:
        async with conn.transaction():
            # 1. Fandom tags (named after collections) + relationship tags (ships).
            fan_id, ship_id = {}, {}
            if collections:
                for r in await conn.fetch(
                        "INSERT INTO tags (name, kind) SELECT n,'fandom' FROM unnest($1::text[]) n "
                        "ON CONFLICT (name, kind) DO UPDATE SET updated_at=now() RETURNING tag_id, name",
                        collections):
                    fan_id[r["name"]] = r["tag_id"]
            if ships:
                for r in await conn.fetch(
                        "INSERT INTO tags (name, kind) SELECT n,'relationship' FROM unnest($1::text[]) n "
                        "ON CONFLICT (name, kind) DO UPDATE SET updated_at=now() RETURNING tag_id, name",
                        ships):
                    ship_id[r["name"]] = r["tag_id"]

            # 2. Collection groups (name == collection) + membership for the fandom tag,
            #    so the snapshot resolves each work's primary collection.
            gid = {r["name"]: r["group_id"] for r in await conn.fetch(
                "SELECT group_id, name FROM tag_groups WHERE group_type='collection'")}
            missing = [c0 for c0 in collections if c0 not in gid]
            if missing:
                for r in await conn.fetch(
                        "INSERT INTO tag_groups (name, group_type) "
                        "SELECT n,'collection' FROM unnest($1::text[]) n RETURNING group_id, name", missing):
                    gid[r["name"]] = r["group_id"]
            mg, mt = [], []
            for coll in collections:
                mg.append(gid[coll]); mt.append(fan_id[coll])
            if mg:
                await conn.execute(
                    "INSERT INTO tag_group_members (group_id, tag_id) "
                    "SELECT g,t FROM unnest($1::bigint[],$2::bigint[]) u(g,t) ON CONFLICT DO NOTHING", mg, mt)

            # 3. Authors -> id map.
            author_id = {}
            anames = list({a for b in books for a in _jl(b["authors"])})
            if anames:
                for r in await conn.fetch(
                        "INSERT INTO authors (name) SELECT n FROM unnest($1::text[]) n "
                        "ON CONFLICT (name) DO UPDATE SET name=EXCLUDED.name RETURNING author_id, name", anames):
                    author_id[r["name"]] = r["author_id"]

            # 4. Works + work_authors + work_tags.
            wrows, warows, wtrows, seen_wa, seen_wt, priority = [], [], [], set(), set(), []
            for b in books:
                wid, cid = b["wid"], int(b["calibre_id"])
                ekey, ehash = epub.get(wid, (None, None))
                wrows.append((
                    wid, b.get("title") or f"(untitled {wid})", b.get("comments"), b.get("shortsummary"),
                    _int(b.get("wordcount")), _lang(b.get("languages")), b.get("series") or None,
                    _num(b.get("series_index")), READSTATUS_MAP.get(b.get("readstatus"), "Unread"),
                    b.get("readstatus") == "Favorite", _parse_dt(b.get("timestamp")), ekey, ehash))
                for pos, a in enumerate(_jl(b["authors"])):
                    aid = author_id[a]
                    if (wid, aid) in seen_wa:
                        continue
                    seen_wa.add((wid, aid)); warows.append((wid, aid, pos))
                coll = b.get("collection")
                if coll and coll in fan_id:
                    wtrows.append((wid, fan_id[coll], 0, False, True))  # primary collection
                ship = b.get("primaryship")
                if ship in ship_id:
                    wtrows.append((wid, ship_id[ship], 0, True, False))  # primary ship
                if b.get("readstatus") == "Priority":
                    priority.append(wid)

            await conn.executemany(
                """INSERT INTO works (work_id, source, work_type, source_url, title, summary_html,
                     short_summary, wordcount, chapter_count, is_complete, language, series_name,
                     series_index, rating, read_status, is_favorite, pinned, date_added, availability,
                     epub_r2_key, epub_hash)
                   VALUES ($1,'pre_ao3','fanfiction',NULL,$2,$3,$4,$5,NULL,NULL,$6,$7,$8,NULL,$9,$10,false,$11,'n/a',$12,$13)
                   ON CONFLICT (work_id) DO UPDATE SET
                     title=EXCLUDED.title, summary_html=EXCLUDED.summary_html, short_summary=EXCLUDED.short_summary,
                     wordcount=EXCLUDED.wordcount, language=EXCLUDED.language, series_name=EXCLUDED.series_name,
                     series_index=EXCLUDED.series_index, read_status=EXCLUDED.read_status,
                     is_favorite=EXCLUDED.is_favorite, date_added=EXCLUDED.date_added, availability='n/a',
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

        cnt = await conn.fetchrow(
            "SELECT (SELECT COUNT(*) FROM works WHERE source='pre_ao3') p, (SELECT COUNT(*) FROM works) w")
        no_epub = sum(1 for w in wrows if w[11] is None)
        print(f"loaded {len(wrows)} pre_ao3 works ({len(collections)} collections, {len(ships)} ships; "
              f"{no_epub} without an epub).")
        print(f"  source='pre_ao3' works: {cnt['p']}   total works: {cnt['w']}")
    finally:
        await conn.close()


if __name__ == "__main__":
    url = os.environ.get("DATABASE_PUBLIC_URL") or os.environ.get("DATABASE_URL")
    if not url:
        sys.exit("set DATABASE_PUBLIC_URL")
    books = _books()
    print(f"NO_AO3 books: {len(books)}")
    if "--load-only" not in sys.argv:
        backfill(books)
    asyncio.run(load(url, books))
