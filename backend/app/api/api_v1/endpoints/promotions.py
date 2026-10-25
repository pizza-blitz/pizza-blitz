import csv
import io
import os

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session
from sqlalchemy import func
from app.core.clock import business_today
from app.api.deps import get_db, require_roles
from app.core.config import settings
from app.models.domain import (
    AdCampaign,
    AdCampaignLaunch,
    CampaignDelivery,
    Customer,
    DailySales,
    Promotion,
    ProviderTestRun,
    RestaurantOrder,
    SocialPost,
)
from app.services.campaign_dispatch_service import (
    campaign_provider_status,
    normalize_campaign_destination,
    send_campaign_message,
)
from app.services.campaign_schedule_service import activate_due_scheduled_campaigns
from app.services.billing_settings_service import calculate_charges
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
SEGMENT_CAMPAIGN_TEMPLATES = {
    "marketing_opt_in": {
        "label": "Marketing Opt-in",
        "intent": "Reach consented customers with a broad offer.",
        "name": "Opt-in Flash Slice",
        "description": "A broad coupon for customers who have already consented to marketing.",
        "discount_type": "percentage",
        "discount_value": 10,
        "channel": "whatsapp",
        "code_prefix": "OPT",
        "message_template": "Hi {name}, Pizza Blitz has {offer} for you. Use {code} before {end_date}. Order here: {order_link}",
    },
    "repeat_customers": {
        "label": "Repeat Customers",
        "intent": "Reward customers who already show a buying habit.",
        "name": "Repeat Slice Reward",
        "description": "A loyalty coupon for customers with repeat orders.",
        "discount_type": "percentage",
        "discount_value": 12,
        "channel": "whatsapp",
        "code_prefix": "REP",
        "message_template": "Hi {name}, thanks for coming back to Pizza Blitz. Your repeat-guest offer is {offer}. Use {code} before {end_date}. Order here: {order_link}",
    },
    "high_spenders": {
        "label": "High Spenders",
        "intent": "Convert larger-ticket guests into premium repeat buyers.",
        "name": "Premium Party Pack Push",
        "description": "A premium bundle coupon for high-value customers.",
        "discount_type": "percentage",
        "discount_value": 15,
        "channel": "whatsapp",
        "code_prefix": "HSP",
        "message_template": "Hi {name}, your Pizza Blitz premium offer is {offer}. Use {code} before {end_date}. Order here: {order_link}",
    },
    "all_customers": {
        "label": "All Customers",
        "intent": "Run a broad customer-wide offer.",
        "name": "Everyone Gets a Slice",
        "description": "A general coupon for the full customer base.",
        "discount_type": "percentage",
        "discount_value": 8,
        "channel": "whatsapp",
        "code_prefix": "ALL",
        "message_template": "Hi {name}, Pizza Blitz has {offer} for everyone this week. Use {code} before {end_date}. Order here: {order_link}",
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
    live_confirmation: Optional[str] = None


class CampaignDeliveryRetryRequest(BaseModel):
    limit: int = Field(50, ge=1, le=500)
    dry_run: bool = True
    status: str = "needs_attention"
    reason: str = "all"


class ProviderTestSendRequest(BaseModel):
    channel: str = Field(..., min_length=1)
    recipient: str = Field(..., min_length=3)
    message_template: str = Field(..., min_length=8)


class PromotionScheduleRequest(BaseModel):
    start_date: str
    duration_days: int = Field(7, ge=1, le=60)


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


def _promotion_schedule_state(promo: Promotion) -> dict:
    today = business_today()
    if today < promo.start_date:
        phase = "upcoming"
    elif today > promo.end_date:
        phase = "ended"
    else:
        phase = "live"

    return {
        "phase": phase,
        "days_until_start": max((promo.start_date - today).days, 0),
        "days_remaining": max((promo.end_date - today).days + 1, 0),
        "send_ready_on": promo.start_date.isoformat(),
        "can_send_now": promo.status in {"active", "scheduled"} and promo.start_date <= today <= promo.end_date,
    }


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
        "schedule": _promotion_schedule_state(promo),
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


def _provider_credential_checks(channel: str, status: dict) -> list[dict]:
    credential_map = {
        "whatsapp": [
            ("CAMPAIGN_SEND_ENABLED=true", "Global campaign send switch"),
            ("WHATSAPP_ACCESS_TOKEN", "Meta access token"),
            ("WHATSAPP_PHONE_NUMBER_ID", "WhatsApp phone number ID"),
        ],
        "sms": [
            ("CAMPAIGN_SEND_ENABLED=true", "Global campaign send switch"),
            ("TWILIO_ACCOUNT_SID", "Twilio account SID"),
            ("TWILIO_AUTH_TOKEN", "Twilio auth token"),
            ("TWILIO_FROM_NUMBER or TWILIO_MESSAGING_SERVICE_SID", "Twilio sender identity"),
        ],
        "email": [
            ("CAMPAIGN_SEND_ENABLED=true", "Global campaign send switch"),
            ("RESEND_API_KEY", "Resend API key"),
            ("RESEND_FROM_EMAIL", "Verified from email"),
        ],
    }
    missing = set(status.get("missing_settings") or [])
    return [
        {
            "key": key,
            "label": label,
            "configured": key not in missing and not status.get("unsupported"),
        }
        for key, label in credential_map.get(channel, [])
    ]


def _provider_setup_steps(channel: str, status: dict) -> list[dict]:
    setup_map = {
        "whatsapp": [
            (
                "meta_access_token",
                "Add Meta access token",
                "WHATSAPP_ACCESS_TOKEN",
                "Server-side token used for approved WhatsApp templates.",
                "Add the Meta token in production environment variables.",
            ),
            (
                "phone_number_id",
                "Connect WhatsApp sender",
                "WHATSAPP_PHONE_NUMBER_ID",
                "Meta phone number ID for the sending account.",
                "Copy the sender phone number ID from Meta Business settings.",
            ),
            (
                "template_name",
                "Confirm approved template",
                "WHATSAPP_TEMPLATE_NAME",
                "Template name must match an approved Meta WhatsApp template.",
                "Add the approved template name before live WhatsApp broadcasts.",
            ),
            (
                "send_switch",
                "Enable live campaign switch",
                "CAMPAIGN_SEND_ENABLED=true",
                "Live sending remains blocked until the global switch is enabled.",
                "Enable only after credentials and dry-run proof are verified.",
            ),
        ],
        "sms": [
            (
                "twilio_account_sid",
                "Add Twilio account SID",
                "TWILIO_ACCOUNT_SID",
                "Server-side account identifier for Twilio SMS.",
                "Add the Twilio account SID in production environment variables.",
            ),
            (
                "twilio_auth_token",
                "Add Twilio auth token",
                "TWILIO_AUTH_TOKEN",
                "Secret token used by the backend for SMS delivery.",
                "Add the Twilio auth token as a protected environment variable.",
            ),
            (
                "twilio_sender",
                "Choose SMS sender identity",
                "TWILIO_FROM_NUMBER or TWILIO_MESSAGING_SERVICE_SID",
                "A sender number or messaging service is required before SMS delivery.",
                "Configure one approved sender identity for the store.",
            ),
            (
                "send_switch",
                "Enable live campaign switch",
                "CAMPAIGN_SEND_ENABLED=true",
                "Live sending remains blocked until the global switch is enabled.",
                "Enable only after credentials and dry-run proof are verified.",
            ),
        ],
        "email": [
            (
                "resend_api_key",
                "Add Resend API key",
                "RESEND_API_KEY",
                "Server-only key used by the backend for email delivery.",
                "Create a Resend API key and add it to production environment variables.",
            ),
            (
                "resend_from_email",
                "Verify sender email",
                "RESEND_FROM_EMAIL",
                "The from address must be a sender or domain verified in Resend.",
                "Set the verified Pizza Blitz sender email before live campaigns.",
            ),
            (
                "send_switch",
                "Enable live campaign switch",
                "CAMPAIGN_SEND_ENABLED=true",
                "Live sending remains blocked until the global switch is enabled.",
                "Enable only after the dry-run receipt and provider checks pass.",
            ),
        ],
    }
    missing = set(status.get("missing_settings") or [])
    if channel == "whatsapp" and not settings.WHATSAPP_TEMPLATE_NAME:
        missing.add("WHATSAPP_TEMPLATE_NAME")
    unsupported = bool(status.get("unsupported"))
    steps = []
    for key, label, required_setting, detail, action in setup_map.get(channel, []):
        missing_step = required_setting in missing or unsupported
        steps.append(
            {
                "key": key,
                "label": label,
                "required_setting": required_setting,
                "passed": not missing_step,
                "status": "missing" if missing_step else "configured",
                "detail": detail,
                "action": action,
            }
        )
    return steps


def _provider_template_state(channel: str) -> dict:
    if channel == "whatsapp":
        if settings.WHATSAPP_TEMPLATE_NAME:
            return {
                "status": "ready",
                "label": f"Template {settings.WHATSAPP_TEMPLATE_NAME} / {settings.WHATSAPP_TEMPLATE_LANGUAGE}",
                "detail": "Meta template messaging is configured for production review.",
            }
        return {
            "status": "needs_template",
            "label": "Meta template pending",
            "detail": "Set WHATSAPP_TEMPLATE_NAME before production WhatsApp broadcasts.",
        }
    if channel == "sms":
        return {
            "status": "ready",
            "label": "SMS text body ready",
            "detail": "SMS uses approved text content and sender identity checks.",
        }
    return {
        "status": "ready",
        "label": "Email subject/body ready",
        "detail": "Email uses verified sender and template preview checks.",
    }


def _messaging_compliance_checks(channel: str) -> list[dict]:
    checks = [
        {
            "label": "Marketing consent gate",
            "status": "enforced",
            "detail": "Campaign delivery skips customers without opt-in consent.",
        },
        {
            "label": "Destination validation",
            "status": "enforced",
            "detail": "Email, SMS and WhatsApp destinations are normalized before sending.",
        },
        {
            "label": "Dry run before live send",
            "status": "enforced",
            "detail": "The send queue requires a dry run before live campaign sending.",
        },
    ]
    if channel == "whatsapp":
        checks.append(
            {
                "label": "Template approval",
                "status": "manual",
                "detail": "Meta template approval must be verified before production WhatsApp broadcasts.",
            }
        )
    return checks


def _provider_readiness_status(channel: str) -> dict:
    status = campaign_provider_status(channel)
    template_state = _provider_template_state(channel)
    missing = status.get("missing_settings") or []
    if status.get("configured"):
        readiness_label = "Provider ready"
        next_action = "Run dry-run proof, then approve the live campaign send checklist."
    else:
        readiness_label = "Setup needed"
        next_action = f"Configure {', '.join(missing) if missing else 'supported provider settings'}."

    return {
        **status,
        "readiness_label": readiness_label,
        "credential_checks": _provider_credential_checks(channel, status),
        "setup_steps": _provider_setup_steps(channel, status),
        "template_status": template_state["status"],
        "template_label": template_state["label"],
        "template_detail": template_state["detail"],
        "compliance_checks": _messaging_compliance_checks(channel),
        "safe_test_send": {
            "mode": "dry_run_only",
            "live_send_blocked": True,
            "requires_approval": True,
        },
        "next_action": next_action,
    }


def _delivery_proof_dict(delivery: CampaignDelivery | None) -> dict | None:
    if not delivery:
        return None
    return {
        "id": delivery.id,
        "promotion_id": delivery.promotion_id,
        "channel": delivery.channel,
        "provider": delivery.provider,
        "status": delivery.status,
        "dry_run": delivery.dry_run,
        "external_id": delivery.external_id,
        "recipient_masked": (
            _masked_destination(delivery.channel, delivery.destination)
            if delivery.destination
            else None
        ),
        "issue_reason": _delivery_issue_reason(delivery),
        "error": delivery.error,
        "attempted_at": delivery.attempted_at.isoformat() if delivery.attempted_at else None,
    }


def _provider_test_run_dict(test_run: ProviderTestRun | None) -> dict | None:
    if not test_run:
        return None
    return {
        "id": test_run.id,
        "test_id": test_run.test_id,
        "channel": test_run.channel,
        "provider": test_run.provider,
        "recipient_masked": test_run.recipient_masked,
        "message_preview": test_run.message_preview,
        "queued": test_run.queued,
        "live_send_blocked": test_run.live_send_blocked,
        "generated_at": test_run.generated_at.isoformat() if test_run.generated_at else None,
    }


def _provider_test_audit_csv(test_runs: list[ProviderTestRun]) -> str:
    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow(
        [
            "id",
            "test_id",
            "generated_at",
            "channel",
            "provider",
            "recipient_masked",
            "queued",
            "live_send_blocked",
            "message_preview",
        ]
    )
    for test_run in test_runs:
        writer.writerow(
            [
                test_run.id,
                test_run.test_id,
                test_run.generated_at.isoformat() if test_run.generated_at else "",
                test_run.channel,
                test_run.provider or "",
                test_run.recipient_masked or "",
                "yes" if test_run.queued else "no",
                "yes" if test_run.live_send_blocked else "no",
                test_run.message_preview or "",
            ]
        )
    return output.getvalue()


def _dispatch_activation_status(channel: str, status: dict, counts: dict) -> tuple[str, str, list[str]]:
    missing_settings = status.get("missing_settings") or []
    blockers: list[str] = []
    if status.get("unsupported"):
        blockers = ["Unsupported provider selected"]
        return "unsupported", "Select a supported provider before sending.", blockers
    if not settings.CAMPAIGN_SEND_ENABLED:
        blockers.append("CAMPAIGN_SEND_ENABLED=true")
    blockers.extend(setting for setting in missing_settings if setting not in blockers)
    if blockers:
        return "credentials_needed", f"Configure {', '.join(blockers)}.", blockers
    if channel == "whatsapp" and status.get("template_status") == "needs_template":
        blockers = ["WHATSAPP_TEMPLATE_NAME"]
        return "template_needed", "Add the approved Meta template name before WhatsApp broadcasts.", blockers
    if counts["dry_run_count"] == 0 and counts["sent_count"] == 0:
        blockers = ["Dry-run proof missing"]
        return "test_proof_needed", "Run a dry-run campaign send before live launch.", blockers
    if counts["needs_attention_count"] > 0 and counts["sent_count"] == 0:
        blockers = ["Delivery issues need recovery"]
        return "recovery_needed", "Resolve failed or skipped delivery attempts before live launch.", blockers
    return "live_ready", "Channel has credentials, compliance checks and send proof.", []


def _dispatch_activation_checklist(channel: str, status: dict, counts: dict) -> list[dict]:
    credential_checks = status.get("credential_checks") or []
    provider_credential_checks = [
        check
        for check in credential_checks
        if check.get("key") != "CAMPAIGN_SEND_ENABLED=true"
    ]
    missing_credentials = [
        check.get("label") or check.get("key")
        for check in provider_credential_checks
        if not check.get("configured")
    ]
    provider_credentials_ready = bool(provider_credential_checks) and not missing_credentials
    template_ready = status.get("template_status") == "ready"
    dry_run_count = counts.get("dry_run_count", 0)
    sent_count = counts.get("sent_count", 0)
    issue_count = counts.get("needs_attention_count", 0)

    return [
        {
            "key": "send_switch",
            "label": "Global send switch",
            "passed": settings.CAMPAIGN_SEND_ENABLED,
            "detail": (
                "CAMPAIGN_SEND_ENABLED is enabled."
                if settings.CAMPAIGN_SEND_ENABLED
                else "Set CAMPAIGN_SEND_ENABLED=true only after provider tests pass."
            ),
        },
        {
            "key": "provider_credentials",
            "label": "Provider credentials",
            "passed": provider_credentials_ready,
            "detail": (
                f"{status.get('provider')} credentials are present."
                if provider_credentials_ready
                else f"Missing: {', '.join(missing_credentials) if missing_credentials else 'supported provider settings'}."
            ),
        },
        {
            "key": "template_content",
            "label": "Template/content approval",
            "passed": template_ready,
            "detail": status.get("template_detail") or (
                f"Review {channel} message content before live sends."
            ),
        },
        {
            "key": "dry_run_proof",
            "label": "Dry-run proof",
            "passed": dry_run_count > 0 or sent_count > 0,
            "detail": f"{dry_run_count} dry-run receipt(s), {sent_count} live send receipt(s).",
        },
        {
            "key": "issue_recovery",
            "label": "Issue recovery",
            "passed": issue_count == 0,
            "detail": (
                "No failed/skipped deliveries need review."
                if issue_count == 0
                else f"{issue_count} delivery issue(s) need cleanup before launch."
            ),
        },
    ]


def _dispatch_control_channel(db: Session, channel: str) -> dict:
    status = _provider_readiness_status(channel)
    deliveries = (
        db.query(CampaignDelivery)
        .filter(CampaignDelivery.channel == channel)
        .order_by(CampaignDelivery.attempted_at.desc(), CampaignDelivery.id.desc())
        .all()
    )
    counts = _delivery_counts(deliveries)
    audit_counts = _delivery_audit_counts(deliveries)
    latest_dry_run = next((delivery for delivery in deliveries if delivery.status == "dry_run"), None)
    latest_sent = next((delivery for delivery in deliveries if delivery.status == "sent"), None)
    latest_issue = next((delivery for delivery in deliveries if delivery.status in {"failed", "skipped"}), None)
    latest_provider_test = (
        db.query(ProviderTestRun)
        .filter(ProviderTestRun.channel == channel)
        .order_by(ProviderTestRun.generated_at.desc(), ProviderTestRun.id.desc())
        .first()
    )
    activation_status, next_action, blockers = _dispatch_activation_status(channel, status, counts)
    return {
        "channel": channel,
        "provider_status": status,
        "activation_status": activation_status,
        "activation_checklist": _dispatch_activation_checklist(channel, status, counts),
        "blockers": blockers,
        "counts": {**counts, **audit_counts},
        "latest_dry_run": _delivery_proof_dict(latest_dry_run),
        "latest_sent": _delivery_proof_dict(latest_sent),
        "latest_issue": _delivery_proof_dict(latest_issue),
        "latest_provider_test": _provider_test_run_dict(latest_provider_test),
        "next_action": next_action,
    }


def _render_provider_test_message(template: str) -> str:
    values = {
        "name": "Test Customer",
        "offer": "10% off",
        "code": "TEST10",
        "end_date": business_today().isoformat(),
        "order_link": f"{_public_site_url()}/order",
    }
    try:
        return template.format(**values).strip()
    except KeyError as exc:
        raise HTTPException(
            status_code=422,
            detail=f"Unsupported template variable: {exc.args[0]}",
        ) from exc


def _masked_destination(channel: str, destination: str) -> str:
    if channel == "email":
        local, _, domain = destination.partition("@")
        if not domain:
            return "***"
        return f"{local[:2]}***@{domain}"
    digits = "".join(character for character in destination if character.isdigit())
    if len(digits) <= 4:
        return "****"
    return f"{'*' * max(len(digits) - 4, 4)}{digits[-4:]}"


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


def _scheduled_campaign_phase(promo: Promotion) -> str:
    today = business_today()
    if promo.end_date < today:
        return "overdue"
    if promo.start_date <= today <= promo.end_date:
        return "due_today"
    return "upcoming"


def _scheduled_campaign_queue_row(db: Session, promo: Promotion) -> dict:
    customers = _audience_query(db, promo.audience or "marketing_opt_in").all()
    contacts = [_dispatch_contact(customer, promo) for customer in customers]
    ready_count = sum(1 for contact in contacts if contact["send_ready"])
    phase = _scheduled_campaign_phase(promo)
    if phase == "due_today":
        action = "Activate due campaign and run the send checklist."
    elif phase == "overdue":
        action = "Review expired schedule before sending."
    else:
        action = f"Wait until {promo.start_date.isoformat()} or reschedule."

    return {
        "promotion": _promotion_dict(promo),
        "phase": phase,
        "audience_count": len(customers),
        "ready_count": ready_count,
        "missing_count": max(len(customers) - ready_count, 0),
        "can_activate": phase == "due_today",
        "recommended_action": action,
    }


def _campaign_send_queue_row(db: Session, promo: Promotion) -> dict:
    customers = (
        _audience_query(db, promo.audience or "marketing_opt_in")
        .order_by(Customer.last_order_at.desc().nullslast(), Customer.id.desc())
        .all()
    )
    contacts = [_dispatch_contact(customer, promo) for customer in customers]
    ready_count = sum(1 for contact in contacts if contact["send_ready"])
    deliveries = (
        db.query(CampaignDelivery)
        .filter(CampaignDelivery.promotion_id == promo.id)
        .order_by(CampaignDelivery.attempted_at.desc(), CampaignDelivery.id.desc())
        .all()
    )
    counts = _delivery_counts(deliveries)
    provider_status = campaign_provider_status(promo.channel)
    schedule = _promotion_schedule_state(promo)
    latest_delivery = deliveries[0] if deliveries else None
    can_dry_run = ready_count > 0 and schedule["can_send_now"]
    has_dry_run = counts["dry_run_count"] > 0
    already_sent = counts["sent_count"] > 0
    can_send = can_dry_run and provider_status["configured"] and has_dry_run and not already_sent
    if not schedule["can_send_now"]:
        queue_status = "scheduled_wait"
        queue_label = "Wait"
        live_send_blockers = [f"Send window opens {schedule['send_ready_on']}"]
    elif ready_count == 0:
        queue_status = "audience_blocked"
        queue_label = "Clean Audience"
        live_send_blockers = ["No send-ready contacts"]
    elif not provider_status["configured"]:
        queue_status = "provider_blocked"
        queue_label = "Provider Setup"
        live_send_blockers = provider_status["missing_settings"] or ["Unsupported provider"]
    elif not has_dry_run and not already_sent:
        queue_status = "needs_dry_run"
        queue_label = "Needs Dry Run"
        live_send_blockers = ["Dry run not recorded"]
    elif not already_sent:
        queue_status = "ready_to_send"
        queue_label = "Ready To Send"
        live_send_blockers = []
    else:
        queue_status = "dry_run_done"
        queue_label = "Already Sent"
        live_send_blockers = ["Campaign already has sent deliveries"]

    if not schedule["can_send_now"]:
        action = f"Wait until {schedule['send_ready_on']}."
    elif ready_count == 0:
        action = "Clean audience contact data before sending."
    elif not provider_status["configured"]:
        action = f"Run dry run; configure {provider_status['provider']} before live send."
    elif counts["dry_run_count"] == 0 and counts["sent_count"] == 0:
        action = "Run a dry run before live send."
    else:
        action = "Ready for live send checklist."

    return {
        "promotion": _promotion_dict(promo),
        "audience_count": len(customers),
        "ready_count": ready_count,
        "missing_count": max(len(customers) - ready_count, 0),
        "provider_status": provider_status,
        "can_dry_run": can_dry_run,
        "can_send": can_send,
        "live_confirmation_phrase": _live_send_confirmation_phrase(promo),
        "queue_status": queue_status,
        "queue_label": queue_label,
        "live_send_blockers": live_send_blockers,
        "latest_attempted_at": latest_delivery.attempted_at.isoformat() if latest_delivery and latest_delivery.attempted_at else None,
        "recommended_action": action,
        **counts,
    }


def _live_send_confirmation_phrase(promo: Promotion) -> str:
    return f"LIVE SEND {promo.id}"


def _live_send_preflight_blockers(db: Session, promo: Promotion, force_resend: bool = False) -> list[str]:
    queue_row = _campaign_send_queue_row(db, promo)
    if queue_row["can_send"]:
        return []

    blockers = list(queue_row.get("live_send_blockers") or [])
    if force_resend:
        blockers = [
            blocker
            for blocker in blockers
            if blocker != "Campaign already has sent deliveries"
        ]
    return blockers or ["Live send preflight is incomplete"]


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


def _segment_campaign_template(audience: str) -> dict:
    if audience in RETENTION_PLAYBOOK:
        return RETENTION_PLAYBOOK[audience]
    if audience in SEGMENT_CAMPAIGN_TEMPLATES:
        return SEGMENT_CAMPAIGN_TEMPLATES[audience]
    raise HTTPException(status_code=422, detail="Unsupported segment campaign audience.")


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


def _campaign_delivery_audit_csv(deliveries: list[CampaignDelivery]) -> str:
    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow(
        [
            "id",
            "promotion_id",
            "promotion",
            "code",
            "attempted_at",
            "channel",
            "provider",
            "status",
            "dry_run",
            "recipient_masked",
            "issue_reason",
            "recovery_action",
            "external_id",
            "error",
        ]
    )
    for delivery in deliveries:
        promotion = delivery.promotion
        writer.writerow(
            [
                delivery.id,
                delivery.promotion_id,
                promotion.name if promotion else "",
                promotion.code if promotion else "",
                delivery.attempted_at.isoformat() if delivery.attempted_at else "",
                delivery.channel,
                delivery.provider or "",
                delivery.status,
                "yes" if delivery.dry_run else "no",
                _masked_destination(delivery.channel, delivery.destination) if delivery.destination else "",
                _delivery_issue_reason(delivery),
                _delivery_recovery_action(delivery),
                delivery.external_id or "",
                delivery.error or "",
            ]
        )
    return output.getvalue()


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
        "retryable_count": sum(1 for delivery in deliveries if delivery.status in {"failed", "skipped"}),
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


def _delivery_retry_candidates(
    db: Session,
    promo: Promotion,
    *,
    status_filter: str,
    reason_filter: str,
    limit: int,
) -> list[CampaignDelivery]:
    normalized_status = (status_filter or "needs_attention").strip().lower()
    if normalized_status == "all":
        query = db.query(CampaignDelivery).filter(CampaignDelivery.promotion_id == promo.id)
    elif normalized_status == "needs_attention":
        query = (
            db.query(CampaignDelivery)
            .filter(CampaignDelivery.promotion_id == promo.id)
            .filter(CampaignDelivery.status.in_(["failed", "skipped"]))
        )
    elif normalized_status in {"failed", "skipped"}:
        query = (
            db.query(CampaignDelivery)
            .filter(CampaignDelivery.promotion_id == promo.id)
            .filter(CampaignDelivery.status == normalized_status)
        )
    else:
        raise HTTPException(status_code=422, detail="Unsupported retry delivery status filter.")

    normalized_reason = (reason_filter or "all").strip().lower()
    if normalized_reason != "all" and normalized_reason not in VALID_DELIVERY_REASON_FILTERS:
        raise HTTPException(status_code=422, detail="Unsupported retry delivery reason filter.")

    deliveries = query.order_by(CampaignDelivery.attempted_at.desc(), CampaignDelivery.id.desc()).all()
    retryable = [delivery for delivery in deliveries if delivery.status in {"failed", "skipped"}]
    if normalized_reason != "all":
        retryable = [
            delivery
            for delivery in retryable
            if _delivery_issue_reason(delivery) == normalized_reason
        ]
    return retryable[:limit]


def _retry_delivery_for_customer(
    promo: Promotion,
    customer: Customer,
    source_delivery: CampaignDelivery,
    provider_status: dict,
    *,
    dry_run: bool,
) -> CampaignDelivery:
    contact = _dispatch_contact(customer, promo)
    destination = normalize_campaign_destination(promo.channel, contact["destination"])
    response_payload = {
        "provider_status": provider_status,
        "retry_source_delivery_id": source_delivery.id,
        "retry_source_reason": _delivery_issue_reason(source_delivery),
    }
    delivery_kwargs = {
        "promotion_id": promo.id,
        "customer_id": customer.id,
        "channel": promo.channel,
        "destination": destination or contact["destination"],
        "message": contact["message"],
        "attempted_at": datetime.utcnow(),
    }

    if not contact["send_ready"] or not destination:
        return CampaignDelivery(
            **delivery_kwargs,
            provider=provider_status["provider"],
            status="skipped",
            error=contact["missing_reason"] or "Missing destination",
            dry_run=dry_run,
            response_payload=response_payload,
        )
    if dry_run:
        return CampaignDelivery(
            **delivery_kwargs,
            provider=provider_status["provider"],
            status="dry_run",
            dry_run=True,
            response_payload=response_payload,
        )

    result = send_campaign_message(
        channel=promo.channel,
        destination=destination,
        message=contact["message"],
        subject=promo.name,
    )
    return CampaignDelivery(
        **delivery_kwargs,
        provider=result.provider,
        status=result.status,
        external_id=result.external_id,
        error=result.error,
        dry_run=False,
        response_payload={
            **(result.response_payload or {}),
            "retry_source_delivery_id": source_delivery.id,
            "retry_source_reason": _delivery_issue_reason(source_delivery),
        },
    )


def _coupon_orders_query(db: Session, promo: Promotion):
    query = db.query(RestaurantOrder)
    if not promo.code:
        return query.filter(RestaurantOrder.id == -1)
    return query.filter(RestaurantOrder.notes.like(f"%Coupon: {promo.code}%"))


def _promotion_window(promo: Promotion) -> dict:
    today = business_today()
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
    baseline_start = promo.start_date - timedelta(days=30)
    baseline_end = promo.start_date - timedelta(days=1)
    baseline_avg, baseline_total = (
        db.query(func.avg(DailySales.total_sale), func.sum(DailySales.total_sale))
        .filter(DailySales.date.between(baseline_start, baseline_end))
        .one()
    )
    during_avg = float(avg_sale or 0)
    baseline_avg = float(baseline_avg or 0)
    elapsed_days = max(_promotion_window(promo)["elapsed_days"], 1)
    incremental_revenue = round((during_avg - baseline_avg) * elapsed_days, 2)
    lift_percent = (
        round(((during_avg - baseline_avg) / baseline_avg) * 100, 2)
        if baseline_avg
        else 0.0
    )
    channel_names: list[str] = []
    if delivery_counts["sent_count"]:
        channel_names.append(promo.channel or "campaign")
    if social_posts:
        channel_names.append("social")
    if ad_campaigns:
        channel_names.append("ads")
    if coupon_orders:
        channel_names.append("coupon")
    unique_channels = list(dict.fromkeys(channel_names))
    channel_share = (
        round(redemption_revenue / len(unique_channels), 2) if unique_channels else 0
    )
    attribution_channels = [
        {
            "channel": channel,
            "credit_revenue": channel_share,
            "share_percent": round(100 / len(unique_channels), 2),
            "model": "linear_channel_credit",
        }
        for channel in unique_channels
    ]

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
        "lift": {
            "baseline_days": 30,
            "baseline_avg_daily_sale": round(baseline_avg, 2),
            "baseline_total_sale": round(float(baseline_total or 0), 2),
            "during_avg_daily_sale": round(during_avg, 2),
            "elapsed_days": elapsed_days,
            "incremental_revenue": incremental_revenue,
            "lift_percent": lift_percent,
            "has_baseline": baseline_avg > 0,
        },
        "attribution": {
            "model": "linear_channel_credit",
            "window": "campaign_window",
            "channels": attribution_channels,
            "attributed_revenue": round(
                sum(item["credit_revenue"] for item in attribution_channels), 2
            ),
            "note": (
                "Coupon revenue is split equally across channels active in this campaign. "
                "This is campaign-level channel credit, not person-level multi-touch."
            ),
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
    today = business_today()
    promotions = (
        db.query(Promotion)
        .filter(Promotion.start_date <= today, Promotion.end_date >= today)
        .filter(Promotion.status.in_(["active", "scheduled"]))
        .order_by(Promotion.end_date.asc())
        .all()
    )
    return [_promotion_dict(promo) for promo in promotions]


@router.get("/schedule/queue")
def scheduled_campaign_queue(
    limit: int = Query(20, ge=1, le=100),
    db: Session = Depends(get_db),
    session: dict = Depends(require_roles("admin", "staff")),
):
    scheduled_promotions = (
        db.query(Promotion)
        .filter(Promotion.status == "scheduled")
        .order_by(Promotion.start_date.asc(), Promotion.id.asc())
        .all()
    )
    rows = [_scheduled_campaign_queue_row(db, promo) for promo in scheduled_promotions]
    phase_priority = {"due_today": 0, "overdue": 1, "upcoming": 2}
    rows.sort(
        key=lambda row: (
            phase_priority.get(row["phase"], 9),
            row["promotion"]["start_date"],
            row["promotion"]["id"],
        )
    )
    return {
        "generated_at": datetime.utcnow().isoformat(),
        "summary": {
            "scheduled_count": len(rows),
            "due_today_count": sum(1 for row in rows if row["phase"] == "due_today"),
            "upcoming_count": sum(1 for row in rows if row["phase"] == "upcoming"),
            "overdue_count": sum(1 for row in rows if row["phase"] == "overdue"),
            "ready_count": sum(row["ready_count"] for row in rows),
            "missing_count": sum(row["missing_count"] for row in rows),
        },
        "campaigns": rows[:limit],
    }


@router.get("/send/queue")
def campaign_send_queue(
    limit: int = Query(20, ge=1, le=100),
    view: str = Query("all"),
    db: Session = Depends(get_db),
    session: dict = Depends(require_roles("admin", "staff")),
):
    normalized_view = view.strip().lower()
    allowed_views = {
        "all",
        "needs_dry_run",
        "provider_blocked",
        "ready_to_send",
        "audience_blocked",
        "dry_run_done",
    }
    if normalized_view not in allowed_views:
        raise HTTPException(status_code=422, detail="Unsupported send queue view.")

    today = business_today()
    promotions = (
        db.query(Promotion)
        .filter(Promotion.status.in_(["active", "scheduled"]))
        .filter(Promotion.start_date <= today)
        .filter(Promotion.end_date >= today)
        .order_by(Promotion.start_date.asc(), Promotion.id.asc())
        .all()
    )
    rows = [_campaign_send_queue_row(db, promo) for promo in promotions]
    rows.sort(
        key=lambda row: (
            0 if row["can_dry_run"] and row["dry_run_count"] == 0 else 1,
            0 if row["can_send"] else 1,
            -row["ready_count"],
            -row["promotion"]["id"],
        )
    )
    filtered_rows = (
        rows
        if normalized_view == "all"
        else [row for row in rows if row["queue_status"] == normalized_view]
    )
    return {
        "generated_at": datetime.utcnow().isoformat(),
        "summary": {
            "view": normalized_view,
            "campaign_count": len(rows),
            "filtered_count": len(filtered_rows),
            "ready_campaign_count": sum(1 for row in rows if row["ready_count"] > 0),
            "dry_run_needed_count": sum(
                1 for row in rows if row["queue_status"] == "needs_dry_run"
            ),
            "provider_blocked_count": sum(
                1 for row in rows if row["queue_status"] == "provider_blocked"
            ),
            "live_ready_count": sum(1 for row in rows if row["queue_status"] == "ready_to_send"),
            "audience_blocked_count": sum(1 for row in rows if row["queue_status"] == "audience_blocked"),
            "dry_run_done_count": sum(1 for row in rows if row["queue_status"] == "dry_run_done"),
            "send_ready_contacts": sum(row["ready_count"] for row in rows),
            "missing_contacts": sum(row["missing_count"] for row in rows),
        },
        "campaigns": filtered_rows[:limit],
    }


@router.post("/schedule/activate-due")
def activate_due_campaigns(
    db: Session = Depends(get_db),
    session: dict = Depends(require_roles("admin")),
):
    promotions = activate_due_scheduled_campaigns(db)
    return {
        "status": "due campaigns activated",
        "activated_count": len(promotions),
        "campaigns": [_promotion_dict(promo) for promo in promotions],
    }


@router.post("/schedule/{promo_id}/activate")
def activate_scheduled_campaign(
    promo_id: int,
    db: Session = Depends(get_db),
    session: dict = Depends(require_roles("admin")),
):
    promo = db.get(Promotion, promo_id)
    if not promo:
        raise HTTPException(status_code=404, detail="Promotion not found")
    if promo.status != "scheduled":
        raise HTTPException(status_code=409, detail="Only scheduled campaigns can be activated.")
    today = business_today()
    if promo.start_date > today:
        raise HTTPException(
            status_code=409,
            detail=f"Scheduled campaign is not due until {promo.start_date.isoformat()}.",
        )
    if promo.end_date < today:
        raise HTTPException(status_code=409, detail="Scheduled campaign has already ended.")

    promo.status = "active"
    db.commit()
    db.refresh(promo)
    return {
        "status": "scheduled campaign activated",
        "promotion": _promotion_dict(promo),
    }


@router.post("/{promo_id}/schedule")
def schedule_promotion_campaign(
    promo_id: int,
    payload: PromotionScheduleRequest,
    db: Session = Depends(get_db),
    session: dict = Depends(require_roles("admin")),
):
    promo = db.get(Promotion, promo_id)
    if not promo:
        raise HTTPException(status_code=404, detail="Promotion not found")

    start_date = _parse_date(payload.start_date)
    if start_date < business_today():
        raise HTTPException(status_code=422, detail="Scheduled date cannot be in the past.")

    promo.start_date = start_date
    promo.end_date = start_date + timedelta(days=payload.duration_days - 1)
    promo.status = "scheduled"
    db.commit()
    db.refresh(promo)
    return {
        "status": "promotion scheduled",
        "promotion": _promotion_dict(promo),
        "schedule": _promotion_schedule_state(promo),
    }


@router.post("/validate-code")
def validate_coupon(payload: CouponValidationRequest, db: Session = Depends(get_db)):
    code = _normalize_code(payload.code)
    promo = db.query(Promotion).filter(Promotion.code == code).first()
    if not promo:
        raise HTTPException(status_code=404, detail="Coupon code not found.")

    today = business_today()
    if promo.start_date > today or promo.end_date < today:
        raise HTTPException(status_code=409, detail="Coupon is not active today.")
    if promo.status not in {"active", "scheduled"}:
        raise HTTPException(status_code=409, detail="Coupon is not active.")

    discount = _calculate_discount(promo, payload.subtotal)
    taxable_subtotal = max(round(payload.subtotal - discount, 2), 0)
    charges = calculate_charges(db, taxable_subtotal)
    tax = charges["tax"]
    total = charges["total"]
    return {
        "valid": True,
        "promotion": _promotion_dict(promo),
        "subtotal": round(payload.subtotal, 2),
        "discount": discount,
        "service_charge": charges["service_charge"],
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
    start_date = business_today()
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


@router.post("/segment-campaign/{audience}")
def create_segment_campaign(
    audience: str,
    payload: RetentionCampaignCreate,
    db: Session = Depends(get_db),
    session: dict = Depends(require_roles("admin")),
):
    if payload.status not in VALID_STATUSES:
        raise HTTPException(status_code=422, detail="Unsupported campaign status.")
    if audience not in VALID_AUDIENCES:
        raise HTTPException(status_code=422, detail="Unsupported campaign audience.")

    template = _segment_campaign_template(audience)
    start_date = business_today()
    end_date = start_date + timedelta(days=payload.duration_days - 1)
    code = _normalize_code(payload.code) or _unique_retention_code(db, template["code_prefix"])
    if db.query(Promotion).filter(Promotion.code == code).first():
        raise HTTPException(status_code=409, detail="Promotion code already exists.")

    audience_count = _audience_query(db, audience).count()
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
        "status": "segment campaign created",
        "audience": audience,
        "audience_count": audience_count,
        "intent": template["intent"],
        "promotion": _promotion_dict(promo),
    }


@router.get("/providers/status")
def campaign_provider_statuses(
    session: dict = Depends(require_roles("admin")),
):
    channels = ["whatsapp", "sms", "email"]
    statuses = [_provider_readiness_status(channel) for channel in channels]
    all_configured = all(status["configured"] for status in statuses)
    return {
        "send_enabled": all(status["enabled"] for status in statuses),
        "configured_count": sum(1 for status in statuses if status["configured"]),
        "channels": statuses,
        "safe_test_mode": "dry_run_only",
        "live_send_blocked": not all_configured or not settings.CAMPAIGN_SEND_ENABLED,
        "compliance_summary": [
            "Consent is enforced before campaign delivery.",
            "Destinations are normalized before send attempts.",
            "Safe test sends never call live provider APIs.",
        ],
        "next_action": (
            "All providers are configured. Run dry-run proofs before live campaign sends."
            if all_configured and settings.CAMPAIGN_SEND_ENABLED
            else "Finish provider credentials, then run a dry-run proof for each channel."
        ),
    }


@router.get("/providers/dispatch-control")
def campaign_dispatch_control(
    db: Session = Depends(get_db),
    session: dict = Depends(require_roles("admin")),
):
    channels = [_dispatch_control_channel(db, channel) for channel in CHANNEL_ORDER]
    delivery_counts = {
        "attempted_count": sum(channel["counts"]["attempted_count"] for channel in channels),
        "sent_count": sum(channel["counts"]["sent_count"] for channel in channels),
        "dry_run_count": sum(channel["counts"]["dry_run_count"] for channel in channels),
        "failed_count": sum(channel["counts"]["failed_count"] for channel in channels),
        "skipped_count": sum(channel["counts"]["skipped_count"] for channel in channels),
        "needs_attention_count": sum(channel["counts"]["needs_attention_count"] for channel in channels),
        "provider_issue_count": sum(channel["counts"]["provider_issue_count"] for channel in channels),
    }
    configured_count = sum(1 for channel in channels if channel["provider_status"]["configured"])
    live_ready_count = sum(1 for channel in channels if channel["activation_status"] == "live_ready")
    blocked_count = len(channels) - live_ready_count
    recent_deliveries = (
        db.query(CampaignDelivery)
        .order_by(CampaignDelivery.attempted_at.desc(), CampaignDelivery.id.desc())
        .limit(8)
        .all()
    )
    recent_provider_tests = (
        db.query(ProviderTestRun)
        .order_by(ProviderTestRun.generated_at.desc(), ProviderTestRun.id.desc())
        .limit(8)
        .all()
    )
    if live_ready_count == len(CHANNEL_ORDER):
        overall_status = "live_ready"
        next_action = "All channels are live-ready. Use the send queue for campaign-level approval."
    elif configured_count:
        overall_status = "partially_ready"
        next_action = "Complete the remaining channel blockers, then run dry-run proof before live sending."
    else:
        overall_status = "setup_needed"
        next_action = "Add provider credentials and keep test sends in dry-run mode until proof is recorded."

    return {
        "generated_at": datetime.utcnow().isoformat(),
        "summary": {
            "overall_status": overall_status,
            "send_enabled": settings.CAMPAIGN_SEND_ENABLED,
            "configured_count": configured_count,
            "live_ready_count": live_ready_count,
            "blocked_count": blocked_count,
            **delivery_counts,
            "next_action": next_action,
        },
        "channels": channels,
        "controls": [
            {
                "label": "Secret-safe activation",
                "status": "enforced",
                "detail": "Only missing setting names and masked recipients are shown; provider secrets are never returned.",
            },
            {
                "label": "Consent gate",
                "status": "enforced",
                "detail": "Campaign delivery skips customers without promotional opt-in before any provider call.",
            },
            {
                "label": "Dry-run proof",
                "status": "enforced",
                "detail": "Live campaign sends stay blocked until a dry-run receipt exists for the channel.",
            },
            {
                "label": "Recovery queue",
                "status": "ready",
                "detail": "Failed and skipped deliveries are classified for resend or contact-cleanup action.",
            },
        ],
        "recent_delivery_events": [_delivery_proof_dict(delivery) for delivery in recent_deliveries],
        "recent_provider_tests": [_provider_test_run_dict(test_run) for test_run in recent_provider_tests],
    }


@router.get("/providers/delivery-events/export.csv")
def export_campaign_delivery_events_csv(
    channel: str | None = Query(None),
    status: str | None = Query(None),
    reason: str | None = Query(None),
    limit: int = Query(500, ge=1, le=5000),
    db: Session = Depends(get_db),
    session: dict = Depends(require_roles("admin", "staff")),
):
    query = db.query(CampaignDelivery)
    filename_parts = ["delivery_events"]

    if channel:
        normalized_channel = channel.strip().lower()
        if normalized_channel not in VALID_CHANNELS:
            raise HTTPException(status_code=422, detail="Unsupported delivery channel filter.")
        query = query.filter(CampaignDelivery.channel == normalized_channel)
        filename_parts.append(normalized_channel)

    if status:
        normalized_status = status.strip().lower()
        if normalized_status == "needs_attention":
            query = query.filter(CampaignDelivery.status.in_(["failed", "skipped"]))
        elif normalized_status in {"sent", "dry_run", "failed", "skipped", "pending"}:
            query = query.filter(CampaignDelivery.status == normalized_status)
        else:
            raise HTTPException(status_code=422, detail="Unsupported delivery status filter.")
        filename_parts.append(normalized_status)

    normalized_reason = reason.strip().lower() if reason else None
    if normalized_reason:
        if normalized_reason not in VALID_DELIVERY_REASON_FILTERS:
            raise HTTPException(status_code=422, detail="Unsupported delivery reason filter.")
        filename_parts.append(normalized_reason)

    fetch_limit = limit if not normalized_reason else 5000
    deliveries = (
        query.order_by(CampaignDelivery.attempted_at.desc(), CampaignDelivery.id.desc())
        .limit(fetch_limit)
        .all()
    )
    if normalized_reason:
        deliveries = [
            delivery
            for delivery in deliveries
            if _delivery_issue_reason(delivery) == normalized_reason
        ][:limit]

    return StreamingResponse(
        iter([_campaign_delivery_audit_csv(deliveries)]),
        media_type="text/csv",
        headers={"Content-Disposition": f"attachment; filename={'_'.join(filename_parts)}.csv"},
    )


@router.get("/providers/test-runs/export.csv")
def export_provider_test_runs_csv(
    channel: str | None = Query(None),
    limit: int = Query(250, ge=1, le=2000),
    db: Session = Depends(get_db),
    session: dict = Depends(require_roles("admin", "staff")),
):
    query = db.query(ProviderTestRun)
    if channel:
        normalized_channel = channel.strip().lower()
        if normalized_channel not in VALID_CHANNELS:
            raise HTTPException(status_code=422, detail="Unsupported provider test channel.")
        query = query.filter(ProviderTestRun.channel == normalized_channel)
        filename_suffix = normalized_channel
    else:
        filename_suffix = "all"

    test_runs = (
        query.order_by(ProviderTestRun.generated_at.desc(), ProviderTestRun.id.desc())
        .limit(limit)
        .all()
    )
    return StreamingResponse(
        iter([_provider_test_audit_csv(test_runs)]),
        media_type="text/csv",
        headers={"Content-Disposition": f"attachment; filename=provider_test_audit_{filename_suffix}.csv"},
    )


@router.post("/providers/test-send")
def provider_test_send(
    payload: ProviderTestSendRequest,
    db: Session = Depends(get_db),
    session: dict = Depends(require_roles("admin", "staff")),
):
    channel = payload.channel.strip().lower()
    if channel not in VALID_CHANNELS:
        raise HTTPException(status_code=422, detail="Unsupported provider test channel.")

    destination = normalize_campaign_destination(channel, payload.recipient.strip())
    if not destination:
        raise HTTPException(status_code=422, detail="Recipient could not be normalized for this channel.")

    generated_at = datetime.utcnow()
    message_preview = _render_provider_test_message(payload.message_template.strip())
    provider_status = _provider_readiness_status(channel)
    test_id = f"provider-dryrun-{channel}-{generated_at.strftime('%Y%m%d%H%M%S%f')}"
    result = {
        "status": "dry_run_test_generated",
        "mode": "dry_run_only",
        "generated_at": generated_at.isoformat(),
        "test_id": test_id,
        "channel": channel,
        "provider_status": provider_status,
        "recipient_masked": _masked_destination(channel, destination),
        "normalized_destination": destination,
        "message_preview": message_preview,
        "queued": False,
        "live_send_blocked": True,
        "compliance_checks": provider_status["compliance_checks"],
        "next_action": provider_status["next_action"],
    }
    test_run = ProviderTestRun(
        test_id=test_id,
        channel=channel,
        provider=provider_status.get("provider"),
        recipient_masked=result["recipient_masked"],
        message_preview=message_preview,
        queued=False,
        live_send_blocked=True,
        response_payload={
            "mode": "dry_run_only",
            "provider_status": {
                "provider": provider_status.get("provider"),
                "configured": provider_status.get("configured"),
                "missing_settings": provider_status.get("missing_settings"),
            },
            "next_action": provider_status.get("next_action"),
        },
        generated_at=generated_at,
    )
    db.add(test_run)
    db.commit()
    db.refresh(test_run)
    return {
        **result,
        "audit": _provider_test_run_dict(test_run),
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
    if (
        promo.status == "scheduled"
        and promo.start_date > business_today()
        and not payload.dry_run
        and not payload.force_resend
    ):
        raise HTTPException(
            status_code=409,
            detail=f"Scheduled campaign is not due until {promo.start_date.isoformat()}.",
        )

    customers = (
        _audience_query(db, promo.audience or "marketing_opt_in")
        .order_by(Customer.last_order_at.desc().nullslast(), Customer.id.desc())
        .limit(payload.limit)
        .all()
    )
    deliveries: list[CampaignDelivery] = []
    provider_status = campaign_provider_status(promo.channel)
    if not payload.dry_run:
        expected_confirmation = _live_send_confirmation_phrase(promo)
        if payload.live_confirmation != expected_confirmation:
            raise HTTPException(
                status_code=409,
                detail=f"Live send requires confirmation phrase: {expected_confirmation}",
            )
        live_blockers = _live_send_preflight_blockers(
            db,
            promo,
            force_resend=payload.force_resend,
        )
        if live_blockers:
            raise HTTPException(
                status_code=409,
                detail=f"Live send blocked: {', '.join(live_blockers)}.",
            )

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


@router.post("/{promo_id}/deliveries/retry")
def retry_campaign_deliveries(
    promo_id: int,
    payload: CampaignDeliveryRetryRequest,
    db: Session = Depends(get_db),
    session: dict = Depends(require_roles("admin")),
):
    promo = db.get(Promotion, promo_id)
    if not promo:
        raise HTTPException(status_code=404, detail="Promotion not found")
    if promo.status not in {"active", "scheduled"} and not payload.dry_run:
        raise HTTPException(
            status_code=409,
            detail="Only active or scheduled campaigns can be retried live.",
        )
    if (
        promo.status == "scheduled"
        and promo.start_date > business_today()
        and not payload.dry_run
    ):
        raise HTTPException(
            status_code=409,
            detail=f"Scheduled campaign is not due until {promo.start_date.isoformat()}.",
        )

    status_filter = (payload.status or "needs_attention").strip().lower()
    reason_filter = (payload.reason or "all").strip().lower()
    source_deliveries = _delivery_retry_candidates(
        db,
        promo,
        status_filter=status_filter,
        reason_filter=reason_filter,
        limit=payload.limit,
    )
    provider_status = campaign_provider_status(promo.channel)
    seen_customer_ids: set[int] = set()
    skipped_source_count = 0
    retry_deliveries: list[CampaignDelivery] = []

    for source_delivery in source_deliveries:
        if not source_delivery.customer_id or not source_delivery.customer:
            skipped_source_count += 1
            continue
        if source_delivery.customer_id in seen_customer_ids:
            skipped_source_count += 1
            continue
        seen_customer_ids.add(source_delivery.customer_id)
        delivery = _retry_delivery_for_customer(
            promo,
            source_delivery.customer,
            source_delivery,
            provider_status,
            dry_run=payload.dry_run,
        )
        db.add(delivery)
        retry_deliveries.append(delivery)

    db.commit()
    for delivery in retry_deliveries:
        db.refresh(delivery)

    return {
        "promotion": _promotion_dict(promo),
        "provider_status": provider_status,
        "channel": promo.channel,
        "dry_run": payload.dry_run,
        "status_filter": status_filter,
        "reason_filter": reason_filter,
        "source_count": len(source_deliveries),
        "skipped_source_count": skipped_source_count,
        "retried_customer_count": len(retry_deliveries),
        **_delivery_counts(retry_deliveries),
        "deliveries": [_delivery_dict(delivery) for delivery in retry_deliveries],
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
