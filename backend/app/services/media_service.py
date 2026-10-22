"""Menu image storage.

Uploads are validated by magic bytes, stored under ``media/menu`` with a random
name, and served at ``/media/menu/<name>``. ``MEDIA_ROOT`` can override the
storage directory for deployments with a persistent volume.
"""

import os
from pathlib import Path
from uuid import uuid4

MAX_IMAGE_BYTES = 5 * 1024 * 1024
PUBLIC_PREFIX = "/media/menu/"
MENU_SUBDIR = "menu"


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


def save_menu_image(item_id: int, data: bytes) -> str:
    if not data:
        raise ValueError("The uploaded file is empty.")
    if len(data) > MAX_IMAGE_BYTES:
        raise ValueError("Images must be 5 MB or smaller.")
    extension = _detect_extension(data)
    if extension is None:
        raise ValueError("Upload a JPEG, PNG, or WebP image.")

    target_dir = media_root() / MENU_SUBDIR
    target_dir.mkdir(parents=True, exist_ok=True)
    filename = f"item-{item_id}-{uuid4().hex[:12]}.{extension}"
    (target_dir / filename).write_bytes(data)
    return f"{PUBLIC_PREFIX}{filename}"


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
