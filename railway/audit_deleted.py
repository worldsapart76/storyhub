"""Salvage recovery for the 102 deleted-on-AO3 works (Phase D §7.1).

These works are gone from AO3 but their epubs survive in R2 (backfilled from
Calibre). The AO3 scrape is empty for them, so this recovers their metadata from
the EPUB (authoritative) + the Calibre cache (reference only), types the tags,
flags Calibre↔epub conflicts, and emits a review dataset (audit_deleted.json).

Epub is authoritative (verified: Calibre's #primaryship/#collection can be
stale/mis-set — e.g. work 390961's columns say Jane Austen/Darcy-Elizabeth while
the epub is a Teen Wolf ABO fic). Calibre values are kept for reference and any
disagreement is flagged so the human reviewer sees where the epub overrode it.

Two epub shapes (all 102):
  * 14 newer FFF epubs keep a TYPED title page (Category=fandom, Genre=freeform,
    Characters, Relationships, Warnings, Rating).
  * 88 were re-processed by Calibre -> only a FLAT dc:subject list, typed via the
    scrape-derived name->kind dictionary (6 719 OK works) + simple rules; unknowns
    default to freeform, with character/fandom-looking ones flagged for a kind check.

Usage:  python audit_deleted.py prep        # -> audit_deleted.json + stats
Needs R2_* env vars (same as migrate.py backfill); run from railway/.
"""
from __future__ import annotations

import html
import io
import json
import os
import re
import sqlite3
import zipfile
from collections import Counter, defaultdict
from pathlib import Path

from app.normalize import map_rating
from app.seeding import propose_collection

CACHE = Path(__file__).with_name("migration_cache.sqlite")
OUT = Path(__file__).with_name("audit_deleted.json")

AO3_CATS = {"Gen", "F/F", "F/M", "M/M", "Multi", "Other", "No category"}
RATINGS = {"Explicit", "Mature", "Teen And Up Audiences", "General Audiences", "Not Rated"}
WARNS = {
    "Choose Not To Use Archive Warnings", "Creator Chose Not To Use Archive Warnings",
    "No Archive Warnings Apply", "Graphic Depictions Of Violence", "Major Character Death",
    "Rape/Non-Con", "Underage", "Underage Sex",
}
DROP = {"FanFiction", "Fanworks", "Completed"}
TITLEPAGE_LABELS = {"Category", "Genre", "Language", "Characters", "Relationships",
                    "Status", "Published", "Updated", "Packaged", "Rating",
                    "Warnings", "Chapters", "Words", "Publisher", "Summary"}


def _db():
    c = sqlite3.connect(CACHE)
    c.row_factory = sqlite3.Row
    return c


def _r2():
    import boto3
    from botocore.config import Config
    return boto3.client(
        "s3", endpoint_url=os.environ["R2_ENDPOINT_URL"],
        aws_access_key_id=os.environ["R2_ACCESS_KEY_ID"],
        aws_secret_access_key=os.environ["R2_SECRET_ACCESS_KEY"],
        region_name="auto", config=Config(signature_version="s3v4"))


def build_kind_dict(c: sqlite3.Connection) -> dict[str, str]:
    """name -> most-common kind, from the typed scrape rows (the 6 719 OK works)."""
    votes: dict[str, Counter] = defaultdict(Counter)
    cols = [("fandoms", "fandom"), ("relationships", "relationship"),
            ("characters", "character"), ("freeforms", "freeform"), ("warnings", "warning")]
    for r in c.execute("SELECT fandoms,relationships,characters,freeforms,warnings "
                       "FROM ao3_scrape WHERE status='ok'"):
        for col, kind in cols:
            for t in (json.loads(r[col]) if r[col] else []):
                votes[t][kind] += 1
    return {n: kc.most_common(1)[0][0] for n, kc in votes.items()}


def _split(v):
    return [html.unescape(t.strip()) for t in v.split(",") if t.strip()] if v else []


def parse_titlepage(xhtml: str) -> dict:
    text = re.sub(r"<[^>]+>", "\n", xhtml)
    lines = [l.strip() for l in text.splitlines() if l.strip()]
    out, cur, buf = {}, None, []
    for l in lines:
        lab = l[:-1] if l.endswith(":") else None
        if lab in TITLEPAGE_LABELS:
            if cur:
                out[cur] = " ".join(buf).strip()
            cur, buf = lab, []
        elif cur:
            buf.append(l)
    if cur:
        out[cur] = " ".join(buf).strip()
    return out


def _empty_tags():
    return {"fandoms": [], "relationships": [], "characters": [], "freeforms": [],
            "warnings": [], "rating": None, "flagged": []}


def recover_typed(z: zipfile.ZipFile, tp_name: str) -> dict:
    m = parse_titlepage(z.read(tp_name).decode("utf-8", "replace"))
    genre = _split(m.get("Genre"))
    t = _empty_tags()
    t["fandoms"] = _split(m.get("Category"))
    t["relationships"] = _split(m.get("Relationships"))
    t["characters"] = [c for c in _split(m.get("Characters")) if c not in DROP]
    t["freeforms"] = [g for g in genre if g not in AO3_CATS and g not in DROP]
    t["warnings"] = _split(m.get("Warnings"))
    t["rating"] = (m.get("Rating") or "").strip() or None
    return t


def recover_flat(z: zipfile.ZipFile, opf_name: str, kind_dict, fandom_hint) -> dict:
    opf = z.read(opf_name).decode("utf-8", "replace")
    subs = [html.unescape(s.strip()) for s in re.findall(r"<dc:subject>(.*?)</dc:subject>", opf)]
    t = _empty_tags()
    for s in subs:
        if not s or s in DROP:
            continue
        if s in RATINGS:
            t["rating"] = s; continue
        if s in AO3_CATS:
            continue
        if s in WARNS:
            t["warnings"].append(s); continue
        kind = kind_dict.get(s)
        if kind is None:
            if "/" in s:
                kind = "relationship"
            elif " | " in s:
                kind = "character"
            elif re.search(r"\([^)]+\)$", s) and fandom_hint and fandom_hint.split()[0] in s:
                kind = "character"
        if kind == "fandom":
            t["fandoms"].append(s)
        elif kind == "relationship":
            t["relationships"].append(s)
        elif kind == "character":
            t["characters"].append(s)
        elif kind == "warning":
            t["warnings"].append(s)
        elif kind == "freeform":
            t["freeforms"].append(s)
        else:
            # Unknown: default to freeform (most unique tags are), but flag the ones
            # that LOOK like a character/fandom ("(Fandom)" suffix or " | " alias) so
            # the reviewer eyeballs the kind.
            t["freeforms"].append(s)
            if re.search(r"\([^)]+\)$", s) or " | " in s:
                t["flagged"].append(s)
    return t


def _opf_title(z: zipfile.ZipFile, opf_name: str) -> str | None:
    m = re.search(r"<dc:title>(.*?)</dc:title>", z.read(opf_name).decode("utf-8", "replace"), re.S)
    return html.unescape(m.group(1).strip()) if m else None


def prep():
    c = _db()
    cli = _r2()
    bucket = os.environ["R2_BUCKET_NAME"]
    kind_dict = build_kind_dict(c)
    print(f"kind dictionary: {len(kind_dict)} tags")

    deleted = [r["work_id"] for r in c.execute("SELECT work_id FROM ao3_scrape WHERE status='deleted'")]
    cal = {r["work_id"]: r for r in c.execute(
        "SELECT CAST(work_id AS INTEGER) work_id, title, authors, primaryship, collection, "
        "shortsummary, wordcount, readstatus FROM calibre_books "
        f"WHERE CAST(work_id AS INTEGER) IN ({','.join('?'*len(deleted))})", deleted)}

    out, stats = [], Counter()
    for wid in deleted:
        b = cal.get(wid)
        data = cli.get_object(Bucket=bucket, Key=f"epubs/{wid}.epub")["Body"].read()
        z = zipfile.ZipFile(io.BytesIO(data))
        opf = next(n for n in z.namelist() if n.endswith(".opf"))
        tp = next((n for n in z.namelist() if n.endswith("title_page.xhtml")), None)
        fmt = "typed" if tp else "flat"
        tags = recover_typed(z, tp) if tp else recover_flat(z, opf, kind_dict, b["collection"] if b else None)

        # epub-authoritative primary ship/collection; Calibre kept as reference.
        primary_ship = tags["relationships"][0] if tags["relationships"] else None
        derived_coll = propose_collection(tags["fandoms"])
        primary_collection = derived_coll or (b["collection"] if b else None) \
            or (tags["fandoms"][0] if tags["fandoms"] else None)

        cal_coll = (b["collection"] if b else None)
        cal_ship = (b["primaryship"] if b else None)
        # conflict = Calibre's collection disagrees with what the epub's fandoms imply
        coll_conflict = bool(derived_coll and cal_coll and derived_coll.lower() != cal_coll.lower())

        rec = {
            "work_id": wid,
            "format": fmt,
            "title": _opf_title(z, opf) or (b["title"] if b else None),
            "authors": json.loads(b["authors"]) if b and b["authors"] else [],
            "summary": (b["shortsummary"] if b else None),
            "rating": map_rating(tags["rating"]),
            "rating_label": tags["rating"],
            "fandoms": tags["fandoms"],
            "relationships": tags["relationships"],
            "characters": tags["characters"],
            "freeforms": tags["freeforms"],
            "warnings": tags["warnings"],
            "flagged": tags["flagged"],
            "primary_ship": primary_ship,
            "primary_collection": primary_collection,
            "readstatus": (b["readstatus"] if b else None),
            "calibre": {"title": (b["title"] if b else None), "primaryship": cal_ship,
                        "collection": cal_coll},
            "conflicts": {"collection": coll_conflict},
        }
        out.append(rec)
        stats[fmt] += 1
        stats["flagged_tags"] += len(tags["flagged"])
        if coll_conflict:
            stats["collection_conflicts"] += 1

    OUT.write_text(json.dumps(out, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"recovered {len(out)} works -> {OUT.name}")
    print(f"  typed (title page): {stats['typed']}   flat (dict+rules): {stats['flat']}")
    print(f"  tags flagged for kind check: {stats['flagged_tags']}")
    print(f"  Calibre-vs-epub collection conflicts: {stats['collection_conflicts']}")


if __name__ == "__main__":
    import sys
    {"prep": prep}.get(sys.argv[1] if len(sys.argv) > 1 else "prep", prep)()
