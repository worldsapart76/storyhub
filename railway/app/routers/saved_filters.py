"""/api/saved-filters — CRUD for saved Browse filter/sort state.

Phase 6 surface (docs/ux/saved-filters.md). Table exists now (Phase 1); the
CRUD + star/order logic lands in Phase 6. Routes 501 for now so the API
surface is complete.
"""

from __future__ import annotations

from fastapi import APIRouter, HTTPException, status

router = APIRouter(prefix="/saved-filters", tags=["saved-filters"])

_NOT_YET = "Saved Filters are implemented in Phase 6 (docs/ux/saved-filters.md)"


@router.api_route(
    "/{path:path}",
    methods=["GET", "POST", "PUT", "DELETE"],
    include_in_schema=False,
)
@router.api_route("", methods=["GET", "POST"], include_in_schema=False)
async def saved_filters_placeholder(path: str = "") -> None:
    raise HTTPException(status.HTTP_501_NOT_IMPLEMENTED, _NOT_YET)
