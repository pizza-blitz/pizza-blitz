from typing import Optional

from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, UploadFile
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.api.deps import get_db, require_roles
from app.services.media_library_service import (
    create_asset,
    delete_asset,
    list_assets,
    serialize_asset,
)
from app.services.media_storage import storage_status
from app.services.caption_service import delete_caption, save_caption

router = APIRouter()


class TrimRequest(BaseModel):
    start_seconds: float = Field(default=0, ge=0, le=180)
    end_seconds: float = Field(gt=0, le=180)
    name: str = Field(default="", max_length=160)


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


@router.post("/assets/{asset_id}/trim", status_code=201)
def trim_media_asset(
    asset_id: int,
    payload: TrimRequest,
    db: Session = Depends(get_db),
    session: dict = Depends(require_roles("admin")),
):
    from app.models.domain import MediaAsset

    asset = db.query(MediaAsset).filter(MediaAsset.id == asset_id).first()
    if asset is None:
        raise HTTPException(status_code=404, detail="Media asset not found.")
    if asset.media_type != "video":
        raise HTTPException(status_code=422, detail="Only videos can be trimmed.")
    if payload.end_seconds <= payload.start_seconds:
        raise HTTPException(
            status_code=422, detail="End time must be after the start time."
        )
    if asset.duration_seconds and payload.end_seconds > asset.duration_seconds + 0.5:
        raise HTTPException(
            status_code=422,
            detail=f"End time exceeds the {asset.duration_seconds:.1f}s clip.",
        )
    try:
        created = create_asset(
            db,
            data=b"",
            name=(payload.name or f"{asset.name} (trim)").strip()[:160],
            uploaded_by=str(session.get("subject") or ""),
            tags=list(dict.fromkeys([*(asset.tags or []), "trimmed"])),
            trim_source={
                "url": asset.url,
                "start_seconds": payload.start_seconds,
                "end_seconds": payload.end_seconds,
            },
        )
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    return {"asset": created}


@router.post("/assets/{asset_id}/caption", status_code=201)
async def upload_asset_caption(
    asset_id: int,
    file: UploadFile = File(...),
    language: str = Form(default="en"),
    db: Session = Depends(get_db),
    _: dict = Depends(require_roles("admin")),
):
    from app.models.domain import MediaAsset

    asset = db.query(MediaAsset).filter(MediaAsset.id == asset_id).first()
    if asset is None:
        raise HTTPException(status_code=404, detail="Media asset not found.")
    data = await file.read()
    try:
        url, clean_language = save_caption(
            asset, data, file.filename or "captions.vtt", language
        )
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    delete_caption(asset.caption_url)
    asset.caption_url = url
    asset.caption_language = clean_language
    db.commit()
    db.refresh(asset)
    return {"asset": serialize_asset(asset)}


@router.delete("/assets/{asset_id}/caption", status_code=204)
def remove_asset_caption(
    asset_id: int,
    db: Session = Depends(get_db),
    _: dict = Depends(require_roles("admin")),
):
    from app.models.domain import MediaAsset

    asset = db.query(MediaAsset).filter(MediaAsset.id == asset_id).first()
    if asset is None:
        raise HTTPException(status_code=404, detail="Media asset not found.")
    delete_caption(asset.caption_url)
    asset.caption_url = None
    asset.caption_language = None
    db.commit()


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
