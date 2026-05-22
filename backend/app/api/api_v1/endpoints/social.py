from datetime import datetime
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.api.deps import get_db
from app.models.domain import SocialPost, SocialPostDelivery
from app.services.social_publish_service import publish_social_post, social_provider_status

router = APIRouter()

VALID_SOCIAL_PLATFORMS = {"facebook", "instagram"}
VALID_SOCIAL_STATUSES = {"draft", "scheduled", "ready", "published", "failed"}


class SocialPostCreate(BaseModel):
    title: str = Field(..., min_length=1)
    message: str = Field(..., min_length=1)
    link_url: Optional[str] = None
    image_url: Optional[str] = None
    platforms: list[str] = Field(default_factory=lambda: ["facebook", "instagram"])
    status: str = "draft"
    scheduled_at: Optional[str] = None


class SocialPublishRequest(BaseModel):
    dry_run: bool = False
    platforms: Optional[list[str]] = None
    force_repost: bool = False
    mark_published: bool = True


def _parse_optional_datetime(value: Optional[str]) -> Optional[datetime]:
    if not value:
        return None
    try:
        return datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=f"Invalid scheduled_at: {value}") from exc


def _normalize_platforms(platforms: list[str]) -> list[str]:
    cleaned = []
    for platform in platforms:
        normalized = platform.strip().lower()
        if normalized and normalized not in cleaned:
            cleaned.append(normalized)
    invalid = [platform for platform in cleaned if platform not in VALID_SOCIAL_PLATFORMS]
    if invalid:
        raise HTTPException(status_code=422, detail=f"Unsupported platform: {', '.join(invalid)}")
    if not cleaned:
        raise HTTPException(status_code=422, detail="At least one social platform is required.")
    return cleaned


def _validate_status(status: str) -> str:
    normalized = status.strip().lower()
    if normalized not in VALID_SOCIAL_STATUSES:
        raise HTTPException(status_code=422, detail="Unsupported social post status.")
    return normalized


def _social_post_dict(post: SocialPost) -> dict:
    return {
        "id": post.id,
        "title": post.title,
        "message": post.message,
        "link_url": post.link_url,
        "image_url": post.image_url,
        "platforms": post.platforms or [],
        "status": post.status,
        "scheduled_at": post.scheduled_at.isoformat() if post.scheduled_at else None,
        "created_at": post.created_at.isoformat() if post.created_at else None,
    }


def _delivery_dict(delivery: SocialPostDelivery) -> dict:
    return {
        "id": delivery.id,
        "social_post_id": delivery.social_post_id,
        "platform": delivery.platform,
        "provider": delivery.provider,
        "status": delivery.status,
        "external_id": delivery.external_id,
        "error": delivery.error,
        "dry_run": delivery.dry_run,
        "attempted_at": delivery.attempted_at.isoformat() if delivery.attempted_at else None,
    }


def _delivery_counts(deliveries: list[SocialPostDelivery]) -> dict:
    return {
        "attempted_count": len(deliveries),
        "published_count": sum(1 for delivery in deliveries if delivery.status == "published"),
        "dry_run_count": sum(1 for delivery in deliveries if delivery.status == "dry_run"),
        "failed_count": sum(1 for delivery in deliveries if delivery.status == "failed"),
        "skipped_count": sum(1 for delivery in deliveries if delivery.status == "skipped"),
    }


@router.get("/provider-status")
def social_provider_statuses():
    return {
        platform: social_provider_status(platform)
        for platform in sorted(VALID_SOCIAL_PLATFORMS)
    }


@router.post("/posts")
def create_social_post(payload: SocialPostCreate, db: Session = Depends(get_db)):
    post = SocialPost(
        title=payload.title.strip(),
        message=payload.message.strip(),
        link_url=(payload.link_url or "").strip() or None,
        image_url=(payload.image_url or "").strip() or None,
        platforms=_normalize_platforms(payload.platforms),
        status=_validate_status(payload.status),
        scheduled_at=_parse_optional_datetime(payload.scheduled_at),
    )
    db.add(post)
    db.commit()
    db.refresh(post)
    return {"status": "social post created", "post": _social_post_dict(post)}


@router.get("/posts")
def list_social_posts(
    limit: int = Query(50, ge=1, le=200),
    db: Session = Depends(get_db),
):
    posts = (
        db.query(SocialPost)
        .order_by(SocialPost.created_at.desc(), SocialPost.id.desc())
        .limit(limit)
        .all()
    )
    return [_social_post_dict(post) for post in posts]


@router.get("/posts/{post_id}/deliveries")
def social_post_deliveries(
    post_id: int,
    limit: int = Query(50, ge=1, le=200),
    db: Session = Depends(get_db),
):
    post = db.get(SocialPost, post_id)
    if not post:
        raise HTTPException(status_code=404, detail="Social post not found")
    deliveries = (
        db.query(SocialPostDelivery)
        .filter(SocialPostDelivery.social_post_id == post.id)
        .order_by(SocialPostDelivery.attempted_at.desc(), SocialPostDelivery.id.desc())
        .limit(limit)
        .all()
    )
    return {
        "post": _social_post_dict(post),
        **_delivery_counts(deliveries),
        "deliveries": [_delivery_dict(delivery) for delivery in deliveries],
    }


@router.post("/posts/{post_id}/publish")
def publish_post(
    post_id: int,
    payload: SocialPublishRequest,
    db: Session = Depends(get_db),
):
    post = db.get(SocialPost, post_id)
    if not post:
        raise HTTPException(status_code=404, detail="Social post not found")
    if post.status == "published" and not payload.force_repost and not payload.dry_run:
        raise HTTPException(status_code=409, detail="Post is already marked as published.")

    platforms = _normalize_platforms(payload.platforms or post.platforms or [])
    deliveries: list[SocialPostDelivery] = []

    for platform in platforms:
        provider_status = social_provider_status(platform)
        delivery_kwargs = {
            "social_post_id": post.id,
            "platform": platform,
            "attempted_at": datetime.utcnow(),
        }

        if platform == "instagram" and not post.image_url:
            delivery = SocialPostDelivery(
                **delivery_kwargs,
                provider=provider_status["provider"],
                status="skipped",
                error="Instagram publishing requires an image_url.",
                dry_run=payload.dry_run,
                response_payload={"provider_status": provider_status},
            )
        elif payload.dry_run:
            delivery = SocialPostDelivery(
                **delivery_kwargs,
                provider="dry_run",
                status="dry_run",
                dry_run=True,
                response_payload={"provider_status": provider_status},
            )
        else:
            result = publish_social_post(
                platform=platform,
                message=post.message,
                link_url=post.link_url,
                image_url=post.image_url,
            )
            delivery = SocialPostDelivery(
                **delivery_kwargs,
                provider=result.provider,
                status=result.status,
                external_id=result.external_id,
                error=result.error,
                dry_run=False,
                response_payload=result.response_payload,
            )
        db.add(delivery)
        deliveries.append(delivery)

    if not payload.dry_run and deliveries:
        if any(delivery.status == "published" for delivery in deliveries):
            post.status = "published" if payload.mark_published else post.status
        elif any(delivery.status == "failed" for delivery in deliveries):
            post.status = "failed"

    db.commit()
    for delivery in deliveries:
        db.refresh(delivery)
    return {
        "post": _social_post_dict(post),
        "provider_status": {
            platform: social_provider_status(platform)
            for platform in platforms
        },
        "dry_run": payload.dry_run,
        **_delivery_counts(deliveries),
        "deliveries": [_delivery_dict(delivery) for delivery in deliveries],
    }
