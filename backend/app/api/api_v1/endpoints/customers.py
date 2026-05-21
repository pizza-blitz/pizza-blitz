from datetime import datetime
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import func, or_
from sqlalchemy.orm import Session

from app.api.deps import get_db
from app.models.domain import Customer

router = APIRouter()


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


@router.get("/")
def list_customers(q: Optional[str] = None, db: Session = Depends(get_db)):
    query = db.query(Customer)
    if q:
        search = f"%{q.strip()}%"
        query = query.filter(or_(Customer.name.ilike(search), Customer.phone.ilike(search)))

    customers = query.order_by(Customer.last_order_at.desc().nullslast(), Customer.id.desc()).limit(200).all()
    return [serialize_customer(customer) for customer in customers]


@router.post("/")
def create_or_update_customer(payload: CustomerCreate, db: Session = Depends(get_db)):
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
def customer_summary(db: Session = Depends(get_db)):
    total_customers = db.query(func.count(Customer.id)).scalar() or 0
    opted_in = db.query(func.count(Customer.id)).filter(Customer.opt_in_marketing.is_(True)).scalar() or 0
    total_spend = db.query(func.coalesce(func.sum(Customer.total_spend), 0)).scalar() or 0
    repeat_customers = db.query(func.count(Customer.id)).filter(Customer.total_orders > 1).scalar() or 0

    return {
        "total_customers": total_customers,
        "opted_in_customers": opted_in,
        "repeat_customers": repeat_customers,
        "recorded_spend": float(total_spend or 0),
    }
