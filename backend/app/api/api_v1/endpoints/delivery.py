import secrets
from datetime import datetime
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.api.deps import get_db, require_roles
from app.core.config import settings
from app.models.domain import DeliveryAssignment, DeliveryZone, RestaurantOrder
from app.services.aggregator_service import queue_status_event
from app.services.delivery_service import (
    delivery_address_validation,
    delivery_quote,
    match_delivery_zone,
    seed_default_delivery_zones,
    serialize_delivery_zone,
)
from app.services.operational_audit_service import record_operational_audit_event
from app.services.order_notification_service import notify_order_event


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


class DeliveryZoneCreate(BaseModel):
    name: str
    keywords: List[str] = Field(default_factory=list)
    delivery_fee: float = Field(default=0, ge=0)
    minimum_order_amount: float = Field(default=0, ge=0)
    eta_min_minutes: int = Field(default=25, ge=1)
    eta_max_minutes: int = Field(default=45, ge=1)
    is_active: bool = True


class DeliveryAssignmentUpdate(BaseModel):
    assigned_to: Optional[str] = None
    status: str = "assigned"
    notes: Optional[str] = None


class RiderLocationUpdate(BaseModel):
    lat: float = Field(ge=-90, le=90)
    lng: float = Field(ge=-180, le=180)


class RiderProofCreate(BaseModel):
    proof_type: str = Field(pattern="^(photo|signature|otp)$")
    reference: str = Field(min_length=3, max_length=500)
    notes: Optional[str] = Field(default=None, max_length=500)


class RiderStatusUpdate(BaseModel):
    status: str
    notes: Optional[str] = Field(default=None, max_length=500)


def ensure_delivery_zones(db: Session) -> None:
    seed_default_delivery_zones(db)
    db.commit()


def normalized_keywords(keywords: Optional[List[str]]) -> list[str]:
    return [
        keyword.strip().lower()
        for keyword in (keywords or [])
        if keyword and keyword.strip()
    ]


def validate_eta_window(min_minutes: int, max_minutes: int) -> None:
    if min_minutes > max_minutes:
        raise HTTPException(status_code=422, detail="Minimum ETA cannot be greater than maximum ETA.")


def serialize_delivery_assignment(assignment: DeliveryAssignment) -> dict:
    next_action = "Assign a delivery partner."
    if assignment.status == "assigned":
        next_action = "Dispatch the order when the rider leaves."
    elif assignment.status == "out_for_delivery":
        next_action = "Mark delivered after customer handoff."
    elif assignment.status == "delivered":
        next_action = "Close the order after payment is settled."
    elif assignment.status == "failed":
        next_action = "Review the failure note and contact the customer."

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
        "rider_phone": assignment.rider_phone,
        "has_rider_token": bool(assignment.rider_token),
        "location": (
            {
                "lat": assignment.current_lat,
                "lng": assignment.current_lng,
                "updated_at": assignment.location_updated_at.isoformat()
                if assignment.location_updated_at
                else None,
            }
            if assignment.current_lat is not None and assignment.current_lng is not None
            else None
        ),
        "proof_type": assignment.proof_type,
        "proof_captured_at": (
            assignment.proof_captured_at.isoformat()
            if assignment.proof_captured_at
            else None
        ),
        "next_action": next_action,
    }


def delivery_economics_next_actions(
    *,
    active_zones: list[DeliveryZone],
    inactive_count: int,
    unassigned_count: int,
    payment_due_count: int,
) -> list[str]:
    actions: list[str] = []
    if not active_zones:
        actions.append("Activate at least one delivery zone before accepting delivery orders.")
    if inactive_count:
        actions.append(f"Review {inactive_count} inactive zone(s) before campaign pushes.")
    if active_zones and not any(float(zone.minimum_order_amount or 0) > 0 for zone in active_zones):
        actions.append("Add a minimum order to far zones so delivery fees do not erase margin.")
    if unassigned_count:
        actions.append(f"Assign riders to {unassigned_count} active delivery order(s).")
    if payment_due_count:
        actions.append(f"Confirm payment before closing {payment_due_count} prepaid delivery order(s).")
    if not actions:
        actions.append("Run one customer delivery checkout proof after any fee or ETA change.")
    return actions


def delivery_priority_rank(order: dict) -> int:
    status = order.get("assignment_status") or "unassigned"
    if order.get("requires_address_review"):
        return 0
    if order.get("payment_due"):
        return 1
    if status == "unassigned" or not order.get("assigned_to"):
        return 2
    if status == "assigned":
        return 3
    if status == "out_for_delivery":
        return 4
    if status == "failed":
        return 5
    if status == "delivered":
        return 6
    return 7


def delivery_mission_summary(
    *,
    queue_orders: list[dict],
    zones: list[DeliveryZone],
) -> dict:
    active_zones = [zone for zone in zones if zone.is_active]
    inactive_count = len(zones) - len(active_zones)
    active_fees = [float(zone.delivery_fee or 0) for zone in active_zones]
    active_eta_max = [int(zone.eta_max_minutes or 0) for zone in active_zones]
    minimum_order_zones = [
        zone for zone in active_zones if float(zone.minimum_order_amount or 0) > 0
    ]
    keyword_count = sum(len(zone.keywords or []) for zone in active_zones)
    unassigned_count = sum(
        1
        for order in queue_orders
        if order["assignment_status"] == "unassigned" or not order["assigned_to"]
    )
    assigned_count = sum(
        1 for order in queue_orders if order["assignment_status"] == "assigned"
    )
    out_for_delivery_count = sum(
        1 for order in queue_orders if order["assignment_status"] == "out_for_delivery"
    )
    delivered_count = sum(
        1 for order in queue_orders if order["assignment_status"] == "delivered"
    )
    failed_count = sum(
        1 for order in queue_orders if order["assignment_status"] == "failed"
    )
    address_review_count = sum(
        1 for order in queue_orders if order["requires_address_review"]
    )
    payment_due_count = sum(1 for order in queue_orders if order["payment_due"])
    dispatch_ready_count = sum(
        1
        for order in queue_orders
        if order["assignment_status"] == "assigned"
        and order["assigned_to"]
        and not order["requires_address_review"]
        and not order["payment_due"]
    )
    ready_to_close_count = sum(
        1
        for order in queue_orders
        if order["assignment_status"] == "delivered"
        and not order["requires_address_review"]
        and not order["payment_due"]
    )

    if not active_zones:
        overall_status = "no_zones"
        next_action = "Activate one delivery zone before taking delivery orders."
    elif address_review_count:
        overall_status = "address_review"
        next_action = f"Confirm address details for {address_review_count} delivery order(s)."
    elif unassigned_count:
        overall_status = "needs_assignment"
        next_action = f"Assign riders to {unassigned_count} delivery order(s)."
    elif payment_due_count:
        overall_status = "payment_blocked"
        next_action = f"Confirm prepaid payment for {payment_due_count} delivery order(s)."
    elif dispatch_ready_count:
        overall_status = "dispatch_ready"
        next_action = f"Dispatch {dispatch_ready_count} assigned delivery order(s)."
    elif out_for_delivery_count:
        overall_status = "handoff_pending"
        next_action = f"Track {out_for_delivery_count} order(s) until customer handoff."
    else:
        overall_status = "stable"
        next_action = "Delivery queue is stable."

    return {
        "overall_status": overall_status,
        "next_action": next_action,
        "active_zone_count": len(active_zones),
        "inactive_zone_count": inactive_count,
        "lowest_fee": round(min(active_fees), 2) if active_fees else 0,
        "highest_fee": round(max(active_fees), 2) if active_fees else 0,
        "average_fee": round(sum(active_fees) / len(active_fees), 2) if active_fees else 0,
        "longest_eta_minutes": max(active_eta_max) if active_eta_max else 0,
        "minimum_order_zone_count": len(minimum_order_zones),
        "coverage_keyword_count": keyword_count,
        "open_delivery_count": len(queue_orders),
        "open_delivery_value": round(
            sum(float(order["total_amount"] or 0) for order in queue_orders),
            2,
        ),
        "unassigned_count": unassigned_count,
        "assigned_count": assigned_count,
        "out_for_delivery_count": out_for_delivery_count,
        "delivered_count": delivered_count,
        "failed_count": failed_count,
        "address_review_count": address_review_count,
        "payment_due_count": payment_due_count,
        "dispatch_ready_count": dispatch_ready_count,
        "ready_to_close_count": ready_to_close_count,
    }


def delivery_mission_controls(summary: dict) -> list[dict]:
    return [
        {
            "label": "Zone pricing gate",
            "status": "ready" if summary["active_zone_count"] else "blocked",
            "count": summary["active_zone_count"],
            "detail": (
                f"Rs {summary['lowest_fee']:.0f}-Rs {summary['highest_fee']:.0f} fees | "
                f"{summary['minimum_order_zone_count']} minimum rules"
            ),
        },
        {
            "label": "Address validation gate",
            "status": "blocked" if summary["address_review_count"] else "ready",
            "count": summary["address_review_count"],
            "detail": "Confirm weak addresses before rider dispatch.",
        },
        {
            "label": "Rider assignment gate",
            "status": "blocked" if summary["unassigned_count"] else "ready",
            "count": summary["unassigned_count"],
            "detail": "Every active delivery needs a rider owner.",
        },
        {
            "label": "Payment close gate",
            "status": "blocked" if summary["payment_due_count"] else "ready",
            "count": summary["payment_due_count"],
            "detail": "Prepaid orders must be paid before close.",
        },
        {
            "label": "ETA handoff",
            "status": "ready" if summary["dispatch_ready_count"] else "watch",
            "count": summary["dispatch_ready_count"],
            "detail": f"Longest active ETA is {summary['longest_eta_minutes']} min.",
        },
    ]


def delivery_mission_next_actions(summary: dict) -> list[str]:
    actions = [summary["next_action"]]
    if summary["inactive_zone_count"]:
        actions.append(f"Review {summary['inactive_zone_count']} inactive delivery zone(s).")
    if summary["minimum_order_zone_count"] == 0 and summary["active_zone_count"]:
        actions.append("Add minimum order rules for far zones to protect delivery margin.")
    if summary["dispatch_ready_count"]:
        actions.append("Move assigned orders to out for delivery once the rider leaves.")
    if summary["ready_to_close_count"]:
        actions.append(f"Close {summary['ready_to_close_count']} delivered order(s) after receipt check.")
    if len(actions) == 1 and summary["overall_status"] == "stable":
        actions.append("Run one checkout and delivery proof after any fee, ETA, or zone change.")
    return actions


def note_value(notes: Optional[str], label: str) -> Optional[str]:
    if not notes:
        return None
    prefix = f"{label}:"
    for part in notes.split("|"):
        text = part.strip()
        if text.lower().startswith(prefix.lower()):
            value = text[len(prefix):].strip()
            return value or None
    return None


def is_payment_due(order: RestaurantOrder) -> bool:
    return (
        (order.payment_method or "").lower() == "prepaid"
        and (order.payment_status or "").lower() != "paid"
    )


def delivery_zone_for_order(
    db: Session,
    order: RestaurantOrder,
    address: Optional[str],
) -> Optional[DeliveryZone]:
    if order.delivery_assignment and order.delivery_assignment.zone:
        return order.delivery_assignment.zone

    zone_name = note_value(order.notes, "Delivery Zone")
    if zone_name:
        zone = db.query(DeliveryZone).filter(DeliveryZone.name == zone_name).first()
        if zone:
            return zone

    if address:
        return match_delivery_zone(db, address)
    return None


def address_validation_for_order(
    db: Session,
    order: RestaurantOrder,
    address: Optional[str],
) -> dict:
    if not address:
        return {
            "quality": "weak",
            "score": 0,
            "matched_keyword": None,
            "warnings": ["Add a customer delivery address before assigning a rider."],
            "requires_review": True,
        }

    zone = delivery_zone_for_order(db, order, address)
    return delivery_address_validation(
        address,
        zone,
        zone_id=order.delivery_assignment.zone_id if order.delivery_assignment else None,
    )


def delivery_next_action(
    order: RestaurantOrder,
    validation: dict,
    assignment: Optional[dict],
) -> str:
    if validation.get("requires_review"):
        return "Call the customer to confirm address details before dispatch."
    if is_payment_due(order):
        return "Confirm prepaid payment before closing this delivery."
    if not assignment or not assignment.get("assigned_to"):
        return "Assign a delivery partner."
    return assignment.get("next_action") or "Keep delivery status updated."


def serialize_delivery_queue_order(db: Session, order: RestaurantOrder) -> dict:
    address = note_value(order.notes, "Address")
    validation = address_validation_for_order(db, order, address)
    assignment = (
        serialize_delivery_assignment(order.delivery_assignment)
        if order.delivery_assignment
        else None
    )
    assignment_status = assignment["status"] if assignment else "unassigned"
    assigned_to = assignment["assigned_to"] if assignment else None
    payment_due = is_payment_due(order)
    return {
        "id": order.id,
        "customer_name": order.customer_name,
        "customer_phone": order.customer_phone,
        "total_amount": round(float(order.total_amount or 0), 2),
        "payment_status": order.payment_status,
        "payment_due": payment_due,
        "payment_blocked": payment_due,
        "order_status": order.status,
        "delivery_address": address,
        "delivery_zone": note_value(order.notes, "Delivery Zone"),
        "delivery_fee": note_value(order.notes, "Delivery Fee"),
        "eta_window": note_value(order.notes, "ETA"),
        "notes": order.notes,
        "assignment": assignment,
        "assignment_status": assignment_status,
        "assigned_to": assigned_to,
        "address_validation": validation,
        "requires_address_review": bool(validation.get("requires_review")),
        "next_action": delivery_next_action(order, validation, assignment),
    }


@router.get("/zones")
def list_delivery_zones(db: Session = Depends(get_db)):
    zones = (
        db.query(DeliveryZone)
        .order_by(DeliveryZone.delivery_fee.asc(), DeliveryZone.id.asc())
        .all()
    )
    if not zones:
        ensure_delivery_zones(db)
        zones = (
            db.query(DeliveryZone)
            .order_by(DeliveryZone.delivery_fee.asc(), DeliveryZone.id.asc())
            .all()
        )
    return [serialize_delivery_zone(zone) for zone in zones]


@router.post("/zones")
def create_delivery_zone(
    payload: DeliveryZoneCreate,
    request: Request,
    db: Session = Depends(get_db),
    session: dict = Depends(require_roles("admin")),
):
    ensure_delivery_zones(db)
    name = payload.name.strip()
    if not name:
        raise HTTPException(status_code=422, detail="Delivery zone name is required.")
    duplicate = db.query(DeliveryZone).filter(DeliveryZone.name == name).first()
    if duplicate:
        raise HTTPException(status_code=409, detail="A delivery zone with this name already exists.")
    validate_eta_window(payload.eta_min_minutes, payload.eta_max_minutes)

    zone = DeliveryZone(
        name=name,
        keywords=normalized_keywords(payload.keywords),
        delivery_fee=round(float(payload.delivery_fee or 0), 2),
        minimum_order_amount=round(float(payload.minimum_order_amount or 0), 2),
        eta_min_minutes=int(payload.eta_min_minutes),
        eta_max_minutes=int(payload.eta_max_minutes),
        is_active=payload.is_active,
    )
    db.add(zone)
    db.commit()
    db.refresh(zone)
    record_operational_audit_event(
        db,
        session=session,
        request=request,
        event_type="delivery",
        action="delivery_zone_create",
        resource_type="delivery_zone",
        resource_id=zone.id,
        detail=f"Delivery zone {zone.name} created.",
        metadata={
            "delivery_fee": round(float(zone.delivery_fee or 0), 2),
            "minimum_order_amount": round(float(zone.minimum_order_amount or 0), 2),
            "keyword_count": len(zone.keywords or []),
            "is_active": bool(zone.is_active),
        },
    )
    return serialize_delivery_zone(zone)


@router.get("/economics")
def delivery_economics(
    db: Session = Depends(get_db),
    session: dict = Depends(require_roles("admin")),
):
    ensure_delivery_zones(db)
    zones = (
        db.query(DeliveryZone)
        .order_by(DeliveryZone.delivery_fee.asc(), DeliveryZone.id.asc())
        .all()
    )
    active_zones = [zone for zone in zones if zone.is_active]
    inactive_count = len(zones) - len(active_zones)
    active_fees = [float(zone.delivery_fee or 0) for zone in active_zones]
    active_eta_max = [int(zone.eta_max_minutes or 0) for zone in active_zones]
    minimum_order_zones = [
        zone for zone in active_zones if float(zone.minimum_order_amount or 0) > 0
    ]
    keyword_count = sum(len(zone.keywords or []) for zone in active_zones)

    orders = (
        db.query(RestaurantOrder)
        .filter(RestaurantOrder.order_type == "delivery")
        .filter(RestaurantOrder.status.notin_(["closed", "cancelled"]))
        .order_by(RestaurantOrder.created_at.asc(), RestaurantOrder.id.asc())
        .all()
    )
    unassigned_count = sum(
        1
        for order in orders
        if not order.delivery_assignment or not order.delivery_assignment.assigned_to
    )
    payment_due_count = sum(
        1
        for order in orders
        if (order.payment_method or "").lower() == "prepaid"
        and (order.payment_status or "").lower() != "paid"
    )
    open_delivery_value = round(
        sum(float(order.total_amount or 0) for order in orders),
        2,
    )

    return {
        "generated_at": datetime.utcnow().isoformat(),
        "summary": {
            "active_zone_count": len(active_zones),
            "inactive_zone_count": inactive_count,
            "lowest_fee": round(min(active_fees), 2) if active_fees else 0,
            "highest_fee": round(max(active_fees), 2) if active_fees else 0,
            "average_fee": round(sum(active_fees) / len(active_fees), 2) if active_fees else 0,
            "longest_eta_minutes": max(active_eta_max) if active_eta_max else 0,
            "minimum_order_zone_count": len(minimum_order_zones),
            "coverage_keyword_count": keyword_count,
            "open_delivery_count": len(orders),
            "open_delivery_value": open_delivery_value,
            "unassigned_count": unassigned_count,
            "payment_due_count": payment_due_count,
        },
        "zones": [serialize_delivery_zone(zone) for zone in zones],
        "queue_preview": [
            {
                "id": order.id,
                "customer_name": order.customer_name,
                "delivery_zone": note_value(order.notes, "Delivery Zone"),
                "delivery_fee": note_value(order.notes, "Delivery Fee"),
                "eta_window": note_value(order.notes, "ETA"),
                "total_amount": round(float(order.total_amount or 0), 2),
                "payment_status": order.payment_status,
                "assignment_status": (
                    order.delivery_assignment.status
                    if order.delivery_assignment
                    else "unassigned"
                ),
                "assigned_to": (
                    order.delivery_assignment.assigned_to
                    if order.delivery_assignment
                    else None
                ),
            }
            for order in orders[:8]
        ],
        "next_actions": delivery_economics_next_actions(
            active_zones=active_zones,
            inactive_count=inactive_count,
            unassigned_count=unassigned_count,
            payment_due_count=payment_due_count,
        ),
    }


@router.get("/mission-control")
def delivery_mission_control(
    db: Session = Depends(get_db),
    session: dict = Depends(require_roles("admin", "staff")),
):
    del session
    ensure_delivery_zones(db)
    zones = (
        db.query(DeliveryZone)
        .order_by(DeliveryZone.delivery_fee.asc(), DeliveryZone.id.asc())
        .all()
    )
    orders = (
        db.query(RestaurantOrder)
        .filter(RestaurantOrder.order_type == "delivery")
        .filter(RestaurantOrder.status.notin_(["closed", "cancelled"]))
        .order_by(RestaurantOrder.created_at.asc(), RestaurantOrder.id.asc())
        .all()
    )
    queue_orders = [serialize_delivery_queue_order(db, order) for order in orders]
    summary = delivery_mission_summary(queue_orders=queue_orders, zones=zones)
    priority_orders = sorted(queue_orders, key=delivery_priority_rank)[:8]

    return {
        "generated_at": datetime.utcnow().isoformat(),
        "summary": summary,
        "controls": delivery_mission_controls(summary),
        "zones": [serialize_delivery_zone(zone) for zone in zones],
        "priority_orders": priority_orders,
        "next_actions": delivery_mission_next_actions(summary),
    }


@router.patch("/zones/{zone_id}")
def update_delivery_zone(
    zone_id: int,
    payload: DeliveryZoneUpdate,
    request: Request,
    db: Session = Depends(get_db),
    session: dict = Depends(require_roles("admin")),
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
        zone.keywords = normalized_keywords(payload.keywords)
    if payload.delivery_fee is not None:
        zone.delivery_fee = round(float(payload.delivery_fee), 2)
    if payload.minimum_order_amount is not None:
        zone.minimum_order_amount = round(float(payload.minimum_order_amount), 2)
    if payload.eta_min_minutes is not None:
        zone.eta_min_minutes = int(payload.eta_min_minutes)
    if payload.eta_max_minutes is not None:
        zone.eta_max_minutes = int(payload.eta_max_minutes)
    if zone.eta_min_minutes is not None and zone.eta_max_minutes is not None:
        validate_eta_window(zone.eta_min_minutes, zone.eta_max_minutes)
    if payload.is_active is not None:
        zone.is_active = payload.is_active

    db.commit()
    db.refresh(zone)
    record_operational_audit_event(
        db,
        session=session,
        request=request,
        event_type="delivery",
        action="delivery_zone_update",
        resource_type="delivery_zone",
        resource_id=zone.id,
        detail=f"Delivery zone {zone.name} updated.",
        metadata={
            "delivery_fee": round(float(zone.delivery_fee or 0), 2),
            "minimum_order_amount": round(float(zone.minimum_order_amount or 0), 2),
            "eta_window": f"{zone.eta_min_minutes}-{zone.eta_max_minutes} min",
            "is_active": bool(zone.is_active),
        },
    )
    return serialize_delivery_zone(zone)


@router.delete("/zones/{zone_id}")
def archive_delivery_zone(
    zone_id: int,
    request: Request,
    db: Session = Depends(get_db),
    session: dict = Depends(require_roles("admin")),
):
    ensure_delivery_zones(db)
    zone = db.query(DeliveryZone).filter(DeliveryZone.id == zone_id).first()
    if zone is None:
        raise HTTPException(status_code=404, detail="Delivery zone not found.")

    has_assignments = (
        db.query(DeliveryAssignment)
        .filter(DeliveryAssignment.zone_id == zone_id)
        .first()
        is not None
    )
    if has_assignments:
        zone.is_active = False
        db.commit()
        db.refresh(zone)
        record_operational_audit_event(
            db,
            session=session,
            request=request,
            event_type="delivery",
            action="delivery_zone_archive",
            resource_type="delivery_zone",
            resource_id=zone.id,
            detail=f"Delivery zone {zone.name} archived.",
            metadata={"reason": "Zone has delivery history."},
        )
        return {
            "status": "archived",
            "reason": "Zone has delivery history, so it was deactivated instead of deleted.",
            "zone": serialize_delivery_zone(zone),
        }

    zone_name = zone.name
    db.delete(zone)
    db.commit()
    record_operational_audit_event(
        db,
        session=session,
        request=request,
        event_type="delivery",
        action="delivery_zone_delete",
        resource_type="delivery_zone",
        resource_id=zone_id,
        detail=f"Delivery zone {zone_name} deleted.",
        metadata={"reason": "Zone had no delivery history."},
    )
    return {
        "status": "deleted",
        "zone_id": zone_id,
    }


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
def delivery_queue(
    db: Session = Depends(get_db),
    session: dict = Depends(require_roles("admin", "staff")),
):
    ensure_delivery_zones(db)
    orders = (
        db.query(RestaurantOrder)
        .filter(RestaurantOrder.order_type == "delivery")
        .filter(RestaurantOrder.status.notin_(["closed", "cancelled"]))
        .order_by(RestaurantOrder.created_at.asc(), RestaurantOrder.id.asc())
        .all()
    )
    queue_orders = [serialize_delivery_queue_order(db, order) for order in orders]
    summary = {
        "open_delivery_count": len(queue_orders),
        "unassigned_count": sum(
            1
            for order in queue_orders
            if order["assignment_status"] == "unassigned" or not order["assigned_to"]
        ),
        "assigned_count": sum(1 for order in queue_orders if order["assignment_status"] == "assigned"),
        "out_for_delivery_count": sum(
            1 for order in queue_orders if order["assignment_status"] == "out_for_delivery"
        ),
        "delivered_count": sum(1 for order in queue_orders if order["assignment_status"] == "delivered"),
        "failed_count": sum(1 for order in queue_orders if order["assignment_status"] == "failed"),
        "address_review_count": sum(
            1 for order in queue_orders if order["requires_address_review"]
        ),
        "payment_due_count": sum(1 for order in queue_orders if order["payment_due"]),
    }
    return {
        "count": len(queue_orders),
        "summary": summary,
        "orders": queue_orders,
    }


@router.patch("/orders/{order_id}/assignment")
def update_delivery_assignment(
    order_id: int,
    payload: DeliveryAssignmentUpdate,
    request: Request,
    db: Session = Depends(get_db),
    session: dict = Depends(require_roles("admin", "staff")),
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
    assigned_to = payload.assigned_to.strip() if payload.assigned_to else None
    existing_assignee = order.delivery_assignment.assigned_to if order.delivery_assignment else None
    if status in {"assigned", "out_for_delivery", "delivered"} and not (assigned_to or existing_assignee):
        raise HTTPException(status_code=422, detail="Delivery partner is required for this status.")
    if status == "failed" and not (payload.notes or "").strip():
        raise HTTPException(status_code=422, detail="Failure reason is required.")

    assignment = order.delivery_assignment
    previous_status = assignment.status if assignment else None
    if assignment is None:
        assignment = DeliveryAssignment(order_id=order.id)
        db.add(assignment)

    if assignment.zone_id is None:
        zone_name = note_value(order.notes, "Delivery Zone")
        if zone_name:
            zone = db.query(DeliveryZone).filter(DeliveryZone.name == zone_name).first()
            if zone:
                assignment.zone_id = zone.id

    if payload.assigned_to is not None:
        assignment.assigned_to = assigned_to
    assignment.status = status
    if payload.notes is not None:
        assignment.notes = payload.notes.strip() or None
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
    if status in {"out_for_delivery", "delivered"} and status != previous_status:
        notify_order_event(db, order, status)
        queue_status_event(db, order, status)
    record_operational_audit_event(
        db,
        session=session,
        request=request,
        event_type="delivery",
        action="delivery_assignment_update",
        resource_type="restaurant_order",
        resource_id=order.id,
        detail=f"Delivery assignment for order #{order.id} moved to {status}.",
        metadata={
            "assignment_id": assignment.id,
            "status": assignment.status,
            "assigned_to_present": bool(assignment.assigned_to),
            "zone_id": assignment.zone_id,
        },
    )
    return {
        "assignment": serialize_delivery_assignment(assignment),
        "order_status": order.status,
    }


def _rider_assignment(db: Session, token: str) -> DeliveryAssignment:
    assignment = (
        db.query(DeliveryAssignment)
        .filter(DeliveryAssignment.rider_token == (token or "").strip())
        .first()
    )
    if assignment is None:
        raise HTTPException(status_code=404, detail="Rider link is not valid.")
    return assignment


def _rider_payload(assignment: DeliveryAssignment) -> dict:
    order = assignment.order
    items = [
        {
            "name": item.get("name"),
            "quantity": item.get("quantity"),
            "selected_options": item.get("selected_options") or [],
        }
        for item in (order.items or [])
        if isinstance(item, dict)
    ]
    proof_captured = assignment.proof_captured_at is not None
    allowed_actions: list[str] = []
    if assignment.status == "assigned":
        allowed_actions.append("out_for_delivery")
    if assignment.status == "out_for_delivery":
        allowed_actions.append("failed")
        if proof_captured:
            allowed_actions.append("delivered")
    return {
        "assignment_id": assignment.id,
        "status": assignment.status,
        "assigned_to": assignment.assigned_to,
        "rider_phone": assignment.rider_phone,
        "order": {
            "id": order.id,
            "status": order.status,
            "total_amount": order.total_amount,
            "payment_method": order.payment_method,
            "payment_status": order.payment_status,
            "customer_name": order.customer_name,
            "customer_phone": order.customer_phone,
            "delivery_address": note_value(order.notes, "Address"),
            "delivery_zone": note_value(order.notes, "Delivery Zone"),
            "items": items,
        },
        "location": (
            {
                "lat": assignment.current_lat,
                "lng": assignment.current_lng,
                "updated_at": assignment.location_updated_at.isoformat()
                if assignment.location_updated_at
                else None,
            }
            if assignment.current_lat is not None and assignment.current_lng is not None
            else None
        ),
        "proof": (
            {
                "type": assignment.proof_type,
                "reference": assignment.proof_reference,
                "notes": assignment.proof_notes,
                "captured_at": assignment.proof_captured_at.isoformat()
                if assignment.proof_captured_at
                else None,
            }
            if proof_captured
            else None
        ),
        "timestamps": {
            "assigned_at": assignment.assigned_at.isoformat()
            if assignment.assigned_at
            else None,
            "out_for_delivery_at": assignment.out_for_delivery_at.isoformat()
            if assignment.out_for_delivery_at
            else None,
            "delivered_at": assignment.delivered_at.isoformat()
            if assignment.delivered_at
            else None,
        },
        "allowed_actions": allowed_actions,
    }


@router.get("/orders/{order_id}/rider-link")
def get_rider_link(
    order_id: int,
    db: Session = Depends(get_db),
    session: dict = Depends(require_roles("admin", "staff")),
):
    del session
    order = db.query(RestaurantOrder).filter(RestaurantOrder.id == order_id).first()
    if not order:
        raise HTTPException(status_code=404, detail="Order not found.")
    assignment = order.delivery_assignment
    if assignment is None:
        raise HTTPException(status_code=404, detail="Delivery assignment not found.")
    if not assignment.rider_token:
        assignment.rider_token = "RDR" + secrets.token_urlsafe(24)
    db.commit()
    db.refresh(assignment)
    base = (settings.PIZZA_BLITZ_PUBLIC_URL or "").rstrip("/")
    return {
        "order_id": order.id,
        "rider_token": assignment.rider_token,
        "rider_path": f"/rider/{assignment.rider_token}",
        "rider_url": f"{base}/rider/{assignment.rider_token}",
        "assigned_to": assignment.assigned_to,
        "status": assignment.status,
    }


@router.get("/rider/{token}")
def get_rider_view(token: str, db: Session = Depends(get_db)):
    return _rider_payload(_rider_assignment(db, token))


@router.post("/rider/{token}/location")
def update_rider_location(
    token: str,
    payload: RiderLocationUpdate,
    db: Session = Depends(get_db),
):
    assignment = _rider_assignment(db, token)
    assignment.current_lat = payload.lat
    assignment.current_lng = payload.lng
    assignment.location_updated_at = datetime.utcnow()
    db.commit()
    db.refresh(assignment)
    return _rider_payload(assignment)


@router.post("/rider/{token}/proof")
def capture_rider_proof(
    token: str,
    payload: RiderProofCreate,
    db: Session = Depends(get_db),
):
    assignment = _rider_assignment(db, token)
    if assignment.status not in {"assigned", "out_for_delivery"}:
        raise HTTPException(
            status_code=409,
            detail="Proof can only be captured before or during delivery.",
        )
    assignment.proof_type = payload.proof_type
    assignment.proof_reference = payload.reference.strip()
    assignment.proof_notes = (payload.notes or "").strip() or None
    assignment.proof_captured_at = datetime.utcnow()
    db.commit()
    db.refresh(assignment)
    return _rider_payload(assignment)


@router.patch("/rider/{token}/status")
def update_rider_status(
    token: str,
    payload: RiderStatusUpdate,
    db: Session = Depends(get_db),
):
    assignment = _rider_assignment(db, token)
    order = assignment.order
    status = (payload.status or "").strip().lower()
    now = datetime.utcnow()

    if status == "out_for_delivery":
        if assignment.status not in {"assigned", "out_for_delivery"}:
            raise HTTPException(
                status_code=409,
                detail="Assign the rider before starting the delivery.",
            )
        assignment.status = "out_for_delivery"
        if assignment.out_for_delivery_at is None:
            assignment.out_for_delivery_at = now
        if order.status == "open":
            order.status = "ready"
    elif status == "delivered":
        if assignment.status != "out_for_delivery":
            raise HTTPException(
                status_code=409,
                detail="Start the delivery before marking it delivered.",
            )
        if assignment.proof_captured_at is None:
            raise HTTPException(
                status_code=409,
                detail="Capture proof of delivery before marking it delivered.",
            )
        assignment.status = "delivered"
        if assignment.delivered_at is None:
            assignment.delivered_at = now
    elif status == "failed":
        if assignment.status not in {"assigned", "out_for_delivery"}:
            raise HTTPException(
                status_code=409,
                detail="Only active deliveries can be marked failed.",
            )
        if not (payload.notes or "").strip():
            raise HTTPException(
                status_code=422, detail="Add a reason for the failed delivery."
            )
        assignment.status = "failed"
        assignment.notes = payload.notes.strip()
    else:
        raise HTTPException(
            status_code=422,
            detail="Status must be out_for_delivery, delivered, or failed.",
        )

    assignment.updated_at = now
    db.commit()
    db.refresh(assignment)
    if status in {"out_for_delivery", "delivered"}:
        notify_order_event(db, order, status)
    queue_status_event(db, order, status)
    return _rider_payload(assignment)
