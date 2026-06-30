"""
export/xteink_catalog.py — Xteink X4 / Crosspoint library catalog EPUB generator.

Builds one or more catalog EPUBs at the SD card root, each prefixed
``00-Catalog - …`` so they sort above all Collection folders in
Crosspoint's file picker.

Files are split by fandom group:

  00-Catalog - Stray Kids.epub      (one EPUB per "solo" fandom)
  00-Catalog - Harry Potter.epub
  00-Catalog - Teen Wolf.epub
  00-Catalog - Roswell.epub
  00-Catalog - Other Fandoms.epub   (everything else, bundled)

The ESP32-C3 indexes each EPUB lazily on first open and caches its
sections to ``.crosspoint/epub_<hash>/sections/``. Opening Stray Kids
therefore only pays Stray Kids' indexing cost — keeping each catalog
file small (a few hundred KB) is what makes browsing feel fast.

Inside each EPUB:

  cover.xhtml                          Generated date, totals, fandom list
  fandom-{slug}.xhtml                  Small fandom (≤ split threshold)
                                       — overview + all sections inline
  fandom-{slug}-overview.xhtml         Large fandom — overview only
  fandom-{slug}-fav-{ship}.xhtml         Favorites for one ship (split)
  fandom-{slug}-unread-{ship}.xhtml      Unread for one ship (split)

Each fandom carries two jump indices (only non-empty axes appear):

  Favorites By Ship   one section per ship that has favorites
  Unread By Ship      one section per ship with Unread/Priority

Sort orders within sections:

  Favorites - {Ship}   length asc → title
  Unread - {Ship}      Priority entries first, then non-Priority,
                       both blocks sorted length asc → title

Each story-list section has skip-to-end at the top and skip-to-start at
the bottom so the reader can jump straight to the longest story without
scrolling, then read backwards if desired.

Story entry fields (in order):

  Title (heading)
  Author | Series Name #N             (only if series is set)
  Status | NN,NNN words               (raw word count, no bucket)
  Tags                                 (comma-separated, allowlist-filtered)
  Description                          (HTML from #shortsummary; absent if empty)
  📂 path on SD card                   (Collection → Ship → Status → file)

Adaptive splitting: any fandom whose single-file XHTML exceeds the
threshold (default 200 KB) is rebuilt as an overview-only file plus one
file per non-empty section. Crosspoint's reader paginates one spine item
at a time, so keeping each spine item under the threshold avoids parse
failures on large fandoms. Threshold is tunable via the public API.
"""

from __future__ import annotations

import csv
import html
import re
import zipfile
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path

import json
import sqlite3

from .xteink_transfer import (
    COLLECTION_FALLBACK,
    SHIP_FALLBACK,
    build_filename,
    sanitize_folder,
)

# Catalog scope mirrors the transfer step (redesign §12.5): eligible = is_favorite
# OR read_status=Unread, which after status-derivation is exactly these folders.
# Priority is gone; Read/DNF never indexed.
_ELIGIBLE_STATUSES = {"Unread", "Favorite"}


CATALOG_FILENAME_PREFIX = "00-Catalog - "
CATALOG_FILENAME_SUFFIX = ".epub"
CATALOG_TITLE_PREFIX = "Library Catalog — "
OTHER_FANDOMS_LABEL = "Other Fandoms"
LEGACY_SINGLE_FILE_NAME = "00-Library Catalog.epub"
# Subfolder under the SD card root where every catalog EPUB is written.
# Keeps the catalogs grouped under one easy-to-find folder in Crosspoint's
# file picker (`_` sorts ahead of letters) instead of mixed in with the
# Collection folders at the SD root.
CATALOG_SUBFOLDER = "_catalog"
DEFAULT_SPLIT_THRESHOLD_BYTES = 200_000


def _current_timestamp() -> str:
    """UTC timestamp formatted as ``YYYYMMDD-HHMMSS``.

    Pulled out as a small helper so tests can patch it for deterministic
    filenames. Used as the suffix on every catalog EPUB written to the
    SD card; coupled with cleanup of prior-generation files, this means
    each Xfer to XTEINK produces a uniquely-named set of files that
    Crosspoint can't possibly confuse with cached older versions.
    """
    return datetime.now(timezone.utc).strftime("%Y%m%d-%H%M%S")


# ---------------------------------------------------------------------------
# Result type
# ---------------------------------------------------------------------------


@dataclass
class CatalogResult:
    """Outcome of a generate_catalog() call.

    ``catalog_paths`` is the list of EPUB files written, in stable order
    (solo fandoms in configured order, then "Other Fandoms" last).
    ``book_count``, ``fandom_count``, and ``spine_item_count`` are
    aggregates across all files.
    """

    catalog_paths: list[Path] = field(default_factory=list)
    book_count: int = 0
    fandom_count: int = 0
    spine_item_count: int = 0
    split_fandoms: list[str] = field(default_factory=list)


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------


def load_tag_allowlist(tsv_path: Path) -> set[str]:
    """Read a tag-audit TSV; return the set of tags marked ``keep="y"``.

    The TSV has columns ``count``, ``tag``, ``keep``. Only rows whose
    ``keep`` value is the literal ``y`` (case-insensitive) are kept by
    the catalog filter; everything else (``n``, ``?``, blank) is dropped.
    Tags that don't appear in the TSV at all are also dropped — the
    audit is the sole source of truth for "tags worth showing".

    Returns an empty set if the file does not exist or cannot be parsed.
    The catalog treats an empty allowlist as "no filter configured" and
    keeps all tags (lenient fallback for the pre-audit / missing-TSV case).
    """
    if not tsv_path.exists():
        return set()
    allowed: set[str] = set()
    try:
        with tsv_path.open("r", encoding="utf-8", newline="") as f:
            reader = csv.DictReader(f, delimiter="\t")
            for row in reader:
                tag = (row.get("tag") or "").strip()
                keep = (row.get("keep") or "").strip().lower()
                if tag and keep == "y":
                    allowed.add(tag)
    except (OSError, csv.Error):
        return set()
    return allowed


def books_from_snapshot(snapshot_path: Path) -> list[dict]:
    """Read the snapshot and build FFF-shaped book dicts for the catalog renderer.

    Eligibility matches the transfer (is_favorite OR read_status=Unread). Status is
    derived (Favorite overrides), ship/collection fall back to Gen/Other. Tags come
    straight from work_cards.tags — already curated server-side (excluded tags
    stripped during the snapshot build), so the catalog needs no tags-audit
    allowlist. Summary is the AO3 work summary (work_cards.summary_html); series is
    read from the relational `works` table the snapshot ships. Keys mirror the old
    Calibre dump so every renderer below stays verbatim."""
    conn = sqlite3.connect(str(snapshot_path))
    try:
        conn.row_factory = sqlite3.Row
        rows = conn.execute(
            "SELECT wc.work_id, wc.title, wc.authors, wc.primary_ship, "
            "wc.primary_collection, wc.wordcount, wc.read_status, wc.is_favorite, "
            "wc.summary_html, wc.tags, w.series_name, w.series_index "
            "FROM work_cards wc JOIN works w ON w.work_id = wc.work_id "
            "WHERE wc.is_favorite = 1 OR wc.read_status = 'Unread'"
        ).fetchall()
    finally:
        conn.close()

    books: list[dict] = []
    for r in rows:
        try:
            tag_objs = json.loads(r["tags"]) if r["tags"] else []
        except (TypeError, ValueError):
            tag_objs = []
        try:
            authors = json.loads(r["authors"]) if r["authors"] else []
        except (TypeError, ValueError):
            authors = []
        books.append({
            "id": r["work_id"],
            "title": r["title"] or f"work {r['work_id']}",
            "authors": authors,
            "series": r["series_name"] or "",
            "series_index": r["series_index"],
            "tags": [t.get("name") for t in tag_objs if isinstance(t, dict) and t.get("name")],
            "#shortsummary": r["summary_html"] or "",
            "#collection": r["primary_collection"] or COLLECTION_FALLBACK,
            "#primaryship": r["primary_ship"] or SHIP_FALLBACK,
            "#wordcount": r["wordcount"] or 0,
            "#readstatus": "Favorite" if r["is_favorite"] else "Unread",
        })
    return books


def generate_catalog(
    library: list[dict],
    sd_path: Path,
    *,
    split_threshold: int = DEFAULT_SPLIT_THRESHOLD_BYTES,
    tag_allowlist: set[str] | None = None,
    solo_fandoms: list[str] | None = None,
    timestamp: str | None = None,
) -> CatalogResult:
    """Build the catalog EPUBs from a Calibre library dump and write them to ``sd_path``.

    One EPUB is produced per "solo" fandom (in configured order) plus one
    bundled "Other Fandoms" EPUB for everything else. Empty groups are
    skipped — if Roswell has zero eligible stories, no Roswell file is
    written.

    Args:
        library:         Raw Calibre books (each a dict with keys such as
                         ``id``, ``title``, ``authors``, ``series``,
                         ``series_index``, ``tags``, ``#shortsummary``,
                         ``#collection``, ``#primaryship``, ``#wordcount``,
                         ``#readstatus``). Books with a status outside the
                         eligible set or missing a fandom/ship are dropped.
        sd_path:         SD card root. Each EPUB is written to
                         ``sd_path / "00-Catalog - {Label}.epub"``.
        split_threshold: Maximum size in bytes for a single fandom's XHTML
                         before adaptive splitting kicks in.
        tag_allowlist:   Optional set of tags to keep on every story's tag
                         line; tags not in the set are dropped. Use
                         :func:`load_tag_allowlist` to read from the audit
                         TSV. ``None`` or empty (default) means "no filter"
                         and keeps all tags — lenient fallback for the
                         pre-audit / missing-TSV case.
        solo_fandoms:    Override the per-fandom solo list. Defaults to
                         ``config.XTEINK_CATALOG_SOLO_FANDOMS``. Pass an
                         empty list to bundle everything into one
                         "Other Fandoms" file.

    Returns:
        :class:`CatalogResult` — paths of all EPUBs written, plus aggregates.
    """
    allowlist = tag_allowlist or set()
    if solo_fandoms is None:
        solo_fandoms = []  # caller passes settings.xteink_catalog_solo_fandoms; [] = bundle all
    if timestamp is None:
        timestamp = _current_timestamp()

    eligible_statuses = _ELIGIBLE_STATUSES
    eligible: list[dict] = []
    for book in library:
        status = (book.get("#readstatus") or "").strip() or "Unread"
        if status not in eligible_statuses:
            continue
        if not (book.get("#collection") or "").strip():
            continue
        if not (book.get("#primaryship") or "").strip():
            continue
        eligible.append(book)

    by_fandom: dict[str, list[dict]] = {}
    for book in eligible:
        coll = (book["#collection"]).strip()
        by_fandom.setdefault(coll, []).append(book)

    groups = _partition_fandoms_into_files(by_fandom, solo_fandoms)

    catalog_dir = sd_path / CATALOG_SUBFOLDER
    catalog_dir.mkdir(parents=True, exist_ok=True)

    paths: list[Path] = []
    total_spine_items = 0
    all_split_fandoms: list[str] = []
    for label, group_fandoms in groups:
        target = catalog_dir / (
            f"{CATALOG_FILENAME_PREFIX}{label} - {timestamp}"
            f"{CATALOG_FILENAME_SUFFIX}"
        )
        spine_count, split_for_group = _build_epub_for_group(
            label=label,
            target=target,
            by_fandom=group_fandoms,
            allowlist=allowlist,
            split_threshold=split_threshold,
        )
        paths.append(target)
        total_spine_items += spine_count
        all_split_fandoms.extend(split_for_group)

    _cleanup_prior_catalogs(sd_path, keep={p.name for p in paths})

    return CatalogResult(
        catalog_paths=paths,
        book_count=len(eligible),
        fandom_count=len(by_fandom),
        spine_item_count=total_spine_items,
        split_fandoms=all_split_fandoms,
    )


def _cleanup_prior_catalogs(sd_path: Path, *, keep: set[str]) -> None:
    """Remove any prior-generation catalog files from ``sd_path``.

    Cleans three things:

    1. Files inside ``sd_path / _catalog`` matching the FFF naming pattern
       whose basename isn't in ``keep`` (prior generations).
    2. Files matching the FFF naming pattern at the **SD root** — left
       over from before the ``_catalog`` subfolder was introduced. Always
       removed; nothing in this run writes to the root.
    3. The legacy single-file catalog ``00-Library Catalog.epub``.

    Best-effort: a permission/IO failure is swallowed so a stuck old
    file can't fail the whole catalog generation.
    """
    catalog_dir = sd_path / CATALOG_SUBFOLDER
    if catalog_dir.exists():
        for existing in list(catalog_dir.glob(
            f"{CATALOG_FILENAME_PREFIX}*{CATALOG_FILENAME_SUFFIX}"
        )):
            if existing.name in keep:
                continue
            try:
                existing.unlink()
            except OSError:
                pass
    # Pre-subfolder leftovers at SD root.
    for existing in list(sd_path.glob(
        f"{CATALOG_FILENAME_PREFIX}*{CATALOG_FILENAME_SUFFIX}"
    )):
        try:
            existing.unlink()
        except OSError:
            pass
    legacy = sd_path / LEGACY_SINGLE_FILE_NAME
    if legacy.exists():
        try:
            legacy.unlink()
        except OSError:
            pass


# ---------------------------------------------------------------------------
# Partitioning
# ---------------------------------------------------------------------------


def _partition_fandoms_into_files(
    by_fandom: dict[str, list[dict]],
    solo_fandoms: list[str],
) -> list[tuple[str, dict[str, list[dict]]]]:
    """Split fandoms into per-file groups.

    Returns a list of ``(label, {fandom: books})`` in stable order:

    1. Each configured solo fandom that has at least one eligible book,
       in the order given by ``solo_fandoms``.
    2. ``Other Fandoms`` containing everything else, if any.

    Empty groups are omitted.
    """
    groups: list[tuple[str, dict[str, list[dict]]]] = []
    consumed: set[str] = set()
    for fandom in solo_fandoms:
        books = by_fandom.get(fandom)
        if books:
            groups.append((fandom, {fandom: books}))
            consumed.add(fandom)
    other = {
        fandom: books
        for fandom, books in by_fandom.items()
        if fandom not in consumed
    }
    if other:
        groups.append((OTHER_FANDOMS_LABEL, other))
    return groups


def _build_epub_for_group(
    *,
    label: str,
    target: Path,
    by_fandom: dict[str, list[dict]],
    allowlist: set[str],
    split_threshold: int,
) -> tuple[int, list[str]]:
    """Build and write one catalog EPUB for the given fandom group.

    Returns ``(spine_item_count, split_fandoms_for_group)``.
    """
    title = f"{CATALOG_TITLE_PREFIX}{label}"
    book_total = sum(len(books) for books in by_fandom.values())

    spine_items: list[tuple[str, str, str]] = []
    spine_items.append((
        "cover.xhtml",
        title,
        _render_cover(by_fandom, title=title, total_books=book_total),
    ))

    # Group-unique fandom slugs so two fandoms bundled in "Other Fandoms" can't
    # collide on the same filename.
    fandom_slugs = _unique_slugs(by_fandom.keys())
    split_fandoms: list[str] = []
    for fandom in sorted(by_fandom):
        books = by_fandom[fandom]
        slug = fandom_slugs[fandom]
        single_xhtml = _render_fandom_single(fandom, books, allowlist)
        if len(single_xhtml.encode("utf-8")) <= split_threshold:
            spine_items.append((
                f"fandom-{slug}.xhtml",
                fandom,
                single_xhtml,
            ))
        else:
            split_fandoms.append(fandom)
            spine_items.extend(_render_fandom_split(fandom, books, allowlist, slug))

    _write_epub(target, title, spine_items)
    return len(spine_items), split_fandoms


# ---------------------------------------------------------------------------
# Grouping & sorting
# ---------------------------------------------------------------------------


def _word_count(book: dict) -> int:
    """Coerce a book's #wordcount to a non-negative int.

    Calibre custom columns of type integer or float return as numeric
    JSON values. But if the column is text — or contains formatted
    strings ("10,752", "5000.0", "10k words") — the JSON value is a
    string. We accept any of those and coerce; on failure, fall back to
    0. Without this, malformed entries silently sort as 0 and bunch up
    at the top of length-ordered sections, making them look unsorted.
    """
    raw = book.get("#wordcount")
    if raw is None or raw == "":
        return 0
    if isinstance(raw, bool):
        return 0  # bool is a subclass of int; reject explicitly
    if isinstance(raw, (int, float)):
        return max(int(raw), 0)
    if isinstance(raw, str):
        # Pull the first run of digits, optionally with a decimal.
        # Tolerates thousand separators, leading/trailing whitespace,
        # and trailing units ("words", "k", etc).
        m = re.search(r"\d[\d,]*(?:\.\d+)?", raw)
        if not m:
            return 0
        cleaned = m.group(0).replace(",", "")
        try:
            return max(int(float(cleaned)), 0)
        except (TypeError, ValueError):
            return 0
    return 0


def _status(book: dict) -> str:
    return (book.get("#readstatus") or "").strip() or "Unread"


def _ship(book: dict) -> str:
    return (book.get("#primaryship") or "").strip()


def _title(book: dict) -> str:
    return (book.get("title") or "").strip()


def _sort_length_then_title(books: list[dict]) -> list[dict]:
    return sorted(books, key=lambda b: (_word_count(b), _title(b).casefold()))


def _sort_unread_with_priority_first(books: list[dict]) -> list[dict]:
    """Sort: Priority entries first, then non-Priority, both length asc → title."""
    priority = [b for b in books if _status(b) == "Priority"]
    other = [b for b in books if _status(b) != "Priority"]
    return _sort_length_then_title(priority) + _sort_length_then_title(other)


def _group_by_ship(books: list[dict]) -> dict[str, list[dict]]:
    out: dict[str, list[dict]] = {}
    for b in books:
        out.setdefault(_ship(b), []).append(b)
    return out


# ---------------------------------------------------------------------------
# Rendering — single-file fandom
# ---------------------------------------------------------------------------


def _render_fandom_single(
    fandom: str, books: list[dict], allowlist: set[str],
) -> str:
    """Render an entire fandom (overview + all sections) into one XHTML."""
    favorites = [b for b in books if _status(b) == "Favorite"]
    unread = [b for b in books if _status(b) in {"Unread", "Priority"}]

    fav_by_ship = _group_by_ship(favorites)
    unread_by_ship = _group_by_ship(unread)
    ship_slugs = _unique_slugs(set(fav_by_ship) | set(unread_by_ship))

    body_parts: list[str] = [f"<h1>{html.escape(fandom)}</h1>"]
    body_parts.append(_render_fandom_jump_lists_inline(
        fandom, fav_by_ship, unread_by_ship, ship_slugs,
    ))

    for ship in sorted(fav_by_ship):
        body_parts.append(_render_section_inline(
            section_id=_section_id_fav(ship_slugs[ship]),
            heading=f"Favorites - {ship}",
            books=_sort_length_then_title(fav_by_ship[ship]),
            fandom=fandom,
            allowlist=allowlist,
        ))

    for ship in sorted(unread_by_ship):
        body_parts.append(_render_section_inline(
            section_id=_section_id_unread(ship_slugs[ship]),
            heading=f"Unread - {ship}",
            books=_sort_unread_with_priority_first(unread_by_ship[ship]),
            fandom=fandom,
            allowlist=allowlist,
        ))

    return _wrap_xhtml(fandom, "\n".join(body_parts))


def _render_fandom_jump_lists_inline(
    fandom: str,
    fav_by_ship: dict[str, list[dict]],
    unread_by_ship: dict[str, list[dict]],
    ship_slugs: dict[str, str],
) -> str:
    """Two jump lists at the top of a single-file fandom; in-document anchors."""
    parts: list[str] = []
    if fav_by_ship:
        parts.append("<h2>Favorites By Ship</h2>")
        parts.append("<p>" + " · ".join(
            f'<a href="#{_section_id_fav(ship_slugs[ship])}-top">'
            f'{html.escape(ship)} ({len(fav_by_ship[ship])})</a>'
            for ship in sorted(fav_by_ship)
        ) + "</p>")
    if unread_by_ship:
        parts.append("<h2>Unread By Ship</h2>")
        parts.append("<p>" + " · ".join(
            f'<a href="#{_section_id_unread(ship_slugs[ship])}-top">'
            f'{html.escape(ship)} ({len(unread_by_ship[ship])})</a>'
            for ship in sorted(unread_by_ship)
        ) + "</p>")
    return "\n".join(parts)


def _render_section_inline(
    *, section_id: str, heading: str, books: list[dict], fandom: str,
    allowlist: set[str],
) -> str:
    """A story-list section with skip-to-end / skip-to-start anchors, inside
    a single-file fandom XHTML. Each nav line also offers a "Start over"
    link back to the catalog cover.
    """
    top_id = f"{section_id}-top"
    end_id = f"{section_id}-end"
    parts: list[str] = []
    parts.append(f'<section id="{top_id}">')
    parts.append(f"<h3>{html.escape(heading)}</h3>")
    parts.append(
        f'<p class="nav">'
        f'<a href="#{end_id}">↓ Skip to end</a> · '
        f'<a href="cover.xhtml">↺ Start over</a>'
        f'</p>'
    )
    for book in books:
        parts.append(_render_story_entry(book, fandom, allowlist))
    parts.append(
        f'<p class="nav" id="{end_id}">'
        f'<a href="#{top_id}">↑ Back to top</a> · '
        f'<a href="cover.xhtml">↺ Start over</a>'
        f'</p>'
    )
    parts.append("</section>")
    return "\n".join(parts)


# ---------------------------------------------------------------------------
# Rendering — split fandom (overview + per-section files)
# ---------------------------------------------------------------------------


def _render_fandom_split(
    fandom: str, books: list[dict], allowlist: set[str], slug: str,
) -> list[tuple[str, str, str]]:
    """Render a fandom as one overview file + one file per non-empty section.

    ``slug`` is the fandom's group-unique slug (from _unique_slugs); section files
    additionally key off per-ship unique slugs so two ships can't collide.
    Returns list of (filename, title, xhtml) tuples, ready for the spine.
    """
    favorites = [b for b in books if _status(b) == "Favorite"]
    unread = [b for b in books if _status(b) in {"Unread", "Priority"}]

    fav_by_ship = _group_by_ship(favorites)
    unread_by_ship = _group_by_ship(unread)
    ship_slugs = _unique_slugs(set(fav_by_ship) | set(unread_by_ship))

    out: list[tuple[str, str, str]] = []

    overview_parts = [f"<h1>{html.escape(fandom)}</h1>"]
    if fav_by_ship:
        overview_parts.append("<h2>Favorites By Ship</h2>")
        overview_parts.append("<ul>")
        for ship in sorted(fav_by_ship):
            href = f"fandom-{slug}-fav-{ship_slugs[ship]}.xhtml"
            overview_parts.append(
                f'<li><a href="{href}">{html.escape(ship)} '
                f'({len(fav_by_ship[ship])})</a></li>'
            )
        overview_parts.append("</ul>")
    if unread_by_ship:
        overview_parts.append("<h2>Unread By Ship</h2>")
        overview_parts.append("<ul>")
        for ship in sorted(unread_by_ship):
            href = f"fandom-{slug}-unread-{ship_slugs[ship]}.xhtml"
            overview_parts.append(
                f'<li><a href="{href}">{html.escape(ship)} '
                f'({len(unread_by_ship[ship])})</a></li>'
            )
        overview_parts.append("</ul>")

    out.append((
        f"fandom-{slug}-overview.xhtml",
        fandom,
        _wrap_xhtml(fandom, "\n".join(overview_parts)),
    ))

    for ship in sorted(fav_by_ship):
        sorted_books = _sort_length_then_title(fav_by_ship[ship])
        out.append((
            f"fandom-{slug}-fav-{ship_slugs[ship]}.xhtml",
            f"Favorites - {ship} ({fandom})",
            _render_split_section(
                heading=f"Favorites - {ship}",
                subheading=fandom,
                books=sorted_books,
                fandom=fandom,
                allowlist=allowlist,
            ),
        ))

    for ship in sorted(unread_by_ship):
        sorted_books = _sort_unread_with_priority_first(unread_by_ship[ship])
        out.append((
            f"fandom-{slug}-unread-{ship_slugs[ship]}.xhtml",
            f"Unread - {ship} ({fandom})",
            _render_split_section(
                heading=f"Unread - {ship}",
                subheading=fandom,
                books=sorted_books,
                fandom=fandom,
                allowlist=allowlist,
            ),
        ))

    return out


def _render_split_section(
    *, heading: str, subheading: str, books: list[dict], fandom: str,
    allowlist: set[str],
) -> str:
    """One full XHTML file containing one story-list section.

    Used for split (large) fandoms. Skip links target in-document anchors;
    each nav line also offers a "Start over" link back to the catalog cover.
    """
    parts: list[str] = []
    parts.append(f'<h1 id="top">{html.escape(heading)}</h1>')
    parts.append(f"<p>{html.escape(subheading)}</p>")
    parts.append(
        '<p class="nav">'
        '<a href="#end">↓ Skip to end</a> · '
        '<a href="cover.xhtml">↺ Start over</a>'
        '</p>'
    )
    for book in books:
        parts.append(_render_story_entry(book, fandom, allowlist))
    parts.append(
        '<p class="nav" id="end">'
        '<a href="#top">↑ Back to top</a> · '
        '<a href="cover.xhtml">↺ Start over</a>'
        '</p>'
    )
    return _wrap_xhtml(heading, "\n".join(parts))


# ---------------------------------------------------------------------------
# Rendering — story entry
# ---------------------------------------------------------------------------


def _render_story_entry(book: dict, fandom: str, allowlist: set[str]) -> str:
    """One story's metadata block as displayed inside a story-list section.

    The summary block is rendered from ``#shortsummary`` (an AI-compressed
    short version, ~50 words; or a plain copy of any source summary already
    ≤100 words, written by ``tools/copy_short_summaries.py``). If that
    custom column is empty, no summary block appears for this entry — the
    catalog stays small until the summarizer step populates the field.
    Long unprocessed AO3 summaries are *never* fallen back on, because
    their byte volume makes catalog indexing on the X4 painfully slow.
    """
    title = _title(book) or "Untitled"
    author = _format_author(book)
    series = _format_series(book)
    status = _status(book)
    words = _word_count(book)
    tags = _format_tags(book, allowlist)
    short = (book.get("#shortsummary") or "").strip()
    summary_html = _clean_summary_html(short) if short else ""
    path_str = _format_device_path(book, fandom)

    # Priority stories float to the top of Unread sections (by design),
    # which can look like a sort bug to the reader. Prepending "** " to
    # the title gives an obvious visual cue for *why* a longer story is
    # appearing before shorter ones in the same section.
    display_title = f"** {title}" if status == "Priority" else title

    parts: list[str] = ['<article class="story">']
    parts.append(f"<h4>{html.escape(display_title)}</h4>")

    author_series_line: list[str] = []
    if author:
        author_series_line.append(html.escape(author))
    if series:
        author_series_line.append(html.escape(series))
    if author_series_line:
        parts.append('<p class="meta">' + " | ".join(author_series_line) + "</p>")

    parts.append(
        f'<p class="meta">{html.escape(status)} | '
        f'{words:,} words</p>'
    )

    if tags:
        parts.append(f'<p class="tags">{html.escape(tags)}</p>')

    if summary_html:
        parts.append(f'<div class="summary">{summary_html}</div>')

    parts.append(f'<p class="path">📂 {html.escape(path_str)}</p>')
    parts.append("</article>")
    return "\n".join(parts)


def _format_author(book: dict) -> str:
    """Render the authors field, accepting either a list or a string."""
    raw = book.get("authors")
    if not raw:
        return ""
    if isinstance(raw, list):
        return ", ".join(str(a).strip() for a in raw if str(a).strip())
    return str(raw).strip()


def _format_series(book: dict) -> str:
    """Return ``"Series Name #N"`` if a series is set, else empty string."""
    series = (book.get("series") or "")
    if not isinstance(series, str):
        series = str(series)
    series = series.strip()
    if not series:
        return ""
    idx = book.get("series_index")
    if idx is None or idx == "":
        return series
    try:
        n = float(idx)
        idx_str = str(int(n)) if n.is_integer() else f"{n:g}"
    except (TypeError, ValueError):
        idx_str = str(idx)
    return f"{series} #{idx_str}"


def _format_tags(book: dict, allowlist: set[str]) -> str:
    """Comma-separated tag list filtered by the allowlist.

    If ``allowlist`` is non-empty, only tags appearing in it are kept. An
    empty allowlist (the default / missing-TSV case) is treated as "no
    filter" and every tag is kept — lenient fallback so a missing audit
    file doesn't silently strip every tag from the catalog.
    """
    raw = book.get("tags")
    if not raw:
        return ""
    if isinstance(raw, list):
        tags = [str(t).strip() for t in raw if str(t).strip()]
    else:
        tags = [t.strip() for t in str(raw).split(",") if t.strip()]
    if allowlist:
        tags = [t for t in tags if t in allowlist]
    return ", ".join(tags)


def _format_device_path(book: dict, fandom: str) -> str:
    """Build the SD-card breadcrumb shown beneath the summary."""
    ship = sanitize_folder(_ship(book))
    status = sanitize_folder(_status(book))
    coll = sanitize_folder(fandom)
    filename = build_filename(_word_count(book), _title(book) or "Untitled")
    return f"{coll} → {ship} → {status} → {filename}"


# ---------------------------------------------------------------------------
# Rendering — cover
# ---------------------------------------------------------------------------


def _render_cover(
    by_fandom: dict[str, list[dict]],
    *,
    title: str,
    total_books: int,
) -> str:
    generated = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC")
    parts: list[str] = [
        f"<h1>{html.escape(title)}</h1>",
        f'<p class="meta">Generated {html.escape(generated)} · '
        f'{total_books:,} stories · {len(by_fandom):,} fandom(s)</p>',
        "<h2>Fandoms</h2>",
        "<ul>",
    ]
    for fandom in sorted(by_fandom):
        slug = _slug(fandom)
        # The cover always links to {slug}.xhtml; the writer makes either
        # fandom-{slug}.xhtml (small) or fandom-{slug}-overview.xhtml (split)
        # exist, so the cover instead points at whichever was generated.
        # We rebind href post-hoc by checking which file got into the spine.
        parts.append(
            f'<li><a class="fandom-link" data-fandom-slug="{slug}" href="">'
            f"{html.escape(fandom)} ({len(by_fandom[fandom])})</a></li>"
        )
    parts.append("</ul>")
    return _wrap_xhtml(title, "\n".join(parts))


def _rebind_cover_links(
    cover_xhtml: str, spine_items: list[tuple[str, str, str]],
) -> str:
    """Patch the cover's per-fandom links to point at whichever file was emitted.

    Small fandoms produce ``fandom-{slug}.xhtml``; large fandoms produce
    ``fandom-{slug}-overview.xhtml``. The cover renderer doesn't know which
    each fandom turned out to be, so we patch hrefs after the spine is built.
    """
    by_slug: dict[str, str] = {}
    for filename, _title, _body in spine_items:
        m = re.match(r"fandom-(.+?)(?:-overview)?\.xhtml$", filename)
        if not m:
            continue
        slug = m.group(1)
        if slug.endswith("-overview"):
            slug = slug[:-len("-overview")]
        by_slug.setdefault(slug, filename)
        if filename.endswith("-overview.xhtml"):
            by_slug[slug] = filename  # prefer overview if both forms appear

    def _patch(match: re.Match) -> str:
        slug = match.group(1)
        href = by_slug.get(slug, "")
        return f'data-fandom-slug="{slug}" href="{href}"'

    return re.sub(
        r'data-fandom-slug="([^"]+)"\s+href=""',
        _patch,
        cover_xhtml,
    )


# ---------------------------------------------------------------------------
# Section IDs (in-document anchors)
# ---------------------------------------------------------------------------


def _section_id_fav(ship_slug: str) -> str:
    return f"fav-{ship_slug}"


def _section_id_unread(ship_slug: str) -> str:
    return f"unread-{ship_slug}"


# ---------------------------------------------------------------------------
# Slugging & XHTML wrappers
# ---------------------------------------------------------------------------


_SLUG_KEEP = re.compile(r"[A-Za-z0-9]+")


def _slug(text: str) -> str:
    """URL-safe lowercase slug, ASCII-only. Empty input → ``"x"``."""
    parts = _SLUG_KEEP.findall(text or "")
    if not parts:
        return "x"
    return "-".join(parts).lower()


def _unique_slugs(names) -> dict[str, str]:
    """Map each name to a slug UNIQUE within the collection. Distinct strings can
    share a base _slug(): StoryHub ship tags like ``A/B`` and ``A & B`` both reduce
    to ``a-b``, and two fandoms can collide on punctuation. Left undeduped, their
    XHTML filenames / anchor ids collide and one silently overwrites the other in the
    EPUB (lost sections). Collisions get a ``-2``, ``-3`` … suffix; sorted order keeps
    the assignment stable across runs. (FFF never hit this — #primaryship was a single
    hand-curated value; StoryHub primary ships are raw relationship-tag names.)"""
    out: dict[str, str] = {}
    used: set[str] = set()
    for name in sorted(set(names)):
        base = _slug(name)
        slug = base
        n = 2
        while slug in used:
            slug = f"{base}-{n}"
            n += 1
        used.add(slug)
        out[name] = slug
    return out


_XHTML_STYLE = (
    "body { font-family: serif; }\n"
    ".meta { color: #444; font-size: 0.9em; margin: 0.2em 0; }\n"
    ".tags { font-size: 0.9em; margin: 0.2em 0; }\n"
    ".path { color: #555; font-size: 0.85em; margin: 0.4em 0; }\n"
    ".summary { margin: 0.4em 0 0.8em 0; }\n"
    "article.story { margin: 1em 0; padding-bottom: 0.5em; "
    "border-bottom: 1px solid #ccc; }\n"
    "h1, h2, h3, h4 { margin: 0.6em 0 0.3em 0; }\n"
    "p.nav { margin: 0.3em 0; }\n"
)


def _wrap_xhtml(title: str, body: str) -> str:
    return (
        '<?xml version="1.0" encoding="UTF-8"?>\n'
        '<!DOCTYPE html>\n'
        '<html xmlns="http://www.w3.org/1999/xhtml" xml:lang="en" lang="en">\n'
        "<head>\n"
        '<meta charset="UTF-8" />\n'
        f"<title>{html.escape(title)}</title>\n"
        f"<style>\n{_XHTML_STYLE}</style>\n"
        "</head>\n"
        f"<body>\n{body}\n</body>\n"
        "</html>\n"
    )


# ---------------------------------------------------------------------------
# Summary HTML cleaning
# ---------------------------------------------------------------------------


_DANGEROUS_TAG_RE = re.compile(
    r"<(script|style|iframe|object|embed)\b[^>]*>.*?</\1\s*>",
    re.IGNORECASE | re.DOTALL,
)
_DANGEROUS_SELFCLOSE_RE = re.compile(
    r"<(script|style|iframe|object|embed)\b[^>]*/>",
    re.IGNORECASE,
)


def _clean_summary_html(text: str) -> str:
    """Best-effort clean of the ``#shortsummary`` text.

    Strips obviously dangerous tags (``script``, ``style``, ``iframe``,
    ``object``, ``embed``) and their content. Other tags pass through
    unchanged — short summaries are typically plain text, but can contain
    simple ``<p>`` / ``<em>`` markup if copied directly from Calibre.

    Plain-text input (no tags) is wrapped in ``<p>`` and HTML-escaped
    so newlines don't collapse.
    """
    if not text:
        return ""
    text = _DANGEROUS_TAG_RE.sub("", text)
    text = _DANGEROUS_SELFCLOSE_RE.sub("", text)
    if "<" not in text:
        escaped = html.escape(text).replace("\n\n", "</p><p>").replace("\n", "<br/>")
        return f"<p>{escaped}</p>"
    return text


# ---------------------------------------------------------------------------
# EPUB packaging
# ---------------------------------------------------------------------------


def _container_xml() -> str:
    return (
        '<?xml version="1.0" encoding="UTF-8"?>\n'
        '<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:'
        'xmlns:container">\n'
        '  <rootfiles>\n'
        '    <rootfile full-path="OEBPS/content.opf" '
        'media-type="application/oebps-package+xml"/>\n'
        '  </rootfiles>\n'
        '</container>\n'
    )


def _content_opf(title: str, spine_items: list[tuple[str, str, str]]) -> str:
    """Manifest + spine for the EPUB."""
    book_id = f"fff-xteink-catalog-{_slug(title)}"
    generated = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")

    manifest_lines = [
        '<item id="nav" href="nav.xhtml" '
        'media-type="application/xhtml+xml" properties="nav"/>',
    ]
    spine_lines: list[str] = []
    for i, (filename, _title, _body) in enumerate(spine_items):
        item_id = f"item{i}"
        manifest_lines.append(
            f'<item id="{item_id}" href="{filename}" '
            f'media-type="application/xhtml+xml"/>'
        )
        spine_lines.append(f'<itemref idref="{item_id}"/>')

    return (
        '<?xml version="1.0" encoding="UTF-8"?>\n'
        '<package xmlns="http://www.idpf.org/2007/opf" '
        'version="3.0" unique-identifier="bookid">\n'
        '  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">\n'
        f'    <dc:identifier id="bookid">{book_id}</dc:identifier>\n'
        f'    <dc:title>{html.escape(title)}</dc:title>\n'
        f'    <dc:language>en</dc:language>\n'
        f'    <meta property="dcterms:modified">{generated}</meta>\n'
        '  </metadata>\n'
        '  <manifest>\n    '
        + "\n    ".join(manifest_lines)
        + '\n  </manifest>\n'
        '  <spine>\n    '
        + "\n    ".join(spine_lines)
        + '\n  </spine>\n'
        '</package>\n'
    )


def _nav_xhtml(spine_items: list[tuple[str, str, str]]) -> str:
    """EPUB 3 navigation document — feeds Crosspoint's chapter selection screen."""
    items = "\n".join(
        f'    <li><a href="{filename}">{html.escape(title)}</a></li>'
        for filename, title, _body in spine_items
    )
    return (
        '<?xml version="1.0" encoding="UTF-8"?>\n'
        '<!DOCTYPE html>\n'
        '<html xmlns="http://www.w3.org/1999/xhtml" '
        'xmlns:epub="http://www.idpf.org/2007/ops" '
        'xml:lang="en" lang="en">\n'
        '<head><meta charset="UTF-8"/><title>Navigation</title></head>\n'
        '<body>\n'
        '  <nav epub:type="toc" id="toc">\n'
        '    <h1>Catalog</h1>\n'
        '    <ol>\n'
        f"{items}\n"
        '    </ol>\n'
        '  </nav>\n'
        '</body></html>\n'
    )


def _write_epub(
    target: Path,
    title: str,
    spine_items: list[tuple[str, str, str]],
) -> None:
    """Write the EPUB zip to ``target``, replacing any existing file."""
    spine_items = list(spine_items)
    if spine_items:
        cover_filename, cover_title, cover_body = spine_items[0]
        if cover_filename == "cover.xhtml":
            spine_items[0] = (
                cover_filename,
                cover_title,
                _rebind_cover_links(cover_body, spine_items),
            )

    target.parent.mkdir(parents=True, exist_ok=True)
    if target.exists():
        target.unlink()

    with zipfile.ZipFile(target, "w", zipfile.ZIP_DEFLATED) as zf:
        # mimetype must be the first entry, stored uncompressed.
        zi = zipfile.ZipInfo("mimetype")
        zi.compress_type = zipfile.ZIP_STORED
        zf.writestr(zi, "application/epub+zip")

        zf.writestr("META-INF/container.xml", _container_xml())
        zf.writestr("OEBPS/content.opf", _content_opf(title, spine_items))
        zf.writestr("OEBPS/nav.xhtml", _nav_xhtml(spine_items))
        for filename, _title, body in spine_items:
            zf.writestr(f"OEBPS/{filename}", body)
