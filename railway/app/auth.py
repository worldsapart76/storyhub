"""Bearer-token auth — single shared secret, applied to every /api route.

See docs/auth.md: one token for all clients (extension, worker, dashboard,
bookmarklet), compared against the AUTH_TOKEN env var. No users, no sessions.
"""

from __future__ import annotations

import secrets

from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from .config import Settings, get_settings

_bearer = HTTPBearer(auto_error=False)


def require_token(
    credentials: HTTPAuthorizationCredentials | None = Depends(_bearer),
    settings: Settings = Depends(get_settings),
) -> None:
    """Reject any request lacking a valid `Authorization: Bearer {token}`."""
    if credentials is None or not secrets.compare_digest(
        credentials.credentials, settings.auth_token
    ):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Missing or invalid bearer token",
            headers={"WWW-Authenticate": "Bearer"},
        )
