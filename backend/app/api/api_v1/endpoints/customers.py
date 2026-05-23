from datetime import datetime, timedelta
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy import func, or_
from sqlalchemy.orm import Session

from app.api.deps import get_db, require_roles
from app.models.domain import Customer

router = APIRouter()

VALID_CUSTOMER_SEGMENTS = {
    "all",
    "marketing_opt_in",
    "opted_out",
    "repeat_customers",
    "high_spenders",
    "with_email",
    "missing_email",
    "new_guests",
    "regular_guests",
    "vip_guests",
    "active_customers",
    "comeback_customers",
    "win_back_customers",
}


class CustomerCreate(BaseModel):
    name: Optional[str] = None
    phone: str
    email: Optional[str] = None
    opt_in_marketing: bool = True
    notes: Optional[str] = None


def serialize_customer(customer: Customer) -> dict:
    return {
        "id": customer.id,
        "name": customer.name,
        "phone": customer.phone,
        "email": customer.email,
        "opt_in_marketing": customer.opt_in_marketing,
        "total_orders": customer.total_orders,
        "total_spend": customer.total_spend,
        "first_seen_at": customer.first_seen_at.isoformat() if customer.first_seen_at else None,
        "last_order_at": customer.last_order_at.isoformat() if customer.last_order_at else None,
        "notes": customer.notes,
    }


def days_since(value: Optional[datetime]) -> Optional[int]:
    if not value:
        return None
    return max((datetime.utcnow() - value).days, 0)


def customer_tier(customer: Customer) -> tuple[str, str, int, int]:
    total_orders = int(customer.total_orders or 0)
    total_spend = float(customer.total_spend or 0)
    if total_orders >= 10 or total_spend >= 5000:
        return "VIP Slice Club", "Top tier", 100, 0
    if total_orders >= 3 or total_spend >= 1200:
        progress = min(round((total_orders / 10) * 100), 100)
        return "Regular Guest", "VIP Slice Club", progress, max(10 - total_orders, 0)
    progress = min(round((total_orders / 3) * 100), 100)
    return "New Guest", "Regular Guest", progress, max(3 - total_orders, 0)


def customer_cadence(customer: Customer) -> tuple[str, int]:
    age = days_since(customer.last_order_at)
    if age is None:
        return "No order yet", 50
    if age <= 7:
        return "Active this week", 35
    if age <= 30:
        return "Comeback offer due", 75
    return "Win-back priority", 95


def customer_recommended_action(customer: Customer, tier: str, cadence: str) -> str:
    if not customer.opt_in_marketing:
        return "Ask for marketing consent at next order"
    if not customer.email:
        return "Capture email for richer offers"
    if cadence == "Win-back priority":
        return "Send win-back coupon"
    if cadence == "Comeback offer due":
        return "Send comeback reminder"
    if tier == "VIP Slice Club":
        return "Invite to VIP party pack"
    if tier == "Regular Guest":
        return "Send loyalty bundle"
    return "Nudge second or third order"


def serialize_customer_retention(customer: Customer) -> dict:
    tier, next_tier, progress, orders_to_next = customer_tier(customer)
    cadence, priority_score = customer_cadence(customer)
    average_order_value = (
        round(float(customer.total_spend or 0) / int(customer.total_orders or 0), 2)
        if int(customer.total_orders or 0)
        else 0
    )
    if tier == "VIP Slice Club":
        segment = "vip"
    elif tier == "Regular Guest":
        segment = "regular"
    else:
        segment = "new"
    if cadence == "Win-back priority":
        segment = "win_back"
    elif cadence == "Comeback offer due":
        segment = "comeback"
    elif cadence == "Active this week":
        segment = "active"

    if not customer.opt_in_marketing:
        priority_score += 10
    if not customer.email:
        priority_score += 5
    if tier == "VIP Slice Club":
        priority_score += 10

    return {
        **serialize_customer(customer),
        "tier": tier,
        "next_tier": next_tier,
        "tier_progress_percent": progress,
        "orders_to_next_tier": orders_to_next,
        "average_order_value": average_order_value,
        "days_since_last_order": days_since(customer.last_order_at),
        "cadence": cadence,
        "retention_segment": segment,
        "recommended_action": customer_recommended_action(customer, tier, cadence),
        "priority_score": min(priority_score, 100),
    }


def retention_counts(customers: list[Customer]) -> dict:
    counts = {
        "new_guests": 0,
        "regular_guests": 0,
        "vip_guests": 0,
        "active_customers": 0,
        "comeback_customers": 0,
        "win_back_customers": 0,
    }
    for customer in customers:
        tier, _, _, _ = customer_tier(customer)
        cadence, _ = customer_cadence(customer)
        if tier == "VIP Slice Club":
            counts["vip_guests"] += 1
        elif tier == "Regular Guest":
            counts["regular_guests"] += 1
        else:
            counts["new_guests"] += 1
        if cadence == "Active this week":
            counts["active_customers"] += 1
        elif cadence == "Comeback offer due":
            counts["comeback_customers"] += 1
        elif cadence == "Win-back priority":
            counts["win_back_customers"] += 1
    return counts


def apply_customer_segment(query, segment: str):
    now = datetime.utcnow()
    comeback_after = now - timedelta(days=7)
    win_back_after = now - timedelta(days=30)
    if segment == "marketing_opt_in":
        return query.filter(Customer.opt_in_marketing.is_(True))
    if segment == "opted_out":
        return query.filter(Customer.opt_in_marketing.is_(False))
    if segment == "repeat_customers":
        return query.filter(Customer.total_orders >= 2)
    if segment == "high_spenders":
        return query.filter(Customer.total_spend >= 500)
    if segment == "with_email":
        return query.filter(Customer.email.isnot(None), Customer.email != "")
    if segment == "missing_email":
        return query.filter(or_(Customer.email.is_(None), Customer.email == ""))
    if segment == "new_guests":
        return query.filter(Customer.total_orders < 3, Customer.total_spend < 1200)
    if segment == "regular_guests":
        return query.filter(
            or_(Customer.total_orders >= 3, Customer.total_spend >= 1200),
            Customer.total_orders < 10,
            Customer.total_spend < 5000,
        )
    if segment == "vip_guests":
        return query.filter(or_(Customer.total_orders >= 10, Customer.total_spend >= 5000))
    if segment == "active_customers":
        return query.filter(Customer.last_order_at >= comeback_after)
    if segment == "comeback_customers":
        return query.filter(
            Customer.last_order_at < comeback_after,
            Customer.last_order_at >= win_back_after,
        )
    if segment == "win_back_customers":
        return query.filter(or_(Customer.last_order_at < win_back_after, Customer.last_order_at.is_(None)))
    return query


@router.get("/")
def list_customers(
    q: Optional[str] = None,
    segment: str = Query("all"),
    db: Session = Depends(get_db),
    session: dict = Depends(require_roles("admin", "staff")),
):
    if segment not in VALID_CUSTOMER_SEGMENTS:
        raise HTTPException(status_code=422, detail="Unsupported customer segment.")

    query = db.query(Customer)
    query = apply_customer_segment(query, segment)
    if q:
        search = f"%{q.strip()}%"
        query = query.filter(
            or_(
                Customer.name.ilike(search),
                Customer.phone.ilike(search),
                Customer.email.ilike(search),
                Customer.notes.ilike(search),
            )
        )

    customers = query.order_by(Customer.last_order_at.desc().nullslast(), Customer.id.desc()).limit(200).all()
    return [serialize_customer(customer) for customer in customers]


@router.post("/")
def create_or_update_customer(
    payload: CustomerCreate,
    db: Session = Depends(get_db),
    session: dict = Depends(require_roles("admin", "staff")),
):
    phone = payload.phone.strip()
    if not phone:
        raise HTTPException(status_code=422, detail="Phone is required.")

    customer = db.query(Customer).filter(Customer.phone == phone).first()
    if customer is None:
        customer = Customer(phone=phone, first_seen_at=datetime.utcnow())
        db.add(customer)

    customer.name = payload.name
    customer.email = payload.email
    customer.opt_in_marketing = payload.opt_in_marketing
    customer.notes = payload.notes

    db.commit()
    db.refresh(customer)
    return serialize_customer(customer)


@router.get("/summary")
def customer_summary(
    db: Session = Depends(get_db),
    session: dict = Depends(require_roles("admin", "staff")),
):
    total_customers = db.query(func.count(Customer.id)).scalar() or 0
    opted_in = db.query(func.count(Customer.id)).filter(Customer.opt_in_marketing.is_(True)).scalar() or 0
    total_spend = db.query(func.coalesce(func.sum(Customer.total_spend), 0)).scalar() or 0
    repeat_customers = db.query(func.count(Customer.id)).filter(Customer.total_orders > 1).scalar() or 0
    high_spenders = db.query(func.count(Customer.id)).filter(Customer.total_spend >= 500).scalar() or 0
    with_email = (
        db.query(func.count(Customer.id))
        .filter(Customer.email.isnot(None), Customer.email != "")
        .scalar()
        or 0
    )
    customers = db.query(Customer).all()

    return {
        "total_customers": total_customers,
        "opted_in_customers": opted_in,
        "opted_out_customers": max(total_customers - opted_in, 0),
        "repeat_customers": repeat_customers,
        "high_spenders": high_spenders,
        "email_ready_customers": with_email,
        "missing_email_customers": max(total_customers - with_email, 0),
        "recorded_spend": float(total_spend or 0),
        "retention_segments": retention_counts(customers),
    }


@router.get("/retention")
def customer_retention(
    limit: int = Query(50, ge=1, le=200),
    db: Session = Depends(get_db),
    session: dict = Depends(require_roles("admin", "staff")),
):
    customers = (
        db.query(Customer)
        .order_by(Customer.last_order_at.desc().nullslast(), Customer.id.desc())
        .limit(500)
        .all()
    )
    retention_rows = [serialize_customer_retention(customer) for customer in customers]
    retention_rows.sort(
        key=lambda customer: (
            customer["priority_score"],
            customer["last_order_at"] or "",
            customer["total_spend"] or 0,
        ),
        reverse=True,
    )
    counts = retention_counts(customers)
    return {
        "generated_at": datetime.utcnow().isoformat(),
        "counts": counts,
        "campaign_ready_count": sum(
            1 for customer in customers if customer.opt_in_marketing and customer.phone
        ),
        "average_order_value": (
            round(
                sum(float(customer.total_spend or 0) for customer in customers)
                / sum(int(customer.total_orders or 0) for customer in customers),
                2,
            )
            if sum(int(customer.total_orders or 0) for customer in customers)
            else 0
        ),
        "customers": retention_rows[:limit],
    }
