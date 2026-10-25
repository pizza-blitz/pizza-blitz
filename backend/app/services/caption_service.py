"""Video caption storage: VTT/SRT validation and SRT -> WebVTT conversion."""

import re
from pathlib import Path
from uuid import uuid4

from app.models.domain import MediaAsset
from app.services.media_service import media_root
from app.services.media_storage import delete_url, is_s3, upload_bytes

CAPTION_SUBDIR = "library/captions"
CAPTION_PREFIX = "/media/library/captions/"
MAX_CAPTION_BYTES = 1024 * 1024
TIMESTAMP_RE = re.compile(r"(\d{2}:\d{2}:\d{2}),(\d{3})")


def caption_dir() -> Path:
    target = media_root() / CAPTION_SUBDIR
    target.mkdir(parents=True, exist_ok=True)
    return target


def _convert(text: str) -> str:
    clean = text.lstrip("\ufeff").replace("\r\n", "\n").replace("\r", "\n").strip()
    if not clean:
        raise ValueError("Caption file is empty.")
    if "-->" not in clean:
        raise ValueError("Caption file has no timed cues.")
    if clean.upper().startswith("WEBVTT"):
        return clean + "\n"
    converted = TIMESTAMP_RE.sub(r"\1.\2", clean)
    return f"WEBVTT\n\n{converted}\n"


def save_caption(
    asset: MediaAsset, data: bytes, filename: str, language: str = "en"
) -> tuple[str, str]:
    if (asset.media_type or "image") != "video":
        raise ValueError("Captions can only be added to videos.")
    if not data:
        raise ValueError("Caption file is empty.")
    if len(data) > MAX_CAPTION_BYTES:
        raise ValueError("Caption files must be 1 MB or smaller.")
    suffix = Path(filename).suffix.lower()
    if suffix not in {".vtt", ".srt"}:
        raise ValueError("Upload a .vtt or .srt caption file.")
    try:
        text = data.decode("utf-8")
    except UnicodeDecodeError as exc:
        raise ValueError("Caption files must be UTF-8 text.") from exc
    converted = _convert(text)
    clean_language = (language or "en").strip()[:20].lower() or "en"
    stem = Path(asset.file_name).stem[:60] or "captions"
    target_name = f"{stem}-{uuid4().hex[:8]}.vtt"
    payload = converted.encode("utf-8")
    if is_s3():
        url = upload_bytes(
            f"{CAPTION_SUBDIR}/{target_name}", payload, "text/vtt"
        )
    else:
        target = caption_dir() / target_name
        target.write_bytes(payload)
        url = f"{CAPTION_PREFIX}{target_name}"
    return url, clean_language


def delete_caption(url: str | None) -> None:
    if not url:
        return
    if is_s3() and delete_url(url):
        return
    if not url.startswith(CAPTION_PREFIX):
        return
    filename = url[len(CAPTION_PREFIX):]
    if not filename or "/" in filename or "\\" in filename or ".." in filename:
        return
    target = (caption_dir() / filename).resolve()
    root = caption_dir().resolve()
    if root not in target.parents:
        return
    target.unlink(missing_ok=True)
