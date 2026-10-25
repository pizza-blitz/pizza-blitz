from typing import Optional

from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, UploadFile
from sqlalchemy.orm import Session

from app.api.deps import get_db, require_roles
from app.services.media_library_service import (
    create_asset,
    delete_asset,
    list_assets,
)
from app.services.media_storage import storage_status

router = APIRouter()


@router.get("/storage-status")
def media_storage_status(
    _: dict = Depends(require_roles("admin")),
):
    return {"storage": storage_status()}


@router.get("/assets")
def media_assets(
    q: str = Query(default="", max_length=120),
    limit: int = Query(default=100, ge=1, le=200),
    db: Session = Depends(get_db),
    _: dict = Depends(require_roles("admin")),
):
    return {"assets": list_assets(db, q, limit)}


@router.post("/assets", status_code=201)
async def upload_media_asset(
    file: UploadFile = File(...),
    name: Optional[str] = Form(default=None),
    tags: Optional[str] = Form(default=None),
    db: Session = Depends(get_db),
    session: dict = Depends(require_roles("admin")),
):
    data = await file.read()
    try:
        asset = create_asset(
            db,
            data=data,
            name=(name or file.filename or "image").strip(),
            uploaded_by=str(session.get("subject") or ""),
            tags=[tag.strip() for tag in (tags or "").split(",") if tag.strip()],
        )
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    return {"asset": asset}


@router.delete("/assets/{asset_id}", status_code=204)
def delete_media_asset(
    asset_id: int,
    db: Session = Depends(get_db),
    _: dict = Depends(require_roles("admin")),
):
    try:
        delete_asset(db, asset_id)
    except ValueError as exc:
        raise HTTPException(
            status_code=404 if "not found" in str(exc).lower() else 409,
            detail=str(exc),
        ) from exc
