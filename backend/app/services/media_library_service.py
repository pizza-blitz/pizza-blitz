"""Shared media library records and usage checks."""

from sqlalchemy.orm import Session

from app.models.domain import AdCampaign, MediaAsset, MenuItem, SocialPost
from app.services.media_service import (
    delete_library_image,
    save_library_image,
)


def serialize_asset(asset: MediaAsset) -> dict:
    return {
        "id": asset.id,
        "name": asset.name,
        "url": asset.url,
        "file_name": asset.file_name,
        "mime_type": asset.mime_type,
        "size_bytes": asset.size_bytes,
        "tags": asset.tags or [],
        "uploaded_by": asset.uploaded_by,
        "created_at": asset.created_at.isoformat() if asset.created_at else None,
    }


def list_assets(db: Session, query: str = "", limit: int = 100) -> list[dict]:
    rows = db.query(MediaAsset).order_by(MediaAsset.created_at.desc()).limit(500).all()
    needle = query.strip().lower()
    if needle:
        rows = [
            row
            for row in rows
            if needle in row.name.lower()
            or needle in row.file_name.lower()
            or any(needle in str(tag).lower() for tag in (row.tags or []))
        ]
    return [serialize_asset(row) for row in rows[: max(1, min(limit, 200))]]


def asset_usage(db: Session, url: str) -> list[str]:
    usage: list[str] = []
    if db.query(MenuItem.id).filter(MenuItem.image_url == url).first():
        usage.append("menu item")
    if db.query(SocialPost.id).filter(SocialPost.image_url == url).first():
        usage.append("social post")
    if db.query(AdCampaign.id).filter(AdCampaign.image_url == url).first():
        usage.append("ad campaign")
    return usage


def create_asset(
    db: Session,
    *,
    data: bytes,
    name: str,
    uploaded_by: str = "",
    tags: list[str] | None = None,
) -> dict:
    url, file_name, mime_type = save_library_image(data, name)
    return register_asset(
        db,
        url=url,
        file_name=file_name,
        mime_type=mime_type,
        size_bytes=len(data),
        name=name,
        uploaded_by=uploaded_by,
        tags=tags,
    )


def register_asset(
    db: Session,
    *,
    url: str,
    file_name: str,
    mime_type: str,
    size_bytes: int,
    name: str = "",
    uploaded_by: str = "",
    tags: list[str] | None = None,
) -> dict:
    existing = db.query(MediaAsset).filter(MediaAsset.url == url).first()
    if existing is not None:
        return serialize_asset(existing)
    asset = MediaAsset(
        name=(name or file_name).strip()[:160] or file_name,
        url=url,
        file_name=file_name[:255],
        mime_type=mime_type[:120],
        size_bytes=size_bytes,
        tags=[str(tag).strip()[:40] for tag in (tags or []) if str(tag).strip()][:12],
        uploaded_by=uploaded_by[:120] or None,
    )
    db.add(asset)
    db.commit()
    db.refresh(asset)
    return serialize_asset(asset)


def delete_asset(db: Session, asset_id: int) -> None:
    asset = db.query(MediaAsset).filter(MediaAsset.id == asset_id).first()
    if asset is None:
        raise ValueError("Media asset not found.")
    usage = asset_usage(db, asset.url)
    if usage:
        raise ValueError(f"This image is in use by {', '.join(usage)}.")
    url = asset.url
    db.delete(asset)
    db.commit()
    delete_library_image(url)
