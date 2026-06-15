"""Grouping-layer seeding heuristics — pure compute (redesign §6.3.1).

Lifted from FFF's normalization rules (docs/lifted-from-fff/normalization-rules.md;
do NOT change the rules without reading that doc). In the Calibre era these
emitted `#primaryship` / `#collection` strings; in the redesign they **demote to
seeding heuristics** that propose grouping-layer membership and display aliases.

CONSUMERS: migration (Phase D) seeds tag_groups / canonical synonyms / display
aliases from these; Tag Management (Phase G) offers them as suggestions. They are
**NOT** the per-work import path — primary selection at insert is lowest-position
only (see normalize.py, §12.1 correction note). Kept here, tested, so D/G reuse
them without re-deriving battle-tested logic.

These tables are user-editable later (will move to settings/config); seeded here
verbatim from the lifted doc.
"""

from __future__ import annotations

import re

# Rule 5 — full-name -> fan-preferred shortname (normalization-rules.md). Most
# ships resolve via Calibre lookup (Rule 4, migration-only); this covers the rest.
SHORTNAME_OVERRIDES: dict[str, str] = {
    "Katniss Everdeen/Peeta Mellark": "Katniss/Peeta",
    "Elizabeth Bennet/Fitzwilliam Darcy": "Darcy/Elizabeth",
    'James "Bucky" Barnes/Clint Barton': "Bucky/Clint",
    "Jason Todd/Tim Drake": "Tim Drake/Jason Todd",
    "Regulus Black/James Potter": "Regulus/James",
}

# Collection keyword table — first match wins (normalization-rules.md).
COLLECTION_KEYWORDS: list[tuple[tuple[str, ...], str]] = [
    (("Stray Kids",), "Stray Kids"),
    (("ATEEZ",), "ATEEZ"),
    (("Hunger Games",), "Hunger Games"),
    (("Harry Potter",), "Harry Potter"),
    (("Batman", "DCU", "DC Comics"), "DCU"),
    (("Marvel", "Avengers"), "Marvel"),
    (("Pride and Prejudice", "Jane Austen"), "Jane Austen"),
    (("Roswell New Mexico",), "Roswell"),
    (("Mass Effect",), "Mass Effect"),
    (("Dragon Age",), "Dragon Age"),
    (("Shadowhunters", "Mortal Instruments"), "Shadowhunters"),
    (("Star Wars",), "Star Wars"),
    (("Teen Wolf",), "Teen Wolf"),
    (("Witcher",), "Witcher"),
    (("Skyrim", "Elder Scrolls"), "Skyrim"),
]

POLY_TAG_SIGNALS = ("Polyamory", "Polyamory Negotiations")

_ALIAS_RE = re.compile(r"\s*\|.*$")          # Rule 1: ` | Alias` and after
_FANDOM_SUFFIX_RE = re.compile(r"\s*\([^)]*\)\s*$")  # Rule 2: trailing `(Fandom)`


def clean_name_segment(segment: str) -> str:
    """Rules 1 & 2 applied to a single character/name segment."""
    return _FANDOM_SUFFIX_RE.sub("", _ALIAS_RE.sub("", segment)).strip()


def clean_ship(raw: str) -> str:
    """Clean a relationship tag segment-by-segment (Rules 1 & 2)."""
    return "/".join(clean_name_segment(s) for s in raw.split("/"))


def is_poly(relationship: str | None, freeform_tags: list[str]) -> bool:
    """Rule 3 — any one signal triggers Poly (after Rules 1 & 2)."""
    if relationship:
        cleaned = clean_ship(relationship)
        names = [n.strip() for n in cleaned.split("/")]
        if len({n for n in names if n}) >= 3:
            return True
        if any(n == "Everyone" for n in names):
            return True
    return any(t.strip() in POLY_TAG_SIGNALS for t in freeform_tags)


def shortname(raw_ship: str) -> str | None:
    """Rule 5 — known full-name -> shortname mapping, applied after cleaning."""
    return SHORTNAME_OVERRIDES.get(clean_ship(raw_ship))


def propose_collection(fandoms: list[str]) -> str | None:
    """Keyword-match the fandom list to a collection group name (first wins)."""
    for fandom in fandoms:
        for keywords, collection in COLLECTION_KEYWORDS:
            if any(kw.lower() in fandom.lower() for kw in keywords):
                return collection
    return None
