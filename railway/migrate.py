"""Phase D migration tool (staged, resumable). See docs/phase-d-migration-plan.md.

Durable state lives in a local SQLite cache (migration_cache.sqlite, gitignored)
so wiping/iterating Railway never loses scraped data. AO3 is the metadata source;
epubs are NOT parsed for metadata (R2 file backfill only, a later stage).

Stages (CLI):
    python migrate.py dump-calibre      # enumerate Calibre -> cache.calibre_books
    python migrate.py select-sample     # pick 5 fandoms x 10 -> cache.sample
    python migrate.py scrape [--all]    # scrape AO3 -> cache.ao3_scrape (sample default)
    python migrate.py status            # counts
    python migrate.py show <work_id>    # Calibre vs AO3 side-by-side

Env: CAL_U, CAL_P (Calibre digest creds); optional CAL_URL, CAL_LIB.
"""
from __future__ import annotations

import argparse
import html
import json
import os
import random
import re
import sqlite3
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

CACHE = Path(__file__).with_name("migration_cache.sqlite")
COOKIE_FILE = Path(__file__).with_name(".ao3-cookie")
_COOKIE = None  # AO3 logged-in cookie header, loaded by scrape()
CAL_URL = os.environ.get("CAL_URL", "http://localhost:8080").rstrip("/")
CAL_LIB = os.environ.get("CAL_LIB", "FanFiction")
UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36")

# 5 fandoms (by #collection) to sample, in preference order; first 5 with >=10.
SAMPLE_COLLECTIONS = ["Marvel", "Teen Wolf", "Stray Kids", "Harry Potter",
                      "Witcher", "DCU", "Shadowhunters", "Star Wars"]
PER_FANDOM = 10
TAG_KINDS = ("rating", "warning", "category", "fandom", "relationship",
             "character", "freeform")


# --- Calibre REST (digest) ---------------------------------------------------

def _cal_opener():
    mgr = urllib.request.HTTPPasswordMgrWithDefaultRealm()
    mgr.add_password(None, CAL_URL, os.environ["CAL_U"], os.environ["CAL_P"])
    return urllib.request.build_opener(urllib.request.HTTPDigestAuthHandler(mgr))


def _cal_json(opener, path, params=None):
    url = CAL_URL + path + ("?" + urllib.parse.urlencode(params) if params else "")
    return json.load(opener.open(url, timeout=120))


def _cv(book, name):
    m = (book.get("user_metadata") or {}).get(name)
    return m.get("#value#") if isinstance(m, dict) else None


# --- DB ----------------------------------------------------------------------

def db():
    conn = sqlite3.connect(CACHE, timeout=30)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA busy_timeout=30000")  # tolerate the concurrent scrape
    conn.executescript("""
    CREATE TABLE IF NOT EXISTS calibre_books (
        calibre_id INTEGER PRIMARY KEY, work_id TEXT, is_ao3 INTEGER,
        title TEXT, authors TEXT, tags TEXT, collection TEXT, primaryship TEXT,
        shortsummary TEXT, wordcount INTEGER, readstatus TEXT, series TEXT,
        series_index REAL, comments TEXT, languages TEXT, timestamp TEXT);
    CREATE TABLE IF NOT EXISTS sample (
        work_id INTEGER PRIMARY KEY, calibre_id INTEGER, fandom TEXT);
    CREATE TABLE IF NOT EXISTS ao3_scrape (
        work_id INTEGER PRIMARY KEY, calibre_id INTEGER, scraped_at TEXT,
        status TEXT, http_status INTEGER, title TEXT, authors TEXT,
        rating TEXT, warnings TEXT, fandoms TEXT, relationships TEXT,
        characters TEXT, freeforms TEXT, categories TEXT, summary_html TEXT,
        series_name TEXT, series_index REAL, wordcount INTEGER, chapters TEXT,
        is_complete INTEGER, language TEXT, error TEXT);
    """)
    return conn


# --- stage: dump-calibre -----------------------------------------------------

def dump_calibre():
    op = _cal_opener()
    ids = _cal_json(op, f"/ajax/search/{CAL_LIB}", {"query": "", "num": 2_000_000_000})["book_ids"]
    conn = db()
    n = 0
    for i in range(0, len(ids), 250):
        batch = ids[i:i + 250]
        raw = _cal_json(op, f"/ajax/books/{CAL_LIB}", {"ids": ",".join(map(str, batch))})
        for bid in batch:
            b = raw.get(str(bid))
            if not b:
                continue
            wid = str(_cv(b, "#ao3_work_id") or "").strip()
            conn.execute(
                "INSERT OR REPLACE INTO calibre_books VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
                (bid, wid, 1 if wid.isdigit() else 0, b.get("title"),
                 json.dumps(b.get("authors") or []), json.dumps(b.get("tags") or []),
                 _cv(b, "#collection"), _cv(b, "#primaryship"), _cv(b, "#shortsummary"),
                 _cv(b, "#wordcount"), _cv(b, "#readstatus"), b.get("series"),
                 b.get("series_index"), b.get("comments"),
                 json.dumps(b.get("languages") or []), b.get("timestamp")))
            n += 1
        conn.commit()
    print(f"dumped {n} books to {CACHE.name}")


# --- stage: select-sample ----------------------------------------------------

def _varied_pick(rows):
    """Pick PER_FANDOM rows spanning tag-count, ensuring series/no-series + a
    no-ship example are represented when available."""
    rows = sorted(rows, key=lambda r: len(json.loads(r["tags"])))
    if len(rows) <= PER_FANDOM:
        return rows
    # evenly-spaced across the tag-count range
    idx = [round(i * (len(rows) - 1) / (PER_FANDOM - 1)) for i in range(PER_FANDOM)]
    picked = [rows[i] for i in dict.fromkeys(idx)]

    def has(pred):
        return any(pred(r) for r in picked)

    def add(pred):
        nonlocal picked
        if not has(pred):
            extra = next((r for r in rows if pred(r) and r not in picked), None)
            if extra:
                picked = picked[:-1] + [extra]

    add(lambda r: r["series"])                       # at least one series
    add(lambda r: not r["series"])                   # at least one standalone
    add(lambda r: not (r["primaryship"] or ""))      # at least one gen/no-ship
    return picked[:PER_FANDOM]


def select_sample():
    conn = db()
    conn.execute("DELETE FROM sample")
    counts = {r["collection"]: r["n"] for r in conn.execute(
        "SELECT collection, COUNT(*) n FROM calibre_books WHERE is_ao3=1 "
        "AND collection IS NOT NULL GROUP BY collection")}
    chosen = [c for c in SAMPLE_COLLECTIONS if counts.get(c, 0) >= PER_FANDOM][:5]
    print("sampling fandoms:", chosen)
    for coll in chosen:
        rows = list(conn.execute(
            "SELECT * FROM calibre_books WHERE is_ao3=1 AND collection=?", (coll,)))
        for r in _varied_pick(rows):
            conn.execute("INSERT OR REPLACE INTO sample VALUES (?,?,?)",
                         (int(r["work_id"]), r["calibre_id"], coll))
        picks = list(conn.execute("SELECT * FROM sample WHERE fandom=?", (coll,)))
        print(f"\n  {coll} ({len(picks)}):")
        for s in picks:
            b = conn.execute("SELECT * FROM calibre_books WHERE calibre_id=?",
                             (s["calibre_id"],)).fetchone()
            print(f"    {b['work_id']:>10}  tags={len(json.loads(b['tags'])):>2}  "
                  f"series={'Y' if b['series'] else '-'}  "
                  f"ship={b['primaryship'] or '(none)':<20}  {(b['title'] or '')[:40]}")
    conn.commit()


# --- stage: scrape -----------------------------------------------------------

def _tags(block_html):
    return [html.unescape(t) for t in re.findall(r"<a[^>]*>(.*?)</a>", block_html, re.S)]


def _first(pat, text, flags=re.S):
    m = re.search(pat, text, flags)
    return html.unescape(m.group(1).strip()) if m else None


def load_cookie():
    if COOKIE_FILE.exists():
        for line in COOKIE_FILE.read_text(encoding="utf-8").splitlines():
            line = line.strip()
            if line and not line.startswith("#") and line != "PASTE_AO3_COOKIE_HERE":
                # Accept a full "name=value; ..." header or a bare session value.
                return line if "=" in line else f"_otwarchive_session={line}"
    return None


def scrape_one(work_id):
    url = f"https://archiveofourown.org/works/{work_id}?view_adult=true"
    headers = {"User-Agent": UA, "Accept": "text/html"}
    if _COOKIE:
        headers["Cookie"] = _COOKIE
    req = urllib.request.Request(url, headers=headers)
    try:
        resp = urllib.request.urlopen(req, timeout=60)
        final = resp.geturl()
        body = resp.read().decode("utf-8", "replace")
        code = resp.status
    except urllib.error.HTTPError as e:
        if e.code == 404:
            return {"status": "deleted", "http_status": 404}
        return {"status": "failed", "http_status": e.code, "error": str(e)[:300]}
    except Exception as e:  # noqa: BLE001
        return {"status": "failed", "http_status": None, "error": f"{type(e).__name__}: {e}"[:300]}

    if "/users/login" in final or "only available to registered users" in body:
        return {"status": "locked", "http_status": code}
    if 'class="work meta group"' not in body:
        if "Mystery Work" in body:
            # Unrevealed collection — AO3 hides metadata until reveal.
            return {"status": "mystery", "http_status": code}
        return {"status": "failed", "http_status": code, "error": "no meta group (blocked/changed?)"}

    out = {"status": "ok", "http_status": code}
    for kind in TAG_KINDS:
        m = re.search(rf'<dd class="{kind} tags">(.*?)</dd>', body, re.S)
        out[kind] = _tags(m.group(1)) if m else []
    out["summary_html"] = _first(r'<div class="summary module">.*?<blockquote[^>]*>(.*?)</blockquote>', body)
    out["title"] = _first(r'<h2 class="title heading">(.*?)</h2>', body)
    out["authors"] = [html.unescape(a) for a in re.findall(r'<a[^>]*rel="author"[^>]*>(.*?)</a>', body)]
    out["language"] = _first(r'<dd class="language"[^>]*>(.*?)</dd>', body)
    out["wordcount"] = _first(r'<dd class="words">(.*?)</dd>', body)
    out["chapters"] = _first(r'<dd class="chapters">(.*?)</dd>', body)
    sm = re.search(r'<dd class="series">(.*?)</dd>', body, re.S)
    if sm:
        out["series_name"] = _first(r'/series/\d+">(.*?)</a>', sm.group(1))
        pos = re.search(r"Part (\d+) of", sm.group(1))
        out["series_index"] = float(pos.group(1)) if pos else None
    return out


def _store_scrape(conn, work_id, calibre_id, r):
    def j(k):
        return json.dumps(r.get(k)) if r.get(k) is not None else None
    wc = r.get("wordcount")
    wc = int(wc.replace(",", "")) if isinstance(wc, str) and wc.replace(",", "").isdigit() else None
    complete = None
    if r.get("chapters"):
        a, _, b = r["chapters"].partition("/")
        complete = 1 if (b and a.strip() == b.strip()) else 0
    conn.execute(
        "INSERT OR REPLACE INTO ao3_scrape VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
        (work_id, calibre_id, time.strftime("%Y-%m-%dT%H:%M:%S"), r.get("status"),
         r.get("http_status"), r.get("title"), j("authors"), j("rating"),
         j("warning"), j("fandom"), j("relationship"), j("character"),
         j("freeform"), j("category"), r.get("summary_html"), r.get("series_name"),
         r.get("series_index"), wc, r.get("chapters"), complete, r.get("language"),
         r.get("error")))
    conn.commit()


def scrape(do_all=False):
    global _COOKIE
    _COOKIE = load_cookie()
    print("auth:", "logged-in (cookie loaded)" if _COOKIE else "ANONYMOUS (no cookie)")
    conn = db()
    if do_all:
        todo = list(conn.execute(
            "SELECT calibre_id, work_id FROM calibre_books WHERE is_ao3=1 "
            "AND CAST(work_id AS INTEGER) NOT IN "
            "(SELECT work_id FROM ao3_scrape WHERE status='ok')"))
        todo = [(int(r["work_id"]), r["calibre_id"]) for r in todo]
    else:
        todo = [(s["work_id"], s["calibre_id"]) for s in conn.execute(
            "SELECT work_id, calibre_id FROM sample WHERE work_id NOT IN "
            "(SELECT work_id FROM ao3_scrape WHERE status='ok')")]
    print(f"scraping {len(todo)} works (paced)...")
    consecutive_block = 0
    for i, (wid, cid) in enumerate(todo, 1):
        r = scrape_one(wid)
        _store_scrape(conn, wid, cid, r)
        st = r.get("status")
        kinds = "" if st != "ok" else (
            f"F{len(r['fandom'])} R{len(r['relationship'])} C{len(r['character'])} "
            f"f{len(r['freeform'])} rat={(r['rating'] or ['?'])[0][:12]}")
        print(f"  [{i}/{len(todo)}] {wid} {st} {kinds}")
        # deleted/mystery are legitimate per-work outcomes; failed/rate-limit, or
        # locked-while-authenticated (cookie expired), are systemic -> back off.
        systemic = (st == "failed" or r.get("http_status") in (429, 503)
                    or (st == "locked" and _COOKIE))
        if systemic:
            consecutive_block += 1
            if consecutive_block >= 5:
                print("  !! repeated systemic errors (rate-limit or cookie expiry?)"
                      " — stopping; re-run `scrape --all` to resume")
                break
            time.sleep(45)
        else:
            consecutive_block = 0
            time.sleep(random.uniform(2.5, 4.5))
    status()


# --- stage: load (cache -> Railway Postgres) ---------------------------------

READSTATUS_MAP = {"Unread": "Unread", "Read": "Read", "DNF": "DNF",
                  "Favorite": "Read", "Priority": "Unread"}
KIND_FIELDS = [("fandoms", "fandom"), ("relationships", "relationship"),
               ("characters", "character"), ("freeforms", "freeform"),
               ("warnings", "warning")]


def _jl(v):
    return json.loads(v) if v else []


def _parse_dt(s):
    from datetime import datetime
    try:
        return datetime.fromisoformat(s) if s else None
    except (ValueError, TypeError):
        return None


def load(db_url, only_sample=True):
    import asyncio
    asyncio.run(_load_async(db_url, only_sample))


async def _load_async(db_url, only_sample):
    import asyncpg
    from collections import Counter, defaultdict
    from app.normalize import map_rating  # reuse AO3 rating-label mapping

    cache = db()
    join = ("SELECT a.*, b.collection, b.primaryship, b.readstatus, "
            "b.title ctitle, b.authors cauthors, b.shortsummary, "
            "b.wordcount cwordcount, b.series cseries, b.series_index cseries_index, "
            "b.comments, b.timestamp ts, b.languages "
            "FROM ao3_scrape a JOIN calibre_books b ON a.calibre_id=b.calibre_id "
            + ("JOIN sample s ON s.work_id=a.work_id " if only_sample else "")
            + "WHERE a.status='ok'")
    works = [dict(r) for r in cache.execute(join)]
    print(f"loading {len(works)} works to Postgres...")

    # Global maps: ship display alias (majority #primaryship per raw primary ship)
    # and collection-group membership (primary fandom per #collection).
    ship_votes = defaultdict(Counter)
    coll_members = defaultdict(set)
    for w in works:
        rels, fandoms = _jl(w["relationships"]), _jl(w["fandoms"])
        if rels and w["primaryship"] and w["primaryship"] != "Poly":
            ship_votes[rels[0]][w["primaryship"]] += 1
        if fandoms and w["collection"]:
            coll_members[w["collection"]].add(fandoms[0])
    ship_display = {rel: v.most_common(1)[0][0] for rel, v in ship_votes.items()}

    conn = await asyncpg.connect(db_url)
    try:
        # 1. Upsert all tags; set display_name on primary-ship relationship tags.
        tag_id = {}
        seen = {(n, k) for w in works for f, k in KIND_FIELDS for n in _jl(w[f])}
        for name, kind in seen:
            disp = ship_display.get(name) if kind == "relationship" else None
            row = await conn.fetchrow(
                "INSERT INTO tags (name, kind, display_name) VALUES ($1,$2,$3) "
                "ON CONFLICT (name, kind) DO UPDATE SET "
                "display_name = COALESCE(EXCLUDED.display_name, tags.display_name), "
                "updated_at = now() RETURNING tag_id", name, kind, disp)
            tag_id[(name, kind)] = row["tag_id"]

        # 2. Collection groups (get-or-create) + members (preserve XTEINK names).
        for coll, fandoms in coll_members.items():
            g = await conn.fetchrow(
                "SELECT group_id FROM tag_groups WHERE name=$1 AND group_type='collection'", coll)
            gid = g["group_id"] if g else (await conn.fetchrow(
                "INSERT INTO tag_groups (name, group_type) VALUES ($1,'collection') "
                "RETURNING group_id", coll))["group_id"]
            for f in fandoms:
                if (f, "fandom") in tag_id:
                    await conn.execute(
                        "INSERT INTO tag_group_members (group_id, tag_id) VALUES ($1,$2) "
                        "ON CONFLICT DO NOTHING", gid, tag_id[(f, "fandom")])

        # 3. Per-work: works row + authors + work_tags (positions + primary flags).
        priority = []
        for w in works:
            wid = int(w["work_id"])
            chapters = w["chapters"]
            ch_count = int(chapters.split("/")[0]) if chapters and chapters.split("/")[0].isdigit() else None
            await conn.execute(
                """INSERT INTO works (work_id, source, work_type, source_url, title,
                     summary_html, short_summary, wordcount, chapter_count, is_complete,
                     language, series_name, series_index, rating, read_status,
                     is_favorite, pinned, date_added, availability)
                   VALUES ($1,'ao3','fanfiction',$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,false,$15,'live')
                   ON CONFLICT (work_id) DO UPDATE SET
                     source_url=EXCLUDED.source_url, title=EXCLUDED.title,
                     summary_html=EXCLUDED.summary_html, short_summary=EXCLUDED.short_summary,
                     wordcount=EXCLUDED.wordcount, chapter_count=EXCLUDED.chapter_count,
                     is_complete=EXCLUDED.is_complete, language=EXCLUDED.language,
                     series_name=EXCLUDED.series_name, series_index=EXCLUDED.series_index,
                     rating=EXCLUDED.rating, read_status=EXCLUDED.read_status,
                     is_favorite=EXCLUDED.is_favorite, date_added=EXCLUDED.date_added,
                     updated_at=now()""",
                wid, f"https://archiveofourown.org/works/{wid}",
                w["title"] or w["ctitle"], w["summary_html"] or w["comments"],
                w["shortsummary"], w["wordcount"] or w["cwordcount"], ch_count,
                bool(w["is_complete"]), w["language"] or (_jl(w["languages"])[:1] or [None])[0],
                w["series_name"] or w["cseries"],
                w["series_index"] if w["series_name"] else w["cseries_index"],
                map_rating((_jl(w["rating"])[:1] or [None])[0]),
                READSTATUS_MAP.get(w["readstatus"], "Unread"),
                w["readstatus"] == "Favorite", _parse_dt(w["ts"]))

            await conn.execute("DELETE FROM work_authors WHERE work_id=$1", wid)
            for pos, name in enumerate(_jl(w["cauthors"])):
                a = await conn.fetchrow(
                    "INSERT INTO authors (name) VALUES ($1) ON CONFLICT (name) "
                    "DO UPDATE SET name=EXCLUDED.name RETURNING author_id", name)
                await conn.execute(
                    "INSERT INTO work_authors (work_id, author_id, position) VALUES ($1,$2,$3) "
                    "ON CONFLICT (work_id, author_id) DO UPDATE SET position=EXCLUDED.position",
                    wid, a["author_id"], pos)

            await conn.execute("DELETE FROM work_tags WHERE work_id=$1", wid)
            prim_fandom = (_jl(w["fandoms"])[:1] or [None])[0]
            prim_rel = (_jl(w["relationships"])[:1] or [None])[0]
            for field, kind in KIND_FIELDS:
                for pos, name in enumerate(_jl(w[field])):
                    await conn.execute(
                        "INSERT INTO work_tags (work_id, tag_id, position, "
                        "is_primary_ship, is_primary_collection) VALUES ($1,$2,$3,$4,$5)",
                        wid, tag_id[(name, kind)], pos,
                        kind == "relationship" and pos == 0 and name == prim_rel,
                        kind == "fandom" and pos == 0 and name == prim_fandom)
            if w["readstatus"] == "Priority":
                priority.append(wid)

        # 4. Reading lists: Favorites (system, rule) + Priority (manual members).
        await conn.execute(
            "INSERT INTO reading_lists (name, is_system, membership_rule) "
            "SELECT 'Favorites', true, 'is_favorite = true' "
            "WHERE NOT EXISTS (SELECT 1 FROM reading_lists WHERE name='Favorites')")
        if priority:
            pl = await conn.fetchrow("SELECT id FROM reading_lists WHERE name='Priority'") \
                or await conn.fetchrow("INSERT INTO reading_lists (name) VALUES ('Priority') RETURNING id")
            for pos, wid in enumerate(priority):
                await conn.execute(
                    "INSERT INTO reading_list_members (reading_list_id, work_id, position) "
                    "VALUES ($1,$2,$3) ON CONFLICT DO NOTHING", pl["id"], wid, pos)

        c = await conn.fetchrow(
            "SELECT (SELECT COUNT(*) FROM works) w, (SELECT COUNT(*) FROM tags) t, "
            "(SELECT COUNT(*) FROM work_tags) wt, (SELECT COUNT(*) FROM tag_groups) g, "
            "(SELECT COUNT(*) FROM authors) a")
        print(f"loaded. works={c['w']} tags={c['t']} work_tags={c['wt']} "
              f"collection_groups={c['g']} authors={c['a']} priority_list={len(priority)}")
    finally:
        await conn.close()


# --- stage: verify (inspect loaded Postgres) ---------------------------------

def verify(db_url):
    import asyncio
    asyncio.run(_verify_async(db_url))


async def _verify_async(db_url):
    import asyncpg
    conn = await asyncpg.connect(db_url)
    try:
        print("works by read_status (fav count):")
        for r in await conn.fetch("SELECT read_status, COUNT(*) n, "
                "COUNT(*) FILTER (WHERE is_favorite) fav FROM works GROUP BY read_status"):
            print(f"  {r['read_status']}: {r['n']} (fav={r['fav']})")
        bad = await conn.fetchval("SELECT COUNT(*) FROM works WHERE is_favorite AND read_status<>'Read'")
        print(f"  favorites not Read (must be 0): {bad}")
        print("tags by kind:")
        for r in await conn.fetch("SELECT kind, COUNT(*) n FROM tags GROUP BY kind ORDER BY n DESC"):
            print(f"  {r['kind']}: {r['n']}")
        ps = await conn.fetchval("SELECT COUNT(DISTINCT work_id) FROM work_tags WHERE is_primary_ship")
        pc = await conn.fetchval("SELECT COUNT(DISTINCT work_id) FROM work_tags WHERE is_primary_collection")
        tot = await conn.fetchval("SELECT COUNT(*) FROM works")
        print(f"works with primary ship: {ps} / collection: {pc} (of {tot})")
        print("collection groups (XTEINK names) + member fandoms:")
        for r in await conn.fetch("SELECT g.name, COUNT(m.tag_id) n FROM tag_groups g "
                "LEFT JOIN tag_group_members m ON m.group_id=g.group_id "
                "WHERE g.group_type='collection' GROUP BY g.name ORDER BY g.name"):
            print(f"  {r['name']}: {r['n']}")
        print("sample ship display aliases (XTEINK ship folders):")
        for r in await conn.fetch("SELECT name, display_name FROM tags WHERE kind='relationship' "
                "AND display_name IS NOT NULL ORDER BY display_name LIMIT 12"):
            print(f"  {r['display_name']:<24} <- {r['name']}")
        print("reading lists:")
        for r in await conn.fetch("SELECT rl.name, rl.is_system, rl.membership_rule, "
                "COUNT(m.work_id) n FROM reading_lists rl LEFT JOIN reading_list_members m "
                "ON m.reading_list_id=rl.id GROUP BY rl.id, rl.name, rl.is_system, rl.membership_rule"):
            print(f"  {r['name']} (system={r['is_system']}, rule={r['membership_rule']}, members={r['n']})")
        for wid in (56147932, 67008430):
            w = await conn.fetchrow("SELECT title, read_status, is_favorite, rating, wordcount, "
                "series_name, series_index FROM works WHERE work_id=$1", wid)
            if not w:
                continue
            print(f"\nWORK {wid}: {w['title']}  [{w['read_status']} fav={w['is_favorite']} "
                  f"{w['rating']} {w['wordcount']}w series={w['series_name']}#{w['series_index']}]")
            sh = await conn.fetchrow("SELECT t.name, t.display_name FROM work_tags wt JOIN tags t "
                "ON t.tag_id=wt.tag_id WHERE wt.work_id=$1 AND wt.is_primary_ship", wid)
            co = await conn.fetchrow("SELECT t.name FROM work_tags wt JOIN tags t "
                "ON t.tag_id=wt.tag_id WHERE wt.work_id=$1 AND wt.is_primary_collection", wid)
            print(f"  primary ship: {sh['name'] if sh else None}  (display: {sh['display_name'] if sh else None})")
            print(f"  primary collection fandom: {co['name'] if co else None}")
            kinds = await conn.fetch("SELECT t.kind, COUNT(*) n FROM work_tags wt JOIN tags t "
                "ON t.tag_id=wt.tag_id WHERE wt.work_id=$1 GROUP BY t.kind ORDER BY n DESC", wid)
            print("  tags: " + ", ".join(f"{r['kind']}={r['n']}" for r in kinds))
    finally:
        await conn.close()


# --- stage: status / show ----------------------------------------------------

def status():
    conn = db()
    cb = conn.execute("SELECT COUNT(*) n, SUM(is_ao3) ao3 FROM calibre_books").fetchone()
    print(f"\ncalibre_books: {cb['n']} ({cb['ao3']} AO3, {cb['n']-(cb['ao3'] or 0)} NO_AO3)")
    print(f"sample: {conn.execute('SELECT COUNT(*) n FROM sample').fetchone()['n']}")
    for r in conn.execute("SELECT status, COUNT(*) n FROM ao3_scrape GROUP BY status"):
        print(f"  scrape {r['status']}: {r['n']}")


def show(work_id):
    conn = db()
    b = conn.execute("SELECT * FROM calibre_books WHERE work_id=?", (str(work_id),)).fetchone()
    a = conn.execute("SELECT * FROM ao3_scrape WHERE work_id=?", (int(work_id),)).fetchone()
    print("=== CALIBRE ===")
    if b:
        print(f"  title: {b['title']}\n  collection: {b['collection']}  primaryship: {b['primaryship']}")
        print(f"  series: {b['series']} #{b['series_index']}  wordcount: {b['wordcount']}  readstatus: {b['readstatus']}")
        print(f"  flat tags ({len(json.loads(b['tags']))}): {json.loads(b['tags'])}")
    print("\n=== AO3 ===")
    if a:
        print(f"  status: {a['status']}  title: {a['title']}  authors: {a['authors']}")
        for k in ("rating", "warnings", "fandoms", "relationships", "characters", "freeforms", "categories"):
            v = json.loads(a[k]) if a[k] else None
            print(f"  {k}: {v}")
        print(f"  series: {a['series_name']} #{a['series_index']}  words: {a['wordcount']}  chapters: {a['chapters']}  complete: {a['is_complete']}")
        print(f"  summary_html: {(a['summary_html'] or '')[:200]}")
    else:
        print("  (not scraped)")


if __name__ == "__main__":
    p = argparse.ArgumentParser()
    sub = p.add_subparsers(dest="cmd", required=True)
    sub.add_parser("dump-calibre")
    sub.add_parser("select-sample")
    sc = sub.add_parser("scrape")
    sc.add_argument("--all", action="store_true")
    ld = sub.add_parser("load")
    ld.add_argument("--all", action="store_true", help="all ok works (default: sample only)")
    ld.add_argument("--db", help="Postgres URL (else $DATABASE_PUBLIC_URL / $DATABASE_URL)")
    vf = sub.add_parser("verify")
    vf.add_argument("--db", help="Postgres URL (else $DATABASE_PUBLIC_URL / $DATABASE_URL)")
    sub.add_parser("status")
    sh = sub.add_parser("show")
    sh.add_argument("work_id")
    args = p.parse_args()
    if args.cmd == "dump-calibre":
        dump_calibre()
    elif args.cmd == "select-sample":
        select_sample()
    elif args.cmd == "scrape":
        scrape(do_all=args.all)
    elif args.cmd == "load":
        url = args.db or os.environ.get("DATABASE_PUBLIC_URL") or os.environ.get("DATABASE_URL")
        if not url:
            sys.exit("no DB url (--db, DATABASE_PUBLIC_URL, or DATABASE_URL)")
        load(url, only_sample=not args.all)
    elif args.cmd == "verify":
        url = args.db or os.environ.get("DATABASE_PUBLIC_URL") or os.environ.get("DATABASE_URL")
        if not url:
            sys.exit("no DB url (--db, DATABASE_PUBLIC_URL, or DATABASE_URL)")
        verify(url)
    elif args.cmd == "status":
        status()
    elif args.cmd == "show":
        show(args.work_id)
