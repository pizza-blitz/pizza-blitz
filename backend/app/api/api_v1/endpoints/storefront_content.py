from typing import Dict, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.api.deps import get_db, require_roles
from app.services.storefront_content_service import (
    content_payload,
    reset_content,
    update_content,
)

router = APIRouter()


class StorefrontContentUpdate(BaseModel):
    hero_title: str = Field(min_length=2, max_length=160)
    hero_highlight: str = Field(min_length=1, max_length=120)
    hero_subtitle: str = Field(min_length=10, max_length=800)
    hero_image_url: Optional[str] = Field(default=None, max_length=500)
    story_title: str = Field(min_length=2, max_length=200)
    story_body: str = Field(min_length=10, max_length=1200)
    story_image_url: Optional[str] = Field(default=None, max_length=500)
    category_images: Dict[str, str] = Field(default_factory=dict)


@router.get("/")
def get_storefront_content(
    db: Session = Depends(get_db),
    _: dict = Depends(require_roles("admin")),
):
    return {"content": content_payload(db)}


@router.put("/")
def save_storefront_content(
    payload: StorefrontContentUpdate,
    db: Session = Depends(get_db),
    _: dict = Depends(require_roles("admin")),
):
    values = payload.model_dump()
    for field in (
        "hero_title",
        "hero_highlight",
        "hero_subtitle",
        "story_title",
        "story_body",
    ):
        values[field] = values[field].strip()
        if not values[field]:
            raise HTTPException(status_code=422, detail=f"{field} cannot be empty.")
    for field in ("hero_image_url", "story_image_url"):
        values[field] = (values[field] or "").strip() or None
    category_images: dict[str, str] = {}
    for key, value in payload.category_images.items():
        clean_key = str(key).strip()[:60]
        clean_value = str(value).strip()[:500]
        if clean_key and clean_value:
            category_images[clean_key] = clean_value
    values["category_images"] = category_images
    return {"content": update_content(db, values)}


@router.post("/reset")
def reset_storefront_content(
    db: Session = Depends(get_db),
    _: dict = Depends(require_roles("admin")),
):
    return {"content": reset_content(db)}
