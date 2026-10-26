"""Media storage.

Uploads are validated by magic bytes, stored under ``media/menu`` or
``media/library`` with a random name, and served at ``/media/...``.
``MEDIA_ROOT`` can override the storage directory for deployments with a
persistent volume.
"""

import json
import os
import shutil
import subprocess
import tempfile
from pathlib import Path
from uuid import uuid4

from app.services.media_storage import delete_url, is_s3, upload_bytes

MAX_IMAGE_BYTES = 5 * 1024 * 1024
MAX_VIDEO_BYTES = 100 * 1024 * 1024
PUBLIC_PREFIX = "/media/menu/"
MENU_SUBDIR = "menu"
LIBRARY_PREFIX = "/media/library/"
LIBRARY_SUBDIR = "library"
VIDEO_PREFIX = "/media/library/videos/"
VIDEO_SUBDIR = "library/videos"
POSTER_PREFIX = "/media/library/posters/"
POSTER_SUBDIR = "library/posters"
VIDEO_MAX_SECONDS = 180
IMAGE_MIME = {"jpg": "image/jpeg", "png": "image/png", "webp": "image/webp"}


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
    filename = f"item-{item_id}-{uuid4().hex[:12]}.{extension}"
    if is_s3():
        return upload_bytes(
            f"{MENU_SUBDIR}/{filename}", data, IMAGE_MIME[extension]
        )
    target_dir = media_root() / MENU_SUBDIR
    target_dir.mkdir(parents=True, exist_ok=True)
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
    if is_s3():
        url = upload_bytes(
            f"{LIBRARY_SUBDIR}/{filename}", data, IMAGE_MIME[extension]
        )
        return url, filename, IMAGE_MIME[extension]
    (target_dir / filename).write_bytes(data)
    mime = IMAGE_MIME[extension]
    return f"{LIBRARY_PREFIX}{filename}", filename, mime


def delete_library_image(image_url: str | None) -> None:
    if delete_url(image_url or ""):
        return
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


def _detect_video(data: bytes) -> str | None:
    if len(data) > 12 and data[4:8] == b"ftyp":
        return "mp4"
    if data[:4] == b"\x1aE\xdf\xa3":
        return "webm"
    return None


def _ffmpeg(name: str) -> str | None:
    return shutil.which(name)


def _probe_video(path: Path) -> dict:
    ffprobe = _ffmpeg("ffprobe")
    if not ffprobe:
        return {}
    try:
        result = subprocess.run(  # noqa: S603
            [
                ffprobe,
                "-v",
                "error",
                "-select_streams",
                "v:0",
                "-show_entries",
                "stream=width,height,duration",
                "-of",
                "json",
                str(path),
            ],
            capture_output=True,
            text=True,
            timeout=60,
        )
        if result.returncode != 0:
            return {}
        streams = json.loads(result.stdout or "{}").get("streams") or []
        if not streams:
            return {}
        stream = streams[0]
        return {
            "width": int(stream.get("width") or 0),
            "height": int(stream.get("height") or 0),
            "duration_seconds": round(float(stream.get("duration") or 0), 2),
        }
    except (OSError, ValueError, subprocess.SubprocessError):
        return {}


def validate_video(data: bytes) -> str:
    if not data:
        raise ValueError("The uploaded file is empty.")
    if len(data) > MAX_VIDEO_BYTES:
        raise ValueError("Videos must be 100 MB or smaller.")
    extension = _detect_video(data)
    if extension is None:
        raise ValueError("Upload an MP4, MOV or WebM video.")
    return extension


def save_library_video(data: bytes, original_name: str = "") -> dict:
    extension = validate_video(data)
    stem = "".join(
        char for char in Path(original_name).stem.lower() if char.isalnum() or char in "-_"
    )[:60] or "video"
    token = uuid4().hex[:12]
    filename = f"{stem}-{token}.mp4"
    video_dir = media_root() / VIDEO_SUBDIR
    poster_dir = media_root() / POSTER_SUBDIR
    video_dir.mkdir(parents=True, exist_ok=True)
    poster_dir.mkdir(parents=True, exist_ok=True)
    target = video_dir / filename
    poster_name = f"{stem}-{token}.jpg"
    poster_target = poster_dir / poster_name

    with tempfile.TemporaryDirectory() as temp_dir:
        source = Path(temp_dir) / f"source.{extension}"
        source.write_bytes(data)
        ffmpeg = _ffmpeg("ffmpeg")
        if ffmpeg:
            try:
                subprocess.run(  # noqa: S603
                    [
                        ffmpeg,
                        "-y",
                        "-i",
                        str(source),
                        "-t",
                        str(VIDEO_MAX_SECONDS),
                        "-vf",
                        "scale='min(1080,iw)':-2",
                        "-c:v",
                        "libx264",
                        "-preset",
                        "fast",
                        "-crf",
                        "23",
                        "-c:a",
                        "aac",
                        "-b:a",
                        "128k",
                        "-movflags",
                        "+faststart",
                        str(target),
                    ],
                    capture_output=True,
                    timeout=600,
                    check=True,
                )
                subprocess.run(  # noqa: S603
                    [
                        ffmpeg,
                        "-y",
                        "-ss",
                        "00:00:00.100",
                        "-i",
                        str(target),
                        "-frames:v",
                        "1",
                        "-vf",
                        "scale=720:-2",
                        str(poster_target),
                    ],
                    capture_output=True,
                    timeout=120,
                    check=False,
                )
            except (OSError, subprocess.SubprocessError) as exc:
                target.unlink(missing_ok=True)
                raise ValueError("That video could not be processed.") from exc
        else:
            target.write_bytes(data)

    meta = _probe_video(target)
    duration = meta.get("duration_seconds") or 0
    if duration and duration > VIDEO_MAX_SECONDS + 1:
        target.unlink(missing_ok=True)
        poster_target.unlink(missing_ok=True)
        raise ValueError(f"Videos must be {VIDEO_MAX_SECONDS} seconds or shorter.")
    if not target.exists() or target.stat().st_size == 0:
        raise ValueError("That video could not be processed.")
    video_url = f"{VIDEO_PREFIX}{filename}"
    poster_url = f"{POSTER_PREFIX}{poster_name}" if poster_target.exists() else None
    video_size = target.stat().st_size
    if is_s3():
        video_url = upload_bytes(
            f"{VIDEO_SUBDIR}/{filename}", target.read_bytes(), "video/mp4"
        )
        if poster_target.exists():
            poster_url = upload_bytes(
                f"{POSTER_SUBDIR}/{poster_name}",
                poster_target.read_bytes(),
                "image/jpeg",
            )
        target.unlink(missing_ok=True)
        poster_target.unlink(missing_ok=True)
    return {
        "url": video_url,
        "poster_url": poster_url,
        "file_name": filename,
        "mime_type": "video/mp4",
        "size_bytes": video_size,
        "media_type": "video",
        "duration_seconds": duration or None,
        "width": meta.get("width") or None,
        "height": meta.get("height") or None,
    }


def trim_library_video(
    video_url: str,
    *,
    start_seconds: float,
    end_seconds: float,
) -> bytes:
    if is_s3():
        raise ValueError("Trimming currently requires local media storage.")
    if not video_url.startswith(VIDEO_PREFIX):
        raise ValueError("Trim requires a library video.")
    start = max(0.0, float(start_seconds))
    end = float(end_seconds)
    if end - start < 0.5:
        raise ValueError("Trim must keep at least half a second.")
    if end - start > VIDEO_MAX_SECONDS:
        raise ValueError(f"Trimmed clips must be {VIDEO_MAX_SECONDS} seconds or shorter.")
    filename = video_url[len(VIDEO_PREFIX):]
    if not filename or "/" in filename or "\\" in filename or ".." in filename:
        raise ValueError("Invalid video path.")
    source = (media_root() / VIDEO_SUBDIR / filename).resolve()
    if media_root().resolve() not in source.parents or not source.exists():
        raise ValueError("Source video not found.")
    ffmpeg = _ffmpeg("ffmpeg")
    if not ffmpeg:
        raise ValueError("ffmpeg is required to trim videos.")
    with tempfile.TemporaryDirectory() as temp_dir:
        target = Path(temp_dir) / "trimmed.mp4"
        base = [
            ffmpeg,
            "-y",
            "-ss",
            f"{start:.3f}",
            "-t",
            f"{end - start:.3f}",
            "-i",
            str(source),
        ]
        try:
            subprocess.run(  # noqa: S603
                [*base, "-c", "copy", "-avoid_negative_ts", "make_zero", str(target)],
                capture_output=True,
                timeout=180,
                check=True,
            )
        except (OSError, subprocess.SubprocessError):
            try:
                subprocess.run(  # noqa: S603
                    [
                        *base,
                        "-c:v",
                        "libx264",
                        "-preset",
                        "veryfast",
                        "-crf",
                        "23",
                        "-c:a",
                        "aac",
                        "-movflags",
                        "+faststart",
                        str(target),
                    ],
                    capture_output=True,
                    timeout=600,
                    check=True,
                )
            except (OSError, subprocess.SubprocessError) as exc:
                raise ValueError("That clip could not be trimmed.") from exc
        if not target.exists() or target.stat().st_size == 0:
            raise ValueError("That clip could not be trimmed.")
        return target.read_bytes()


def _has_audio(path: Path) -> bool:
    ffprobe = _ffmpeg("ffprobe")
    if not ffprobe:
        return False
    try:
        result = subprocess.run(  # noqa: S603
            [
                ffprobe,
                "-v",
                "error",
                "-select_streams",
                "a:0",
                "-show_entries",
                "stream=codec_type",
                "-of",
                "csv=p=0",
                str(path),
            ],
            capture_output=True,
            text=True,
            timeout=60,
        )
        return result.returncode == 0 and "audio" in (result.stdout or "")
    except (OSError, subprocess.SubprocessError):
        return False


def merge_library_videos(
    video_urls: list[str],
    *,
    transition: str = "none",
    transition_seconds: float = 0.5,
) -> bytes:
    if len(video_urls) < 2 or len(video_urls) > 10:
        raise ValueError("Select between 2 and 10 clips to merge.")
    if is_s3():
        raise ValueError("Merging currently requires local media storage.")
    transition = (transition or "none").strip().lower()
    if transition not in {"none", "fade"}:
        raise ValueError("Transition must be none or fade.")
    if transition == "fade" and len(video_urls) != 2:
        raise ValueError("A fade transition supports exactly two clips.")
    sources: list[Path] = []
    for url in video_urls:
        if not url.startswith(VIDEO_PREFIX):
            raise ValueError("Merge requires library videos.")
        filename = url[len(VIDEO_PREFIX):]
        if not filename or "/" in filename or "\\" in filename or ".." in filename:
            raise ValueError("Invalid video path.")
        source = (media_root() / VIDEO_SUBDIR / filename).resolve()
        if media_root().resolve() not in source.parents or not source.exists():
            raise ValueError("Source video not found.")
        sources.append(source)
    metas = [_probe_video(path) for path in sources]
    dimensions = {(meta.get("width"), meta.get("height")) for meta in metas}
    if len(dimensions) != 1:
        raise ValueError("Merge clips must have the same width and height.")
    audio_flags = {_has_audio(path) for path in sources}
    if len(audio_flags) != 1:
        raise ValueError("Merge clips must either all have audio or all be silent.")
    has_audio = audio_flags.pop()
    durations = [float(meta.get("duration_seconds") or 0) for meta in metas]
    total = sum(durations)
    if total > VIDEO_MAX_SECONDS:
        raise ValueError(f"Merged clips must be {VIDEO_MAX_SECONDS} seconds or shorter.")
    ffmpeg = _ffmpeg("ffmpeg")
    if not ffmpeg:
        raise ValueError("ffmpeg is required to merge videos.")
    with tempfile.TemporaryDirectory() as temp_dir:
        target = Path(temp_dir) / "merged.mp4"
        if transition == "fade":
            duration = max(
                0.1,
                min(float(transition_seconds), 1.0, durations[0] / 2, durations[1] / 2),
            )
            offset = max(0.0, durations[0] - duration)
            filter_parts = [
                "[0:v]setsar=1[v0]",
                "[1:v]setsar=1[v1]",
                f"[v0][v1]xfade=transition=fade:duration={duration:.3f}:"
                f"offset={offset:.3f}[v]",
            ]
            command = [
                ffmpeg,
                "-y",
                "-i",
                str(sources[0]),
                "-i",
                str(sources[1]),
                "-filter_complex",
            ]
            if has_audio:
                filter_parts.append(f"[0:a][1:a]acrossfade=d={duration:.3f}[a]")
            command.extend(
                [
                    ";".join(filter_parts),
                    "-map",
                    "[v]",
                ]
            )
            if has_audio:
                command.extend(["-map", "[a]", "-c:a", "aac"])
            command.extend(
                [
                    "-c:v",
                    "libx264",
                    "-preset",
                    "veryfast",
                    "-crf",
                    "23",
                    "-movflags",
                    "+faststart",
                    str(target),
                ]
            )
            try:
                subprocess.run(  # noqa: S603
                    command, capture_output=True, timeout=900, check=True
                )
            except (OSError, subprocess.SubprocessError) as exc:
                raise ValueError("That crossfade could not be rendered.") from exc
        else:
            list_path = Path(temp_dir) / "concat.txt"
            entries = []
            for path in sources:
                escaped = str(path).replace("'", r"'\''")
                entries.append(f"file '{escaped}'")
            list_path.write_text("\n".join(entries), encoding="utf-8")
            try:
                subprocess.run(  # noqa: S603
                    [
                        ffmpeg,
                        "-y",
                        "-f",
                        "concat",
                        "-safe",
                        "0",
                        "-i",
                        str(list_path),
                        "-c",
                        "copy",
                        "-movflags",
                        "+faststart",
                        str(target),
                    ],
                    capture_output=True,
                    timeout=600,
                    check=True,
                )
            except (OSError, subprocess.SubprocessError):
                try:
                    subprocess.run(  # noqa: S603
                        [
                            ffmpeg,
                            "-y",
                            "-f",
                            "concat",
                            "-safe",
                            "0",
                            "-i",
                            str(list_path),
                            "-c:v",
                            "libx264",
                            "-preset",
                            "veryfast",
                            "-crf",
                            "23",
                            "-c:a",
                            "aac",
                            "-movflags",
                            "+faststart",
                            str(target),
                        ],
                        capture_output=True,
                        timeout=900,
                        check=True,
                    )
                except (OSError, subprocess.SubprocessError) as exc:
                    raise ValueError("Those clips could not be merged.") from exc
        if not target.exists() or target.stat().st_size == 0:
            raise ValueError("Those clips could not be merged.")
        merged_meta = _probe_video(target)
        if float(merged_meta.get("duration_seconds") or 0) > VIDEO_MAX_SECONDS + 1:
            raise ValueError(f"Merged clips must be {VIDEO_MAX_SECONDS} seconds or shorter.")
        return target.read_bytes()


VIDEO_FILTERS = {
    "grayscale": "hue=s=0",
    "sepia": (
        "colorchannelmixer=.393:.769:.189:0:.349:.686:.168:0:.272:.534:.131"
    ),
    "warm": "colorbalance=rs=.12:gs=.03:bs=-.12",
    "cool": "colorbalance=rs=-.12:gs=0:bs=.12",
    "brighten": "eq=brightness=0.08:contrast=1.05",
    "vignette": "vignette=PI/4",
}


def filter_library_video(video_url: str, preset: str) -> bytes:
    filter_name = (preset or "").strip().lower()
    if filter_name not in VIDEO_FILTERS:
        raise ValueError("Unknown video filter.")
    if is_s3():
        raise ValueError("Filtering currently requires local media storage.")
    if not video_url.startswith(VIDEO_PREFIX):
        raise ValueError("Filter requires a library video.")
    filename = video_url[len(VIDEO_PREFIX):]
    if not filename or "/" in filename or "\\" in filename or ".." in filename:
        raise ValueError("Invalid video path.")
    source = (media_root() / VIDEO_SUBDIR / filename).resolve()
    if media_root().resolve() not in source.parents or not source.exists():
        raise ValueError("Source video not found.")
    ffmpeg = _ffmpeg("ffmpeg")
    if not ffmpeg:
        raise ValueError("ffmpeg is required to filter videos.")
    with tempfile.TemporaryDirectory() as temp_dir:
        target = Path(temp_dir) / "filtered.mp4"
        try:
            subprocess.run(  # noqa: S603
                [
                    ffmpeg,
                    "-y",
                    "-i",
                    str(source),
                    "-vf",
                    VIDEO_FILTERS[filter_name],
                    "-c:v",
                    "libx264",
                    "-preset",
                    "veryfast",
                    "-crf",
                    "23",
                    "-c:a",
                    "copy",
                    "-movflags",
                    "+faststart",
                    str(target),
                ],
                capture_output=True,
                timeout=600,
                check=True,
            )
        except (OSError, subprocess.SubprocessError) as exc:
            raise ValueError("That video could not be filtered.") from exc
        if not target.exists() or target.stat().st_size == 0:
            raise ValueError("That video could not be filtered.")
        return target.read_bytes()


def delete_library_video(video_url: str | None, poster_url: str | None = None) -> None:
    if is_s3():
        removed = delete_url(video_url or "")
        if delete_url(poster_url or ""):
            removed = True
        if removed:
            return
    for url, prefix, subdir in (
        (video_url, VIDEO_PREFIX, VIDEO_SUBDIR),
        (poster_url, POSTER_PREFIX, POSTER_SUBDIR),
    ):
        if not url or not url.startswith(prefix):
            continue
        filename = url[len(prefix):]
        if not filename or "/" in filename or "\\" in filename or ".." in filename:
            continue
        target = (media_root() / subdir / filename).resolve()
        root = (media_root() / subdir).resolve()
        if root not in target.parents:
            continue
        target.unlink(missing_ok=True)


def delete_menu_image(image_url: str | None) -> None:
    if delete_url(image_url or ""):
        return
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
