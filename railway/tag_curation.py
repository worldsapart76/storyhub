"""Durable tag curation: a committed source-of-truth that survives DB reseeds.

Tag categorization (and state/display alias) lives in the live `tags` table, which
is wiped on a reseed. This persists it in `tag_curation.json` (committed) so it can
be re-applied. Round-trip:

    python tag_curation.py build     # classify ALL corpus freeforms -> tag_curation.json (auto)
    python tag_curation.py apply     # tag_curation.json -> live tags table (after a reseed)
    python tag_curation.py export    # live tags -> tag_curation.json (capture manual edits)

Captured per tag (name-keyed): category, state (favorite/excluded), display alias,
and whether the category was auto-classified (flagged for review per the hard rule)
or human-confirmed. Synonyms/groups are NOT covered yet (separate layer; TODO).

`apply`/`export` use DATABASE_PUBLIC_URL (bulk, direct asyncpg). `build` reads the
local migration cache + audit dataset. Run from railway/.
"""
from __future__ import annotations

import asyncio
import json
import os
import sqlite3
import sys
from pathlib import Path

from classify_tags import categorize

HERE = Path(__file__).parent
CACHE = HERE / "migration_cache.sqlite"
AUDIT = HERE / "audit_deleted.json"
CUR = HERE / "tag_curation.json"


def _corpus_freeforms() -> set[str]:
    names: set[str] = set()
    if CACHE.exists():
        c = sqlite3.connect(CACHE)
        for (ff,) in c.execute("SELECT freeforms FROM ao3_scrape WHERE status='ok' AND freeforms IS NOT NULL"):
            names.update(json.loads(ff))
        c.close()
    if AUDIT.exists():
        for w in json.loads(AUDIT.read_text(encoding="utf-8")):
            names.update(w.get("freeforms", []))
    return names


def build():
    """Classify every corpus freeform tag -> tag_curation.json. Only non-Other
    assignments are written (Other = leave uncategorized). Existing human-confirmed
    entries in the file are preserved; auto ones are refreshed from the classifier."""
    existing = json.loads(CUR.read_text(encoding="utf-8"))["tags"] if CUR.exists() else {}
    names = _corpus_freeforms()
    tags = {}
    kept = 0
    for n in sorted(names):
        prev = existing.get(n)
        if prev and not prev.get("auto", True):
            tags[n] = prev; kept += 1; continue          # keep human-confirmed
        cat = categorize(n)
        if cat != "Other":
            tags[n] = {"category": cat, "auto": True}
    # also keep any human-confirmed entries for tags not in this corpus snapshot
    for n, info in existing.items():
        if n not in tags and not info.get("auto", True):
            tags[n] = info; kept += 1
    CUR.write_text(json.dumps({"version": 1, "tags": dict(sorted(tags.items()))},
                              ensure_ascii=False, indent=0), encoding="utf-8")
    print(f"built {CUR.name}: {len(tags)} categorized of {len(names)} corpus freeforms "
          f"({kept} human-confirmed preserved)")


def build_llm(llm_out: str):
    """Turn an LLM classification (llm_classify.py output) into tag_curation.json.
    Strong category -> {category, auto}; Exclude -> {state: excluded, auto}; Other
    -> left out (stays uncategorized so the 'needs review' filter surfaces it).
    Human-confirmed (auto=false) entries already in the file are preserved."""
    res = json.loads(Path(llm_out).read_text(encoding="utf-8"))
    existing = json.loads(CUR.read_text(encoding="utf-8"))["tags"] if CUR.exists() else {}
    strong = {"Identity", "Universe", "Content", "Trope", "Dynamics", "Mood", "Structure"}
    tags = {n: e for n, e in existing.items() if not e.get("auto", True)}  # keep confirmed
    n_cat = n_exc = 0
    for name, v in res.items():
        if name in tags:
            continue  # human-confirmed wins
        cat = v.get("category")
        if cat == "Exclude":
            tags[name] = {"state": "excluded", "auto": True}; n_exc += 1
        elif cat in strong:
            tags[name] = {"category": cat, "auto": True}; n_cat += 1
        # Other / unknown -> no entry (uncategorized)
    CUR.write_text(json.dumps({"version": 1, "tags": dict(sorted(tags.items()))},
                              ensure_ascii=False, indent=0), encoding="utf-8")
    print(f"built {CUR.name}: {n_cat} categorized + {n_exc} excluded "
          f"({len(tags)} total entries, of {len(res)} classified)")


async def _apply(db_url: str):
    """Bulk set-based apply: a few UPDATE...FROM unnest() statements instead of one
    round-trip per tag (the file has ~25k entries but only matching live tags update)."""
    import asyncpg
    data = json.loads(CUR.read_text(encoding="utf-8"))["tags"]
    cat_names, cat_vals, cat_auto = [], [], []
    state_names, state_vals = [], []
    alias_names, alias_vals = [], []
    for name, info in data.items():
        if info.get("category"):
            cat_names.append(name); cat_vals.append(info["category"]); cat_auto.append(bool(info.get("auto", True)))
        if info.get("state") and info["state"] != "normal":
            state_names.append(name); state_vals.append(info["state"])
        if info.get("display_name"):
            alias_names.append(name); alias_vals.append(info["display_name"])
    conn = await asyncpg.connect(db_url)
    try:
        c = await conn.execute(
            "UPDATE tags t SET category=d.cat, auto_classified=d.auto, updated_at=now() "
            "FROM (SELECT unnest($1::text[]) name, unnest($2::text[]) cat, unnest($3::bool[]) auto) d "
            "WHERE t.name=d.name AND t.kind IN ('freeform','warning')",
            cat_names, cat_vals, cat_auto)
        s = await conn.execute(
            "UPDATE tags t SET state=d.st, updated_at=now() "
            "FROM (SELECT unnest($1::text[]) name, unnest($2::text[]) st) d WHERE t.name=d.name",
            state_names, state_vals)
        a = await conn.execute(
            "UPDATE tags t SET display_name=d.dn, updated_at=now() "
            "FROM (SELECT unnest($1::text[]) name, unnest($2::text[]) dn) d WHERE t.name=d.name",
            alias_names, alias_vals) if alias_names else "UPDATE 0"
    finally:
        await conn.close()
    def _n(r): return r.rsplit(" ", 1)[-1]
    print(f"applied to live tags: {_n(c)} categories, {_n(s)} states, {_n(a)} aliases "
          f"(from {len(cat_names)} cat / {len(state_names)} excluded entries in file)")


async def _export(db_url: str):
    import asyncpg
    conn = await asyncpg.connect(db_url)
    try:
        rows = await conn.fetch(
            "SELECT name, category, state, display_name, auto_classified FROM tags "
            "WHERE category IS NOT NULL OR state <> 'normal' OR display_name IS NOT NULL "
            "ORDER BY name")
    finally:
        await conn.close()
    tags = {}
    for r in rows:
        e = {}
        if r["category"]:
            e["category"] = r["category"]; e["auto"] = bool(r["auto_classified"])
        if r["state"] and r["state"] != "normal":
            e["state"] = r["state"]
        if r["display_name"]:
            e["display_name"] = r["display_name"]
        if e:
            tags[r["name"]] = e
    CUR.write_text(json.dumps({"version": 1, "tags": tags}, ensure_ascii=False, indent=0),
                   encoding="utf-8")
    print(f"exported {len(tags)} curated tags -> {CUR.name}")


def _dburl() -> str:
    u = os.environ.get("DATABASE_PUBLIC_URL") or os.environ.get("DB_URL")
    if not u:
        sys.exit("set DATABASE_PUBLIC_URL")
    return u


if __name__ == "__main__":
    cmd = sys.argv[1] if len(sys.argv) > 1 else "build"
    if cmd == "build":
        build()
    elif cmd == "build-llm":
        build_llm(sys.argv[2])
    elif cmd == "apply":
        asyncio.run(_apply(_dburl()))
    elif cmd == "export":
        asyncio.run(_export(_dburl()))
    else:
        sys.exit(f"unknown command {cmd!r}")
