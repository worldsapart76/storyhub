"""/api/reading-lists — CRUD for manual + system reading lists.

Phase 6 surface (docs/ux/reading-lists.md). Tables exist now (Phase 1) but the
CRUD + membership logic, system-list refresh, and cover handling land in
Phase 6. Routes are present so the API surface is complete; they 501 for now.
"""

from __future__ import annotations

from fastapi import APIRouter, HTTPException, status

router = APIRouter(prefix="/reading-lists", tags=["reading-lists"])

_NOT_YET = "Reading Lists are implemented in Phase 6 (docs/ux/reading-lists.md)"


@router.api_route(
    "/{path:path}",
    methods=["GET", "POST", "PUT", "DELETE"],
    include_in_schema=False,
)
@router.api_route("", methods=["GET", "POST"], include_in_schema=False)
async def reading_lists_placeholder(path: str = "") -> None:
    raise HTTPException(status.HTTP_501_NOT_IMPLEMENTED, _NOT_YET)
