"""/api/groups — tag roll-up groups (collection | property) (redesign §6.3.1).

Equivalence (synonym/ship) is NOT here — it lives on tags.canonical_tag_id
([RESOLVED #1]). These groups are roll-ups only: a group is created from a tag
(first member), and its class is inferred from member kind (structural ->
collection, descriptive -> property). Curated in Tag Management (Phase G).
"""

from __future__ import annotations

import asyncpg
from fastapi import APIRouter, Depends, HTTPException, Query, Response, status

from ..db import get_conn
from ..models import GroupCreate, GroupPatch, GroupType, TagGroup

router = APIRouter(prefix="/groups", tags=["groups"])


async def _members(conn: asyncpg.Connection, group_id: int) -> list[int]:
    rows = await conn.fetch(
        "SELECT tag_id FROM tag_group_members WHERE group_id = $1 ORDER BY tag_id",
        group_id,
    )
    return [r["tag_id"] for r in rows]


async def _load(conn: asyncpg.Connection, group_id: int) -> TagGroup | None:
    row = await conn.fetchrow(
        "SELECT group_id, name, group_type, canonical_tag_id, parent_group_id, "
        "updated_at FROM tag_groups WHERE group_id = $1",
        group_id,
    )
    if row is None:
        return None
    return TagGroup(**dict(row), member_tag_ids=await _members(conn, group_id))


@router.get("", response_model=list[TagGroup])
async def list_groups(
    group_type: GroupType | None = Query(None),
    conn: asyncpg.Connection = Depends(get_conn),
) -> list[TagGroup]:
    if group_type is None:
        rows = await conn.fetch(
            "SELECT group_id, name, group_type, canonical_tag_id, parent_group_id, "
            "updated_at FROM tag_groups ORDER BY name"
        )
    else:
        rows = await conn.fetch(
            "SELECT group_id, name, group_type, canonical_tag_id, parent_group_id, "
            "updated_at FROM tag_groups WHERE group_type = $1 ORDER BY name",
            group_type.value,
        )
    return [
        TagGroup(**dict(r), member_tag_ids=await _members(conn, r["group_id"]))
        for r in rows
    ]


@router.get("/{group_id}", response_model=TagGroup)
async def get_group(
    group_id: int, conn: asyncpg.Connection = Depends(get_conn)
) -> TagGroup:
    group = await _load(conn, group_id)
    if group is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Group not found")
    return group


@router.post("", response_model=TagGroup, status_code=status.HTTP_201_CREATED)
async def create_group(
    group: GroupCreate, conn: asyncpg.Connection = Depends(get_conn)
) -> TagGroup:
    """A roll-up group is never empty — it is created from its first member(s)."""
    if not group.member_tag_ids:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_ENTITY,
            "A roll-up group must be created with at least one member tag",
        )
    async with conn.transaction():
        row = await conn.fetchrow(
            "INSERT INTO tag_groups (name, group_type, canonical_tag_id) "
            "VALUES ($1,$2,$3) RETURNING group_id",
            group.name, group.group_type.value, group.canonical_tag_id,
        )
        group_id = row["group_id"]
        await conn.executemany(
            "INSERT INTO tag_group_members (group_id, tag_id) VALUES ($1,$2) "
            "ON CONFLICT DO NOTHING",
            [(group_id, tag_id) for tag_id in group.member_tag_ids],
        )
    return await _load(conn, group_id)  # type: ignore[return-value]


@router.patch("/{group_id}", response_model=TagGroup)
async def patch_group(
    group_id: int, patch: GroupPatch, conn: asyncpg.Connection = Depends(get_conn)
) -> TagGroup:
    fields = patch.model_dump(exclude_unset=True)
    if not fields:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "No fields to update")
    sets: list[str] = []
    params: list[object] = []
    for key, value in fields.items():
        params.append(value)
        sets.append(f"{key} = ${len(params)}")
    params.append(group_id)
    row = await conn.fetchrow(
        f"UPDATE tag_groups SET {', '.join(sets)}, updated_at = now() "
        f"WHERE group_id = ${len(params)} RETURNING group_id",
        *params,
    )
    if row is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Group not found")
    return await _load(conn, group_id)  # type: ignore[return-value]


@router.delete("/{group_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_group(
    group_id: int, conn: asyncpg.Connection = Depends(get_conn)
) -> Response:
    """Delete a roll-up group (members cascade). Used when the last member is
    removed in Tag Management, or to discard a group outright."""
    await conn.execute("DELETE FROM tag_groups WHERE group_id = $1", group_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post("/{group_id}/members/{tag_id}", response_model=TagGroup)
async def add_member(
    group_id: int, tag_id: int, conn: asyncpg.Connection = Depends(get_conn)
) -> TagGroup:
    group = await _load(conn, group_id)
    if group is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Group not found")
    await conn.execute(
        "INSERT INTO tag_group_members (group_id, tag_id) VALUES ($1,$2) "
        "ON CONFLICT DO NOTHING",
        group_id, tag_id,
    )
    return await _load(conn, group_id)  # type: ignore[return-value]


@router.delete("/{group_id}/members/{tag_id}", response_model=TagGroup)
async def remove_member(
    group_id: int, tag_id: int, conn: asyncpg.Connection = Depends(get_conn)
) -> TagGroup:
    await conn.execute(
        "DELETE FROM tag_group_members WHERE group_id = $1 AND tag_id = $2",
        group_id, tag_id,
    )
    group = await _load(conn, group_id)
    if group is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Group not found")
    return group
