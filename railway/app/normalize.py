"""Per-work normalization at insert — pure compute (redesign §12.1).

This is the load-bearing import-path logic. It is deliberately SIMPLE, per the
§12.1 correction note (2026-06-14):

  * The primary-ship / primary-collection proposal is just the **lowest-position**
    (AO3 first-listed) relationship / fandom tag — NOT a cleaned/grouped string.
  * Grouping, synonyms, and the old Ship Rules 1–5 do NOT run here. They are
    seeding heuristics for the grouping layer (see seeding.py), consumed by
    migration (Phase D) and Tag Management (Phase G) only.
  * Auto-commit iff each axis is unambiguous: ≤1 fandom AND ≤1 relationship.
    Otherwise the work goes to the per-work Review Queue (primaries only).

No DB, no AO3, no I/O — runs on Railway at insert time.
"""

from __future__ import annotations

from .models import NormalizationProposals, RawCapture, TagProposal

# AO3's rating labels -> our `rating` enum (redesign §6.1).
_RATING_MAP = {
    "Explicit": "Explicit",
    "Mature": "Mature",
    "Teen And Up Audiences": "Teen",
    "Teen": "Teen",
    "General Audiences": "General",
    "General": "General",
    "Not Rated": "Not Rated",
}

# (raw AO3 list field, tag kind) in the order they carry positions.
_KINDS = (
    ("fandoms", "fandom"),
    ("relationships", "relationship"),
    ("characters", "character"),
    ("warnings", "warning"),
    ("freeform_tags", "freeform"),
)


def map_rating(raw: str | None) -> str | None:
    """Map an AO3 rating label to the `rating` enum value (None if unknown)."""
    if raw is None:
        return None
    return _RATING_MAP.get(raw.strip())


def normalize_capture(payload: RawCapture) -> NormalizationProposals:
    """Build the tag list (with per-kind positions) + primary proposals + the
    auto-vs-review decision from a raw AO3 capture."""
    tags: list[TagProposal] = []
    for field, kind in _KINDS:
        raw_list = getattr(payload, field) or []
        for position, name in enumerate(raw_list):
            name = (name or "").strip()
            if not name:
                continue
            tags.append(TagProposal(name=name, kind=kind, position=position))

    fandoms = [t for t in tags if t.kind == "fandom"]
    relationships = [t for t in tags if t.kind == "relationship"]

    # Lowest-position (AO3 first-listed) is the default primary on each axis.
    primary_ship = relationships[0] if relationships else None
    primary_collection = fandoms[0] if fandoms else None
    if primary_ship is not None:
        primary_ship.is_primary_ship = True
    if primary_collection is not None:
        primary_collection.is_primary_collection = True

    auto = len(fandoms) <= 1 and len(relationships) <= 1
    reason = None
    if not auto:
        bits = []
        if len(fandoms) > 1:
            bits.append(f"{len(fandoms)} fandoms")
        if len(relationships) > 1:
            bits.append(f"{len(relationships)} relationships")
        reason = "ambiguous primary: " + ", ".join(bits)

    return NormalizationProposals(
        tags=tags,
        primary_ship_name=primary_ship.name if primary_ship else None,
        primary_collection_name=primary_collection.name if primary_collection else None,
        rating=map_rating(payload.rating),
        auto=auto,
        review_reason=reason,
    )
