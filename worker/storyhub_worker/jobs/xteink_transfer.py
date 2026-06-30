"""X4 / Xteink Crosspoint SD-card transfer (redesign §12.5, lifted from FFF
orchestrator/export/xteink_transfer.py).

Folder structure `<sd_root>/<Collection>/<Ship>/<Status>/[NNN]-Title.epub` and the
filename format are UNCHANGED (hard rule — Crosspoint indexes by epub content hash;
structure changes orphan caches). Only the data source and eligibility move to the
StoryHub model:

  - Source: the latest snapshot `work_cards` (from R2) + epubs from R2, not Calibre.
  - Eligibility: a work transfers iff `is_favorite` OR `read_status = Unread`.
  - Status folder is DERIVED, not stored: `Favorite` if is_favorite else `Unread`
    (favorite overrides read state — a favorited Read work still rides along).
  - Ship fallback: works with no primary ship get a synthetic `Gen` folder.
  - Collection fallback: works with no primary collection get `Other`.

The sanitize / path / scan / prune helpers are byte-for-byte the FFF logic.
"""

from __future__ import annotations

import shutil
import sqlite3
import tempfile
from dataclasses import dataclass, field
from pathlib import Path
from typing import Callable

from ..config import Settings
from . import r2

COLLECTION_FALLBACK = "Other"
SHIP_FALLBACK = "Gen"


class XteinkSdCardNotFoundError(Exception):
    """Raised when no SD card containing .crosspoint/ can be located."""


@dataclass
class XteinkBook:
    work_id: int
    title: str
    collection: str
    ship: str
    word_count: int
    status: str  # derived device folder: "Favorite" | "Unread"


@dataclass
class XteinkTransferResult:
    sd_path: Path
    transferred: list[Path] = field(default_factory=list)
    skipped: list[Path] = field(default_factory=list)
    removed: list[Path] = field(default_factory=list)
    pruned_dirs: list[Path] = field(default_factory=list)
    missing_epub: list[int] = field(default_factory=list)  # eligible but no epub in R2
    failed: list[tuple[Path, str]] = field(default_factory=list)


# --- sanitization & filename (verbatim from FFF — DO NOT change) --------------

def sanitize_title(title: str) -> str:
    """Strip everything except letters, digits, and spaces; collapse spaces."""
    out_chars = [ch if (ch.isalnum() or ch == " ") else "" for ch in title]
    return " ".join("".join(out_chars).split())


def sanitize_folder(name: str) -> str:
    """Make a value safe for a folder name on FAT32/NTFS: ``/`` → ``-`` (for ship
    values like ``Bucky/Clint``), then strip Windows-illegal characters."""
    cleaned = name.replace("/", "-")
    cleaned = "".join(ch for ch in cleaned if ch not in '<>:"\\|?*')
    return " ".join(cleaned.split())


def length_bucket(words: int | None) -> str:
    """Three-digit length bucket ``words // 1000`` (floor 0, cap 999)."""
    if words is None or words < 0:
        return "000"
    return f"{min(words // 1000, 999):03d}"


def build_filename(words: int | None, title: str) -> str:
    return f"{length_bucket(words)}-{sanitize_title(title)}.epub"


def build_target_path(book: XteinkBook, sd_root: Path) -> Path:
    return (
        sd_root
        / sanitize_folder(book.collection)
        / sanitize_folder(book.ship)
        / sanitize_folder(book.status)
        / build_filename(book.word_count, book.title)
    )


# --- SD card detection (verbatim from FFF) -----------------------------------

def detect_sd_card() -> Path | None:
    """Scan drive letters D:–Z: for one with a ``.crosspoint/`` folder at root."""
    for letter in "DEFGHIJKLMNOPQRSTUVWXYZ":
        root = Path(f"{letter}:\\")
        try:
            if (root / ".crosspoint").is_dir():
                return root
        except OSError:
            continue
    return None


def is_xteink_sd_card(sd_path: Path) -> bool:
    try:
        return (sd_path / ".crosspoint").is_dir()
    except OSError:
        return False


def resolve_sd_path(settings: Settings) -> Path:
    """Use the configured path (validated) or auto-detect. Raises if neither works."""
    if settings.xteink_sd_path:
        p = Path(settings.xteink_sd_path)
        if not is_xteink_sd_card(p):
            raise XteinkSdCardNotFoundError(
                f"No .crosspoint/ folder at the configured xteink_sd_path {p}. "
                "This does not look like an Xteink SD card."
            )
        return p
    p = detect_sd_card()
    if p is None:
        raise XteinkSdCardNotFoundError(
            "No Xteink SD card detected. Insert the card (its root must contain a "
            ".crosspoint/ folder) or set xteink_sd_path in settings.json."
        )
    return p


# --- device scan / prune (verbatim from FFF; managed set now a param) ---------

def scan_device_epubs(sd_path: Path, managed_statuses: set[str]) -> set[Path]:
    """All .epub files at the managed depth: relative path of exactly four parts
    (collection / ship / status / file.epub) AND the status segment in
    ``managed_statuses``. Anything else (other depths, .crosspoint/, user content)
    is ignored and never touched."""
    found: set[Path] = set()
    for path in sd_path.rglob("*.epub"):
        try:
            rel_parts = path.relative_to(sd_path).parts
        except ValueError:
            continue
        if len(rel_parts) != 4:
            continue
        if rel_parts[0] in {".crosspoint", "System Volume Information"}:
            continue
        if rel_parts[2] not in managed_statuses:
            continue
        found.add(path)
    return found


def prune_empty_managed_dirs(touched_files: list[Path], sd_path: Path) -> list[Path]:
    """Remove empty ancestor directories of any file we touched (deepest-first),
    scoped strictly to ancestors of changed files so user content is never visited."""
    candidates: set[Path] = set()
    sd_resolved = sd_path.resolve()
    for f in touched_files:
        d = f.parent
        while True:
            try:
                d_resolved = d.resolve()
            except OSError:
                break
            if d_resolved == sd_resolved:
                break
            if sd_resolved not in d_resolved.parents:
                break
            candidates.add(d)
            d = d.parent

    pruned: list[Path] = []
    for d in sorted(candidates, key=lambda p: len(p.parts), reverse=True):
        try:
            if d.exists() and not any(d.iterdir()):
                d.rmdir()
                pruned.append(d)
        except OSError:
            pass
    return pruned


# --- core transfer (FFF flow; lazy epub fetch so we download only what we copy) -

def transfer(
    books: list[XteinkBook],
    sd_path: Path,
    managed_statuses: set[str],
    fetch_epub: Callable[[XteinkBook], Path | None],
    on_progress: Callable[[str], None] = lambda _m: None,
) -> XteinkTransferResult:
    """Sync the managed area of the SD card to ``books`` (already filtered to the
    eligible set, with derived status). Files at a target path are kept; managed
    files NOT a target are removed (covers Read/DNF demotions + status moves);
    targets not present are copied from ``fetch_epub(book)`` (downloaded lazily, so
    skips cost no bandwidth). Empty managed ancestor dirs are pruned after."""
    target_to_book: dict[Path, XteinkBook] = {
        build_target_path(b, sd_path): b for b in books
    }
    existing = scan_device_epubs(sd_path, managed_statuses)
    result = XteinkTransferResult(sd_path=sd_path)
    touched: list[Path] = []

    # 1) remove managed files that are no longer targets.
    for existing_path in sorted(existing):
        if existing_path in target_to_book:
            result.skipped.append(existing_path)
            continue
        try:
            existing_path.unlink()
            result.removed.append(existing_path)
            touched.append(existing_path)
        except OSError as exc:
            result.failed.append((existing_path, str(exc)))
    if result.removed:
        on_progress(f"removed {len(result.removed)} stale file(s) from device")

    # 2) copy targets not already present (download the epub only now).
    to_copy = [t for t in sorted(target_to_book) if t not in existing]
    on_progress(f"{len(result.skipped)} already current, {len(to_copy)} to copy")
    for i, target_path in enumerate(to_copy, 1):
        book = target_to_book[target_path]
        src = fetch_epub(book)
        if src is None:
            result.missing_epub.append(book.work_id)
            continue
        try:
            target_path.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(src, target_path)
            result.transferred.append(target_path)
            touched.append(target_path)
        except OSError as exc:
            result.failed.append((target_path, str(exc)))
        if i % 25 == 0:
            on_progress(f"copied {i}/{len(to_copy)}…")

    result.pruned_dirs = prune_empty_managed_dirs(touched, sd_path)
    return result


# --- snapshot -> book list ----------------------------------------------------

def eligible_books_from_snapshot(snapshot_path: Path) -> list[XteinkBook]:
    """Read the snapshot's work_cards and build the eligible XteinkBook set.
    Eligibility = is_favorite OR read_status='Unread'; status derived; ship/
    collection fall back to Gen/Other so every eligible work gets a path."""
    conn = sqlite3.connect(str(snapshot_path))
    try:
        conn.row_factory = sqlite3.Row
        rows = conn.execute(
            "SELECT work_id, title, primary_ship, primary_collection, wordcount, "
            "read_status, is_favorite FROM work_cards "
            "WHERE is_favorite = 1 OR read_status = 'Unread'"
        ).fetchall()
    finally:
        conn.close()

    books: list[XteinkBook] = []
    for r in rows:
        is_fav = bool(r["is_favorite"])
        books.append(
            XteinkBook(
                work_id=r["work_id"],
                title=r["title"] or f"work {r['work_id']}",
                collection=(r["primary_collection"] or COLLECTION_FALLBACK),
                ship=(r["primary_ship"] or SHIP_FALLBACK),
                word_count=r["wordcount"] or 0,
                status="Favorite" if is_fav else "Unread",
            )
        )
    return books


# --- job handler --------------------------------------------------------------

def run(job: dict, settings: Settings, client, progress: Callable[[str], None]) -> str:
    """pc_jobs `x4_transfer` handler. Pulls the latest snapshot + eligible epubs
    from R2 and syncs the device. Returns a summary string for the job log."""
    if not settings.is_r2_configured():
        raise RuntimeError("R2 is not configured (set r2_* in settings.json)")

    sd_path = resolve_sd_path(settings)
    progress(f"SD card: {sd_path}")

    snap = client.get_current_snapshot()
    version, r2_path = snap.get("version"), snap.get("r2_path")
    expected = (job.get("params") or {}).get("expected_snapshot_version")
    if expected is not None and expected != version:
        progress(f"note: snapshot now v{version} (dashboard saw v{expected}); using v{version}")
    else:
        progress(f"snapshot v{version}")

    s3 = r2.make_client(settings)
    tmp = Path(tempfile.mkdtemp(prefix="storyhub_x4_"))
    try:
        snap_file = tmp / "snapshot.sqlite"
        if not r2.download(s3, settings, r2_path, snap_file):
            raise RuntimeError(f"snapshot object missing in R2: {r2_path}")
        books = eligible_books_from_snapshot(snap_file)
        progress(f"{len(books)} eligible work(s) (favorite or unread)")

        epub_dir = tmp / "epubs"

        def fetch_epub(book: XteinkBook) -> Path | None:
            dest = epub_dir / f"{book.work_id}.epub"
            if dest.exists():
                return dest
            return dest if r2.download(s3, settings, r2.epub_key(book.work_id), dest) else None

        result = transfer(
            books, sd_path, set(settings.xteink_managed_statuses), fetch_epub, progress
        )

        # Catalog is regenerated every run from the same snapshot. It is secondary:
        # a failure here never rolls back the transfer (redesign §12.5 / FFF doc).
        progress("transfer done; building catalog…")
        try:
            from . import xteink_catalog  # lazy: avoids the transfer<->catalog import cycle

            cat_books = xteink_catalog.books_from_snapshot(snap_file)
            cat = xteink_catalog.generate_catalog(
                cat_books, sd_path,
                solo_fandoms=list(settings.xteink_catalog_solo_fandoms),
            )
            catalog_note = (
                f"Catalog: {len(cat.catalog_paths)} file(s), {cat.book_count} stories "
                f"across {cat.fandom_count} fandom(s)"
                + (f"; adaptively split: {', '.join(cat.split_fandoms)}" if cat.split_fandoms else "")
            )
        except Exception as exc:  # noqa: BLE001 — transfer already succeeded
            catalog_note = (
                f"⚠ Catalog generation FAILED ({exc}) — the file transfer is "
                "unaffected; re-run to retry the catalog."
            )
        progress(catalog_note)
    finally:
        shutil.rmtree(tmp, ignore_errors=True)

    summary = (
        f"Transfer complete on {sd_path}: "
        f"{len(result.transferred)} copied, {len(result.removed)} removed, "
        f"{len(result.skipped)} already current, {len(result.pruned_dirs)} empty dir(s) pruned."
    )
    summary += "\n" + catalog_note
    if result.missing_epub:
        # No silent caps — name what was dropped and why.
        ids = ", ".join(str(w) for w in result.missing_epub[:20])
        more = "" if len(result.missing_epub) <= 20 else f" (+{len(result.missing_epub) - 20} more)"
        summary += f"\nSkipped {len(result.missing_epub)} eligible work(s) with no epub in R2: {ids}{more}"
    if result.failed:
        summary += f"\n{len(result.failed)} file op(s) failed:"
        for path, err in result.failed[:20]:
            summary += f"\n  {path}: {err}"
    summary += "\n\n⚠ Power-cycle the X4 so Crosspoint rescans the card and shows new files."
    return summary
