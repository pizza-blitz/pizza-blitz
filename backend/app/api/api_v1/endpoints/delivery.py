from datetime import datetime
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.api.deps import get_db
from app.models.domain import DeliveryAssignment, DeliveryZone, RestaurantOrder
from app.services.delivery_service import (
    delivery_quote,
    seed_default_delivery_zones,
    serialize_delivery_zone,
)


router = APIRouter()


class DeliveryQuoteRequest(BaseModel):
    address: str
    subtotal: float = 0.0
    zone_id: Optional[int] = None


class DeliveryZoneUpdate(BaseModel):
    name: Optional[str] = None
    keywords: Optional[List[str]] = None
    delivery_fee: Optional[float] = Field(default=None, ge=0)
    minimum_order_amount: Optional[float] = Field(default=None, ge=0)
    eta_min_minutes: Optional[int] = Field(default=None, ge=1)
    eta_max_minutes: Optional[int] = Field(default=None, ge=1)
    is_active: Optional[bool] = None


class DeliveryAssignmentUpdate(BaseModel):
    assigned_to: Optional[str] = None
    status: str = "assigned"
    notes: Optional[str] = None


def ensure_delivery_zones(db: Session) -> None:
    seed_default_delivery_zones(db)
    db.commit()


def serialize_delivery_assignment(assignment: DeliveryAssignment) -> dict:
    return {
        "id": assignment.id,
        "order_id": assignment.order_id,
        "zone_id": assignment.zone_id,
        "zone": serialize_delivery_zone(assignment.zone) if assignment.zone else None,
        "assigned_to": assignment.assigned_to,
        "status": assignment.status,
        "notes": assignment.notes,
        "assigned_at": assignment.assigned_at.isoformat() if assignment.assigned_at else None,
        "out_for_delivery_at": (
            assignment.out_for_delivery_at.isoformat()
            if assignment.out_for_delivery_at
            else None
        ),
        "delivered_at": assignment.delivered_at.isoformat() if assignment.delivered_at else None,
        "updated_at": assignment.updated_at.isoformat() if assignment.updated_at else None,
    }


@router.get("/zones")
def list_delivery_zones(db: Session = Depends(get_db)):
    ensure_delivery_zones(db)
    zones = (
        db.query(DeliveryZone)
        .order_by(DeliveryZone.delivery_fee.asc(), DeliveryZone.id.asc())
        .all()
    )
    return [serialize_delivery_zone(zone) for zone in zones]


@router.patch("/zones/{zone_id}")
def update_delivery_zone(
    zone_id: int,
    payload: DeliveryZoneUpdate,
    db: Session = Depends(get_db),
):
    ensure_delivery_zones(db)
    zone = db.query(DeliveryZone).filter(DeliveryZone.id == zone_id).first()
    if zone is None:
        raise HTTPException(status_code=404, detail="Delivery zone not found.")

    if payload.name is not None:
        name = payload.name.strip()
        if not name:
            raise HTTPException(status_code=422, detail="Delivery zone name is required.")
        duplicate = (
            db.query(DeliveryZone)
            .filter(DeliveryZone.name == name)
            .filter(DeliveryZone.id != zone_id)
            .first()
        )
        if duplicate:
            raise HTTPException(status_code=409, detail="A delivery zone with this name already exists.")
        zone.name = name

    if payload.keywords is not None:
        zone.keywords = [
            keyword.strip().lower()
            for keyword in payload.keywords
            if keyword and keyword.strip()
        ]
    if payload.delivery_fee is not None:
        zone.delivery_fee = round(float(payload.delivery_fee), 2)
    if payload.minimum_order_amount is not None:
        zone.minimum_order_amount = round(float(payload.minimum_order_amount), 2)
    if payload.eta_min_minutes is not None:
        zone.eta_min_minutes = int(payload.eta_min_minutes)
    if payload.eta_max_minutes is not None:
        zone.eta_max_minutes = int(payload.eta_max_minutes)
    if (
        zone.eta_min_minutes is not None
        and zone.eta_max_minutes is not None
        and zone.eta_min_minutes > zone.eta_max_minutes
    ):
        raise HTTPException(status_code=422, detail="Minimum ETA cannot be greater than maximum ETA.")
    if payload.is_active is not None:
        zone.is_active = payload.is_active

    db.commit()
    db.refresh(zone)
    return serialize_delivery_zone(zone)


@router.post("/quote")
def quote_delivery(payload: DeliveryQuoteRequest, db: Session = Depends(get_db)):
    ensure_delivery_zones(db)
    try:
        return delivery_quote(
            db,
            address=payload.address,
            subtotal=payload.subtotal,
            zone_id=payload.zone_id,
        )
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


@router.get("/queue")
def delivery_queue(db: Session = Depends(get_db)):
    ensure_delivery_zones(db)
    orders = (
        db.query(RestaurantOrder)
        .filter(RestaurantOrder.order_type == "delivery")
        .filter(RestaurantOrder.status != "closed")
        .order_by(RestaurantOrder.created_at.asc(), RestaurantOrder.id.asc())
        .all()
    )
    return {
        "count": len(orders),
        "orders": [
            {
                "id": order.id,
                "customer_name": order.customer_name,
                "customer_phone": order.customer_phone,
                "total_amount": order.total_amount,
                "payment_status": order.payment_status,
                "order_status": order.status,
                "notes": order.notes,
                "assignment": (
                    serialize_delivery_assignment(order.delivery_assignment)
                    if order.delivery_assignment
                    else None
                ),
            }
            for order in orders
        ],
    }


@router.patch("/orders/{order_id}/assignment")
def update_delivery_assignment(
    order_id: int,
    payload: DeliveryAssignmentUpdate,
    db: Session = Depends(get_db),
):
    ensure_delivery_zones(db)
    order = db.query(RestaurantOrder).filter(RestaurantOrder.id == order_id).first()
    if not order:
        raise HTTPException(status_code=404, detail="Order not found.")
    if order.order_type != "delivery":
        raise HTTPException(status_code=409, detail="Only delivery orders can be assigned.")

    status = payload.status.strip().lower()
    allowed_statuses = {"unassigned", "assigned", "out_for_delivery", "delivered", "failed"}
    if status not in allowed_statuses:
        raise HTTPException(
            status_code=422,
            detail=f"Status must be one of: {', '.join(sorted(allowed_statuses))}.",
        )

    assignment = order.delivery_assignment
    if assignment is None:
        assignment = DeliveryAssignment(order_id=order.id)
        db.add(assignment)

    if payload.assigned_to is not None:
        assignment.assigned_to = payload.assigned_to.strip() or None
    assignment.status = status
    assignment.notes = payload.notes
    now = datetime.utcnow()
    if status == "assigned" and assignment.assigned_at is None:
        assignment.assigned_at = now
    if status == "out_for_delivery" and assignment.out_for_delivery_at is None:
        assignment.out_for_delivery_at = now
        if order.status == "open":
            order.status = "ready"
    if status == "delivered" and assignment.delivered_at is None:
        assignment.delivered_at = now
    assignment.updated_at = now

    db.commit()
    db.refresh(assignment)
    return {
        "assignment": serialize_delivery_assignment(assignment),
        "order_status": order.status,
    }
