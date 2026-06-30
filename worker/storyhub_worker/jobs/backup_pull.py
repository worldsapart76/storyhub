"""Local backup pull (redesign §12.4). A plain offline mirror of the library: the
current snapshot SQLite + every work's epub, pulled from R2 into the configured
`backup_dir`. Read-only against R2 (the worker never writes to R2).

Layout under backup_dir:
    snapshot/library-{version}.sqlite   the snapshot at backup time
    snapshot/current.json               the R2 pointer (best-effort)
    epubs/{work_id}.epub                one per work that has an epub in R2

Incremental: an epub whose local copy already matches R2's size is skipped, so a
repeat backup only fetches new/changed files. No silent caps — missing/failed
objects are counted and named in the log.
"""

from __future__ import annotations

import sqlite3
from pathlib import Path
from typing import Callable

from ..config import Settings
from . import r2


def _works_with_epubs(snapshot_path: Path) -> list[tuple[int, str]]:
    """(work_id, epub_r2_key) for every work that has an epub, from the snapshot's
    relational `works` table."""
    conn = sqlite3.connect(str(snapshot_path))
    try:
        rows = conn.execute(
            "SELECT work_id, epub_r2_key FROM works "
            "WHERE epub_r2_key IS NOT NULL AND epub_r2_key <> ''"
        ).fetchall()
    finally:
        conn.close()
    return [(int(w), str(k)) for w, k in rows]


def run(job: dict, settings: Settings, client, progress: Callable[[str], None]) -> str:
    """pc_jobs `backup_pull` handler. Mirror snapshot + all epubs from R2 to
    `backup_dir`. Returns a summary for the job log."""
    if not settings.is_r2_configured():
        raise RuntimeError("R2 is not configured (set r2_* in settings.json)")
    if not settings.backup_dir:
        raise RuntimeError("backup_dir is not set in settings.json")

    backup_root = Path(settings.backup_dir)
    backup_root.mkdir(parents=True, exist_ok=True)
    progress(f"backup target: {backup_root}")

    snap = client.get_current_snapshot()
    version, r2_path = snap.get("version"), snap.get("r2_path")
    s3 = r2.make_client(settings)

    # 1) snapshot + pointer.
    snap_dest = backup_root / "snapshot" / Path(r2_path).name
    if not r2.download(s3, settings, r2_path, snap_dest):
        raise RuntimeError(f"snapshot object missing in R2: {r2_path}")
    r2.download(s3, settings, "snapshot/current.json", backup_root / "snapshot" / "current.json")
    progress(f"snapshot v{version} backed up")

    # 2) epubs (incremental by size).
    works = _works_with_epubs(snap_dest)
    progress(f"{len(works)} work(s) have an epub; mirroring…")
    epub_dir = backup_root / "epubs"
    downloaded = skipped = missing = failed = 0
    fail_ids: list[int] = []
    for i, (work_id, key) in enumerate(works, 1):
        dest = epub_dir / f"{work_id}.epub"
        remote_size = r2.object_size(s3, settings, key)
        if remote_size is None:
            missing += 1
            continue
        if dest.exists() and dest.stat().st_size == remote_size:
            skipped += 1
        else:
            try:
                if r2.download(s3, settings, key, dest):
                    downloaded += 1
                else:
                    missing += 1
            except Exception as exc:  # noqa: BLE001 - record, keep mirroring
                failed += 1
                if len(fail_ids) < 20:
                    fail_ids.append(work_id)
        if i % 100 == 0:
            progress(f"…{i}/{len(works)} (downloaded {downloaded}, skipped {skipped})")

    summary = (
        f"Backup complete at {backup_root}: snapshot v{version} + "
        f"{downloaded} epub(s) downloaded, {skipped} already current"
    )
    if missing:
        summary += f", {missing} listed but missing in R2"
    if failed:
        ids = ", ".join(str(w) for w in fail_ids)
        more = "" if failed <= len(fail_ids) else f" (+{failed - len(fail_ids)} more)"
        summary += f", {failed} failed: {ids}{more}"
    summary += "."
    return summary
