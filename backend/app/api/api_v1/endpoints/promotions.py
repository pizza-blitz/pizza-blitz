from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from sqlalchemy import func
from app.api.deps import get_db
from app.models.domain import (
    AdCampaign,
    AdCampaignLaunch,
    CampaignDelivery,
    Customer,
    DailySales,
    Promotion,
    RestaurantOrder,
    SocialPost,
)
from app.services.campaign_dispatch_service import (
    campaign_provider_status,
    normalize_campaign_destination,
    send_campaign_message,
)
from pydantic import BaseModel, Field
from typing import Optional
from datetime import date, datetime
from urllib.parse import quote

router = APIRouter()

VALID_DISCOUNT_TYPES = {"percentage", "fixed"}
VALID_AUDIENCES = {"all_customers", "marketing_opt_in", "repeat_customers", "high_spenders"}
VALID_CHANNELS = {"whatsapp", "sms", "email"}
VALID_STATUSES = {"draft", "scheduled", "active", "paused", "completed"}
VALID_SOCIAL_PLATFORMS = {"facebook", "instagram"}
VALID_SOCIAL_POST_STATUSES = {"draft", "scheduled", "ready"}
VALID_AD_OBJECTIVES = {"awareness", "traffic", "engagement", "leads", "sales"}
VALID_AD_PLATFORMS = {"facebook", "instagram"}
VALID_AD_CAMPAIGN_STATUSES = {"draft", "planned", "ready"}
DEFAULT_MESSAGE_TEMPLATE = (
    "Hi {name}, Pizza Blitz has {offer} for you. Use code {code} before {end_date}. "
    "Reply or visit us to order."
)
DEFAULT_SOCIAL_MESSAGE_TEMPLATE = (
    "{promo_name} at Pizza Blitz: {offer}. Use code {code} before {end_date}. "
    "Order online or visit us today."
)
DEFAULT_AD_MESSAGE_TEMPLATE = (
    "{promo_name} at Pizza Blitz: {offer}. Use code {code} before {end_date}. "
    "Order online now."
)

class PromotionCreate(BaseModel):
    name: str = Field(..., min_length=1)
    code: Optional[str] = None
    start_date: str
    end_date: str
    description: Optional[str] = None
    discount_type: str = "percentage"
    discount_value: float = 0
    audience: str = "marketing_opt_in"
    channel: str = "whatsapp"
    status: str = "draft"
    message_template: Optional[str] = None

class CouponValidationRequest(BaseModel):
    code: str = Field(..., min_length=1)
    subtotal: float = Field(..., ge=0)

class CampaignSendRequest(BaseModel):
    limit: int = Field(50, ge=1, le=500)
    dry_run: bool = False
    force_resend: bool = False
    mark_completed: bool = False


class PromotionSocialPostCreate(BaseModel):
    title: Optional[str] = None
    message_template: Optional[str] = None
    link_url: Optional[str] = None
    image_url: Optional[str] = None
    platforms: list[str] = Field(default_factory=lambda: ["facebook", "instagram"])
    status: str = "ready"
    scheduled_at: Optional[str] = None


class PromotionAdCampaignCreate(BaseModel):
    name: Optional[str] = None
    objective: str = "sales"
    platforms: list[str] = Field(default_factory=lambda: ["facebook", "instagram"])
    audience: Optional[str] = "Existing customers and local pizza lovers"
    location: Optional[str] = None
    creative_template: Optional[str] = None
    link_url: Optional[str] = None
    image_url: Optional[str] = None
    daily_budget: float = Field(500, ge=0)
    lifetime_budget: float = Field(0, ge=0)
    start_date: Optional[str] = None
    end_date: Optional[str] = None
    status: str = "ready"


def _parse_date(value: str) -> date:
    try:
        return date.fromisoformat(value)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=f"Invalid date: {value}") from exc

def _normalize_code(value: Optional[str]) -> Optional[str]:
    if not value:
        return None
    return value.strip().upper().replace(" ", "")

def _validate_promotion_payload(promo: PromotionCreate) -> tuple[date, date]:
    start_date = _parse_date(promo.start_date)
    end_date = _parse_date(promo.end_date)
    if end_date < start_date:
        raise HTTPException(status_code=422, detail="End date cannot be before start date.")
    if promo.discount_type not in VALID_DISCOUNT_TYPES:
        raise HTTPException(status_code=422, detail="Discount type must be percentage or fixed.")
    if promo.discount_value < 0:
        raise HTTPException(status_code=422, detail="Discount value cannot be negative.")
    if promo.audience not in VALID_AUDIENCES:
        raise HTTPException(status_code=422, detail="Unsupported campaign audience.")
    if promo.channel not in VALID_CHANNELS:
        raise HTTPException(status_code=422, detail="Unsupported campaign channel.")
    if promo.status not in VALID_STATUSES:
        raise HTTPException(status_code=422, detail="Unsupported campaign status.")
    return start_date, end_date

def _promotion_dict(promo: Promotion) -> dict:
    return {
        "id": promo.id,
        "name": promo.name,
        "code": promo.code,
        "start_date": promo.start_date.isoformat(),
        "end_date": promo.end_date.isoformat(),
        "description": promo.description,
        "discount_type": promo.discount_type,
        "discount_value": promo.discount_value,
        "audience": promo.audience,
        "channel": promo.channel,
        "status": promo.status,
        "message_template": promo.message_template,
        "created_at": promo.created_at.isoformat() if promo.created_at else None,
    }

def _calculate_discount(promo: Promotion, subtotal: float) -> float:
    if promo.discount_type == "percentage":
        discount = subtotal * (float(promo.discount_value or 0) / 100)
    else:
        discount = float(promo.discount_value or 0)
    return round(min(max(discount, 0), subtotal), 2)

def _offer_label(promo: Promotion) -> str:
    value = f"{promo.discount_value:g}"
    if promo.discount_type == "percentage":
        return f"{value}% off"
    return f"Rs {value} off"

def _customer_dict(customer: Customer) -> dict:
    return {
        "id": customer.id,
        "name": customer.name,
        "phone": customer.phone,
        "email": customer.email,
        "opt_in_marketing": customer.opt_in_marketing,
        "total_orders": customer.total_orders or 0,
        "total_spend": round(float(customer.total_spend or 0), 2),
        "last_order_at": customer.last_order_at.isoformat() if customer.last_order_at else None,
    }

def _audience_query(db: Session, audience: str):
    query = db.query(Customer)
    if audience == "marketing_opt_in":
        query = query.filter(Customer.opt_in_marketing.is_(True))
    elif audience == "repeat_customers":
        query = query.filter(Customer.total_orders >= 2)
    elif audience == "high_spenders":
        query = query.filter(Customer.total_spend >= 500)
    elif audience != "all_customers":
        raise HTTPException(status_code=422, detail="Unsupported campaign audience.")
    return query

def _render_message(promo: Promotion, customer: Optional[Customer] = None) -> str:
    template = promo.message_template or DEFAULT_MESSAGE_TEMPLATE
    values = {
        "name": customer.name if customer and customer.name else "Pizza Lover",
        "offer": _offer_label(promo),
        "code": promo.code or "PIZZABLITZ",
        "end_date": promo.end_date.isoformat(),
        "promo_name": promo.name,
    }
    try:
        return template.format(**values)
    except KeyError as exc:
        raise HTTPException(
            status_code=422,
            detail=f"Unknown message placeholder: {exc.args[0]}",
        ) from exc


def _render_social_message(promo: Promotion, template: Optional[str] = None) -> str:
    values = {
        "offer": _offer_label(promo),
        "code": promo.code or "PIZZABLITZ",
        "end_date": promo.end_date.isoformat(),
        "promo_name": promo.name,
        "description": promo.description or "",
    }
    try:
        return (template or DEFAULT_SOCIAL_MESSAGE_TEMPLATE).format(**values)
    except KeyError as exc:
        raise HTTPException(
            status_code=422,
            detail=f"Unknown social message placeholder: {exc.args[0]}",
        ) from exc


def _render_ad_message(promo: Promotion, template: Optional[str] = None) -> str:
    values = {
        "offer": _offer_label(promo),
        "code": promo.code or "PIZZABLITZ",
        "end_date": promo.end_date.isoformat(),
        "promo_name": promo.name,
        "description": promo.description or "",
    }
    try:
        return (template or DEFAULT_AD_MESSAGE_TEMPLATE).format(**values)
    except KeyError as exc:
        raise HTTPException(
            status_code=422,
            detail=f"Unknown ad message placeholder: {exc.args[0]}",
        ) from exc


def _parse_optional_datetime(value: Optional[str]) -> Optional[datetime]:
    if not value:
        return None
    try:
        return datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=f"Invalid scheduled_at: {value}") from exc


def _parse_optional_ad_date(value: Optional[str]) -> Optional[date]:
    if not value:
        return None
    return _parse_date(value)


def _normalize_social_platforms(platforms: list[str]) -> list[str]:
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


def _normalize_social_post_status(status: str) -> str:
    normalized = status.strip().lower()
    if normalized not in VALID_SOCIAL_POST_STATUSES:
        raise HTTPException(status_code=422, detail="Unsupported social post status.")
    return normalized


def _normalize_ad_platforms(platforms: list[str]) -> list[str]:
    cleaned = []
    for platform in platforms:
        normalized = platform.strip().lower()
        if normalized and normalized not in cleaned:
            cleaned.append(normalized)
    invalid = [platform for platform in cleaned if platform not in VALID_AD_PLATFORMS]
    if invalid:
        raise HTTPException(status_code=422, detail=f"Unsupported ad platform: {', '.join(invalid)}")
    if not cleaned:
        raise HTTPException(status_code=422, detail="At least one ad platform is required.")
    return cleaned


def _normalize_ad_objective(objective: str) -> str:
    normalized = objective.strip().lower()
    if normalized not in VALID_AD_OBJECTIVES:
        raise HTTPException(status_code=422, detail="Unsupported ad objective.")
    return normalized


def _normalize_ad_campaign_status(status: str) -> str:
    normalized = status.strip().lower()
    if normalized not in VALID_AD_CAMPAIGN_STATUSES:
        raise HTTPException(status_code=422, detail="Unsupported ad campaign status.")
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


def _ad_campaign_dict(campaign: AdCampaign) -> dict:
    return {
        "id": campaign.id,
        "name": campaign.name,
        "objective": campaign.objective,
        "platforms": campaign.platforms or [],
        "audience": campaign.audience,
        "location": campaign.location,
        "creative_message": campaign.creative_message,
        "link_url": campaign.link_url,
        "image_url": campaign.image_url,
        "daily_budget": round(float(campaign.daily_budget or 0), 2),
        "lifetime_budget": round(float(campaign.lifetime_budget or 0), 2),
        "start_date": campaign.start_date.isoformat() if campaign.start_date else None,
        "end_date": campaign.end_date.isoformat() if campaign.end_date else None,
        "status": campaign.status,
        "created_at": campaign.created_at.isoformat() if campaign.created_at else None,
    }


def _message_destination(customer: Customer, channel: str) -> Optional[str]:
    if channel == "email":
        return customer.email.strip() if customer.email else None
    if channel == "whatsapp":
        phone = _whatsapp_phone(customer.phone or "")
        return phone or None
    if channel == "sms":
        return customer.phone.strip() if customer.phone else None
    return None

def _whatsapp_phone(value: str) -> str:
    return "".join(character for character in value if character.isdigit())

def _action_url(channel: str, destination: str, message: str, promo: Promotion) -> str:
    encoded_message = quote(message, safe="")
    if channel == "whatsapp":
        return f"https://wa.me/{destination}?text={encoded_message}"
    if channel == "sms":
        return f"sms:{destination}?&body={encoded_message}"
    subject = quote(promo.name, safe="")
    return f"mailto:{destination}?subject={subject}&body={encoded_message}"

def _dispatch_contact(customer: Customer, promo: Promotion) -> dict:
    message = _render_message(promo, customer)
    destination = _message_destination(customer, promo.channel)
    send_ready = bool(destination)
    missing_reason = None
    action_url = None
    if send_ready:
        action_url = _action_url(promo.channel, destination, message, promo)
    else:
        missing_reason = "Missing email address" if promo.channel == "email" else "Missing phone number"

    return {
        **_customer_dict(customer),
        "message": message,
        "destination": destination,
        "action_url": action_url,
        "send_ready": send_ready,
        "missing_reason": missing_reason,
    }

def _delivery_dict(delivery: CampaignDelivery) -> dict:
    return {
        "id": delivery.id,
        "promotion_id": delivery.promotion_id,
        "customer_id": delivery.customer_id,
        "channel": delivery.channel,
        "destination": delivery.destination,
        "provider": delivery.provider,
        "status": delivery.status,
        "external_id": delivery.external_id,
        "error": delivery.error,
        "dry_run": delivery.dry_run,
        "attempted_at": delivery.attempted_at.isoformat() if delivery.attempted_at else None,
    }

def _delivery_counts(deliveries: list[CampaignDelivery]) -> dict:
    return {
        "attempted_count": len(deliveries),
        "sent_count": sum(1 for delivery in deliveries if delivery.status == "sent"),
        "dry_run_count": sum(1 for delivery in deliveries if delivery.status == "dry_run"),
        "failed_count": sum(1 for delivery in deliveries if delivery.status == "failed"),
        "skipped_count": sum(1 for delivery in deliveries if delivery.status == "skipped"),
    }


def _coupon_orders_query(db: Session, promo: Promotion):
    query = db.query(RestaurantOrder)
    if not promo.code:
        return query.filter(RestaurantOrder.id == -1)
    return query.filter(RestaurantOrder.notes.like(f"%Coupon: {promo.code}%"))


def _promotion_window(promo: Promotion) -> dict:
    today = date.today()
    total_days = max((promo.end_date - promo.start_date).days + 1, 1)
    elapsed_days = min(max((today - promo.start_date).days + 1, 0), total_days)
    remaining_days = max((promo.end_date - today).days, 0)
    if today < promo.start_date:
        phase = "upcoming"
    elif today > promo.end_date:
        phase = "ended"
    else:
        phase = "live"
    return {
        "start_date": promo.start_date.isoformat(),
        "end_date": promo.end_date.isoformat(),
        "total_days": total_days,
        "elapsed_days": elapsed_days,
        "remaining_days": remaining_days,
        "phase": phase,
    }


def _promotion_performance_payload(db: Session, promo: Promotion) -> dict:
    avg_sale, total_revenue = (
        db.query(func.avg(DailySales.total_sale), func.sum(DailySales.total_sale))
        .filter(DailySales.date.between(promo.start_date, promo.end_date))
        .one()
    )
    coupon_orders = _coupon_orders_query(db, promo).all()
    delivery_rows = (
        db.query(CampaignDelivery)
        .filter(CampaignDelivery.promotion_id == promo.id)
        .all()
    )
    social_posts = (
        db.query(SocialPost)
        .filter(SocialPost.title.like(f"%{promo.name}%"))
        .all()
    )
    ad_campaigns = (
        db.query(AdCampaign)
        .filter(AdCampaign.name.like(f"%{promo.name}%"))
        .all()
    )
    ad_campaign_ids = [campaign.id for campaign in ad_campaigns]
    ad_launches = []
    if ad_campaign_ids:
        ad_launches = (
            db.query(AdCampaignLaunch)
            .filter(AdCampaignLaunch.campaign_id.in_(ad_campaign_ids))
            .all()
        )

    redemption_revenue = round(sum(float(order.total_amount or 0) for order in coupon_orders), 2)
    redemption_discount = round(sum(float(order.discount_amount or 0) for order in coupon_orders), 2)
    redemption_subtotal = round(sum(float(order.subtotal or 0) for order in coupon_orders), 2)
    unique_customer_phones = {
        (order.customer_phone or "").strip()
        for order in coupon_orders
        if (order.customer_phone or "").strip()
    }
    first_redemption = min(
        [order.created_at for order in coupon_orders if order.created_at],
        default=None,
    )
    last_redemption = max(
        [order.created_at for order in coupon_orders if order.created_at],
        default=None,
    )
    delivery_counts = _delivery_counts(delivery_rows)
    delivery_attempts = max(delivery_counts["sent_count"] + delivery_counts["dry_run_count"], 0)
    ad_spend = round(sum(float(campaign.spend or 0) for campaign in ad_campaigns), 2)
    ad_revenue = round(sum(float(campaign.revenue or 0) for campaign in ad_campaigns), 2)
    planned_budget = round(
        sum(float(campaign.daily_budget or campaign.lifetime_budget or 0) for campaign in ad_campaigns),
        2,
    )

    return {
        "promotion": promo.name,
        "promotion_detail": _promotion_dict(promo),
        "campaign_window": _promotion_window(promo),
        "avg_daily_sale_during": float(avg_sale or 0),
        "total_revenue_during": float(total_revenue or 0),
        "redemption_count": len(coupon_orders),
        "redemption_revenue": redemption_revenue,
        "redemption_discount": redemption_discount,
        "sales": {
            "avg_daily_sale_during": round(float(avg_sale or 0), 2),
            "total_revenue_during": round(float(total_revenue or 0), 2),
        },
        "redemptions": {
            "count": len(coupon_orders),
            "subtotal_before_discount": redemption_subtotal,
            "revenue": redemption_revenue,
            "discount": redemption_discount,
            "average_order_value": round(redemption_revenue / len(coupon_orders), 2)
            if coupon_orders
            else 0,
            "unique_customers": len(unique_customer_phones),
            "first_order_at": first_redemption.isoformat() if first_redemption else None,
            "last_order_at": last_redemption.isoformat() if last_redemption else None,
        },
        "outreach": {
            **delivery_counts,
            "conversion_rate_percent": round((len(coupon_orders) / delivery_attempts) * 100, 2)
            if delivery_attempts
            else 0,
        },
        "social": {
            "post_count": len(social_posts),
            "ready_count": sum(1 for post in social_posts if post.status == "ready"),
            "scheduled_count": sum(1 for post in social_posts if post.status == "scheduled"),
            "latest_post_id": max([post.id for post in social_posts], default=None),
        },
        "ads": {
            "campaign_count": len(ad_campaigns),
            "planned_budget": planned_budget,
            "spend": ad_spend,
            "reported_revenue": ad_revenue,
            "roas": round(ad_revenue / ad_spend, 2) if ad_spend else 0,
            "launch_count": len(ad_launches),
            "latest_campaign_id": max(ad_campaign_ids, default=None),
        },
    }


@router.post("/")
def create_promotion(promo: PromotionCreate, db: Session = Depends(get_db)):
    start_date, end_date = _validate_promotion_payload(promo)
    code = _normalize_code(promo.code)
    if code:
        existing = db.query(Promotion).filter(Promotion.code == code).first()
        if existing:
            raise HTTPException(status_code=409, detail="Promotion code already exists.")

    db_promo = Promotion(
        name=promo.name.strip(),
        code=code,
        start_date=start_date,
        end_date=end_date,
        description=promo.description,
        discount_type=promo.discount_type,
        discount_value=promo.discount_value,
        audience=promo.audience,
        channel=promo.channel,
        status=promo.status,
        message_template=promo.message_template,
    )
    db.add(db_promo)
    db.commit()
    db.refresh(db_promo)
    return {"status": "promotion created", "promotion": _promotion_dict(db_promo)}

@router.get("/")
def list_promotions(db: Session = Depends(get_db)):
    promotions = db.query(Promotion).order_by(Promotion.start_date.desc()).all()
    return [_promotion_dict(promo) for promo in promotions]

@router.get("/active")
def active_promotions(db: Session = Depends(get_db)):
    today = date.today()
    promotions = (
        db.query(Promotion)
        .filter(Promotion.start_date <= today, Promotion.end_date >= today)
        .filter(Promotion.status.in_(["active", "scheduled"]))
        .order_by(Promotion.end_date.asc())
        .all()
    )
    return [_promotion_dict(promo) for promo in promotions]

@router.post("/validate-code")
def validate_coupon(payload: CouponValidationRequest, db: Session = Depends(get_db)):
    code = _normalize_code(payload.code)
    promo = db.query(Promotion).filter(Promotion.code == code).first()
    if not promo:
        raise HTTPException(status_code=404, detail="Coupon code not found.")

    today = date.today()
    if promo.start_date > today or promo.end_date < today:
        raise HTTPException(status_code=409, detail="Coupon is not active today.")
    if promo.status not in {"active", "scheduled"}:
        raise HTTPException(status_code=409, detail="Coupon is not active.")

    discount = _calculate_discount(promo, payload.subtotal)
    taxable_subtotal = max(round(payload.subtotal - discount, 2), 0)
    tax = round(taxable_subtotal * 0.05, 2)
    total = round(taxable_subtotal + tax, 2)
    return {
        "valid": True,
        "promotion": _promotion_dict(promo),
        "subtotal": round(payload.subtotal, 2),
        "discount": discount,
        "tax": tax,
        "total": total,
    }

@router.get("/audience")
def audience_summary(
    audience: str = Query("marketing_opt_in"),
    limit: int = Query(25, ge=1, le=200),
    db: Session = Depends(get_db),
):
    query = _audience_query(db, audience)
    total = query.count()
    customers = (
        query.order_by(Customer.last_order_at.desc().nullslast(), Customer.id.desc())
        .limit(limit)
        .all()
    )
    return {
        "audience": audience,
        "total_contacts": total,
        "customers": [_customer_dict(customer) for customer in customers],
    }


@router.get("/providers/status")
def campaign_provider_statuses():
    channels = ["whatsapp", "sms", "email"]
    statuses = [campaign_provider_status(channel) for channel in channels]
    return {
        "send_enabled": all(status["enabled"] for status in statuses),
        "configured_count": sum(1 for status in statuses if status["configured"]),
        "channels": statuses,
    }


@router.get("/performance")
def promotion_performance_rollup(
    limit: int = Query(20, ge=1, le=100),
    db: Session = Depends(get_db),
):
    promotions = (
        db.query(Promotion)
        .order_by(Promotion.start_date.desc(), Promotion.id.desc())
        .limit(limit)
        .all()
    )
    rows = [_promotion_performance_payload(db, promo) for promo in promotions]
    rows.sort(
        key=lambda row: (
            row["redemptions"]["revenue"],
            row["redemptions"]["count"],
            row["promotion_detail"]["id"],
        ),
        reverse=True,
    )
    total_revenue = round(sum(row["redemptions"]["revenue"] for row in rows), 2)
    total_discount = round(sum(row["redemptions"]["discount"] for row in rows), 2)
    total_orders = sum(row["redemptions"]["count"] for row in rows)
    total_unique_customers = sum(row["redemptions"]["unique_customers"] for row in rows)
    total_social_posts = sum(row["social"]["post_count"] for row in rows)
    total_ad_campaigns = sum(row["ads"]["campaign_count"] for row in rows)
    planned_ad_budget = round(sum(row["ads"]["planned_budget"] for row in rows), 2)

    return {
        "summary": {
            "campaign_count": len(rows),
            "redemption_orders": total_orders,
            "redemption_revenue": total_revenue,
            "redemption_discount": total_discount,
            "average_order_value": round(total_revenue / total_orders, 2)
            if total_orders
            else 0,
            "unique_customers": total_unique_customers,
            "social_post_count": total_social_posts,
            "ad_campaign_count": total_ad_campaigns,
            "planned_ad_budget": planned_ad_budget,
        },
        "best_campaign": rows[0] if rows else None,
        "campaigns": rows,
    }


@router.get("/performance/{promo_id}")
def promotion_performance(promo_id: int, db: Session = Depends(get_db)):
    promo = db.get(Promotion, promo_id)
    if not promo:
        raise HTTPException(status_code=404, detail="Promotion not found")
    return _promotion_performance_payload(db, promo)

@router.get("/{promo_id}/outreach")
def promotion_outreach(
    promo_id: int,
    limit: int = Query(50, ge=1, le=500),
    db: Session = Depends(get_db),
):
    promo = db.get(Promotion, promo_id)
    if not promo:
        raise HTTPException(status_code=404, detail="Promotion not found")

    query = _audience_query(db, promo.audience or "marketing_opt_in")
    total = query.count()
    contacts = (
        query.order_by(Customer.last_order_at.desc().nullslast(), Customer.id.desc())
        .limit(limit)
        .all()
    )
    return {
        "promotion": _promotion_dict(promo),
        "audience": promo.audience,
        "audience_count": total,
        "channel": promo.channel,
        "message_preview": _render_message(promo, contacts[0] if contacts else None),
        "contacts": [
            {
                **_customer_dict(customer),
                "message": _render_message(promo, customer),
            }
            for customer in contacts
        ],
    }

@router.get("/{promo_id}/dispatch")
def promotion_dispatch(
    promo_id: int,
    limit: int = Query(50, ge=1, le=500),
    db: Session = Depends(get_db),
):
    promo = db.get(Promotion, promo_id)
    if not promo:
        raise HTTPException(status_code=404, detail="Promotion not found")

    query = _audience_query(db, promo.audience or "marketing_opt_in")
    total = query.count()
    customers = (
        query.order_by(Customer.last_order_at.desc().nullslast(), Customer.id.desc())
        .limit(limit)
        .all()
    )
    contacts = [_dispatch_contact(customer, promo) for customer in customers]
    send_ready_count = sum(1 for contact in contacts if contact["send_ready"])
    missing_destination_count = len(contacts) - send_ready_count

    return {
        "promotion": _promotion_dict(promo),
        "audience": promo.audience,
        "audience_count": total,
        "channel": promo.channel,
        "provider_status": campaign_provider_status(promo.channel),
        "message_preview": _render_message(promo, customers[0] if customers else None),
        "send_ready_count": send_ready_count,
        "missing_destination_count": missing_destination_count,
        "contacts": contacts,
    }


@router.post("/{promo_id}/social-post")
def create_social_post_from_promotion(
    promo_id: int,
    payload: PromotionSocialPostCreate,
    db: Session = Depends(get_db),
):
    promo = db.get(Promotion, promo_id)
    if not promo:
        raise HTTPException(status_code=404, detail="Promotion not found")

    post = SocialPost(
        title=(payload.title or f"Pizza Blitz Offer: {promo.name}").strip(),
        message=_render_social_message(promo, payload.message_template).strip(),
        link_url=(payload.link_url or "").strip() or None,
        image_url=(payload.image_url or "").strip() or None,
        platforms=_normalize_social_platforms(payload.platforms),
        status=_normalize_social_post_status(payload.status),
        scheduled_at=_parse_optional_datetime(payload.scheduled_at),
    )
    db.add(post)
    db.commit()
    db.refresh(post)
    return {
        "status": "social post created",
        "promotion": _promotion_dict(promo),
        "post": _social_post_dict(post),
    }


@router.post("/{promo_id}/ad-campaign")
def create_ad_campaign_from_promotion(
    promo_id: int,
    payload: PromotionAdCampaignCreate,
    db: Session = Depends(get_db),
):
    promo = db.get(Promotion, promo_id)
    if not promo:
        raise HTTPException(status_code=404, detail="Promotion not found")

    start_date = _parse_optional_ad_date(payload.start_date) or promo.start_date
    end_date = _parse_optional_ad_date(payload.end_date) or promo.end_date
    if start_date and end_date and end_date < start_date:
        raise HTTPException(status_code=422, detail="End date cannot be before start date.")

    campaign = AdCampaign(
        name=(payload.name or f"Pizza Blitz Ad: {promo.name}").strip(),
        objective=_normalize_ad_objective(payload.objective),
        platforms=_normalize_ad_platforms(payload.platforms),
        audience=(payload.audience or "").strip() or None,
        location=(payload.location or "").strip() or None,
        creative_message=_render_ad_message(promo, payload.creative_template).strip(),
        link_url=(payload.link_url or "").strip() or None,
        image_url=(payload.image_url or "").strip() or None,
        daily_budget=payload.daily_budget,
        lifetime_budget=payload.lifetime_budget,
        start_date=start_date,
        end_date=end_date,
        status=_normalize_ad_campaign_status(payload.status),
    )
    db.add(campaign)
    db.commit()
    db.refresh(campaign)
    return {
        "status": "ad campaign created",
        "promotion": _promotion_dict(promo),
        "campaign": _ad_campaign_dict(campaign),
    }


@router.post("/{promo_id}/send")
def send_promotion_campaign(
    promo_id: int,
    payload: CampaignSendRequest,
    db: Session = Depends(get_db),
):
    promo = db.get(Promotion, promo_id)
    if not promo:
        raise HTTPException(status_code=404, detail="Promotion not found")
    if promo.status not in {"active", "scheduled"} and not payload.force_resend:
        raise HTTPException(
            status_code=409,
            detail="Only active or scheduled campaigns can be sent.",
        )

    customers = (
        _audience_query(db, promo.audience or "marketing_opt_in")
        .order_by(Customer.last_order_at.desc().nullslast(), Customer.id.desc())
        .limit(payload.limit)
        .all()
    )
    deliveries: list[CampaignDelivery] = []
    provider_status = campaign_provider_status(promo.channel)

    for customer in customers:
        contact = _dispatch_contact(customer, promo)
        destination = normalize_campaign_destination(promo.channel, contact["destination"])
        message = contact["message"]
        delivery_kwargs = {
            "promotion_id": promo.id,
            "customer_id": customer.id,
            "channel": promo.channel,
            "destination": destination or contact["destination"],
            "message": message,
            "attempted_at": datetime.utcnow(),
        }

        if not contact["send_ready"] or not destination:
            delivery = CampaignDelivery(
                **delivery_kwargs,
                provider=provider_status["provider"],
                status="skipped",
                error=contact["missing_reason"] or "Missing destination",
                dry_run=payload.dry_run,
                response_payload={"provider_status": provider_status},
            )
        else:
            existing_sent = None
            if not payload.force_resend:
                existing_sent = (
                    db.query(CampaignDelivery)
                    .filter(CampaignDelivery.promotion_id == promo.id)
                    .filter(CampaignDelivery.customer_id == customer.id)
                    .filter(CampaignDelivery.status == "sent")
                    .first()
                )
            if existing_sent:
                delivery = CampaignDelivery(
                    **delivery_kwargs,
                    provider=existing_sent.provider,
                    status="skipped",
                    error=f"Already sent in delivery #{existing_sent.id}",
                    response_payload={"previous_delivery_id": existing_sent.id},
                )
            elif payload.dry_run:
                delivery = CampaignDelivery(
                    **delivery_kwargs,
                    provider="dry_run",
                    status="dry_run",
                    dry_run=True,
                    response_payload={"provider_status": provider_status},
                )
            else:
                result = send_campaign_message(
                    channel=promo.channel,
                    destination=destination,
                    message=message,
                    subject=promo.name,
                )
                delivery = CampaignDelivery(
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

    if payload.mark_completed and deliveries and not any(
        delivery.status == "failed" for delivery in deliveries
    ):
        promo.status = "completed"

    db.commit()
    for delivery in deliveries:
        db.refresh(delivery)
    return {
        "promotion": _promotion_dict(promo),
        "provider_status": provider_status,
        "channel": promo.channel,
        "dry_run": payload.dry_run,
        **_delivery_counts(deliveries),
        "deliveries": [_delivery_dict(delivery) for delivery in deliveries],
    }

@router.get("/{promo_id}/deliveries")
def promotion_deliveries(
    promo_id: int,
    limit: int = Query(50, ge=1, le=500),
    db: Session = Depends(get_db),
):
    promo = db.get(Promotion, promo_id)
    if not promo:
        raise HTTPException(status_code=404, detail="Promotion not found")

    deliveries = (
        db.query(CampaignDelivery)
        .filter(CampaignDelivery.promotion_id == promo.id)
        .order_by(CampaignDelivery.attempted_at.desc(), CampaignDelivery.id.desc())
        .limit(limit)
        .all()
    )
    return {
        "promotion": _promotion_dict(promo),
        **_delivery_counts(deliveries),
        "deliveries": [_delivery_dict(delivery) for delivery in deliveries],
    }
