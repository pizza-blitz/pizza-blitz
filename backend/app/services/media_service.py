"""Media storage.

Uploads are validated by magic bytes, stored under ``media/menu`` or
``media/library`` with a random name, and served at ``/media/...``.
``MEDIA_ROOT`` can override the storage directory for deployments with a
persistent volume.
"""

import os
from pathlib import Path
from uuid import uuid4

MAX_IMAGE_BYTES = 5 * 1024 * 1024
PUBLIC_PREFIX = "/media/menu/"
MENU_SUBDIR = "menu"
LIBRARY_PREFIX = "/media/library/"
LIBRARY_SUBDIR = "library"


def media_root() -> Path:
    configured = os.getenv("MEDIA_ROOT", "").strip()
    if configured:
        return Path(configured).expanduser().resolve()
    return (Path(__file__).resolve().parents[2] / "media").resolve()


def _detect_extension(data: bytes) -> str | None:
    if data[:3] == b"\xff\xd8\xff":
        return "jpg"
    if data[:8] == b"\x89PNG\r\n\x1a\n":
        return "png"
    if data[:4] == b"RIFF" and data[8:12] == b"WEBP":
        return "webp"
    return None


def validate_image(data: bytes) -> str:
    if not data:
        raise ValueError("The uploaded file is empty.")
    if len(data) > MAX_IMAGE_BYTES:
        raise ValueError("Images must be 5 MB or smaller.")
    extension = _detect_extension(data)
    if extension is None:
        raise ValueError("Upload a JPEG, PNG, or WebP image.")
    return extension


def save_menu_image(item_id: int, data: bytes) -> str:
    extension = validate_image(data)
    target_dir = media_root() / MENU_SUBDIR
    target_dir.mkdir(parents=True, exist_ok=True)
    filename = f"item-{item_id}-{uuid4().hex[:12]}.{extension}"
    (target_dir / filename).write_bytes(data)
    return f"{PUBLIC_PREFIX}{filename}"


def save_library_image(data: bytes, original_name: str = "") -> tuple[str, str, str]:
    """Save a shared-library image and return (url, file_name, mime_type)."""
    extension = validate_image(data)
    stem = "".join(
        char for char in Path(original_name).stem.lower() if char.isalnum() or char in "-_"
    )[:60] or "image"
    target_dir = media_root() / LIBRARY_SUBDIR
    target_dir.mkdir(parents=True, exist_ok=True)
    filename = f"{stem}-{uuid4().hex[:12]}.{extension}"
    (target_dir / filename).write_bytes(data)
    mime = {"jpg": "image/jpeg", "png": "image/png", "webp": "image/webp"}[extension]
    return f"{LIBRARY_PREFIX}{filename}", filename, mime


def delete_library_image(image_url: str | None) -> None:
    if not image_url or not image_url.startswith(LIBRARY_PREFIX):
        return
    filename = image_url[len(LIBRARY_PREFIX):]
    if not filename or "/" in filename or "\\" in filename or ".." in filename:
        return
    target = (media_root() / LIBRARY_SUBDIR / filename).resolve()
    library_dir = (media_root() / LIBRARY_SUBDIR).resolve()
    if library_dir not in target.parents:
        return
    target.unlink(missing_ok=True)


def delete_menu_image(image_url: str | None) -> None:
    if not image_url or not image_url.startswith(PUBLIC_PREFIX):
        return
    filename = image_url[len(PUBLIC_PREFIX):]
    if not filename or "/" in filename or "\\" in filename or ".." in filename:
        return
    target = (media_root() / MENU_SUBDIR / filename).resolve()
    menu_dir = (media_root() / MENU_SUBDIR).resolve()
    if menu_dir not in target.parents:
        return
    target.unlink(missing_ok=True)
