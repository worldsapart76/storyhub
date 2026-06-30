"""Read-only Cloudflare R2 access for the worker (boto3, S3-compatible).

The worker pulls the snapshot SQLite and per-work epubs straight from R2 (creds in
settings.json) — far cheaper than streaming thousands of epubs through Railway.
It NEVER writes to R2 (hard rule: Railway is the source of truth; the worker is a
thin agent). Keys mirror the server's `app/r2.py`:
  - snapshot:  snapshot/library-{version}.sqlite  (pointer: snapshot/current.json)
  - epub:      epubs/{work_id}.epub
"""

from __future__ import annotations

from pathlib import Path

import boto3
from botocore.client import Config
from botocore.exceptions import ClientError

from ..config import Settings


def make_client(settings: Settings):
    """An S3 client pointed at the account's R2 endpoint."""
    return boto3.client(
        "s3",
        endpoint_url=settings.r2_endpoint_url,
        aws_access_key_id=settings.r2_access_key_id,
        aws_secret_access_key=settings.r2_secret_access_key,
        config=Config(signature_version="s3v4"),
        region_name="auto",
    )


def epub_key(work_id: int) -> str:
    return f"epubs/{work_id}.epub"


def object_size(client, settings: Settings, key: str) -> int | None:
    """ContentLength of an object, or None if it doesn't exist. Used by the backup
    to skip re-downloading an epub whose local copy already matches R2's size."""
    try:
        head = client.head_object(Bucket=settings.r2_bucket, Key=key)
        return head.get("ContentLength")
    except ClientError as exc:
        code = exc.response.get("Error", {}).get("Code", "")
        if code in ("404", "NoSuchKey", "NoSuchKeyError", "NotFound", "405"):
            return None
        raise


def download(client, settings: Settings, key: str, dest: Path) -> bool:
    """Download one object to `dest` (parent dirs created). Returns False if the
    key doesn't exist (404 / NoSuchKey); re-raises any other error."""
    dest.parent.mkdir(parents=True, exist_ok=True)
    try:
        client.download_file(settings.r2_bucket, key, str(dest))
        return True
    except ClientError as exc:
        code = exc.response.get("Error", {}).get("Code", "")
        if code in ("404", "NoSuchKey", "NoSuchKeyError"):
            return False
        raise
