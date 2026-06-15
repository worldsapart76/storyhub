"""Run a .sql file against a Postgres DB (no psql needed — uses asyncpg).

Used to apply one-off migrations (e.g. migrations/0001_reset_to_redesign.sql)
against the live Railway DB from a machine without psql.

Usage:
    python run_migration.py <path/to/file.sql> [DB_URL]

DB URL resolution order: explicit arg -> $DATABASE_PUBLIC_URL -> $DATABASE_URL.
Use the PUBLIC url when connecting from outside Railway (the internal
*.railway.internal host is unreachable from a local machine).
"""

from __future__ import annotations

import asyncio
import os
import sys
from pathlib import Path

import asyncpg


async def main() -> int:
    if len(sys.argv) < 2:
        print("usage: run_migration.py <file.sql> [DB_URL]")
        return 2
    sql_path = Path(sys.argv[1])
    if not sql_path.exists():
        print(f"file not found: {sql_path}")
        return 2
    db_url = (
        sys.argv[2]
        if len(sys.argv) > 2
        else os.environ.get("DATABASE_PUBLIC_URL") or os.environ.get("DATABASE_URL")
    )
    if not db_url:
        print("no DB url (arg, DATABASE_PUBLIC_URL, or DATABASE_URL)")
        return 2

    sql = sql_path.read_text(encoding="utf-8")
    conn = await asyncpg.connect(db_url)
    try:
        await conn.execute(sql)
        rows = await conn.fetch(
            "SELECT tablename FROM pg_tables WHERE schemaname='public' "
            "ORDER BY tablename"
        )
        print(f"applied {sql_path.name}")
        print("public tables now:", ", ".join(r["tablename"] for r in rows) or "(none)")
    finally:
        await conn.close()
    return 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
