from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from sqlalchemy import func
from app.api.deps import get_db
from app.models.domain import Customer, DailySales, Promotion
from pydantic import BaseModel, Field
from typing import Optional
from datetime import date

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
    
    return {
        "promotion": promo.name,
        "avg_daily_sale_during": float(avg_sale or 0),
        "total_revenue_during": float(total_revenue or 0)
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
