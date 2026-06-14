"""StoryHub Railway hub — FastAPI application entrypoint.

Wires the /api routers (all behind bearer auth), opens the Postgres pool at
startup, and exposes a public /health probe for Railway. The dashboard PWA
static host is added in a later phase.
"""

from __future__ import annotations

from contextlib import asynccontextmanager

from fastapi import Depends, FastAPI

from .auth import require_token
from .config import get_settings
from .db import create_pool
from .routers import (
    ao3_actions,
    queue,
    reading_lists,
    saved_filters,
    snapshot,
    status_updates,
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


@app.get("/health", tags=["health"])
async def health() -> dict[str, str]:
    """Unauthenticated liveness probe for Railway."""
    return {"status": "ok"}


# Every /api route requires a valid bearer token (docs/auth.md).
_protected = [Depends(require_token)]
for module in (
    queue,
    status_updates,
    ao3_actions,
    snapshot,
    worker,
    reading_lists,
    saved_filters,
):
    app.include_router(module.router, prefix="/api", dependencies=_protected)
