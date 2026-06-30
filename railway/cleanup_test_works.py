"""Purge test-capture works added after a cutoff (Phase E extension testing).

New captures (extension Mark-for-Later) land hours after the Phase D backfill
(which all committed 02:00-05:00 UTC on 2026-06-17), so a `created_at` cutoff
cleanly separates your test works from the real library. Deleting a work cascades
work_tags / work_authors / reading_list_members / ao3_actions; this script also
drops the queue_items row, deletes the R2 epub (if R2 is configured in env), and
rebuilds the snapshot (if HUB_URL + AUTH_TOKEN are set).

DRY-RUN BY DEFAULT — it only lists what it would delete. Pass --apply to delete.

    python cleanup_test_works.py "2026-06-17 12:00"            # dry run (list)
    python cleanup_test_works.py "2026-06-17 12:00" --apply    # actually delete

Env: DATABASE_PUBLIC_URL (required; or DATABASE_URL). Optional: HUB_URL +
AUTH_TOKEN (snapshot rebuild), R2_* (epub deletion). Tags created by a test
capture are left in place (they're usually shared; an orphaned 0-use tag is
harmless) — prune those by hand if you ever care.
"""
from __future__ import annotations

import asyncio
import os
import sys
import urllib.request
from datetime import datetime, timezone


async def main() -> int:
    positional = [a for a in sys.argv[1:] if not a.startswith("--")]
    apply = "--apply" in sys.argv
    if not positional:
        print('usage: cleanup_test_works.py "<cutoff timestamp>" [--apply]')
        return 2
    try:
        cutoff = datetime.fromisoformat(positional[0])
    except ValueError:
        print(f"bad timestamp {positional[0]!r} — use e.g. \"2026-06-17 12:00\"")
        return 2
    if cutoff.tzinfo is None:  # treat a bare timestamp as UTC (the created_at clusters are UTC)
        cutoff = cutoff.replace(tzinfo=timezone.utc)

    db_url = os.environ.get("DATABASE_PUBLIC_URL") or os.environ.get("DATABASE_URL")
    if not db_url:
        print("set DATABASE_PUBLIC_URL (or DATABASE_URL)")
        return 2

    import asyncpg

    conn = await asyncpg.connect(db_url)
    try:
        rows = await conn.fetch(
            "SELECT work_id, title, source, created_at FROM works "
            "WHERE created_at >= $1::timestamptz ORDER BY created_at",
            cutoff,
        )
        if not rows:
            print(f"no works created at/after {cutoff}")
            return 0
        verb = "DELETING" if apply else "DRY RUN — would delete"
        print(f"{verb} {len(rows)} work(s) created >= {cutoff}:")
        for r in rows:
            print(f"   {r['work_id']:>12}  {r['created_at']:%Y-%m-%d %H:%M:%S}  {r['source']:<7}  {r['title']}")
        ids = [r["work_id"] for r in rows]

        if not apply:
            print("\n(dry run — pass --apply to delete)")
            return 0

        # R2 epub cleanup — best-effort, only if R2 is configured in this env.
        try:
            sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
            # app.config.Settings requires database_url + auth_token to instantiate
            # (even though r2 only reads the R2_* fields), so satisfy them from what
            # we already have — else is_configured() raises and R2 cleanup is skipped
            # (epubs left as orphans) when only DATABASE_PUBLIC_URL is set.
            os.environ.setdefault("DATABASE_URL", db_url)
            os.environ.setdefault("AUTH_TOKEN", "unused")
            from app import r2

            if r2.is_configured():
                for wid in ids:
                    try:
                        await r2.delete(r2.epub_key(wid))
                    except Exception as exc:  # noqa: BLE001
                        print(f"   r2 epub skip {wid}: {exc}")
                print(f"   removed {len(ids)} R2 epub(s)")
            else:
                print("   R2 not configured here — epubs/{id}.epub left as harmless orphans")
        except Exception as exc:  # noqa: BLE001
            print(f"   R2 cleanup skipped: {exc}")

        # DB delete — FK cascade removes work_tags/work_authors/reading_list_members/
        # ao3_actions; queue_items has no FK to works so drop it explicitly.
        await conn.execute("DELETE FROM queue_items WHERE work_id = ANY($1::bigint[])", ids)
        await conn.execute("DELETE FROM works WHERE work_id = ANY($1::bigint[])", ids)
        print(f"deleted {len(ids)} work(s) (+ cascaded edges, + queue_items)")
        print("total works now:", await conn.fetchval("SELECT COUNT(*) FROM works"))
    finally:
        await conn.close()

    # Rebuild the snapshot so the PWA/extension reflect the deletions.
    hub = os.environ.get("HUB_URL")
    token = os.environ.get("AUTH_TOKEN")
    if hub and token:
        req = urllib.request.Request(
            f"{hub.rstrip('/')}/api/snapshot/build",
            method="POST",
            headers={"Authorization": f"Bearer {token}"},
        )
        try:
            with urllib.request.urlopen(req, timeout=180) as resp:  # noqa: S310
                print("snapshot rebuilt:", resp.read().decode())
        except Exception as exc:  # noqa: BLE001
            print(f"snapshot rebuild failed ({exc}) — rebuild from the PWA")
    else:
        print("set HUB_URL + AUTH_TOKEN to auto-rebuild the snapshot, or rebuild from the PWA")
    return 0


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
