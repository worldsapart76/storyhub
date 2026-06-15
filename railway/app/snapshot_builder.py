"""Snapshot builder (redesign §12.3) — projects Postgres into a versioned SQLite.

Hybrid contents:
  * Relational tables (so Tag Management / advanced filtering keep structure):
    works, tags, tag_groups, tag_group_members, work_tags, work_authors,
    reading_lists, reading_list_members, saved_filters, categories.
  * A precomputed per-work `work_cards` projection so Browse needs NO client-side
    joins or group resolution: synonyms collapsed to canonical, primary
    ship/collection resolved to GROUP names, card fields flattened. Shape mirrors
    pwa/src/mock/data.ts (the Phase F contract).

Two versions (§12.3): the content `version` (bumps per committed change) and the
`FORMAT_VERSION` (the projection's structural shape; bump on a code change here —
the CLAUDE.md hard rule).
"""

from __future__ import annotations

import datetime
import decimal
import json
import sqlite3
import tempfile
from pathlib import Path

from . import r2

FORMAT_VERSION = 1

RELATIONAL = ["works", "tags", "tag_groups", "tag_group_members", "work_tags",
              "work_authors", "reading_lists", "reading_list_members",
              "saved_filters", "categories"]
KIND_ORDER = {"fandom": 0, "relationship": 1, "character": 2, "freeform": 3, "warning": 4}


def _sqlval(v):
    if isinstance(v, bool):
        return int(v)
    if isinstance(v, (dict, list)):
        return json.dumps(v)
    if isinstance(v, decimal.Decimal):
        return float(v)
    if isinstance(v, datetime.datetime):
        return v.isoformat()
    if v is None or isinstance(v, (int, float, str, bytes)):
        return v
    return str(v)  # UUID, date, and other exotic pg types -> text


def _card_category(kind: str, cat: str | None) -> str:
    """Map a tag to its Browse category box (graceful: uncategorized -> Other)."""
    if kind == "fandom":
        return "Fandom"
    if kind == "relationship":
        return "Relationship"
    if kind == "character":
        return "Character"
    if kind == "warning":
        return cat or "Content"   # warnings absorbed into Content (§6.3)
    return cat or "Other"          # freeform


async def _copy_table(pg, sq: sqlite3.Connection, table: str) -> None:
    rows = await pg.fetch(f"SELECT * FROM {table}")
    if rows:
        cols = list(rows[0].keys())
    else:
        cols = [r["column_name"] for r in await pg.fetch(
            "SELECT column_name FROM information_schema.columns "
            "WHERE table_name=$1 ORDER BY ordinal_position", table)]
    sq.execute(f"CREATE TABLE {table} ({', '.join(cols)})")  # typeless sqlite
    if rows:
        ph = ",".join("?" * len(cols))
        sq.executemany(f"INSERT INTO {table} VALUES ({ph})",
                       [[_sqlval(r[c]) for c in cols] for r in rows])


async def build_sqlite(conn) -> tuple[bytes, int]:
    """Build the snapshot SQLite and return (bytes, work_count). No R2/Postgres
    writes — pure projection, so it's safe to call for testing."""
    tmp = Path(tempfile.gettempdir()) / "storyhub_snapshot_build.sqlite"
    tmp.unlink(missing_ok=True)
    sq = sqlite3.connect(tmp)
    try:
        for t in RELATIONAL:
            await _copy_table(conn, sq, t)

        tags = {r["tag_id"]: dict(r) for r in await conn.fetch(
            "SELECT tag_id, name, display_name, kind, category, canonical_tag_id FROM tags")}
        coll_of: dict[int, str] = {}
        for r in await conn.fetch(
                "SELECT m.tag_id, g.name FROM tag_group_members m "
                "JOIN tag_groups g ON g.group_id=m.group_id "
                "WHERE g.group_type='collection'"):
            coll_of.setdefault(r["tag_id"], r["name"])
        authors: dict[int, list[str]] = {}
        for r in await conn.fetch(
                "SELECT wa.work_id, a.name FROM work_authors wa "
                "JOIN authors a ON a.author_id=wa.author_id "
                "ORDER BY wa.work_id, wa.position"):
            authors.setdefault(r["work_id"], []).append(r["name"])
        wtags: dict[int, list[dict]] = {}
        for r in await conn.fetch(
                "SELECT work_id, tag_id, position, is_primary_ship, "
                "is_primary_collection FROM work_tags"):
            wtags.setdefault(r["work_id"], []).append(dict(r))

        def resolve(tag_id):
            t = tags[tag_id]
            canon = t["canonical_tag_id"]
            if canon and canon in tags:
                c = tags[canon]
                return (c["display_name"] or c["name"], c["kind"], c["category"], True)
            return (t["display_name"] or t["name"], t["kind"], t["category"], False)

        sq.execute("""CREATE TABLE work_cards (
            work_id INTEGER PRIMARY KEY, title, authors, primary_ship,
            primary_collection, wordcount, chapter_count, is_complete, rating,
            read_status, is_favorite, pinned, availability, source, source_url,
            language, date_added, date_read, summary_html, tags)""")

        works = await conn.fetch("SELECT * FROM works")
        for w in works:
            wid = w["work_id"]
            entries = sorted(
                wtags.get(wid, []),
                key=lambda e: (KIND_ORDER.get(tags[e["tag_id"]]["kind"], 9), e["position"] or 0))
            card_tags, seen = [], set()
            primary_ship = primary_collection = None
            for e in entries:
                name, kind, cat, grouped = resolve(e["tag_id"])
                if e["is_primary_ship"]:
                    primary_ship = name
                if e["is_primary_collection"]:
                    primary_collection = coll_of.get(e["tag_id"]) or name
                cat_box = _card_category(kind, cat)
                if (name, cat_box) in seen:
                    continue
                seen.add((name, cat_box))
                tag = {"name": name, "category": cat_box}
                if grouped:
                    tag["grouped"] = True
                card_tags.append(tag)
            sq.execute(
                "INSERT INTO work_cards VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
                (wid, w["title"], json.dumps(authors.get(wid, [])), primary_ship,
                 primary_collection, w["wordcount"], w["chapter_count"],
                 None if w["is_complete"] is None else int(w["is_complete"]),
                 w["rating"], w["read_status"], int(w["is_favorite"]), int(w["pinned"]),
                 w["availability"], w["source"], w["source_url"], w["language"],
                 _sqlval(w["date_added"]), _sqlval(w["date_read"]),
                 w["summary_html"], json.dumps(card_tags)))
        sq.commit()
        count = len(works)
    finally:
        sq.close()
    data = tmp.read_bytes()
    tmp.unlink(missing_ok=True)
    return data, count


async def build_and_upload(conn) -> dict:
    """Build the snapshot, upload to R2, write current.json, bump the version
    row. Returns the new snapshot descriptor. (Railway owns this — §12.3.)"""
    data, work_count = await build_sqlite(conn)
    version = await conn.fetchval(
        "SELECT COALESCE(MAX(version), 0) + 1 FROM snapshot_versions")
    key = f"snapshot/library-{version}.sqlite"
    await r2.put_bytes(key, data, "application/x-sqlite3")
    pointer = json.dumps({"version": version, "format_version": FORMAT_VERSION,
                          "key": key, "work_count": work_count})
    await r2.put_bytes("snapshot/current.json", pointer.encode(), "application/json")
    await conn.execute(
        "INSERT INTO snapshot_versions (version, format_version, r2_path, work_count) "
        "VALUES ($1,$2,$3,$4)", version, FORMAT_VERSION, key, work_count)
    return {"version": version, "format_version": FORMAT_VERSION, "r2_path": key,
            "work_count": work_count, "bytes": len(data)}
