from datetime import datetime
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.api.deps import get_db, require_roles
from app.core.config import settings
from app.models.domain import SocialPost, SocialPostDelivery
from app.services.social_autopublish_service import (
    publish_due_social_posts,
    social_auto_publish_status,
)
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


class SocialAutoPublishRequest(BaseModel):
    limit: int = Field(20, ge=1, le=100)


class SocialDeliveryRetryRequest(BaseModel):
    limit: int = Field(20, ge=1, le=100)
    dry_run: bool = True
    status: str = "needs_attention"


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
        "issue_reason": _delivery_issue_reason(delivery),
        "retryable": delivery.status in {"failed", "skipped"},
        "recovery_action": _delivery_recovery_action(delivery),
        "attempted_at": delivery.attempted_at.isoformat() if delivery.attempted_at else None,
    }


def _delivery_counts(deliveries: list[SocialPostDelivery]) -> dict:
    return {
        "attempted_count": len(deliveries),
        "published_count": sum(1 for delivery in deliveries if delivery.status == "published"),
        "dry_run_count": sum(1 for delivery in deliveries if delivery.status == "dry_run"),
        "failed_count": sum(1 for delivery in deliveries if delivery.status == "failed"),
        "skipped_count": sum(1 for delivery in deliveries if delivery.status == "skipped"),
        "retryable_count": sum(1 for delivery in deliveries if delivery.status in {"failed", "skipped"}),
    }


def _delivery_issue_reason(delivery: SocialPostDelivery) -> str:
    error = (delivery.error or "").lower()
    if "image_url" in error or "image" in error:
        return "asset"
    if "provider" in error or "configured" in error or delivery.status == "failed":
        return "provider"
    if delivery.status == "skipped":
        return "needs_review"
    return "none"


def _delivery_recovery_action(delivery: SocialPostDelivery) -> str:
    if delivery.status == "published":
        return "Published by provider."
    if delivery.status == "dry_run":
        return "Dry run passed; publish after provider setup and content review."
    reason = _delivery_issue_reason(delivery)
    if reason == "asset":
        return "Attach a public image URL before retrying Instagram publishing."
    if reason == "provider":
        return "Check Meta token, page or business account setup, then retry."
    if delivery.status == "skipped":
        return "Review the skipped delivery and retry when blockers are cleared."
    return "Monitor this pending delivery."


def _delivery_audit_counts(deliveries: list[SocialPostDelivery]) -> dict:
    return {
        "provider_issue_count": sum(1 for delivery in deliveries if _delivery_issue_reason(delivery) == "provider"),
        "asset_issue_count": sum(1 for delivery in deliveries if _delivery_issue_reason(delivery) == "asset"),
        "needs_review_count": sum(1 for delivery in deliveries if _delivery_issue_reason(delivery) == "needs_review"),
    }


def _delivery_proof_dict(delivery: SocialPostDelivery | None) -> dict | None:
    if not delivery:
        return None
    return {
        "id": delivery.id,
        "social_post_id": delivery.social_post_id,
        "platform": delivery.platform,
        "provider": delivery.provider,
        "status": delivery.status,
        "dry_run": delivery.dry_run,
        "external_id": delivery.external_id,
        "issue_reason": _delivery_issue_reason(delivery),
        "error": delivery.error,
        "recovery_action": _delivery_recovery_action(delivery),
        "attempted_at": delivery.attempted_at.isoformat() if delivery.attempted_at else None,
    }


def _platform_activation_status(status: dict, counts: dict, blocked_due_count: int) -> tuple[str, str, list[str]]:
    blockers: list[str] = []
    if status.get("unsupported"):
        return "unsupported", "Select a supported Meta platform provider.", ["Unsupported provider selected"]
    if not settings.SOCIAL_PUBLISH_ENABLED:
        blockers.append("SOCIAL_PUBLISH_ENABLED=true")
    blockers.extend(setting for setting in status.get("missing_settings") or [] if setting not in blockers)
    if blockers:
        return "credentials_needed", f"Configure {', '.join(blockers)}.", blockers
    if blocked_due_count:
        return "content_blocked", "Fix blocked due-post content before auto-posting.", ["Blocked due-post content"]
    if counts["dry_run_count"] == 0 and counts["published_count"] == 0:
        return "proof_needed", "Run a dry-run proof before live auto-posting.", ["Dry-run proof missing"]
    if counts["retryable_count"]:
        return "recovery_needed", "Retry failed or skipped delivery attempts before the next live run.", ["Retryable delivery issues"]
    return "live_ready", "Platform is ready for due-post auto-publishing.", []


def _platform_mission_control(
    db: Session,
    platform: str,
    due_posts: list[dict],
) -> dict:
    status = _social_provider_readiness(platform)
    deliveries = (
        db.query(SocialPostDelivery)
        .filter(SocialPostDelivery.platform == platform)
        .order_by(SocialPostDelivery.attempted_at.desc(), SocialPostDelivery.id.desc())
        .all()
    )
    counts = {
        **_delivery_counts(deliveries),
        **_delivery_audit_counts(deliveries),
    }
    blocked_due = [
        post for post in due_posts
        if platform in (post.get("platforms") or []) and not post.get("eligible")
    ]
    eligible_due = [
        post for post in due_posts
        if platform in (post.get("platforms") or []) and post.get("eligible")
    ]
    latest_dry_run = next((delivery for delivery in deliveries if delivery.status == "dry_run"), None)
    latest_published = next((delivery for delivery in deliveries if delivery.status == "published"), None)
    latest_issue = next((delivery for delivery in deliveries if delivery.status in {"failed", "skipped"}), None)
    activation_status, next_action, blockers = _platform_activation_status(
        status,
        counts,
        len(blocked_due),
    )
    return {
        "platform": platform,
        "provider_status": status,
        "activation_status": activation_status,
        "blockers": blockers,
        "due_count": len(eligible_due) + len(blocked_due),
        "eligible_due_count": len(eligible_due),
        "blocked_due_count": len(blocked_due),
        "counts": counts,
        "latest_dry_run": _delivery_proof_dict(latest_dry_run),
        "latest_published": _delivery_proof_dict(latest_published),
        "latest_issue": _delivery_proof_dict(latest_issue),
        "next_action": next_action,
    }


def _provider_credential_checks(platform: str, status: dict) -> list[dict]:
    credential_map = {
        "facebook": [
            ("SOCIAL_PUBLISH_ENABLED=true", "Global social publish switch"),
            ("FACEBOOK_PAGE_ID", "Facebook page ID"),
            ("FACEBOOK_PAGE_ACCESS_TOKEN", "Facebook page access token"),
        ],
        "instagram": [
            ("SOCIAL_PUBLISH_ENABLED=true", "Global social publish switch"),
            ("INSTAGRAM_BUSINESS_ACCOUNT_ID", "Instagram business account ID"),
            ("INSTAGRAM_ACCESS_TOKEN", "Instagram access token"),
        ],
    }
    missing = set(status.get("missing_settings") or [])
    return [
        {
            "key": key,
            "label": label,
            "configured": key not in missing and not status.get("unsupported"),
        }
        for key, label in credential_map.get(platform, [])
    ]


def _platform_content_requirements(platform: str) -> list[dict]:
    if platform == "instagram":
        return [
            {
                "label": "Public image URL",
                "status": "required",
                "detail": "Instagram publishing requires a reachable image_url on every post.",
            },
            {
                "label": "Caption review",
                "status": "required",
                "detail": "Caption text should be reviewed before live provider posting.",
            },
        ]
    return [
        {
            "label": "Message or image creative",
            "status": "required",
            "detail": "Facebook can publish a feed link/message or a photo caption.",
        },
        {
            "label": "Page ownership",
            "status": "required",
            "detail": "The configured page token must belong to the Pizza Blitz page.",
        },
    ]


def _social_provider_readiness(platform: str) -> dict:
    status = social_provider_status(platform)
    missing = status.get("missing_settings") or []
    return {
        **status,
        "readiness_label": "Provider ready" if status.get("configured") else "Setup needed",
        "credential_checks": _provider_credential_checks(platform, status),
        "content_requirements": _platform_content_requirements(platform),
        "graph_version": settings.META_GRAPH_VERSION,
        "safe_publish": {
            "dry_run_available": True,
            "live_publish_blocked": not status.get("configured"),
            "retry_supported": True,
        },
        "next_action": (
            "Run dry-run proof, then publish due posts when content is approved."
            if status.get("configured")
            else f"Configure {', '.join(missing) if missing else 'supported Meta provider settings'}."
        ),
    }


def _publish_delivery_for_platform(post: SocialPost, platform: str, *, dry_run: bool) -> SocialPostDelivery:
    provider_status = social_provider_status(platform)
    delivery_kwargs = {
        "social_post_id": post.id,
        "platform": platform,
        "attempted_at": datetime.utcnow(),
    }

    if platform == "instagram" and not post.image_url:
        return SocialPostDelivery(
            **delivery_kwargs,
            provider=provider_status["provider"],
            status="skipped",
            error="Instagram publishing requires an image_url.",
            dry_run=dry_run,
            response_payload={"provider_status": provider_status},
        )
    if dry_run:
        return SocialPostDelivery(
            **delivery_kwargs,
            provider=provider_status["provider"],
            status="dry_run",
            dry_run=True,
            response_payload={"provider_status": provider_status},
        )

    result = publish_social_post(
        platform=platform,
        message=post.message,
        link_url=post.link_url,
        image_url=post.image_url,
    )
    return SocialPostDelivery(
        **delivery_kwargs,
        provider=result.provider,
        status=result.status,
        external_id=result.external_id,
        error=result.error,
        dry_run=False,
        response_payload=result.response_payload,
    )


def _retry_candidates(
    db: Session,
    post: SocialPost,
    *,
    status_filter: str,
    limit: int,
) -> list[SocialPostDelivery]:
    normalized = (status_filter or "needs_attention").strip().lower()
    query = db.query(SocialPostDelivery).filter(SocialPostDelivery.social_post_id == post.id)
    if normalized == "needs_attention":
        query = query.filter(SocialPostDelivery.status.in_(["failed", "skipped"]))
    elif normalized in {"failed", "skipped", "pending", "dry_run"}:
        query = query.filter(SocialPostDelivery.status == normalized)
    elif normalized != "all":
        raise HTTPException(status_code=422, detail="Unsupported social delivery retry status filter.")
    return (
        query.order_by(SocialPostDelivery.attempted_at.desc(), SocialPostDelivery.id.desc())
        .limit(limit)
        .all()
    )


@router.get("/provider-status")
def social_provider_statuses(
    session: dict = Depends(require_roles("admin", "staff")),
):
    return {
        platform: _social_provider_readiness(platform)
        for platform in sorted(VALID_SOCIAL_PLATFORMS)
    }


@router.get("/readiness")
def social_publishing_readiness(
    limit: int = Query(20, ge=1, le=100),
    db: Session = Depends(get_db),
    session: dict = Depends(require_roles("admin", "staff")),
):
    providers = {
        platform: _social_provider_readiness(platform)
        for platform in sorted(VALID_SOCIAL_PLATFORMS)
    }
    queue = social_auto_publish_status(db, limit=limit)
    recent_deliveries = (
        db.query(SocialPostDelivery)
        .order_by(SocialPostDelivery.attempted_at.desc(), SocialPostDelivery.id.desc())
        .limit(50)
        .all()
    )
    all_ready = all(status["configured"] for status in providers.values())
    return {
        "generated_at": datetime.utcnow().isoformat(),
        "providers": providers,
        "schedule": queue,
        "audit": {
            **_delivery_counts(recent_deliveries),
            **_delivery_audit_counts(recent_deliveries),
            "latest_attempted_at": recent_deliveries[0].attempted_at.isoformat()
            if recent_deliveries and recent_deliveries[0].attempted_at
            else None,
        },
        "checklist": [
            "Meta tokens are checked without exposing token values.",
            "Scheduled posts remain blocked until platform credentials and Instagram assets are ready.",
            "Failed or skipped delivery attempts can be retried through the social post audit lane.",
        ],
        "next_action": (
            "Run due posts or retry failed deliveries after dry-run proof."
            if all_ready
            else "Finish Meta token setup, then run dry-run proof before live publishing."
        ),
    }


@router.get("/auto-post/mission-control")
def social_auto_post_mission_control(
    limit: int = Query(20, ge=1, le=100),
    db: Session = Depends(get_db),
    session: dict = Depends(require_roles("admin", "staff")),
):
    queue = social_auto_publish_status(db, limit=limit)
    due_posts = queue.get("due_posts") or []
    platforms = [
        _platform_mission_control(db, platform, due_posts)
        for platform in sorted(VALID_SOCIAL_PLATFORMS)
    ]
    recent_deliveries = (
        db.query(SocialPostDelivery)
        .order_by(SocialPostDelivery.attempted_at.desc(), SocialPostDelivery.id.desc())
        .limit(8)
        .all()
    )
    configured_count = sum(1 for platform in platforms if platform["provider_status"]["configured"])
    live_ready_count = sum(1 for platform in platforms if platform["activation_status"] == "live_ready")
    blocked_count = len(platforms) - live_ready_count
    retryable_count = sum(platform["counts"]["retryable_count"] for platform in platforms)
    if live_ready_count == len(platforms):
        overall_status = "live_ready"
        next_action = "All social platforms are live-ready. Run due posts from the auto-post console."
    elif configured_count:
        overall_status = "partially_ready"
        next_action = "Finish proof, content and recovery blockers before the next live auto-post run."
    else:
        overall_status = "setup_needed"
        next_action = "Configure Meta credentials, then run dry-run proof for Facebook and Instagram."

    return {
        "generated_at": datetime.utcnow().isoformat(),
        "summary": {
            "overall_status": overall_status,
            "publish_enabled": settings.SOCIAL_PUBLISH_ENABLED,
            "configured_count": configured_count,
            "live_ready_count": live_ready_count,
            "blocked_count": blocked_count,
            "due_count": queue.get("due_count", 0),
            "eligible_count": queue.get("eligible_count", 0),
            "blocked_due_count": queue.get("blocked_count", 0),
            "retryable_count": retryable_count,
            "next_action": next_action,
        },
        "platforms": platforms,
        "controls": [
            {
                "label": "Secret-safe Meta tokens",
                "status": "enforced",
                "detail": "Only missing setting names are returned; access tokens are never exposed.",
            },
            {
                "label": "Due-post gate",
                "status": "enforced",
                "detail": "Auto-post only considers ready or scheduled posts whose scheduled_at time has arrived.",
            },
            {
                "label": "Instagram asset gate",
                "status": "enforced",
                "detail": "Instagram posts stay blocked until a public image URL is attached.",
            },
            {
                "label": "Dry-run recovery",
                "status": "ready",
                "detail": "Failed and skipped deliveries can be retried in dry-run mode before live posting.",
            },
        ],
        "due_posts": due_posts,
        "recent_delivery_events": [_delivery_proof_dict(delivery) for delivery in recent_deliveries],
    }


@router.get("/auto-publish/status")
def social_auto_publish_readiness(
    limit: int = Query(20, ge=1, le=100),
    db: Session = Depends(get_db),
    session: dict = Depends(require_roles("admin", "staff")),
):
    return social_auto_publish_status(db, limit=limit)


@router.post("/auto-publish/run")
def run_social_auto_publish(
    payload: SocialAutoPublishRequest,
    db: Session = Depends(get_db),
    session: dict = Depends(require_roles("admin")),
):
    return publish_due_social_posts(limit=payload.limit, db=db)


@router.post("/posts")
def create_social_post(
    payload: SocialPostCreate,
    db: Session = Depends(get_db),
    session: dict = Depends(require_roles("admin")),
):
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
    session: dict = Depends(require_roles("admin", "staff")),
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
    session: dict = Depends(require_roles("admin", "staff")),
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
        **_delivery_audit_counts(deliveries),
        "latest_attempted_at": deliveries[0].attempted_at.isoformat()
        if deliveries and deliveries[0].attempted_at
        else None,
        "deliveries": [_delivery_dict(delivery) for delivery in deliveries],
    }


@router.post("/posts/{post_id}/publish")
def publish_post(
    post_id: int,
    payload: SocialPublishRequest,
    db: Session = Depends(get_db),
    session: dict = Depends(require_roles("admin")),
):
    post = db.get(SocialPost, post_id)
    if not post:
        raise HTTPException(status_code=404, detail="Social post not found")
    if post.status == "published" and not payload.force_repost and not payload.dry_run:
        raise HTTPException(status_code=409, detail="Post is already marked as published.")

    platforms = _normalize_platforms(payload.platforms or post.platforms or [])
    deliveries: list[SocialPostDelivery] = []

    for platform in platforms:
        delivery = _publish_delivery_for_platform(post, platform, dry_run=payload.dry_run)
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


@router.post("/posts/{post_id}/deliveries/retry")
def retry_social_post_deliveries(
    post_id: int,
    payload: SocialDeliveryRetryRequest,
    db: Session = Depends(get_db),
    session: dict = Depends(require_roles("admin")),
):
    post = db.get(SocialPost, post_id)
    if not post:
        raise HTTPException(status_code=404, detail="Social post not found")

    source_deliveries = _retry_candidates(
        db,
        post,
        status_filter=payload.status,
        limit=payload.limit,
    )
    retried_platforms: set[str] = set()
    deliveries: list[SocialPostDelivery] = []
    skipped_source_count = 0

    for source in source_deliveries:
        platform = source.platform
        if platform in retried_platforms:
            skipped_source_count += 1
            continue
        retried_platforms.add(platform)
        delivery = _publish_delivery_for_platform(post, platform, dry_run=payload.dry_run)
        db.add(delivery)
        deliveries.append(delivery)

    if not payload.dry_run and deliveries:
        if any(delivery.status == "published" for delivery in deliveries):
            post.status = "published"
        elif any(delivery.status == "failed" for delivery in deliveries):
            post.status = "failed"

    db.commit()
    for delivery in deliveries:
        db.refresh(delivery)

    return {
        "post": _social_post_dict(post),
        "dry_run": payload.dry_run,
        "status_filter": payload.status,
        "source_count": len(source_deliveries),
        "skipped_source_count": skipped_source_count,
        "retried_platform_count": len(deliveries),
        **_delivery_counts(deliveries),
        **_delivery_audit_counts(deliveries),
        "deliveries": [_delivery_dict(delivery) for delivery in deliveries],
    }
