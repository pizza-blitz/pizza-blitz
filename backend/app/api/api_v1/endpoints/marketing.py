from datetime import date
from typing import Optional

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from app.api.deps import get_db, require_roles
from app.core.clock import business_today
from app.models.domain import AdCampaign, Promotion, SocialPost

router = APIRouter()


def _month_bounds(year: int, month: int) -> tuple[date, date]:
    start = date(year, month, 1)
    end = date(year + (month // 12), (month % 12) + 1, 1)
    return start, end


@router.get("/calendar")
def marketing_calendar(
    year: Optional[int] = Query(default=None, ge=2020, le=2100),
    month: Optional[int] = Query(default=None, ge=1, le=12),
    db: Session = Depends(get_db),
    _: dict = Depends(require_roles("admin")),
):
    today = business_today()
    selected_year = year or today.year
    selected_month = month or today.month
    start, end = _month_bounds(selected_year, selected_month)
    items: list[dict] = []

    posts = (
        db.query(SocialPost)
        .filter(
            ((SocialPost.scheduled_at >= start) & (SocialPost.scheduled_at < end))
            | (
                (SocialPost.scheduled_at.is_(None))
                & (SocialPost.created_at >= start)
                & (SocialPost.created_at < end)
            )
        )
        .order_by(SocialPost.scheduled_at.asc(), SocialPost.created_at.asc())
        .all()
    )
    for post in posts:
        when = post.scheduled_at or post.created_at
        items.append(
            {
                "id": f"social-{post.id}",
                "kind": "social",
                "channel": "social",
                "title": post.title,
                "status": post.status,
                "date": when.date().isoformat() if when else None,
                "time": when.isoformat() if post.scheduled_at else None,
                "end_date": None,
                "route": "/social",
                "reference_id": post.id,
                "platforms": post.platforms or [],
                "media_type": post.media_type or "image",
                "image_url": post.image_url,
                "video_url": post.video_url,
            }
        )

    promotions = (
        db.query(Promotion)
        .filter(Promotion.start_date < end, Promotion.end_date >= start)
        .order_by(Promotion.start_date.asc())
        .all()
    )
    for promo in promotions:
        items.append(
            {
                "id": f"campaign-{promo.id}",
                "kind": "campaign",
                "channel": promo.channel or "campaign",
                "title": promo.name,
                "status": promo.status,
                "date": max(promo.start_date, start).isoformat(),
                "time": None,
                "end_date": min(promo.end_date, end).isoformat(),
                "route": "/promotions",
                "reference_id": promo.id,
                "platforms": [promo.channel] if promo.channel else [],
                "media_type": None,
                "image_url": None,
                "video_url": None,
            }
        )

    ads = (
        db.query(AdCampaign)
        .filter(
            AdCampaign.start_date.isnot(None),
            AdCampaign.start_date < end,
            ((AdCampaign.end_date.is_(None)) | (AdCampaign.end_date >= start)),
        )
        .order_by(AdCampaign.start_date.asc())
        .all()
    )
    for ad in ads:
        items.append(
            {
                "id": f"ad-{ad.id}",
                "kind": "ad",
                "channel": "ads",
                "title": ad.name,
                "status": ad.status,
                "date": max(ad.start_date, start).isoformat() if ad.start_date else None,
                "time": None,
                "end_date": min(ad.end_date, end).isoformat() if ad.end_date else None,
                "route": "/ads",
                "reference_id": ad.id,
                "platforms": ad.platforms or [],
                "media_type": None,
                "image_url": ad.image_url,
                "video_url": None,
            }
        )

    items.sort(key=lambda row: (row["date"] or "", row["kind"], row["title"]))
    return {
        "year": selected_year,
        "month": selected_month,
        "start_date": start.isoformat(),
        "end_date": end.isoformat(),
        "items": items,
        "counts": {
            "social": sum(1 for item in items if item["kind"] == "social"),
            "campaigns": sum(1 for item in items if item["kind"] == "campaign"),
            "ads": sum(1 for item in items if item["kind"] == "ad"),
        },
    }
