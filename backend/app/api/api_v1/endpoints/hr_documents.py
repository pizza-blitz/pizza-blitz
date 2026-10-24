from datetime import date
from typing import Optional

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session

from app.api.deps import get_db, require_roles
from app.models.domain import HRDocument, HRLetter
from app.services.hr_documents_service import (
    DOCUMENT_CATEGORIES,
    LETTER_TYPES,
    create_letter,
    delete_document,
    document_path,
    list_documents,
    list_letters,
    save_document,
    serialize_document,
    serialize_letter,
    verify_letter,
)

router = APIRouter()
public_router = APIRouter()


@router.get("/documents")
def hr_documents(
    employee_id: Optional[int] = None,
    category: str = "",
    db: Session = Depends(get_db),
    _: dict = Depends(require_roles("admin")),
):
    return {
        "documents": [
            serialize_document(row)
            for row in list_documents(db, employee_id, category)
        ],
        "categories": sorted(DOCUMENT_CATEGORIES),
    }


@router.post("/documents", status_code=201)
async def upload_hr_document(
    employee_id: int = Form(...),
    category: str = Form(default="other"),
    title: str = Form(...),
    visibility: str = Form(default="hr"),
    notes: Optional[str] = Form(default=None),
    expires_at: Optional[str] = Form(default=None),
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    session: dict = Depends(require_roles("admin")),
):
    try:
        expiry = date.fromisoformat(expires_at[:10]) if expires_at else None
    except ValueError as exc:
        raise HTTPException(status_code=422, detail="Expiry must be YYYY-MM-DD.") from exc
    data = await file.read()
    try:
        row = save_document(
            db,
            employee_id=employee_id,
            category=category,
            title=title,
            visibility=visibility,
            notes=notes,
            expires_at=expiry,
            uploaded_by=str(session.get("sub") or "admin"),
            file_name=file.filename or "document",
            data=data,
        )
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    return serialize_document(row)


@router.get("/documents/{document_id}/download")
def download_hr_document(
    document_id: int,
    db: Session = Depends(get_db),
    _: dict = Depends(require_roles("admin")),
):
    row = db.query(HRDocument).filter(HRDocument.id == document_id).first()
    if row is None:
        raise HTTPException(status_code=404, detail="Document not found.")
    try:
        path = document_path(row)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    return FileResponse(
        path,
        media_type=row.mime_type,
        filename=row.file_name,
    )


@router.delete("/documents/{document_id}", status_code=204)
def remove_hr_document(
    document_id: int,
    db: Session = Depends(get_db),
    _: dict = Depends(require_roles("admin")),
):
    row = db.query(HRDocument).filter(HRDocument.id == document_id).first()
    if row is None:
        raise HTTPException(status_code=404, detail="Document not found.")
    try:
        delete_document(db, row)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    return None


@router.get("/letters")
def hr_letters(
    employee_id: Optional[int] = None,
    letter_type: str = "",
    db: Session = Depends(get_db),
    _: dict = Depends(require_roles("admin")),
):
    return {
        "letters": [
            serialize_letter(row)
            for row in list_letters(db, employee_id, letter_type)
        ],
        "letter_types": [
            {"key": key, "label": label} for key, label in LETTER_TYPES.items()
        ],
    }


@router.post("/letters", status_code=201)
def issue_hr_letter(
    payload: dict,
    db: Session = Depends(get_db),
    session: dict = Depends(require_roles("admin")),
):
    try:
        row = create_letter(
            db,
            int(payload.get("employee_id") or 0),
            str(payload.get("letter_type") or ""),
            str(session.get("sub") or "admin"),
        )
    except (ValueError, TypeError) as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    return serialize_letter(row, include_content=True)


@router.get("/letters/{letter_id}")
def hr_letter_detail(
    letter_id: int,
    db: Session = Depends(get_db),
    _: dict = Depends(require_roles("admin")),
):
    row = db.query(HRLetter).filter(HRLetter.id == letter_id).first()
    if row is None:
        raise HTTPException(status_code=404, detail="Letter not found.")
    return serialize_letter(row, include_content=True)


@public_router.get("/verify-letter/{code}")
def verify_public_letter(
    code: str,
    db: Session = Depends(get_db),
):
    return verify_letter(db, code)
