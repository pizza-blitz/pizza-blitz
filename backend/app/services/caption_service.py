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


def _parse_timestamp(value: str) -> float:
    clean = value.strip().replace(",", ".")
    parts = clean.split(":")
    if len(parts) == 3:
        hours, minutes, seconds = parts
    elif len(parts) == 2:
        hours, minutes, seconds = "0", parts[0], parts[1]
    else:
        raise ValueError("Invalid caption timestamp.")
    return int(hours) * 3600 + int(minutes) * 60 + float(seconds)


def _format_timestamp(seconds: float) -> str:
    value = max(0.0, seconds)
    hours = int(value // 3600)
    minutes = int((value % 3600) // 60)
    whole = int(value % 60)
    millis = int(round((value - int(value)) * 1000))
    if millis == 1000:
        whole += 1
        millis = 0
    return f"{hours:02d}:{minutes:02d}:{whole:02d}.{millis:03d}"


def parse_cues(text: str) -> list[dict]:
    clean = text.lstrip("\ufeff").replace("\r\n", "\n").replace("\r", "\n")
    cues: list[dict] = []
    for block in re.split(r"\n\s*\n", clean.strip()):
        lines = [line for line in block.split("\n") if line.strip()]
        if not lines:
            continue
        timing_index = next(
            (index for index, line in enumerate(lines) if "-->" in line), None
        )
        if timing_index is None:
            continue
        try:
            start_raw, end_raw = lines[timing_index].split("-->", 1)
            start = _parse_timestamp(start_raw)
            end = _parse_timestamp(end_raw.strip().split(" ")[0])
        except ValueError:
            continue
        body = "\n".join(lines[timing_index + 1 :]).strip()
        if not body or end <= start:
            continue
        cues.append({"start": start, "end": end, "text": body})
    return cues


def offset_captions(text: str, offset_seconds: float) -> list[dict]:
    offset = max(0.0, float(offset_seconds))
    return [
        {
            "start": cue["start"] + offset,
            "end": cue["end"] + offset,
            "text": cue["text"],
        }
        for cue in parse_cues(text)
    ]


def combine_captions(parts: list[tuple[str, float]]) -> str:
    blocks: list[str] = []
    for text, offset in parts:
        for cue in offset_captions(text, offset):
            blocks.append(
                f"{_format_timestamp(cue['start'])} --> "
                f"{_format_timestamp(cue['end'])}\n{cue['text']}"
            )
    return "WEBVTT\n\n" + "\n\n".join(blocks) + ("\n" if blocks else "")


def clip_captions(text: str, start_seconds: float, end_seconds: float) -> str:
    start = max(0.0, float(start_seconds))
    end = float(end_seconds)
    blocks: list[str] = []
    for cue in parse_cues(text):
        overlap_start = max(cue["start"], start)
        overlap_end = min(cue["end"], end)
        if overlap_end - overlap_start < 0.05:
            continue
        new_start = overlap_start - start
        new_end = overlap_end - start
        blocks.append(
            f"{_format_timestamp(new_start)} --> {_format_timestamp(new_end)}\n"
            f"{cue['text']}"
        )
    return "WEBVTT\n\n" + "\n\n".join(blocks) + ("\n" if blocks else "")


def load_caption(url: str | None) -> str | None:
    if not url or is_s3() or not url.startswith(CAPTION_PREFIX):
        return None
    filename = url[len(CAPTION_PREFIX):]
    if not filename or "/" in filename or "\\" in filename or ".." in filename:
        return None
    target = (caption_dir() / filename).resolve()
    if caption_dir().resolve() not in target.parents or not target.exists():
        return None
    try:
        return target.read_text(encoding="utf-8")
    except OSError:
        return None


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
