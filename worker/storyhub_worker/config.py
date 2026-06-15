"""Worker configuration, persisted under ~/.storyhub/settings.json.

Settings live outside the repo (per docs/components/worker.md "Runtime files")
so the same checkout can drive any machine. The worker shares one bearer token
with every other StoryHub client (docs/auth.md). First run writes a template
with empty creds; the CLI then refuses to start until they're filled in, rather
than spamming Railway with auth failures.

Phase 2 adds the Calibre Content Server REST creds, the Cloudflare R2 creds, and
the ship/collection normalization tables + FanFicFare/X4 tunables lifted from
FFF's config.py. The normalization tables ship as defaults so settings.json is
self-documenting and user-editable; only the secrets (Calibre password, R2 keys)
strictly need filling in before Phase 2 work runs.
"""

from __future__ import annotations

import json
import socket
from dataclasses import asdict, dataclass, field, fields
from pathlib import Path

STORYHUB_DIR = Path.home() / ".storyhub"
SETTINGS_PATH = STORYHUB_DIR / "settings.json"
LOG_PATH = STORYHUB_DIR / "worker.log"


# ---------------------------------------------------------------------------
# Normalization-table defaults (lifted verbatim from FFF's config.py).
#
# These seed the template settings.json. They live here only as the *default*;
# the user edits the persisted copy under ~/.storyhub/. Functions (not bare
# literals) because dataclass mutable defaults need a default_factory.
# ---------------------------------------------------------------------------

def _default_ship_overrides() -> dict[str, str]:
    """Cleaned AO3 ship string -> preferred Calibre #primaryship value."""
    return {
        "Katniss Everdeen/Peeta Mellark": "Katniss/Peeta",
        "Elizabeth Bennet/Fitzwilliam Darcy": "Darcy/Elizabeth",
        'James "Bucky" Barnes/Clint Barton': "Bucky/Clint",
        "Jason Todd/Tim Drake": "Tim Drake/Jason Todd",
        "Regulus Black/James Potter": "Regulus/James",
    }


def _default_collection_keywords() -> list[list[str]]:
    """Ordered (keyword, collection_name) pairs; first case-insensitive match
    against the AO3 fandoms field wins. JSON has no tuples, so these round-trip
    as 2-element lists — consumers unpack ``for keyword, name in pairs``."""
    return [
        ["Stray Kids", "Stray Kids"],
        ["ATEEZ", "ATEEZ"],
        ["Hunger Games", "Hunger Games"],
        ["Harry Potter", "Harry Potter"],
        ["Batman", "DCU"],
        ["DCU", "DCU"],
        ["DC Comics", "DCU"],
        ["Marvel", "Marvel"],
        ["Avengers", "Marvel"],
        ["Pride and Prejudice", "Jane Austen"],
        ["Jane Austen", "Jane Austen"],
        ["Roswell New Mexico", "Roswell"],
        ["Mass Effect", "Mass Effect"],
        ["Dragon Age", "Dragon Age"],
        ["Shadowhunters", "Shadowhunters"],
        ["Mortal Instruments", "Shadowhunters"],
        ["Star Wars", "Star Wars"],
        ["Teen Wolf", "Teen Wolf"],
        ["Witcher", "Witcher"],
        ["Skyrim", "Skyrim"],
        ["Elder Scrolls", "Skyrim"],
    ]


def _default_xteink_solo_fandoms() -> list[str]:
    """Fandoms that each get their own catalog EPUB (see FFF xteink-catalog)."""
    return ["Stray Kids", "Harry Potter", "Teen Wolf", "Roswell"]


@dataclass
class Settings:
    # --- Railway hub (Phase 1) ---------------------------------------------
    # Railway public domain, e.g. https://storyhub-api.up.railway.app
    railway_url: str = ""
    # Shared bearer token (the AUTH_TOKEN set on the Railway service).
    auth_token: str = ""
    # Identifies this machine in worker_heartbeats; defaults to the hostname.
    worker_id: str = field(default_factory=socket.gethostname)
    # Queue-drain cadence (seconds).
    poll_interval_seconds: float = 5.0
    # Liveness ping cadence; Railway's worker_alive_seconds is 90, so 30s gives
    # two missed beats of slack before the dashboard shows the worker offline.
    heartbeat_interval_seconds: float = 30.0
    # Max items pulled per drain. Hitting it is logged, never silently capped
    # (FFF "no silent caps" principle) — remaining items drain on the next poll.
    queue_batch_limit: int = 100

    # --- Calibre Content Server REST (Phase 2) -----------------------------
    # See the calibre-rest-write-auth verification: digest-authed account with
    # write access; localhost in normal operation, LAN host as a fallback.
    calibre_url: str = "http://localhost:8080"
    calibre_username: str = "storyhub"
    calibre_password: str = ""
    # Default library on the content server. CLAUDE.md: "FanFiction".
    calibre_library_id: str = "FanFiction"
    # Per-call timeout (seconds). add-book on a large library can be slow.
    calibre_timeout_seconds: float = 60.0

    # --- Cloudflare R2 (Phase 2) -------------------------------------------
    # boto3 S3-compatible client. Endpoint is the account-scoped R2 URL:
    #   https://<account_id>.r2.cloudflarestorage.com
    r2_endpoint_url: str = ""
    r2_access_key_id: str = ""
    r2_secret_access_key: str = ""
    r2_bucket: str = "storyhub"

    # --- Normalization tables (lifted from FFF) ----------------------------
    # Default #readstatus written to Calibre for *fresh* imports only.
    default_read_status: str = "Unread"
    ship_shortname_overrides: dict[str, str] = field(
        default_factory=_default_ship_overrides
    )
    collection_keywords: list[list[str]] = field(
        default_factory=_default_collection_keywords
    )

    # --- FanFicFare update-check tunables (Phase 2 chunk 7) ----------------
    fanficfare_cmd: str = (
        r"C:\Users\world\AppData\Local\Programs\Python\Python312\Scripts\fanficfare.exe"
    )
    # is_adult=true is required to fetch Mature/Explicit AO3 stories.
    fanficfare_extra_options: list[str] = field(
        default_factory=lambda: ["is_adult=true"]
    )
    fanficfare_batch_size: int = 5
    fanficfare_batch_delay: int = 10
    fanficfare_story_delay: int = 20
    fanficfare_timeout: int = 120

    # --- X4 / Xteink transfer tunables (Phase 2 chunk 8) -------------------
    # Optional SD-card mount path; empty = auto-detect by scanning removable
    # drives for a .crosspoint/ directory at root.
    xteink_sd_path: str = ""
    xteink_included_statuses: list[str] = field(
        default_factory=lambda: ["Unread", "Priority", "Favorite"]
    )
    xteink_managed_statuses: list[str] = field(
        default_factory=lambda: ["Unread", "Priority", "Favorite", "Read", "DNF"]
    )
    xteink_catalog_solo_fandoms: list[str] = field(
        default_factory=_default_xteink_solo_fandoms
    )

    @property
    def api_base(self) -> str:
        return self.railway_url.rstrip("/") + "/api"

    def is_configured(self) -> bool:
        """True once the Phase-1 round-trip can run. Calibre/R2 creds are
        validated separately by the Phase-2 paths that need them, so a
        not-yet-filled Calibre password doesn't block the heartbeat shell."""
        return bool(self.railway_url and self.auth_token)

    def is_calibre_configured(self) -> bool:
        return bool(
            self.calibre_url and self.calibre_username and self.calibre_password
        )

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
    settings file written by an older/newer worker still loads cleanly.
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
