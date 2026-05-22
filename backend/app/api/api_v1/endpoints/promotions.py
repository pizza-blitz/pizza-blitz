from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from sqlalchemy import func
from app.api.deps import get_db
from app.models.domain import CampaignDelivery, Customer, DailySales, Promotion, RestaurantOrder
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
DEFAULT_MESSAGE_TEMPLATE = (
    "Hi {name}, Pizza Blitz has {offer} for you. Use code {code} before {end_date}. "
    "Reply or visit us to order."
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


@router.get("/performance/{promo_id}")
def promotion_performance(promo_id: int, db: Session = Depends(get_db)):
    promo = db.get(Promotion, promo_id)
    if not promo:
        raise HTTPException(status_code=404, detail="Promotion not found")

    avg_sale, total_revenue = (
        db.query(func.avg(DailySales.total_sale), func.sum(DailySales.total_sale))
        .filter(DailySales.date.between(promo.start_date, promo.end_date))
        .one()
    )
    coupon_orders = []
    if promo.code:
        coupon_orders = (
            db.query(RestaurantOrder)
            .filter(RestaurantOrder.notes.like(f"%Coupon: {promo.code}%"))
            .all()
        )
    
    return {
        "promotion": promo.name,
        "avg_daily_sale_during": float(avg_sale or 0),
        "total_revenue_during": float(total_revenue or 0),
        "redemption_count": len(coupon_orders),
        "redemption_revenue": round(
            sum(float(order.total_amount or 0) for order in coupon_orders),
            2,
        ),
        "redemption_discount": round(
            sum(float(order.discount_amount or 0) for order in coupon_orders),
            2,
        ),
    }

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
