"""S3-compatible public media storage with a local-disk fallback.

Set ``MEDIA_STORAGE_BACKEND=s3`` plus bucket credentials to upload menu images,
library images, transcoded videos and posters. Public URLs are built from
``S3_PUBLIC_BASE_URL`` (CDN or bucket URL). Without S3, files stay under
``MEDIA_ROOT`` and are served by the application.
"""

import os
from functools import lru_cache
from typing import Any
from urllib.parse import quote

import boto3
from botocore.config import Config


def is_s3() -> bool:
    return os.getenv("MEDIA_STORAGE_BACKEND", "local").strip().lower() == "s3"


def _bucket() -> str:
    return os.getenv("S3_BUCKET", "").strip()


def _prefix() -> str:
    return os.getenv("S3_PREFIX", "").strip().strip("/")


def _public_base() -> str:
    return os.getenv("S3_PUBLIC_BASE_URL", "").strip().rstrip("/")


def _endpoint() -> str:
    return os.getenv("S3_ENDPOINT_URL", "").strip().rstrip("/")


def _region() -> str:
    return os.getenv("S3_REGION", "us-east-1").strip() or "us-east-1"


def missing_settings() -> list[str]:
    if not is_s3():
        return []
    missing: list[str] = []
    if not _bucket():
        missing.append("S3_BUCKET")
    if not os.getenv("S3_ACCESS_KEY_ID", "").strip():
        missing.append("S3_ACCESS_KEY_ID")
    if not os.getenv("S3_SECRET_ACCESS_KEY", "").strip():
        missing.append("S3_SECRET_ACCESS_KEY")
    return missing


def validate_media_storage() -> None:
    missing = missing_settings()
    if missing:
        raise RuntimeError(
            "MEDIA_STORAGE_BACKEND=s3 is missing: " + ", ".join(missing)
        )


@lru_cache(maxsize=1)
def _client() -> Any:
    validate_media_storage()
    return boto3.client(
        "s3",
        endpoint_url=_endpoint() or None,
        region_name=_region(),
        aws_access_key_id=os.getenv("S3_ACCESS_KEY_ID", "").strip() or None,
        aws_secret_access_key=os.getenv("S3_SECRET_ACCESS_KEY", "").strip() or None,
        config=Config(signature_version="s3v4", s3={"addressing_style": "path"}),
    )


def _key(key: str) -> str:
    clean = key.lstrip("/")
    return f"{_prefix()}/{clean}" if _prefix() else clean


def public_url(key: str) -> str:
    full_key = _key(key)
    base = _public_base()
    if base:
        return f"{base}/{quote(full_key)}"
    bucket = _bucket()
    endpoint = _endpoint()
    if endpoint:
        return f"{endpoint}/{bucket}/{quote(full_key)}"
    return f"https://{bucket}.s3.{_region()}.amazonaws.com/{quote(full_key)}"


def upload_bytes(key: str, data: bytes, content_type: str) -> str:
    extra: dict[str, Any] = {
        "ContentType": content_type,
        "CacheControl": "public, max-age=31536000, immutable",
    }
    acl = os.getenv("S3_ACL", "").strip()
    if acl:
        extra["ACL"] = acl
    _client().put_object(
        Bucket=_bucket(),
        Key=_key(key),
        Body=data,
        **extra,
    )
    return public_url(key)


def _key_from_url(url: str) -> str | None:
    base = _public_base()
    if base and url.startswith(base + "/"):
        return url[len(base) + 1 :].split("?", 1)[0]
    endpoint = _endpoint()
    bucket = _bucket()
    if endpoint:
        marker = f"{endpoint}/{bucket}/"
        if url.startswith(marker):
            return url[len(marker) :].split("?", 1)[0]
    bucket_marker = f".s3.{_region()}.amazonaws.com/"
    if bucket_marker in url:
        return url.split(bucket_marker, 1)[1].split("?", 1)[0]
    return None


def delete_url(url: str) -> bool:
    if not is_s3() or not url:
        return False
    key = _key_from_url(url)
    if not key:
        return False
    try:
        _client().delete_object(Bucket=_bucket(), Key=key)
        return True
    except Exception:
        return False


def storage_status() -> dict:
    return {
        "backend": "s3" if is_s3() else "local",
        "configured": not missing_settings(),
        "missing_settings": missing_settings(),
        "bucket": _bucket() if is_s3() else None,
        "prefix": _prefix() if is_s3() else None,
        "public_base_url": _public_base() if is_s3() else None,
        "cdn_enabled": bool(_public_base()) if is_s3() else False,
        "local_root": str(
            os.getenv("MEDIA_ROOT", "").strip() or "backend/media"
        )
        if not is_s3()
        else None,
    }
