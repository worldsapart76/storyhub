"""/api/tags — first-class tags (redesign §6.3).

Normalization (Phase B) and migration (Phase D) create raw tags; Tag Management
(Phase G) curates them (display alias, category, synonym canonical, state).
Synonym equivalence is the self-reference canonical_tag_id ([RESOLVED #1]).
"""

from __future__ import annotations

import asyncpg
from fastapi import APIRouter, Depends, HTTPException, Query, status

from ..db import get_conn
from ..models import Tag, TagCreate, TagKind, TagPatch, TagState

router = APIRouter(prefix="/tags", tags=["tags"])

_COLUMNS = (
    "tag_id, name, display_name, kind, category, canonical_tag_id, "
    "state, auto_classified, updated_at"
)


@router.get("", response_model=list[Tag])
async def list_tags(
    kind: TagKind | None = Query(None),
    category: str | None = Query(None),
    state: TagState | None = Query(None),
    uncategorized: bool | None = Query(None),
    ungrouped: bool | None = Query(None, description="no synonym canonical"),
    auto_classified: bool | None = Query(None),
    limit: int = Query(2000, ge=1, le=20000),
    offset: int = Query(0, ge=0),
    conn: asyncpg.Connection = Depends(get_conn),
) -> list[Tag]:
    clauses: list[str] = []
    params: list[object] = []

    def add(clause: str, value: object) -> None:
        params.append(value)
        clauses.append(clause.format(n=len(params)))

    if kind is not None:
        add("kind = ${n}", kind.value)
    if category is not None:
        add("category = ${n}", category)
    if state is not None:
        add("state = ${n}", state.value)
    if auto_classified is not None:
        add("auto_classified = ${n}", auto_classified)
    if uncategorized:
        clauses.append("category IS NULL")
    if ungrouped:
        clauses.append("canonical_tag_id IS NULL")
    where = f"WHERE {' AND '.join(clauses)}" if clauses else ""
    params.extend([limit, offset])
    rows = await conn.fetch(
        f"SELECT {_COLUMNS} FROM tags {where} "
        f"ORDER BY name LIMIT ${len(params) - 1} OFFSET ${len(params)}",
        *params,
    )
    return [Tag(**dict(r)) for r in rows]


@router.get("/{tag_id}", response_model=Tag)
async def get_tag(tag_id: int, conn: asyncpg.Connection = Depends(get_conn)) -> Tag:
    row = await conn.fetchrow(f"SELECT {_COLUMNS} FROM tags WHERE tag_id = $1", tag_id)
    if row is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Tag not found")
    return Tag(**dict(row))


@router.post("", response_model=Tag, status_code=status.HTTP_201_CREATED)
async def create_tag(
    tag: TagCreate, conn: asyncpg.Connection = Depends(get_conn)
) -> Tag:
    """Upsert on (name, kind) — re-capturing a seen tag is a no-op merge."""
    row = await conn.fetchrow(
        f"""
        INSERT INTO tags (name, kind, display_name, category, canonical_tag_id,
                          state, auto_classified)
        VALUES ($1,$2,$3,$4,$5,$6,$7)
        ON CONFLICT (name, kind) DO UPDATE SET
            display_name = COALESCE(EXCLUDED.display_name, tags.display_name),
            category = COALESCE(EXCLUDED.category, tags.category),
            updated_at = now()
        RETURNING {_COLUMNS}
        """,
        tag.name, tag.kind.value, tag.display_name, tag.category,
        tag.canonical_tag_id, tag.state.value, tag.auto_classified,
    )
    return Tag(**dict(row))


@router.patch("/{tag_id}", response_model=Tag)
async def patch_tag(
    tag_id: int, patch: TagPatch, conn: asyncpg.Connection = Depends(get_conn)
) -> Tag:
    fields = patch.model_dump(exclude_unset=True)
    if not fields:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "No fields to update")
    if fields.get("canonical_tag_id") == tag_id:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_ENTITY, "A tag cannot be its own canonical"
        )
    sets: list[str] = []
    params: list[object] = []
    for key, value in fields.items():
        params.append(value.value if hasattr(value, "value") else value)
        sets.append(f"{key} = ${len(params)}")
    params.append(tag_id)
    row = await conn.fetchrow(
        f"UPDATE tags SET {', '.join(sets)}, updated_at = now() "
        f"WHERE tag_id = ${len(params)} RETURNING {_COLUMNS}",
        *params,
    )
    if row is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Tag not found")
    return Tag(**dict(row))
