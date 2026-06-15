"""Cloudflare R2 access (S3-compatible) for epub staging + delivery.

Used by the import pipeline (§12.1): the extension uploads the epub straight to
R2 via a presigned PUT (Railway stays light); on commit Railway copies
/staging/{queue_item_id}.epub -> /epubs/{work_id}.epub and deletes the staging
object. R2 paths per redesign §7.

boto3 is imported lazily so the app loads without it (e.g. local dev without R2
configured); network calls run in a thread (boto3 is sync). If R2 is not
configured, is_configured() is False and the import path skips epub handling.
"""

from __future__ import annotations

import asyncio
from functools import lru_cache

from .config import Settings, get_settings


def is_configured(settings: Settings | None = None) -> bool:
    s = settings or get_settings()
    return bool(
        s.r2_bucket_name
        and s.r2_endpoint_url
        and s.r2_access_key_id
        and s.r2_secret_access_key
    )


@lru_cache
def _client():  # noqa: ANN202 - boto3 client type is dynamic
    import boto3
    from botocore.config import Config

    s = get_settings()
    return boto3.client(
        "s3",
        endpoint_url=s.r2_endpoint_url,
        aws_access_key_id=s.r2_access_key_id,
        aws_secret_access_key=s.r2_secret_access_key,
        region_name="auto",
        config=Config(signature_version="s3v4"),
    )


def staging_key(queue_item_id: str) -> str:
    return f"staging/{queue_item_id}.epub"


def epub_key(work_id: int) -> str:
    return f"epubs/{work_id}.epub"


def presign_put(key: str, expires_in: int = 3600) -> str:
    """Mint a presigned PUT URL the extension uploads epub bytes to directly."""
    bucket = get_settings().r2_bucket_name
    return _client().generate_presigned_url(
        "put_object",
        Params={"Bucket": bucket, "Key": key, "ContentType": "application/epub+zip"},
        ExpiresIn=expires_in,
    )


async def put_bytes(key: str, data: bytes, content_type: str = "application/octet-stream") -> None:
    bucket = get_settings().r2_bucket_name
    await asyncio.to_thread(
        _client().put_object, Bucket=bucket, Key=key, Body=data, ContentType=content_type
    )


async def get_bytes(key: str) -> bytes | None:
    """Fetch an object's bytes, or None if it doesn't exist."""
    bucket = get_settings().r2_bucket_name
    try:
        obj = await asyncio.to_thread(_client().get_object, Bucket=bucket, Key=key)
        return await asyncio.to_thread(obj["Body"].read)
    except Exception:  # noqa: BLE001 - missing key / client error -> absent
        return None


async def copy(src_key: str, dst_key: str) -> None:
    bucket = get_settings().r2_bucket_name
    await asyncio.to_thread(
        _client().copy_object,
        Bucket=bucket,
        CopySource={"Bucket": bucket, "Key": src_key},
        Key=dst_key,
    )


async def delete(key: str) -> None:
    bucket = get_settings().r2_bucket_name
    await asyncio.to_thread(_client().delete_object, Bucket=bucket, Key=key)


async def head(key: str) -> dict | None:
    """Return object metadata (incl. ETag) or None if it doesn't exist."""
    bucket = get_settings().r2_bucket_name
    try:
        return await asyncio.to_thread(_client().head_object, Bucket=bucket, Key=key)
    except Exception:  # noqa: BLE001 - boto3 ClientError 404 -> treat as absent
        return None
