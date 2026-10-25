"""Private resume storage, text extraction and lightweight candidate parsing."""

import io
import re
from pathlib import Path
from uuid import uuid4

from app.services.private_storage import private_root

MAX_RESUME_BYTES = 8 * 1024 * 1024
RESUME_SUBDIR = "resumes"
RESUME_MIME = {
    ".pdf": "application/pdf",
    ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ".txt": "text/plain",
}
EMAIL_RE = re.compile(r"[\w.+-]+@[\w-]+\.[\w.-]+")
PHONE_RE = re.compile(r"(?:\+?91[\s-]?)?[6-9]\d{9}")
SKILL_WORDS = [
    "pizza",
    "kitchen",
    "chef",
    "baking",
    "food safety",
    "inventory",
    "customer service",
    "pos",
    "delivery",
    "team lead",
    "hygiene",
    "hospitality",
]


def resume_dir() -> Path:
    target = private_root() / RESUME_SUBDIR
    target.mkdir(parents=True, exist_ok=True)
    return target


def _extension(filename: str) -> str:
    suffix = Path(filename).suffix.lower()
    if suffix not in RESUME_MIME:
        raise ValueError("Upload a PDF, DOCX or TXT resume.")
    return suffix


def _validate(data: bytes, suffix: str) -> None:
    if not data:
        raise ValueError("The uploaded resume is empty.")
    if len(data) > MAX_RESUME_BYTES:
        raise ValueError("Resumes must be 8 MB or smaller.")
    if suffix == ".pdf" and not data.startswith(b"%PDF"):
        raise ValueError("That file is not a valid PDF.")
    if suffix == ".docx" and not data.startswith(b"PK"):
        raise ValueError("That file is not a valid DOCX.")
    if suffix == ".txt":
        try:
            data.decode("utf-8")
        except UnicodeDecodeError as exc:
            raise ValueError("TXT resumes must be UTF-8 text.") from exc


def extract_text(data: bytes, suffix: str) -> str:
    try:
        if suffix == ".pdf":
            from pypdf import PdfReader

            reader = PdfReader(io.BytesIO(data))
            return "\n".join((page.extract_text() or "") for page in reader.pages)[:50000]
        if suffix == ".docx":
            from docx import Document

            document = Document(io.BytesIO(data))
            return "\n".join(paragraph.text for paragraph in document.paragraphs)[:50000]
        return data.decode("utf-8", errors="replace")[:50000]
    except Exception:
        return ""


def parse_resume(text: str) -> dict:
    cleaned = " ".join((text or "").split())
    email_match = EMAIL_RE.search(cleaned)
    phone_match = PHONE_RE.search(re.sub(r"[\s\-()]", "", cleaned))
    lower = cleaned.lower()
    skills = [skill for skill in SKILL_WORDS if skill in lower][:12]
    lines = [line.strip() for line in (text or "").splitlines() if line.strip()]
    likely_name = ""
    for line in lines[:5]:
        if (
            2 <= len(line) <= 60
            and not EMAIL_RE.search(line)
            and not PHONE_RE.search(line)
            and not any(char.isdigit() for char in line)
            and len(line.split()) <= 5
        ):
            likely_name = line
            break
    return {
        "email": email_match.group(0).lower() if email_match else None,
        "phone": phone_match.group(0) if phone_match else None,
        "name": likely_name or None,
        "skills": skills,
        "character_count": len(cleaned),
    }


def inspect_resume(data: bytes, original_name: str) -> dict:
    suffix = _extension(original_name)
    _validate(data, suffix)
    text = extract_text(data, suffix)
    return {
        "file_name": (original_name or f"resume{suffix}")[:255],
        "mime_type": RESUME_MIME[suffix],
        "text": text,
        "parsed": parse_resume(text),
    }


def save_resume(application_id: int, data: bytes, original_name: str) -> dict:
    suffix = _extension(original_name)
    _validate(data, suffix)
    filename = f"application-{application_id}-{uuid4().hex[:12]}{suffix}"
    target = resume_dir() / filename
    target.write_bytes(data)
    text = extract_text(data, suffix)
    parsed = parse_resume(text)
    return {
        "file_name": (original_name or filename)[:255],
        "storage_name": filename,
        "mime_type": RESUME_MIME[suffix],
        "text": text,
        "parsed": parsed,
    }


def resume_path(storage_name: str) -> Path | None:
    clean = Path(storage_name).name
    if not clean or clean != storage_name:
        return None
    target = (resume_dir() / clean).resolve()
    if resume_dir().resolve() not in target.parents:
        return None
    return target if target.exists() else None


def delete_resume(storage_name: str | None) -> None:
    if not storage_name:
        return
    target = resume_path(storage_name)
    if target is not None:
        target.unlink(missing_ok=True)
