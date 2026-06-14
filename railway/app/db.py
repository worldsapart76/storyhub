"""Async Postgres access via a shared asyncpg connection pool.

The pool is created at app startup (see main.lifespan) and stored on
app.state.pool. Routes acquire a connection through the `get_conn` dependency.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import AsyncIterator

import asyncpg
from fastapi import Request

SCHEMA_PATH = Path(__file__).with_name("schema.sql")


async def _init_conn(conn: asyncpg.Connection) -> None:
    """Decode json/jsonb columns to Python objects (and encode on the way in)."""
    for typename in ("json", "jsonb"):
        await conn.set_type_codec(
            typename,
            encoder=json.dumps,
            decoder=json.loads,
            schema="pg_catalog",
        )


async def create_pool(database_url: str) -> asyncpg.Pool:
    """Create the connection pool and apply the (idempotent) schema."""
    pool = await asyncpg.create_pool(
        dsn=database_url, min_size=1, max_size=10, init=_init_conn
    )
    await _apply_schema(pool)
    return pool


async def _apply_schema(pool: asyncpg.Pool) -> None:
    sql = SCHEMA_PATH.read_text(encoding="utf-8")
    async with pool.acquire() as conn:
        await conn.execute(sql)


async def get_conn(request: Request) -> AsyncIterator[asyncpg.Connection]:
    """FastAPI dependency: yield a pooled connection for the request."""
    pool: asyncpg.Pool = request.app.state.pool
    async with pool.acquire() as conn:
        yield conn
