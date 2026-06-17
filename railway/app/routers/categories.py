"""/api/categories — the freeform category SET + global lock (§12.6).

The ordered list of categories a freeform/warning tag may be assigned to;
`tags.category` is an FK to `categories.name` (ON UPDATE CASCADE so a rename
follows the tags, ON DELETE SET NULL so a delete returns them to uncategorized).

A single global lock lives in settings('lock_category_list'). Once locked,
add/rename/reorder/delete are rejected here (409) — changing the category list
after lock is a deliberate action (preserves the hard rule, redesign §12.6).
Curated in Tag Management (Phase G).
"""

from __future__ import annotations

import asyncpg
from fastapi import APIRouter, Depends, HTTPException, Response, status

from ..db import get_conn
from ..models import (
    Category,
    CategoryCreate,
    CategoryList,
    CategoryLock,
    CategoryRename,
    CategoryReorder,
)

router = APIRouter(prefix="/categories", tags=["categories"])

LOCK_KEY = "lock_category_list"


async def _locked(conn: asyncpg.Connection) -> bool:
    row = await conn.fetchrow("SELECT value_json FROM settings WHERE key = $1", LOCK_KEY)
    return bool(row and row["value_json"] is True)


async def _require_unlocked(conn: asyncpg.Connection) -> None:
    if await _locked(conn):
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            "Category list is locked — unlock it before changing categories",
        )


async def _all(conn: asyncpg.Connection) -> list[Category]:
    rows = await conn.fetch(
        "SELECT id, name, display_order FROM categories "
        "ORDER BY display_order NULLS LAST, name"
    )
    return [Category(**dict(r)) for r in rows]


async def _state(conn: asyncpg.Connection) -> CategoryList:
    return CategoryList(categories=await _all(conn), locked=await _locked(conn))


@router.get("", response_model=CategoryList)
async def list_categories(conn: asyncpg.Connection = Depends(get_conn)) -> CategoryList:
    return await _state(conn)


@router.post("", response_model=Category, status_code=status.HTTP_201_CREATED)
async def create_category(
    body: CategoryCreate, conn: asyncpg.Connection = Depends(get_conn)
) -> Category:
    await _require_unlocked(conn)
    name = body.name.strip()
    if not name:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Name required")
    if await conn.fetchval("SELECT 1 FROM categories WHERE name = $1", name):
        raise HTTPException(status.HTTP_409_CONFLICT, "Category already exists")
    nextord = await conn.fetchval(
        "SELECT COALESCE(MAX(display_order), 0) + 1 FROM categories"
    )
    row = await conn.fetchrow(
        "INSERT INTO categories (name, display_order) VALUES ($1, $2) "
        "RETURNING id, name, display_order",
        name, nextord,
    )
    return Category(**dict(row))


@router.put("/order", response_model=CategoryList)
async def reorder_categories(
    body: CategoryReorder, conn: asyncpg.Connection = Depends(get_conn)
) -> CategoryList:
    await _require_unlocked(conn)
    async with conn.transaction():
        for i, cid in enumerate(body.ids, start=1):
            await conn.execute(
                "UPDATE categories SET display_order = $1 WHERE id = $2", i, cid
            )
    return await _state(conn)


@router.put("/lock", response_model=CategoryList)
async def set_lock(
    body: CategoryLock, conn: asyncpg.Connection = Depends(get_conn)
) -> CategoryList:
    await conn.execute(
        "INSERT INTO settings (key, value_json, updated_at) VALUES ($1, $2, now()) "
        "ON CONFLICT (key) DO UPDATE SET value_json = $2, updated_at = now()",
        LOCK_KEY, body.locked,
    )
    return await _state(conn)


@router.patch("/{cat_id}", response_model=Category)
async def rename_category(
    cat_id: int, body: CategoryRename, conn: asyncpg.Connection = Depends(get_conn)
) -> Category:
    await _require_unlocked(conn)
    name = body.name.strip()
    if not name:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Name required")
    if await conn.fetchval(
        "SELECT 1 FROM categories WHERE name = $1 AND id <> $2", name, cat_id
    ):
        raise HTTPException(status.HTTP_409_CONFLICT, "Category already exists")
    # tags.category FK is ON UPDATE CASCADE — the rename follows assigned tags.
    row = await conn.fetchrow(
        "UPDATE categories SET name = $1 WHERE id = $2 "
        "RETURNING id, name, display_order",
        name, cat_id,
    )
    if row is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Category not found")
    return Category(**dict(row))


@router.delete("/{cat_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_category(
    cat_id: int, conn: asyncpg.Connection = Depends(get_conn)
) -> Response:
    await _require_unlocked(conn)
    # tags.category FK is ON DELETE SET NULL — assigned tags fall back to uncategorized.
    res = await conn.execute("DELETE FROM categories WHERE id = $1", cat_id)
    if res.endswith(" 0"):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Category not found")
    return Response(status_code=status.HTTP_204_NO_CONTENT)
