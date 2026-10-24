"""HR document vault and issued letters with public verification."""

import html
import re
import secrets
from datetime import date, datetime
from pathlib import Path
from uuid import uuid4

from sqlalchemy.orm import Session

from app.models.domain import HREmployee, HRDocument, HRLetter
from app.services.media_service import media_root

MAX_DOCUMENT_BYTES = 10 * 1024 * 1024
DOCUMENT_CATEGORIES = {
    "identity",
    "address",
    "bank",
    "contract",
    "certificate",
    "other",
}
LETTER_TYPES = {
    "offer": "Offer letter",
    "confirmation": "Confirmation letter",
    "experience": "Experience letter",
    "relieving": "Relieving letter",
}


def _documents_root() -> Path:
    """Private HR storage, deliberately outside the public /media mount."""
    root = (media_root() / "hr_private").resolve()
    root.mkdir(parents=True, exist_ok=True)
    return root


def _detect_extension(data: bytes, file_name: str) -> tuple[str, str] | None:
    if data[:4] == b"%PDF":
        return "pdf", "application/pdf"
    if data[:3] == b"\xff\xd8\xff":
        return "jpg", "image/jpeg"
    if data[:8] == b"\x89PNG\r\n\x1a\n":
        return "png", "image/png"
    if data[:4] == b"PK\x03\x04" and str(file_name).lower().endswith(".docx"):
        return (
            "docx",
            "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        )
    return None


def save_document(
    db: Session,
    *,
    employee_id: int,
    category: str,
    title: str,
    visibility: str,
    notes: str | None,
    expires_at: date | None,
    uploaded_by: str | None,
    file_name: str,
    data: bytes,
) -> HRDocument:
    employee = (
        db.query(HREmployee).filter(HREmployee.id == int(employee_id)).first()
    )
    if employee is None:
        raise ValueError("Employee not found.")
    if category not in DOCUMENT_CATEGORIES:
        raise ValueError("Unknown document category.")
    if visibility not in {"hr", "employee"}:
        raise ValueError("Visibility must be hr or employee.")
    clean_title = str(title or "").strip()
    if not clean_title:
        raise ValueError("Document title is required.")
    if not data:
        raise ValueError("The uploaded file is empty.")
    if len(data) > MAX_DOCUMENT_BYTES:
        raise ValueError("Documents must be 10 MB or smaller.")
    detected = _detect_extension(data, file_name)
    if detected is None:
        raise ValueError("Upload a PDF, JPEG, PNG or DOCX file.")
    extension, mime = detected
    employee_dir = _documents_root() / str(employee.id)
    employee_dir.mkdir(parents=True, exist_ok=True)
    stored_name = f"doc-{uuid4().hex[:16]}.{extension}"
    target = employee_dir / stored_name
    target.write_bytes(data)
    relative = str(target.relative_to(_documents_root()))
    document = HRDocument(
        employee_id=employee.id,
        category=category,
        title=clean_title[:160],
        file_name=str(file_name or stored_name)[:255],
        mime_type=mime,
        size_bytes=len(data),
        storage_path=relative,
        visibility=visibility,
        expires_at=expires_at,
        notes=(str(notes or "").strip() or None),
        uploaded_by=uploaded_by,
    )
    db.add(document)
    try:
        db.commit()
    except Exception:
        db.rollback()
        target.unlink(missing_ok=True)
        raise
    db.refresh(document)
    return document


def serialize_document(row: HRDocument) -> dict:
    return {
        "id": row.id,
        "employee_id": row.employee_id,
        "employee_name": row.employee.full_name if row.employee else None,
        "employee_code": row.employee.employee_code if row.employee else None,
        "category": row.category,
        "title": row.title,
        "file_name": row.file_name,
        "mime_type": row.mime_type,
        "size_bytes": row.size_bytes,
        "visibility": row.visibility,
        "expires_at": row.expires_at.isoformat() if row.expires_at else None,
        "notes": row.notes,
        "uploaded_by": row.uploaded_by,
        "created_at": row.created_at.isoformat() if row.created_at else None,
        "download_url": f"/api/v1/restaurant/hr/documents/{row.id}/download",
    }


def list_documents(
    db: Session, employee_id: int | None = None, category: str = ""
) -> list[HRDocument]:
    query = db.query(HRDocument)
    if employee_id:
        query = query.filter(HRDocument.employee_id == employee_id)
    if category:
        query = query.filter(HRDocument.category == category)
    return query.order_by(HRDocument.created_at.desc()).all()


def document_path(row: HRDocument) -> Path:
    root = _documents_root()
    target = (root / row.storage_path).resolve()
    if root not in target.parents and target != root:
        raise ValueError("Stored document path is invalid.")
    if not target.exists():
        raise ValueError("Stored document file is missing.")
    return target


def delete_document(db: Session, row: HRDocument) -> None:
    path = document_path(row)
    db.delete(row)
    db.commit()
    path.unlink(missing_ok=True)


def _employee_for_letter(db: Session, employee_id: int) -> HREmployee:
    employee = (
        db.query(HREmployee).filter(HREmployee.id == int(employee_id)).first()
    )
    if employee is None:
        raise ValueError("Employee not found.")
    return employee


def _fmt_date(value: date | None) -> str:
    return value.strftime("%d %B %Y") if value else "the date on record"


def _letter_body(employee: HREmployee, letter_type: str, code: str) -> str:
    safe_name = html.escape(employee.full_name)
    safe_code = html.escape(employee.employee_code)
    safe_designation = html.escape(employee.designation or "the role on record")
    joining = _fmt_date(employee.joining_date)
    if letter_type == "offer":
        subject = "Offer of employment"
        body = (
            f"We are pleased to offer you the position of <strong>{safe_designation}</strong> "
            f"at Pizza Blitz. Your employee code is <strong>{safe_code}</strong> and your "
            f"expected joining date is <strong>{joining}</strong>. This offer is subject to "
            "the company's policies, verification of documents and satisfactory references."
        )
    elif letter_type == "confirmation":
        subject = "Confirmation of employment"
        body = (
            f"This is to confirm that <strong>{safe_name}</strong> ({safe_code}) is employed "
            f"with Pizza Blitz as <strong>{safe_designation}</strong> with effect from "
            f"{joining}. This letter is issued for employment verification purposes."
        )
    elif letter_type == "experience":
        subject = "Experience certificate"
        body = (
            f"This is to certify that <strong>{safe_name}</strong> ({safe_code}) was employed "
            f"with Pizza Blitz as <strong>{safe_designation}</strong> from {joining}. "
            "During this period, they contributed to restaurant operations and maintained "
            "the standards expected of the role. We wish them continued success."
        )
    else:
        subject = "Relieving letter"
        body = (
            f"This is to certify that <strong>{safe_name}</strong> ({safe_code}) has been "
            f"relieved of their duties as <strong>{safe_designation}</strong> at Pizza Blitz. "
            "All company property and clearances on record have been addressed. We thank them "
            "for their service."
        )
    issued = datetime.utcnow().strftime("%d %B %Y")
    return (
        "<article style=\"font-family:Georgia,serif;line-height:1.65;color:#1f2937\">"
        "<header style=\"border-bottom:2px solid #0f766e;padding-bottom:12px;margin-bottom:20px\">"
        "<p style=\"margin:0;font-size:12px;letter-spacing:3px;color:#0f766e\">PIZZA BLITZ · PEOPLE &amp; HR</p>"
        "<h2 style=\"margin:6px 0 0;font-size:24px;color:#111827\">"
        f"{html.escape(subject)}</h2></header>"
        f"<p style=\"margin:0 0 12px\">Date: {issued}</p>"
        f"<p style=\"margin:0 0 12px\">To: <strong>{safe_name}</strong> ({safe_code})</p>"
        f"<p style=\"margin:0 0 16px\">{body}</p>"
        "<p style=\"margin:24px 0 4px\">For Pizza Blitz</p>"
        "<p style=\"margin:0;font-weight:bold\">People &amp; HR</p>"
        "<p style=\"margin:24px 0 0;font-size:11px;color:#6b7280\">"
        f"Verification code: {html.escape(code)} · Verify at /restaurant/hr/verify-letter/{html.escape(code)}"
        "</p></article>"
    )


def create_letter(
    db: Session, employee_id: int, letter_type: str, issued_by: str | None
) -> HRLetter:
    employee = _employee_for_letter(db, employee_id)
    if letter_type not in LETTER_TYPES:
        raise ValueError("Unknown letter type.")
    code = "PBL-" + secrets.token_hex(6).upper()
    title = f"{LETTER_TYPES[letter_type]} · {employee.full_name}"
    letter = HRLetter(
        employee_id=employee.id,
        letter_type=letter_type,
        title=title,
        content_html=_letter_body(employee, letter_type, code),
        verification_code=code,
        issued_by=issued_by,
        status="issued",
    )
    db.add(letter)
    db.commit()
    db.refresh(letter)
    return letter


def serialize_letter(row: HRLetter, include_content: bool = False) -> dict:
    data = {
        "id": row.id,
        "employee_id": row.employee_id,
        "employee_name": row.employee.full_name if row.employee else None,
        "employee_code": row.employee.employee_code if row.employee else None,
        "letter_type": row.letter_type,
        "letter_label": LETTER_TYPES.get(row.letter_type, row.letter_type),
        "title": row.title,
        "verification_code": row.verification_code,
        "status": row.status,
        "issued_by": row.issued_by,
        "issued_at": row.issued_at.isoformat() if row.issued_at else None,
    }
    if include_content:
        data["content_html"] = row.content_html
    return data


def list_letters(
    db: Session, employee_id: int | None = None, letter_type: str = ""
) -> list[HRLetter]:
    query = db.query(HRLetter)
    if employee_id:
        query = query.filter(HRLetter.employee_id == employee_id)
    if letter_type:
        query = query.filter(HRLetter.letter_type == letter_type)
    return query.order_by(HRLetter.issued_at.desc()).all()


def verify_letter(db: Session, code: str) -> dict:
    normalized = str(code or "").strip().upper()
    if not re.match(r"^PBL-[A-F0-9]{12}$", normalized):
        return {"valid": False, "code": normalized}
    letter = (
        db.query(HRLetter)
        .filter(HRLetter.verification_code == normalized)
        .first()
    )
    if letter is None or letter.status != "issued":
        return {"valid": False, "code": normalized}
    return {
        "valid": True,
        "code": normalized,
        "employee_name": letter.employee.full_name if letter.employee else None,
        "employee_code": letter.employee.employee_code if letter.employee else None,
        "letter_type": letter.letter_type,
        "letter_label": LETTER_TYPES.get(letter.letter_type, letter.letter_type),
        "title": letter.title,
        "issued_at": letter.issued_at.isoformat() if letter.issued_at else None,
    }
