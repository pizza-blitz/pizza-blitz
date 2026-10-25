"""Private file storage for resumes and offer letters (never statically served)."""

import os
from pathlib import Path


def private_root() -> Path:
    configured = os.getenv("PRIVATE_MEDIA_ROOT", "").strip()
    if configured:
        return Path(configured).expanduser().resolve()
    return (Path(__file__).resolve().parents[2] / "private_media").resolve()
