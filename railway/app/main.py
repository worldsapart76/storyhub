"""StoryHub Railway hub — FastAPI application entrypoint.

Wires the /api routers (all behind bearer auth), opens the Postgres pool at
startup, and exposes a public /health probe for Railway. The dashboard PWA
static host is added in a later phase.
"""

from __future__ import annotations

from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import Depends, FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from starlette.exceptions import HTTPException as StarletteHTTPException

from .auth import require_token
from .config import get_settings
from .db import create_pool
from .routers import (
    ao3_actions,
    categories,
    groups,
    pc_jobs,
    pending,
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
    categories,
    queue,
    ao3_actions,
    pending,
    snapshot,
    worker,
    pc_jobs,
    reading_lists,
    saved_filters,
):
    app.include_router(module.router, prefix="/api", dependencies=_protected)


class SPAStaticFiles(StaticFiles):
    """Serve the built PWA, falling back to index.html for unmatched in-app routes
    (e.g. the share-target's /share) so a deep link or a share before the service
    worker is controlling still boots the SPA instead of 404ing. API paths keep
    their real 404 — they never want the app shell."""

    async def get_response(self, path: str, scope):
        try:
            return await super().get_response(path, scope)
        except StarletteHTTPException as exc:
            if exc.status_code == 404 and not path.startswith("api"):
                return await super().get_response("index.html", scope)
            raise


# Serve the built PWA same-origin (built into railway/web by `vite build`). Mounted
# LAST so /api/*, /health, and /docs win; html=True serves index.html at "/".
# Guarded so the API still boots if the PWA hasn't been built into the image.
_web = Path(__file__).resolve().parent.parent / "web"
if _web.is_dir():
    app.mount("/", SPAStaticFiles(directory=str(_web), html=True), name="web")
