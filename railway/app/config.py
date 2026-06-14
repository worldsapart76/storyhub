"""Service configuration, loaded from environment variables.

All seven Railway env vars from Phase 0 are read here. Only AUTH_TOKEN and
DATABASE_URL are required for the API to boot; the R2_* values are consumed by
snapshot/epub flows (worker-side and later phases) and are optional at startup
so the API can run locally without R2 configured.
"""

from __future__ import annotations

from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    # Required
    auth_token: str
    database_url: str

    # R2 — optional at API startup (used by snapshot/epub delivery)
    r2_account_id: str | None = None
    r2_bucket_name: str | None = None
    r2_access_key_id: str | None = None
    r2_secret_access_key: str | None = None
    r2_endpoint_url: str | None = None

    # Operational tuning
    # A worker is considered "alive" if it heart-beat within this window.
    # Worker pings ~every 30s; 90s gives two missed beats of slack.
    worker_alive_seconds: int = 90


@lru_cache
def get_settings() -> Settings:
    return Settings()  # type: ignore[call-arg]
