"""StoryHub Railway hub — FastAPI application entrypoint.

Wires the /api routers (all behind bearer auth), opens the Postgres pool at
startup, and exposes a public /health probe for Railway. The dashboard PWA
static host is added in a later phase.
"""

from __future__ import annotations

from contextlib import asynccontextmanager

from fastapi import Depends, FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .auth import require_token
from .config import get_settings
from .db import create_pool
from .routers import (
    ao3_actions,
    groups,
    queue,
    reading_lists,
    saved_filters,
    snapshot,
    tags,
    works,
    worker,
)


@asynccontextmanager
async def lifespan(app: FastAPI):
    settings = get_settings()
    app.state.pool = await create_pool(settings.database_url)
    try:
        yield
    finally:
        await app.state.pool.close()


app = FastAPI(title="StoryHub API", version="0.1.0", lifespan=lifespan)

# The PWA/extension call the API cross-origin from the browser. Auth is a bearer
# token (not cookies), so a permissive origin policy is safe for this single-user
# app — the token, not the origin, gates access.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
    expose_headers=["X-Snapshot-Version"],
)


@app.get("/health", tags=["health"])
async def health() -> dict[str, str]:
    """Unauthenticated liveness probe for Railway."""
    return {"status": "ok"}


# Every /api route requires a valid bearer token (docs/auth.md).
_protected = [Depends(require_token)]
for module in (
    works,
    tags,
    groups,
    queue,
    ao3_actions,
    snapshot,
    worker,
    reading_lists,
    saved_filters,
):
    app.include_router(module.router, prefix="/api", dependencies=_protected)
