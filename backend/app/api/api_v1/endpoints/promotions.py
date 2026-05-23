import csv
import io
import os

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session
from sqlalchemy import func
from app.api.deps import get_db, require_roles
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
from datetime import date, datetime, timedelta
from urllib.parse import quote

router = APIRouter()

VALID_DISCOUNT_TYPES = {"percentage", "fixed"}
RETENTION_AUDIENCE_ORDER = [
    "new_guests",
    "regular_guests",
    "vip_guests",
    "active_customers",
    "comeback_customers",
    "win_back_customers",
]
RETENTION_AUDIENCES = set(RETENTION_AUDIENCE_ORDER)
VALID_AUDIENCES = {
    "all_customers",
    "marketing_opt_in",
    "repeat_customers",
    "high_spenders",
    *RETENTION_AUDIENCES,
}
CHANNEL_ORDER = ["whatsapp", "sms", "email"]
VALID_CHANNELS = set(CHANNEL_ORDER)
VALID_STATUSES = {"draft", "scheduled", "active", "paused", "completed"}
VALID_SOCIAL_PLATFORMS = {"facebook", "instagram"}
VALID_SOCIAL_POST_STATUSES = {"draft", "scheduled", "ready"}
VALID_AD_OBJECTIVES = {"awareness", "traffic", "engagement", "leads", "sales"}
VALID_AD_PLATFORMS = {"facebook", "instagram"}
VALID_AD_CAMPAIGN_STATUSES = {"draft", "planned", "ready"}
VALID_DELIVERY_REASON_FILTERS = {
    "consent",
    "missing_destination",
    "already_sent",
    "provider",
    "needs_review",
}
DEFAULT_MESSAGE_TEMPLATE = (
    "Hi {name}, Pizza Blitz has {offer} for you. Use code {code} before {end_date}. "
    "Order here: {order_link}"
)
DEFAULT_SOCIAL_MESSAGE_TEMPLATE = (
    "{promo_name} at Pizza Blitz: {offer}. Use code {code} before {end_date}. "
    "Order online or visit us today."
)
DEFAULT_AD_MESSAGE_TEMPLATE = (
    "{promo_name} at Pizza Blitz: {offer}. Use code {code} before {end_date}. "
    "Order online now."
)
RETENTION_PLAYBOOK = {
    "new_guests": {
        "label": "New Guests",
        "intent": "Move first-time buyers toward a second and third order.",
        "name": "Second Slice Nudge",
        "description": "A light welcome-back coupon for customers still forming a habit.",
        "discount_type": "percentage",
        "discount_value": 10,
        "channel": "whatsapp",
        "code_prefix": "NEW",
        "message_template": "Hi {name}, welcome back to Pizza Blitz. Your next-slice offer is {offer}. Use {code} before {end_date}. Order here: {order_link}",
    },
    "regular_guests": {
        "label": "Regular Guests",
        "intent": "Reward repeat buyers and push bundle behavior.",
        "name": "Regular Guest Bundle",
        "description": "A loyalty bundle offer for repeat customers.",
        "discount_type": "percentage",
        "discount_value": 12,
        "channel": "email",
        "code_prefix": "REG",
        "message_template": "Hi {name}, your Pizza Blitz regular guest reward is {offer}. Use {code} before {end_date}. Order here: {order_link}",
    },
    "vip_guests": {
        "label": "VIP Guests",
        "intent": "Invite the highest-value customers into premium party packs.",
        "name": "VIP Party Pack Invite",
        "description": "A premium offer for top spenders and frequent guests.",
        "discount_type": "percentage",
        "discount_value": 18,
        "channel": "email",
        "code_prefix": "VIP",
        "message_template": "Hi {name}, your VIP Pizza Blitz party-pack offer is {offer}. Use {code} before {end_date}. Order here: {order_link}",
    },
    "active_customers": {
        "label": "Active This Week",
        "intent": "Use fresh purchase intent to add sides, drinks, or dessert.",
        "name": "This Week Add-on Boost",
        "description": "A timely add-on offer for customers who ordered recently.",
        "discount_type": "percentage",
        "discount_value": 8,
        "channel": "whatsapp",
        "code_prefix": "ADD",
        "message_template": "Hi {name}, complete this week's Pizza Blitz craving with {offer}. Use {code} before {end_date}. Order here: {order_link}",
    },
    "comeback_customers": {
        "label": "Comeback Due",
        "intent": "Bring customers back before they become cold leads.",
        "name": "Comeback Craving Reminder",
        "description": "A stronger reminder for customers who have not ordered recently.",
        "discount_type": "percentage",
        "discount_value": 15,
        "channel": "sms",
        "code_prefix": "BACK",
        "message_template": "Hi {name}, Pizza Blitz misses you. Come back with {offer}. Use {code} before {end_date}. Order here: {order_link}",
    },
    "win_back_customers": {
        "label": "Win-back Priority",
        "intent": "Recover cold customers with the strongest controlled offer.",
        "name": "Win-back Big Slice",
        "description": "A high-priority recovery offer for customers at risk of churn.",
        "discount_type": "percentage",
        "discount_value": 20,
        "channel": "whatsapp",
        "code_prefix": "WIN",
        "message_template": "Hi {name}, here is a Pizza Blitz win-back treat: {offer}. Use {code} before {end_date}. Order here: {order_link}",
    },
}

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


class RetentionCampaignCreate(BaseModel):
    status: str = "active"
    duration_days: int = Field(7, ge=1, le=60)
    name: Optional[str] = None
    code: Optional[str] = None


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


def _audience_label(value: Optional[str]) -> str:
    return (value or "marketing_opt_in").replace("_", " ").title()


def _public_site_url() -> str:
    return (
        os.getenv("PIZZA_BLITZ_PUBLIC_BASE_URL")
        or os.getenv("PUBLIC_SITE_URL")
        or "http://127.0.0.1:3011"
    ).strip().rstrip("/")


def _order_offer_link(promo: Promotion) -> str:
    order_url = f"{_public_site_url()}/order"
    if promo.code:
        return f"{order_url}?coupon={quote(promo.code, safe='')}"
    return order_url


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
    now = datetime.utcnow()
    comeback_after = now - timedelta(days=7)
    win_back_after = now - timedelta(days=30)
    if audience == "marketing_opt_in":
        query = query.filter(Customer.opt_in_marketing.is_(True))
    elif audience == "repeat_customers":
        query = query.filter(Customer.total_orders >= 2)
    elif audience == "high_spenders":
        query = query.filter(Customer.total_spend >= 500)
    elif audience == "new_guests":
        query = query.filter(Customer.total_orders < 3, Customer.total_spend < 1200)
    elif audience == "regular_guests":
        query = query.filter(
            (Customer.total_orders >= 3) | (Customer.total_spend >= 1200),
            Customer.total_orders < 10,
            Customer.total_spend < 5000,
        )
    elif audience == "vip_guests":
        query = query.filter((Customer.total_orders >= 10) | (Customer.total_spend >= 5000))
    elif audience == "active_customers":
        query = query.filter(Customer.last_order_at >= comeback_after)
    elif audience == "comeback_customers":
        query = query.filter(
            Customer.last_order_at < comeback_after,
            Customer.last_order_at >= win_back_after,
        )
    elif audience == "win_back_customers":
        query = query.filter((Customer.last_order_at < win_back_after) | Customer.last_order_at.is_(None))
    elif audience != "all_customers":
        raise HTTPException(status_code=422, detail="Unsupported campaign audience.")
    return query

def _render_message(promo: Promotion, customer: Optional[Customer] = None) -> str:
    template = promo.message_template or DEFAULT_MESSAGE_TEMPLATE
    order_link = _order_offer_link(promo)
    values = {
        "name": customer.name if customer and customer.name else "Pizza Lover",
        "offer": _offer_label(promo),
        "code": promo.code or "PIZZABLITZ",
        "end_date": promo.end_date.isoformat(),
        "promo_name": promo.name,
        "order_link": order_link,
    }
    try:
        message = template.format(**values).strip()
        if promo.code and order_link not in message:
            message = f"{message} Order here: {order_link}"
        return message
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
        "order_link": _order_offer_link(promo),
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
        "order_link": _order_offer_link(promo),
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

def _customer_marketing_block_reason(customer: Customer) -> Optional[str]:
    if customer.opt_in_marketing:
        return None
    return "Marketing consent not granted"

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
    order_link = _order_offer_link(promo)
    missing_reason = _customer_marketing_block_reason(customer)
    destination = None
    send_ready = False
    action_url = None
    if not missing_reason:
        raw_destination = _message_destination(customer, promo.channel)
        destination = normalize_campaign_destination(promo.channel, raw_destination)
        send_ready = bool(destination)
        if send_ready:
            action_url = _action_url(promo.channel, destination, message, promo)
        else:
            missing_reason = "Missing email address" if promo.channel == "email" else "Missing phone number"

    return {
        **_customer_dict(customer),
        "message": message,
        "order_link": order_link,
        "destination": destination,
        "action_url": action_url,
        "send_ready": send_ready,
        "missing_reason": missing_reason,
        "suppressed": bool(_customer_marketing_block_reason(customer)),
    }


def _readiness_percent(ready_count: int, total_count: int) -> float:
    if not total_count:
        return 0
    return round((ready_count / total_count) * 100, 2)


def _channel_readiness(customers: list[Customer], channel: str) -> dict:
    total_count = len(customers)
    suppressed_count = sum(1 for customer in customers if _customer_marketing_block_reason(customer))
    ready_count = sum(
        1
        for customer in customers
        if not _customer_marketing_block_reason(customer)
        and normalize_campaign_destination(channel, _message_destination(customer, channel))
    )
    destination_missing_count = sum(
        1
        for customer in customers
        if not _customer_marketing_block_reason(customer)
        and not normalize_campaign_destination(channel, _message_destination(customer, channel))
    )
    return {
        "ready_count": ready_count,
        "missing_count": max(total_count - ready_count, 0),
        "destination_missing_count": destination_missing_count,
        "suppressed_count": suppressed_count,
        "ready_percent": _readiness_percent(ready_count, total_count),
    }


def _audience_hygiene(customers: list[Customer]) -> dict:
    total_count = len(customers)
    channel_readiness = {
        channel: _channel_readiness(customers, channel)
        for channel in CHANNEL_ORDER
    }
    recommended_channel = None
    if total_count:
        recommended_channel = max(
            CHANNEL_ORDER,
            key=lambda channel: (
                channel_readiness[channel]["ready_count"],
                channel_readiness[channel]["ready_percent"],
                -CHANNEL_ORDER.index(channel),
            ),
        )
        if channel_readiness[recommended_channel]["ready_count"] == 0:
            recommended_channel = None

    opted_in_count = sum(1 for customer in customers if customer.opt_in_marketing)
    opted_out_count = max(total_count - opted_in_count, 0)
    phone_ready_count = sum(
        1
        for customer in customers
        if not _customer_marketing_block_reason(customer)
        and (
            normalize_campaign_destination("sms", _message_destination(customer, "sms"))
            or normalize_campaign_destination("whatsapp", _message_destination(customer, "whatsapp"))
        )
    )
    notes = []
    if opted_out_count:
        notes.append(f"{opted_out_count} contacts are opted out and should not receive marketing sends.")
    if channel_readiness["email"]["missing_count"]:
        notes.append(f"Capture email for {channel_readiness['email']['missing_count']} contacts before email campaigns.")
    if total_count - phone_ready_count:
        notes.append(f"Capture phone for {total_count - phone_ready_count} contacts before SMS or WhatsApp campaigns.")
    if not notes and total_count:
        notes.append("Audience hygiene is ready for the selected channel mix.")
    if not total_count:
        notes.append("No matching contacts are available for this audience yet.")

    return {
        "opted_in_count": opted_in_count,
        "opted_out_count": opted_out_count,
        "email_ready_count": channel_readiness["email"]["ready_count"],
        "missing_email_count": channel_readiness["email"]["missing_count"],
        "phone_ready_count": phone_ready_count,
        "missing_phone_count": max(total_count - phone_ready_count, 0),
        "channels": channel_readiness,
        "recommended_channel": recommended_channel,
        "readiness_notes": notes,
    }


def _retention_playbook_entry(db: Session, audience: str) -> dict:
    if audience not in RETENTION_PLAYBOOK:
        raise HTTPException(status_code=422, detail="Unsupported retention playbook audience.")

    template = RETENTION_PLAYBOOK[audience]
    query = _audience_query(db, audience)
    customers = query.order_by(Customer.last_order_at.desc().nullslast(), Customer.id.desc()).all()
    sample_customers = customers[:5]
    channel = template["channel"]
    send_ready_count = sum(
        1
        for customer in customers
        if not _customer_marketing_block_reason(customer)
        and normalize_campaign_destination(channel, _message_destination(customer, channel))
    )
    audience_count = len(customers)
    return {
        "audience": audience,
        "label": template["label"],
        "intent": template["intent"],
        "audience_count": audience_count,
        "send_ready_count": send_ready_count,
        "missing_destination_count": max(audience_count - send_ready_count, 0),
        "recommended_campaign": {
            "name": template["name"],
            "description": template["description"],
            "discount_type": template["discount_type"],
            "discount_value": template["discount_value"],
            "audience": audience,
            "channel": channel,
            "status": "active",
            "duration_days": 7,
            "message_template": template["message_template"],
        },
        "sample_customers": [_customer_dict(customer) for customer in sample_customers],
    }


def _unique_retention_code(db: Session, prefix: str) -> str:
    clean_prefix = "".join(character for character in prefix.upper() if character.isalnum())[:6] or "PB"
    suffix = datetime.utcnow().strftime("%H%M%S")
    code = f"{clean_prefix}{suffix}"
    counter = 1
    while db.query(Promotion).filter(Promotion.code == code).first():
        code = f"{clean_prefix}{suffix}{counter}"
        counter += 1
    return code


def _delivery_dict(delivery: CampaignDelivery) -> dict:
    customer = delivery.customer
    return {
        "id": delivery.id,
        "promotion_id": delivery.promotion_id,
        "customer_id": delivery.customer_id,
        "customer": _customer_dict(customer) if customer else None,
        "channel": delivery.channel,
        "destination": delivery.destination,
        "provider": delivery.provider,
        "status": delivery.status,
        "external_id": delivery.external_id,
        "error": delivery.error,
        "dry_run": delivery.dry_run,
        "retryable": delivery.status in {"failed", "skipped"},
        "recovery_action": _delivery_recovery_action(delivery),
        "attempted_at": delivery.attempted_at.isoformat() if delivery.attempted_at else None,
    }

def _delivery_counts(deliveries: list[CampaignDelivery]) -> dict:
    return {
        "attempted_count": len(deliveries),
        "sent_count": sum(1 for delivery in deliveries if delivery.status == "sent"),
        "dry_run_count": sum(1 for delivery in deliveries if delivery.status == "dry_run"),
        "failed_count": sum(1 for delivery in deliveries if delivery.status == "failed"),
        "skipped_count": sum(1 for delivery in deliveries if delivery.status == "skipped"),
        "needs_attention_count": sum(
            1 for delivery in deliveries if delivery.status in {"failed", "skipped"}
        ),
        "retryable_count": sum(1 for delivery in deliveries if delivery.status == "failed"),
    }


def _delivery_issue_reason(delivery: CampaignDelivery) -> str:
    error = (delivery.error or "").lower()
    if "consent" in error:
        return "consent"
    if "already sent" in error:
        return "already_sent"
    if (
        "missing email" in error
        or "missing phone" in error
        or "missing destination" in error
        or "destination" in error
    ):
        return "missing_destination"
    if delivery.status == "failed" or "provider" in error or "configured" in error:
        return "provider"
    if delivery.status in {"skipped", "pending"}:
        return "needs_review"
    return "none"


def _delivery_audit_counts(deliveries: list[CampaignDelivery]) -> dict:
    return {
        "consent_blocked_count": sum(
            1 for delivery in deliveries if _delivery_issue_reason(delivery) == "consent"
        ),
        "missing_destination_count": sum(
            1 for delivery in deliveries if _delivery_issue_reason(delivery) == "missing_destination"
        ),
        "already_sent_count": sum(
            1 for delivery in deliveries if _delivery_issue_reason(delivery) == "already_sent"
        ),
        "provider_issue_count": sum(
            1 for delivery in deliveries if _delivery_issue_reason(delivery) == "provider"
        ),
        "needs_review_count": sum(
            1 for delivery in deliveries if _delivery_issue_reason(delivery) == "needs_review"
        ),
    }


def _delivery_recovery_action(delivery: CampaignDelivery) -> str:
    if delivery.status == "sent":
        return "Delivered by provider."
    if delivery.status == "dry_run":
        return "Dry run passed; send live when provider setup is ready."
    if delivery.status == "failed":
        return "Retry after checking provider credentials or destination format."
    if delivery.status != "skipped":
        return "Monitor this pending delivery."
    error = (delivery.error or "").lower()
    if "consent" in error:
        return "Ask the customer to opt in before sending promotional messages."
    if "already sent" in error:
        return "Already sent; use Force Resend only for deliberate repeats."
    if delivery.channel == "email" or "email" in error:
        return "Add or correct the customer's email address."
    if delivery.channel in {"sms", "whatsapp"} or "phone" in error:
        return "Add or correct the customer's phone number."
    return "Review the skipped delivery before retrying."


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
    latest_social_post = max(social_posts, key=lambda post: post.id or 0, default=None)
    latest_ad_campaign = max(ad_campaigns, key=lambda campaign: campaign.id or 0, default=None)
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
            "latest_post": _social_post_dict(latest_social_post) if latest_social_post else None,
        },
        "ads": {
            "campaign_count": len(ad_campaigns),
            "planned_budget": planned_budget,
            "spend": ad_spend,
            "reported_revenue": ad_revenue,
            "roas": round(ad_revenue / ad_spend, 2) if ad_spend else 0,
            "launch_count": len(ad_launches),
            "latest_campaign_id": max(ad_campaign_ids, default=None),
            "latest_campaign": _ad_campaign_dict(latest_ad_campaign) if latest_ad_campaign else None,
        },
    }


def _timeline_event(
    *,
    event_id: str,
    event_type: str,
    title: str,
    status: str,
    timestamp: Optional[datetime],
    detail: str,
    metric: Optional[str] = None,
    href: Optional[str] = None,
) -> dict:
    return {
        "id": event_id,
        "type": event_type,
        "title": title,
        "status": status,
        "timestamp": timestamp.isoformat() if timestamp else None,
        "detail": detail,
        "metric": metric,
        "href": href,
    }


def _campaign_activity_payload(db: Session, promo: Promotion, limit: int) -> dict:
    campaign_event = _timeline_event(
        event_id=f"campaign-{promo.id}",
        event_type="campaign",
        title="Campaign created",
        status=promo.status,
        timestamp=promo.created_at,
        detail=f"{_offer_label(promo)} for {_audience_label(promo.audience)} via {promo.channel}.",
        metric=promo.code or "No code",
    )
    events = [campaign_event]

    deliveries = (
        db.query(CampaignDelivery)
        .filter(CampaignDelivery.promotion_id == promo.id)
        .order_by(CampaignDelivery.attempted_at.desc(), CampaignDelivery.id.desc())
        .limit(80)
        .all()
    )
    for delivery in deliveries:
        customer_name = delivery.customer.name if delivery.customer and delivery.customer.name else "Walk-in Customer"
        issue_reason = _delivery_issue_reason(delivery)
        event_type = "cleanup" if issue_reason in {"consent", "missing_destination"} else "delivery"
        if delivery.status == "dry_run":
            title = "Dry run ready"
        elif delivery.status == "sent":
            title = "Campaign sent"
        elif event_type == "cleanup":
            title = "Cleanup issue found"
        else:
            title = f"Delivery {delivery.status}"
        events.append(
            _timeline_event(
                event_id=f"delivery-{delivery.id}",
                event_type=event_type,
                title=title,
                status=delivery.status,
                timestamp=delivery.attempted_at,
                detail=f"{customer_name}: {delivery.error or _delivery_recovery_action(delivery)}",
                metric=delivery.destination or delivery.channel,
            )
        )

    coupon_orders = _coupon_orders_query(db, promo).order_by(RestaurantOrder.created_at.desc()).limit(40).all()
    for order in coupon_orders:
        events.append(
            _timeline_event(
                event_id=f"coupon-{order.id}",
                event_type="redemption",
                title="Coupon redeemed",
                status=order.status,
                timestamp=order.created_at,
                detail=f"{order.customer_name or 'Customer'} used {promo.code or 'campaign code'}.",
                metric=f"Rs {round(float(order.total_amount or 0))}",
                href=f"/orders?order={order.id}",
            )
        )

    social_posts = (
        db.query(SocialPost)
        .filter(SocialPost.title.like(f"%{promo.name}%"))
        .order_by(SocialPost.created_at.desc(), SocialPost.id.desc())
        .limit(20)
        .all()
    )
    for post in social_posts:
        events.append(
            _timeline_event(
                event_id=f"social-{post.id}",
                event_type="social",
                title="Social handoff created",
                status=post.status,
                timestamp=post.created_at,
                detail=f"{post.title} for {', '.join(post.platforms or []) or 'no platform'}.",
                metric=f"Post #{post.id}",
                href=f"/social?post={post.id}",
            )
        )

    ad_campaigns = (
        db.query(AdCampaign)
        .filter(AdCampaign.name.like(f"%{promo.name}%"))
        .order_by(AdCampaign.created_at.desc(), AdCampaign.id.desc())
        .limit(20)
        .all()
    )
    for campaign in ad_campaigns:
        events.append(
            _timeline_event(
                event_id=f"ad-{campaign.id}",
                event_type="ad",
                title="Ad handoff created",
                status=campaign.status,
                timestamp=campaign.created_at,
                detail=f"{campaign.name} planned for {', '.join(campaign.platforms or []) or 'no platform'}.",
                metric=f"Rs {round(float(campaign.daily_budget or campaign.lifetime_budget or 0))}",
                href=f"/ads?campaign={campaign.id}",
            )
        )

    events.sort(key=lambda event: event["timestamp"] or "", reverse=True)
    limited_events = events[:limit]
    if not any(event["id"] == campaign_event["id"] for event in limited_events):
        limited_events = [*limited_events[: max(limit - 1, 0)], campaign_event]
    return {
        "promotion": _promotion_dict(promo),
        "summary": {
            "event_count": len(events),
            "delivery_events": sum(1 for event in events if event["type"] == "delivery"),
            "cleanup_events": sum(1 for event in events if event["type"] == "cleanup"),
            "redemption_events": sum(1 for event in events if event["type"] == "redemption"),
            "handoff_events": sum(1 for event in events if event["type"] in {"social", "ad"}),
        },
        "events": limited_events,
    }


def _campaign_export_filename(promo: Promotion) -> str:
    base = promo.code or promo.name or f"campaign-{promo.id}"
    safe = "".join(character.lower() for character in base if character.isalnum() or character in {"-", "_"})
    return f"campaign_{safe or promo.id}_performance.csv"


def _campaign_performance_csv(payload: dict) -> str:
    output = io.StringIO()
    writer = csv.writer(output)
    promotion = payload["promotion_detail"]
    window = payload["campaign_window"]
    redemptions = payload["redemptions"]
    outreach = payload["outreach"]
    social = payload["social"]
    ads = payload["ads"]
    net_coupon_value = round(float(redemptions["revenue"] or 0) - float(redemptions["discount"] or 0), 2)
    ready_reach = int(outreach["sent_count"] or 0) + int(outreach["dry_run_count"] or 0)

    writer.writerow(["Section", "Metric", "Value"])
    writer.writerow(["Campaign", "Name", promotion["name"]])
    writer.writerow(["Campaign", "Code", promotion["code"] or ""])
    writer.writerow(["Campaign", "Channel", promotion["channel"]])
    writer.writerow(["Campaign", "Audience", promotion["audience"]])
    writer.writerow(["Campaign", "Status", promotion["status"]])
    writer.writerow(["Campaign", "Window", f"{window['start_date']} to {window['end_date']}"])
    writer.writerow(["Campaign", "Phase", window["phase"]])
    writer.writerow(["Coupon", "Revenue", redemptions["revenue"]])
    writer.writerow(["Coupon", "Discount", redemptions["discount"]])
    writer.writerow(["Coupon", "Net Value", net_coupon_value])
    writer.writerow(["Coupon", "Orders", redemptions["count"]])
    writer.writerow(["Coupon", "Unique Customers", redemptions["unique_customers"]])
    writer.writerow(["Coupon", "Average Order Value", redemptions["average_order_value"]])
    writer.writerow(["Outreach", "Ready Reach", ready_reach])
    writer.writerow(["Outreach", "Attempted", outreach["attempted_count"]])
    writer.writerow(["Outreach", "Sent", outreach["sent_count"]])
    writer.writerow(["Outreach", "Dry Runs", outreach["dry_run_count"]])
    writer.writerow(["Outreach", "Needs Attention", outreach["needs_attention_count"]])
    writer.writerow(["Outreach", "Conversion Rate Percent", outreach["conversion_rate_percent"]])
    writer.writerow(["Social", "Posts", social["post_count"]])
    writer.writerow(["Social", "Ready Posts", social["ready_count"]])
    writer.writerow(["Ads", "Campaigns", ads["campaign_count"]])
    writer.writerow(["Ads", "Planned Budget", ads["planned_budget"]])
    writer.writerow(["Ads", "Reported Spend", ads["spend"]])
    writer.writerow(["Ads", "Reported Revenue", ads["reported_revenue"]])
    writer.writerow(["Ads", "ROAS", ads["roas"]])
    return output.getvalue()


@router.post("/")
def create_promotion(
    promo: PromotionCreate,
    db: Session = Depends(get_db),
    session: dict = Depends(require_roles("admin")),
):
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
def list_promotions(
    db: Session = Depends(get_db),
    session: dict = Depends(require_roles("admin", "staff")),
):
    promotions = db.query(Promotion).order_by(Promotion.start_date.desc(), Promotion.id.desc()).all()
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
    session: dict = Depends(require_roles("admin", "staff")),
):
    query = _audience_query(db, audience)
    customers = (
        query.order_by(Customer.last_order_at.desc().nullslast(), Customer.id.desc())
        .all()
    )
    sample_customers = customers[:limit]
    return {
        "audience": audience,
        "total_contacts": len(customers),
        **_audience_hygiene(customers),
        "customers": [_customer_dict(customer) for customer in sample_customers],
    }


@router.get("/retention-playbook")
def retention_campaign_playbook(
    db: Session = Depends(get_db),
    session: dict = Depends(require_roles("admin", "staff")),
):
    return {
        "generated_at": datetime.utcnow().isoformat(),
        "playbook": [
            _retention_playbook_entry(db, audience)
            for audience in RETENTION_AUDIENCE_ORDER
        ],
    }


@router.post("/retention-playbook/{audience}/campaign")
def create_retention_playbook_campaign(
    audience: str,
    payload: RetentionCampaignCreate,
    db: Session = Depends(get_db),
    session: dict = Depends(require_roles("admin")),
):
    if payload.status not in VALID_STATUSES:
        raise HTTPException(status_code=422, detail="Unsupported campaign status.")
    if audience not in RETENTION_PLAYBOOK:
        raise HTTPException(status_code=422, detail="Unsupported retention playbook audience.")

    template = RETENTION_PLAYBOOK[audience]
    start_date = date.today()
    end_date = start_date + timedelta(days=payload.duration_days - 1)
    code = _normalize_code(payload.code) or _unique_retention_code(db, template["code_prefix"])
    if db.query(Promotion).filter(Promotion.code == code).first():
        raise HTTPException(status_code=409, detail="Promotion code already exists.")

    promo = Promotion(
        name=(payload.name or template["name"]).strip(),
        code=code,
        start_date=start_date,
        end_date=end_date,
        description=template["description"],
        discount_type=template["discount_type"],
        discount_value=template["discount_value"],
        audience=audience,
        channel=template["channel"],
        status=payload.status,
        message_template=template["message_template"],
    )
    db.add(promo)
    db.commit()
    db.refresh(promo)
    return {
        "status": "retention campaign created",
        "playbook": _retention_playbook_entry(db, audience),
        "promotion": _promotion_dict(promo),
    }


@router.get("/providers/status")
def campaign_provider_statuses(
    session: dict = Depends(require_roles("admin", "staff")),
):
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
    session: dict = Depends(require_roles("admin", "staff")),
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
def promotion_performance(
    promo_id: int,
    db: Session = Depends(get_db),
    session: dict = Depends(require_roles("admin", "staff")),
):
    promo = db.get(Promotion, promo_id)
    if not promo:
        raise HTTPException(status_code=404, detail="Promotion not found")
    return _promotion_performance_payload(db, promo)


@router.get("/performance/{promo_id}/export.csv")
def export_promotion_performance_csv(
    promo_id: int,
    db: Session = Depends(get_db),
    session: dict = Depends(require_roles("admin", "staff")),
):
    promo = db.get(Promotion, promo_id)
    if not promo:
        raise HTTPException(status_code=404, detail="Promotion not found")
    payload = _promotion_performance_payload(db, promo)
    return StreamingResponse(
        iter([_campaign_performance_csv(payload)]),
        media_type="text/csv",
        headers={"Content-Disposition": f"attachment; filename={_campaign_export_filename(promo)}"},
    )


@router.get("/{promo_id}/timeline")
def promotion_activity_timeline(
    promo_id: int,
    limit: int = Query(24, ge=1, le=100),
    db: Session = Depends(get_db),
    session: dict = Depends(require_roles("admin", "staff")),
):
    promo = db.get(Promotion, promo_id)
    if not promo:
        raise HTTPException(status_code=404, detail="Promotion not found")
    return _campaign_activity_payload(db, promo, limit)


@router.get("/{promo_id}/outreach")
def promotion_outreach(
    promo_id: int,
    limit: int = Query(50, ge=1, le=500),
    db: Session = Depends(get_db),
    session: dict = Depends(require_roles("admin", "staff")),
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
        "order_link": _order_offer_link(promo),
        "message_preview": _render_message(promo, contacts[0] if contacts else None),
        "contacts": [
            {
                **_customer_dict(customer),
                "message": _render_message(promo, customer),
                "order_link": _order_offer_link(promo),
            }
            for customer in contacts
        ],
    }

@router.get("/{promo_id}/dispatch")
def promotion_dispatch(
    promo_id: int,
    limit: int = Query(50, ge=1, le=500),
    db: Session = Depends(get_db),
    session: dict = Depends(require_roles("admin", "staff")),
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
    cleanup_issue_customer_ids = {
        delivery.customer_id
        for delivery in db.query(CampaignDelivery)
        .filter(CampaignDelivery.promotion_id == promo.id)
        .filter(CampaignDelivery.customer_id.isnot(None))
        .all()
        if _delivery_issue_reason(delivery) in {"consent", "missing_destination"}
    }
    cleanup_recovered_ready_count = sum(
        1
        for contact in contacts
        if contact["id"] in cleanup_issue_customer_ids and contact["send_ready"]
    )

    return {
        "promotion": _promotion_dict(promo),
        "audience": promo.audience,
        "audience_count": total,
        "channel": promo.channel,
        "order_link": _order_offer_link(promo),
        "provider_status": campaign_provider_status(promo.channel),
        "message_preview": _render_message(promo, customers[0] if customers else None),
        "send_ready_count": send_ready_count,
        "missing_destination_count": missing_destination_count,
        "cleanup_recovered_ready_count": cleanup_recovered_ready_count,
        "contacts": contacts,
    }


@router.post("/{promo_id}/social-post")
def create_social_post_from_promotion(
    promo_id: int,
    payload: PromotionSocialPostCreate,
    db: Session = Depends(get_db),
    session: dict = Depends(require_roles("admin")),
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
    session: dict = Depends(require_roles("admin")),
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
    session: dict = Depends(require_roles("admin")),
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
                    provider=provider_status["provider"],
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
    status: Optional[str] = Query(None),
    reason: Optional[str] = Query(None),
    db: Session = Depends(get_db),
    session: dict = Depends(require_roles("admin", "staff")),
):
    promo = db.get(Promotion, promo_id)
    if not promo:
        raise HTTPException(status_code=404, detail="Promotion not found")

    base_query = db.query(CampaignDelivery).filter(CampaignDelivery.promotion_id == promo.id)
    all_deliveries = base_query.all()
    query = base_query
    if status:
        normalized_status = status.strip().lower()
        if normalized_status == "needs_attention":
            query = query.filter(CampaignDelivery.status.in_(["failed", "skipped"]))
        elif normalized_status in {"sent", "dry_run", "failed", "skipped", "pending"}:
            query = query.filter(CampaignDelivery.status == normalized_status)
        else:
            raise HTTPException(status_code=422, detail="Unsupported delivery status filter.")

    normalized_reason = reason.strip().lower() if reason else None
    if normalized_reason and normalized_reason not in VALID_DELIVERY_REASON_FILTERS:
        raise HTTPException(status_code=422, detail="Unsupported delivery reason filter.")

    deliveries = query.order_by(CampaignDelivery.attempted_at.desc(), CampaignDelivery.id.desc()).all()
    if normalized_reason:
        deliveries = [
            delivery
            for delivery in deliveries
            if _delivery_issue_reason(delivery) == normalized_reason
        ]
    deliveries = deliveries[:limit]
    latest_attempted_at = deliveries[0].attempted_at if deliveries else None
    audit_counts = _delivery_audit_counts(all_deliveries)
    return {
        "promotion": _promotion_dict(promo),
        "status_filter": status or "all",
        "reason_filter": normalized_reason or "all",
        "latest_attempted_at": latest_attempted_at.isoformat() if latest_attempted_at else None,
        "audit_counts": audit_counts,
        **audit_counts,
        **_delivery_counts(deliveries),
        "deliveries": [_delivery_dict(delivery) for delivery in deliveries],
    }
