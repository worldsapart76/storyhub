"""Worker configuration, persisted under ~/.storyhub/settings.json.

Settings live outside the repo (per docs/components/worker.md "Runtime files")
so the same checkout can drive any machine. The worker shares one bearer token
with every other StoryHub client (docs/auth.md). First run writes a template
with empty creds; the CLI then refuses to start until they're filled in, rather
than spamming Railway with auth failures.

Phase H (redesign §12.4): the worker is a **thin agent** — only two PC-bound jobs,
X4 SD-card transfer + local backup pull. No Calibre, no FanFicFare, no
normalization tables (all of that moved server-side). It needs the Railway hub
creds, the Cloudflare R2 creds (to pull the snapshot + epubs), and the X4 transfer
tunables.
"""

from __future__ import annotations

import json
import socket
from dataclasses import asdict, dataclass, field, fields
from pathlib import Path

STORYHUB_DIR = Path.home() / ".storyhub"
SETTINGS_PATH = STORYHUB_DIR / "settings.json"
LOG_PATH = STORYHUB_DIR / "worker.log"


def _default_xteink_solo_fandoms() -> list[str]:
    """Fandoms that each get their own catalog EPUB (see FFF xteink-catalog)."""
    return ["Stray Kids", "Harry Potter", "Teen Wolf", "Roswell"]


@dataclass
class Settings:
    # --- Railway hub -------------------------------------------------------
    # Railway public domain, e.g. https://ffstoryhub.up.railway.app
    railway_url: str = ""
    # Shared bearer token (the AUTH_TOKEN set on the Railway service).
    auth_token: str = ""
    # Identifies this machine in worker_heartbeats + pc_jobs.worker_id; hostname.
    worker_id: str = field(default_factory=socket.gethostname)
    # pc_jobs poll cadence (seconds) — how often we check for a job to run.
    poll_interval_seconds: float = 5.0
    # Liveness ping cadence; Railway's worker_alive_seconds is 90, so 30s gives
    # two missed beats of slack before the dashboard shows the worker offline.
    heartbeat_interval_seconds: float = 30.0

    # --- Cloudflare R2 -----------------------------------------------------
    # boto3 S3-compatible client. Endpoint is the account-scoped R2 URL:
    #   https://<account_id>.r2.cloudflarestorage.com
    # The worker READS only (snapshot + epubs); it never writes to R2.
    r2_endpoint_url: str = ""
    r2_access_key_id: str = ""
    r2_secret_access_key: str = ""
    r2_bucket: str = "storyhub"

    # --- X4 / Xteink transfer (redesign §12.5) -----------------------------
    # Optional SD-card mount path; empty = auto-detect by scanning removable
    # drives for a .crosspoint/ directory at root.
    xteink_sd_path: str = ""
    # Status folders the worker OWNS on the device — files under these are subject
    # to add/remove. Targets only ever use {Unread, Favorite} (eligibility =
    # is_favorite OR read_status=Unread), but legacy {Priority, Read, DNF} stay in
    # the managed set so stale folders from the FFF era get cleaned up if present.
    xteink_managed_statuses: list[str] = field(
        default_factory=lambda: ["Unread", "Favorite", "Priority", "Read", "DNF"]
    )
    xteink_catalog_solo_fandoms: list[str] = field(
        default_factory=_default_xteink_solo_fandoms
    )

    # --- Local backup pull (redesign §12.4) --------------------------------
    # Destination folder for the backup_pull job: a plain offline mirror of the
    # current snapshot + every epub from R2. Empty = job fails with a clear message.
    backup_dir: str = ""

    @property
    def api_base(self) -> str:
        return self.railway_url.rstrip("/") + "/api"

    def is_configured(self) -> bool:
        """True once the hub round-trip (heartbeat + pc_jobs poll) can run. R2 creds
        are validated separately by the jobs that need them, so a not-yet-filled R2
        key doesn't block the heartbeat shell."""
        return bool(self.railway_url and self.auth_token)

    def is_r2_configured(self) -> bool:
        return bool(
            self.r2_endpoint_url
            and self.r2_access_key_id
            and self.r2_secret_access_key
            and self.r2_bucket
        )


def load_settings() -> Settings:
    """Load settings, bootstrapping a template file on first run.

    Unknown keys are ignored and missing keys fall back to defaults, so a
    settings file written by an older/newer worker still loads cleanly — this is
    also what lets the Phase-1/2 Calibre/FanFicFare keys in an existing
    settings.json be silently dropped now that those fields are gone.
    """
    if not SETTINGS_PATH.exists():
        return _bootstrap()
    data = json.loads(SETTINGS_PATH.read_text(encoding="utf-8"))
    known = {f.name for f in fields(Settings)}
    return Settings(**{k: v for k, v in data.items() if k in known})


def save_settings(settings: Settings) -> None:
    STORYHUB_DIR.mkdir(parents=True, exist_ok=True)
    SETTINGS_PATH.write_text(json.dumps(asdict(settings), indent=2), encoding="utf-8")


def _bootstrap() -> Settings:
    settings = Settings()
    save_settings(settings)
    return settings
