from datetime import datetime
from typing import Optional

from sqlalchemy.orm import Session

from app.db.session import SessionLocal
from app.models.domain import SocialPost, SocialPostDelivery
from app.services.social_publish_service import publish_social_post, social_provider_status


SOCIAL_AUTO_PUBLISH_INTERVAL_MINUTES = 5
SOCIAL_AUTO_PUBLISH_PLATFORMS = ("facebook", "instagram")


def _post_platforms(post: SocialPost) -> list[str]:
    platforms = post.platforms or []
    return [
        str(platform).strip().lower()
        for platform in platforms
        if str(platform).strip().lower() in SOCIAL_AUTO_PUBLISH_PLATFORMS
    ]


def _platform_blockers(post: SocialPost, provider_status: dict[str, dict]) -> list[str]:
    blockers: list[str] = []
    for platform in _post_platforms(post):
        status = provider_status.get(platform) or social_provider_status(platform)
        if not status.get("configured"):
            blockers.extend(status.get("missing_settings") or [f"{platform} provider setup"])
        if platform == "instagram" and not post.image_url:
            blockers.append("Instagram image_url")
    return sorted(set(blockers))


def _due_posts(db: Session, limit: int) -> list[SocialPost]:
    now = datetime.utcnow()
    return (
        db.query(SocialPost)
        .filter(SocialPost.status.in_(["scheduled", "ready"]))
        .filter(SocialPost.scheduled_at.isnot(None))
        .filter(SocialPost.scheduled_at <= now)
        .order_by(SocialPost.scheduled_at.asc(), SocialPost.id.asc())
        .limit(limit)
        .all()
    )


def social_auto_publish_status(db: Session, limit: int = 20) -> dict:
    provider_status = {
        platform: social_provider_status(platform)
        for platform in SOCIAL_AUTO_PUBLISH_PLATFORMS
    }
    due_posts = _due_posts(db, limit)
    post_rows = []
    eligible_count = 0
    blocked_count = 0

    for post in due_posts:
        blockers = _platform_blockers(post, provider_status)
        eligible = not blockers and bool(_post_platforms(post))
        eligible_count += 1 if eligible else 0
        blocked_count += 0 if eligible else 1
        post_rows.append(
            {
                "id": post.id,
                "title": post.title,
                "status": post.status,
                "scheduled_at": post.scheduled_at.isoformat() if post.scheduled_at else None,
                "platforms": _post_platforms(post),
                "eligible": eligible,
                "blockers": blockers,
            }
        )

    return {
        "interval_minutes": SOCIAL_AUTO_PUBLISH_INTERVAL_MINUTES,
        "due_count": len(due_posts),
        "eligible_count": eligible_count,
        "blocked_count": blocked_count,
        "provider_status": provider_status,
        "due_posts": post_rows,
    }


def publish_due_social_posts(limit: int = 20, db: Optional[Session] = None) -> dict:
    owns_session = db is None
    session = db or SessionLocal()
    try:
        provider_status = {
            platform: social_provider_status(platform)
            for platform in SOCIAL_AUTO_PUBLISH_PLATFORMS
        }
        due_posts = _due_posts(session, limit)
        deliveries: list[SocialPostDelivery] = []
        blocked_posts = []

        for post in due_posts:
            blockers = _platform_blockers(post, provider_status)
            platforms = _post_platforms(post)
            if blockers or not platforms:
                blocked_posts.append(
                    {
                        "id": post.id,
                        "title": post.title,
                        "blockers": blockers or ["No supported platform selected"],
                    }
                )
                continue

            post_deliveries: list[SocialPostDelivery] = []
            for platform in platforms:
                result = publish_social_post(
                    platform=platform,
                    message=post.message,
                    link_url=post.link_url,
                    image_url=post.image_url,
                )
                delivery = SocialPostDelivery(
                    social_post_id=post.id,
                    platform=platform,
                    provider=result.provider,
                    status=result.status,
                    external_id=result.external_id,
                    error=result.error,
                    dry_run=False,
                    response_payload=result.response_payload,
                    attempted_at=datetime.utcnow(),
                )
                session.add(delivery)
                deliveries.append(delivery)
                post_deliveries.append(delivery)

            if any(delivery.status == "published" for delivery in post_deliveries):
                post.status = "published"
            elif any(delivery.status == "failed" for delivery in post_deliveries):
                post.status = "failed"

        session.commit()
        for delivery in deliveries:
            session.refresh(delivery)

        return {
            "attempted_post_count": len(due_posts),
            "published_post_count": sum(
                1 for post in due_posts if post.status == "published"
            ),
            "blocked_post_count": len(blocked_posts),
            "delivery_count": len(deliveries),
            "published_delivery_count": sum(
                1 for delivery in deliveries if delivery.status == "published"
            ),
            "failed_delivery_count": sum(
                1 for delivery in deliveries if delivery.status == "failed"
            ),
            "blocked_posts": blocked_posts,
        }
    except Exception:
        session.rollback()
        raise
    finally:
        if owns_session:
            session.close()
