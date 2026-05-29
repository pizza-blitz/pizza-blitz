import hashlib
from collections import Counter
from datetime import date, datetime
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.api.deps import get_db, require_roles, session_from_request
from app.models.domain import (
    Customer,
    DailySales,
    DeliveryAssignment,
    DiningTable,
    InventoryItem,
    InventoryTransaction,
    Invoice,
    PaymentEventAudit,
    Promotion,
    Recipe,
    RestaurantOrder,
)
from app.services.delivery_service import delivery_quote, serialize_delivery_zone
from app.services.menu_customization_service import (
    calculate_customized_item_price,
    find_menu_item_for_order,
)
from app.services.payment_gateway import (
    PaymentWebhookError,
    create_payment_session,
    normalize_payment_webhook,
    payment_provider_status,
    verify_razorpay_checkout_signature,
)


router = APIRouter()


DEFAULT_TABLES = [
    ("T1", 4),
    ("T2", 4),
    ("T3", 6),
    ("T4", 2),
    ("T5", 4),
    ("T6", 8),
    ("T7", 2),
    ("T8", 4),
]

ORDER_USAGE_NOTE_PREFIX = "Auto usage from order"
PAYMENT_PROVIDER_ORDER = ("manual", "direct_bank", "cashfree", "razorpay")
PAYMENT_GATEWAY_RUNBOOK = {
    "manual": {
        "label": "Manual fallback",
        "dashboard": "Admin controlled",
        "credential_step": "No external credentials required.",
        "webhook_step": "Use the protected manual webhook tester for admin proof.",
    },
    "direct_bank": {
        "label": "Direct Bank / UPI",
        "dashboard": "Restaurant bank account or UPI settlement statement",
        "credential_step": "Add DIRECT_BANK_UPI_ID or bank account details in Vercel production env.",
        "webhook_step": "Direct bank settlement is staff-verified; keep counter proof and bank reference in the ledger.",
    },
    "cashfree": {
        "label": "Cashfree",
        "dashboard": "Cashfree merchant dashboard",
        "credential_step": "Add CASHFREE_APP_ID and CASHFREE_SECRET_KEY in Vercel production env.",
        "webhook_step": "Add CASHFREE_WEBHOOK_SECRET and point Cashfree to the webhook endpoint.",
    },
    "razorpay": {
        "label": "Razorpay",
        "dashboard": "Razorpay dashboard",
        "credential_step": "Add RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET in Vercel production env.",
        "webhook_step": "Add RAZORPAY_WEBHOOK_SECRET and enable payment captured webhooks.",
    },
}


class OrderItem(BaseModel):
    menu_item_id: Optional[int] = None
    name: str
    quantity: int
    price: float
    base_price: Optional[float] = None
    customization_total: float = 0.0
    selected_options: List[dict] = Field(default_factory=list)


class OrderCreate(BaseModel):
    order_type: str = "dine-in"
    table_number: Optional[str] = None
    customer_name: Optional[str] = None
    customer_phone: Optional[str] = None
    customer_email: Optional[str] = None
    opt_in_marketing: Optional[bool] = None
    items: List[OrderItem] = Field(default_factory=list)
    discount_amount: float = 0.0
    coupon_code: Optional[str] = None
    payment_method: Optional[str] = None
    delivery_address: Optional[str] = None
    delivery_zone_id: Optional[int] = None
    notes: Optional[str] = None


class PaymentConfirmation(BaseModel):
    payment_provider: str = "manual"
    payment_reference: Optional[str] = None
    paid_amount: Optional[float] = None


class TrackedPaymentConfirmation(BaseModel):
    phone: str
    payment_provider: str = "manual"
    payment_reference: Optional[str] = None
    paid_amount: Optional[float] = None


class PaymentSessionRequest(BaseModel):
    provider: Optional[str] = None
    return_url: Optional[str] = None


class CancelOrderRequest(BaseModel):
    reason: Optional[str] = None


class ProviderPaymentVerification(BaseModel):
    provider: str
    provider_order_id: Optional[str] = None
    provider_payment_id: Optional[str] = None
    provider_signature: Optional[str] = None
    paid_amount: Optional[float] = None


class OrderStatusUpdate(BaseModel):
    status: str


def ensure_default_tables(db: Session) -> None:
    existing = {row.table_number for row in db.query(DiningTable).all()}
    for table_number, capacity in DEFAULT_TABLES:
        if table_number not in existing:
            db.add(DiningTable(table_number=table_number, capacity=capacity))
    db.commit()


def serialize_table(table: DiningTable) -> dict:
    return {
        "id": table.id,
        "table_number": table.table_number,
        "capacity": table.capacity,
        "status": table.status,
        "current_order_id": table.current_order_id,
        "last_updated": table.last_updated.isoformat() if table.last_updated else None,
    }


def serialize_invoice(invoice: Invoice) -> dict:
    return {
        "id": invoice.id,
        "invoice_number": invoice.invoice_number,
        "date": invoice.date.isoformat() if invoice.date else None,
        "order_id": invoice.order_id,
        "customer_name": invoice.customer_name,
        "customer_gstin": invoice.customer_gstin,
        "items": invoice.items or [],
        "subtotal": invoice.subtotal,
        "cgst": invoice.cgst,
        "sgst": invoice.sgst,
        "total": invoice.total,
        "payment_method": invoice.payment_method,
        "created_at": invoice.created_at.isoformat() if invoice.created_at else None,
    }


def serialize_order(order: RestaurantOrder) -> dict:
    metadata = order_metadata(order)
    assignment = order.delivery_assignment
    return {
        "id": order.id,
        "date": order.date.isoformat() if order.date else None,
        "order_type": order.order_type,
        "source": metadata["source"],
        "fulfillment_type": metadata["fulfillment_type"],
        "delivery_address": metadata["delivery_address"],
        "delivery_zone": metadata["delivery_zone"],
        "delivery_fee": metadata["delivery_fee"],
        "delivery_assignment": serialize_delivery_assignment(assignment),
        "eta_window": order_eta_window(order),
        "payment_due": (
            (order.payment_method or "").lower() == "prepaid"
            and (order.payment_status or "").lower() != "paid"
        ),
        "table_number": order.table_number,
        "customer_name": order.customer_name,
        "customer_phone": order.customer_phone,
        "items": order.items or [],
        "subtotal": order.subtotal,
        "discount_amount": order.discount_amount,
        "tax_amount": order.tax_amount,
        "total_amount": order.total_amount,
        "payment_status": order.payment_status,
        "payment_method": order.payment_method,
        "payment_provider": order.payment_provider,
        "payment_session_id": order.payment_session_id,
        "payment_session_url": order.payment_session_url,
        "payment_session_created_at": (
            order.payment_session_created_at.isoformat()
            if order.payment_session_created_at
            else None
        ),
        "payment_reference": order.payment_reference,
        "payment_confirmed_at": (
            order.payment_confirmed_at.isoformat()
            if order.payment_confirmed_at
            else None
        ),
        "status": order.status,
        "notes": order.notes,
        "created_at": order.created_at.isoformat() if order.created_at else None,
        "closed_at": order.closed_at.isoformat() if order.closed_at else None,
    }


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


def order_metadata(order: RestaurantOrder) -> dict:
    notes = order.notes or ""
    fulfillment_type = note_value(notes, "Fulfillment") or order.order_type or "takeaway"
    delivery_fee = 0.0
    fee_note = note_value(notes, "Delivery Fee")
    if fee_note:
        try:
            delivery_fee = round(float(fee_note.replace("Rs", "").strip()), 2)
        except ValueError:
            delivery_fee = 0.0
    return {
        "source": "customer_website" if "customer website order" in notes.lower() else "counter",
        "fulfillment_type": fulfillment_type,
        "delivery_address": note_value(notes, "Address"),
        "delivery_zone": note_value(notes, "Delivery Zone"),
        "delivery_fee": delivery_fee,
    }


def order_eta_window(order: RestaurantOrder) -> str:
    if order.status == "cancelled":
        return "Cancelled"
    if order.status == "closed":
        return "Completed"
    assignment_status = (
        (order.delivery_assignment.status or "").lower()
        if order.delivery_assignment
        else ""
    )
    if assignment_status == "delivered":
        return "Completed"
    if assignment_status == "out_for_delivery":
        return "Arriving soon"
    if assignment_status == "assigned":
        return "Rider assigned"
    if order.status == "ready":
        return "Ready now"
    if order.status == "preparing":
        return "10-15 min"
    eta_from_notes = note_value(order.notes, "ETA")
    if eta_from_notes:
        return eta_from_notes
    if (order.order_type or "").lower() == "delivery":
        return "35-45 min"
    return "20-25 min"


def delivery_assignment_next_action(status: Optional[str]) -> str:
    normalized = (status or "unassigned").lower()
    if normalized == "assigned":
        return "Rider assigned. Your order will leave shortly."
    if normalized == "out_for_delivery":
        return "Rider is on the way with your order."
    if normalized == "delivered":
        return "Delivery completed. Thank you for ordering."
    if normalized == "failed":
        return "Delivery needs attention. The store team will contact you."
    return "Store team is assigning a delivery partner."


def serialize_delivery_assignment(assignment: Optional[DeliveryAssignment]) -> Optional[dict]:
    if assignment is None:
        return None
    return {
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
        "next_action": delivery_assignment_next_action(assignment.status),
    }


def order_tracking_steps(order: RestaurantOrder) -> list[dict]:
    status = (order.status or "open").lower()
    payment_status = (order.payment_status or "pending").lower()
    payment_ready = payment_status == "paid" or (order.payment_method or "").lower() != "prepaid"
    assignment_status = (
        (order.delivery_assignment.status or "unassigned").lower()
        if order.delivery_assignment
        else "unassigned"
    )
    if status == "cancelled":
        return [
            {"key": "placed", "label": "Order placed", "complete": True},
            {"key": "cancelled", "label": "Cancelled", "complete": True},
        ]
    if (order.order_type or "").lower() == "delivery":
        steps = [
            ("placed", True, "Order placed"),
            ("payment", payment_ready, "Payment checked"),
            (
                "preparing",
                status in {"preparing", "ready", "closed"}
                or assignment_status in {"assigned", "out_for_delivery", "delivered"},
                "Preparing",
            ),
            (
                "assigned",
                assignment_status in {"assigned", "out_for_delivery", "delivered"},
                "Rider assigned",
            ),
            (
                "out_for_delivery",
                assignment_status in {"out_for_delivery", "delivered"},
                "Out for delivery",
            ),
            (
                "delivered",
                assignment_status == "delivered" or status == "closed",
                "Delivered",
            ),
        ]
        return [
            {"key": key, "label": label, "complete": complete}
            for key, complete, label in steps
        ]

    steps = [
        ("placed", True, "Order placed"),
        ("payment", payment_ready, "Payment checked"),
        ("preparing", status in {"preparing", "ready", "closed"}, "Preparing"),
        ("ready", status in {"ready", "closed"}, "Ready"),
        ("completed", status == "closed", "Completed"),
    ]
    return [
        {"key": key, "label": label, "complete": complete}
        for key, complete, label in steps
    ]


def serialize_order_tracking(order: RestaurantOrder) -> dict:
    payload = serialize_order(order)
    assignment = order.delivery_assignment
    delivery_status = assignment.status if assignment else None
    next_action = order_next_action(order)
    if order.status == "cancelled":
        next_action = "Order cancelled. No sales or inventory were posted."
    elif (order.order_type or "").lower() == "delivery":
        if delivery_status == "assigned":
            next_action = "Delivery partner assigned. Your order will leave shortly."
        elif delivery_status == "out_for_delivery":
            next_action = "Rider is on the way with your order."
        elif delivery_status == "delivered":
            next_action = "Delivery completed. Thank you for ordering."
        elif order.status == "closed":
            next_action = "Order completed. Thank you for ordering."
        else:
            next_action = "Order received. Assigning a delivery partner."
    payload.update(
        {
            "eta_window": order_eta_window(order),
            "tracking_steps": order_tracking_steps(order),
            "next_action": next_action,
        }
    )
    return payload


def customer_history_insights(orders: list[RestaurantOrder], customer: Optional[Customer]) -> dict:
    total_orders = int(customer.total_orders or 0) if customer else len(orders)
    total_spend = (
        float(customer.total_spend or 0)
        if customer
        else sum(float(order.total_amount or 0) for order in orders)
    )
    order_count = max(total_orders, len(orders))
    average_order_value = round(total_spend / order_count, 2) if order_count else 0
    total_discount = round(sum(float(order.discount_amount or 0) for order in orders), 2)

    item_quantities: Counter[str] = Counter()
    item_spend: Counter[str] = Counter()
    latest_item_detail: dict[str, dict] = {}
    for order in orders:
        for item in order.items or []:
            name = str(item.get("name") or "Item").strip() or "Item"
            quantity = int(item.get("quantity") or 0)
            price = float(item.get("price") or 0)
            item_quantities[name] += quantity
            item_spend[name] += price * quantity
            latest_item_detail.setdefault(name, item)

    favorite_items = [
        {
            "name": name,
            "quantity": quantity,
            "spend": round(float(item_spend[name] or 0), 2),
        }
        for name, quantity in item_quantities.most_common(5)
    ]

    latest_order = orders[0] if orders else None
    latest_order_at = (
        latest_order.created_at
        if latest_order and latest_order.created_at
        else datetime.combine(latest_order.date, datetime.min.time())
        if latest_order and latest_order.date
        else None
    )
    days_since_last_order = (
        max((datetime.utcnow() - latest_order_at).days, 0)
        if latest_order_at
        else None
    )

    if total_orders >= 10 or total_spend >= 5000:
        tier = "VIP Slice Club"
        next_tier = "Top tier"
        tier_current = min(total_orders, 10)
        tier_target = 10
    elif total_orders >= 3 or total_spend >= 1200:
        tier = "Regular Guest"
        next_tier = "VIP Slice Club"
        tier_current = min(total_orders, 10)
        tier_target = 10
    else:
        tier = "New Guest"
        next_tier = "Regular Guest"
        tier_current = min(total_orders, 3)
        tier_target = 3

    if days_since_last_order is None:
        cadence = "First order pending"
    elif days_since_last_order <= 7:
        cadence = "Active this week"
    elif days_since_last_order <= 30:
        cadence = "Ready for a comeback offer"
    else:
        cadence = "Win-back recommended"

    recommended_source = latest_order.items if latest_order and latest_order.items else []
    if favorite_items:
        recommended_source = [
            latest_item_detail[item["name"]]
            for item in favorite_items[:3]
            if item["name"] in latest_item_detail
        ] or recommended_source

    recommended_reorder = [
        {
            "name": item.get("name"),
            "quantity": int(item.get("quantity") or 1),
            "price": round(float(item.get("price") or 0), 2),
            "selected_options": item.get("selected_options") or [],
        }
        for item in recommended_source[:4]
        if item.get("name")
    ]

    return {
        "tier": tier,
        "next_tier": next_tier,
        "tier_progress_percent": round((tier_current / tier_target) * 100) if tier_target else 100,
        "orders_to_next_tier": max(tier_target - total_orders, 0),
        "average_order_value": average_order_value,
        "total_discount": total_discount,
        "days_since_last_order": days_since_last_order,
        "cadence": cadence,
        "favorite_items": favorite_items,
        "recommended_reorder": recommended_reorder,
    }


def order_next_action(order: RestaurantOrder) -> str:
    if order.status == "cancelled":
        return "Order cancelled. No sales or inventory were posted."
    if (order.payment_method or "").lower() == "prepaid" and order.payment_status != "paid":
        return "Payment is pending. Confirm prepaid payment to continue."
    if order.status == "open":
        return "Order received. Kitchen will begin preparation shortly."
    if order.status == "preparing":
        return "Kitchen is preparing your order."
    if order.status == "ready":
        return "Order is ready for pickup or handoff."
    if order.status == "closed":
        return "Order completed. Thank you for ordering."
    return "Order is being processed."


def apply_order_payment(
    db: Session,
    order: RestaurantOrder,
    *,
    provider: str,
    reference: Optional[str],
    paid_amount: Optional[float],
) -> tuple[dict, bool]:
    settled_amount = paid_amount if paid_amount is not None else order.total_amount
    if round(float(settled_amount or 0), 2) < round(float(order.total_amount or 0), 2):
        raise HTTPException(status_code=422, detail="Paid amount is below order total.")

    if (order.payment_status or "").lower() == "paid":
        return serialize_order(order), False

    order.payment_method = "prepaid"
    order.payment_status = "paid"
    order.payment_provider = (provider or "manual").strip().lower() or "manual"
    order.payment_reference = (
        reference.strip()
        if reference and reference.strip()
        else f"{order.payment_provider.upper()}-{order.id}"
    )
    order.payment_confirmed_at = datetime.utcnow()
    db.commit()
    db.refresh(order)
    return serialize_order(order), True


def serialize_payment_queue_order(order: RestaurantOrder) -> dict:
    metadata = order_metadata(order)
    return {
        "id": order.id,
        "customer_name": order.customer_name,
        "customer_phone": order.customer_phone,
        "order_type": order.order_type,
        "fulfillment_type": metadata["fulfillment_type"],
        "source": metadata["source"],
        "total_amount": round(float(order.total_amount or 0), 2),
        "payment_status": order.payment_status,
        "payment_method": order.payment_method,
        "payment_provider": order.payment_provider,
        "payment_session_id": order.payment_session_id,
        "payment_reference": order.payment_reference,
        "payment_confirmed_at": (
            order.payment_confirmed_at.isoformat()
            if order.payment_confirmed_at
            else None
        ),
        "created_at": order.created_at.isoformat() if order.created_at else None,
    }


def payment_event_key(event: dict) -> str:
    raw_key = "|".join(
        [
            str(event.get("provider") or ""),
            str(event.get("event_type") or ""),
            str(event.get("order_id") or event.get("provider_order_id") or ""),
            str(event.get("provider_payment_id") or event.get("provider_order_id") or ""),
            str(event.get("status") or ""),
        ]
    )
    return hashlib.sha256(raw_key.encode("utf-8")).hexdigest()


def serialize_payment_event(event: PaymentEventAudit) -> dict:
    return {
        "id": event.id,
        "event_key": event.event_key,
        "order_id": event.order_id,
        "provider": event.provider,
        "event_type": event.event_type,
        "payment_status": event.payment_status,
        "action": event.action,
        "provider_order_id": event.provider_order_id,
        "provider_payment_id": event.provider_payment_id,
        "paid_amount": round(float(event.paid_amount or 0), 2) if event.paid_amount is not None else None,
        "duplicate_count": int(event.duplicate_count or 0),
        "received_at": event.received_at.isoformat() if event.received_at else None,
        "last_seen_at": event.last_seen_at.isoformat() if event.last_seen_at else None,
    }


def existing_payment_event(db: Session, event: dict) -> PaymentEventAudit | None:
    return (
        db.query(PaymentEventAudit)
        .filter(PaymentEventAudit.event_key == payment_event_key(event))
        .first()
    )


def mark_duplicate_payment_event(db: Session, event_audit: PaymentEventAudit) -> PaymentEventAudit:
    event_audit.duplicate_count = int(event_audit.duplicate_count or 0) + 1
    event_audit.last_seen_at = datetime.utcnow()
    db.commit()
    db.refresh(event_audit)
    return event_audit


def record_payment_event(
    db: Session,
    order: RestaurantOrder,
    event: dict,
    *,
    action: str,
) -> PaymentEventAudit:
    event_audit = PaymentEventAudit(
        event_key=payment_event_key(event),
        order_id=order.id,
        provider=event["provider"],
        event_type=event["event_type"],
        payment_status=event["status"],
        action=action,
        provider_order_id=event.get("provider_order_id"),
        provider_payment_id=event.get("provider_payment_id"),
        paid_amount=event.get("paid_amount"),
        raw_payload=event.get("raw") or event,
        received_at=datetime.utcnow(),
    )
    db.add(event_audit)
    db.commit()
    db.refresh(event_audit)
    return event_audit


def order_has_customization(order: RestaurantOrder) -> bool:
    return any(
        bool((item or {}).get("selected_options"))
        for item in (order.items or [])
        if isinstance(item, dict)
    )


def order_payment_due(order: RestaurantOrder) -> bool:
    if order.status == "cancelled":
        return False
    return (
        (order.payment_method or "").lower() == "prepaid"
        and (order.payment_status or "").lower() != "paid"
    )


def order_flow_stage(order: RestaurantOrder) -> str:
    if order.status == "cancelled":
        return "cancelled"
    if order.status == "closed":
        return "closed"
    if order_payment_due(order):
        return "payment_due"
    if order.status == "ready":
        return "ready_to_close"
    if order.status == "preparing":
        return "kitchen"
    return "received"


def serialize_order_flow_row(order: RestaurantOrder, invoice_ids: set[int]) -> dict:
    metadata = order_metadata(order)
    payment_due = order_payment_due(order)
    ready_to_close = order.status == "ready" and not payment_due
    customized = order_has_customization(order)
    stage = order_flow_stage(order)
    if ready_to_close:
        next_action = "Print receipt and close after customer handoff."
    elif payment_due:
        next_action = "Confirm prepaid payment before closing."
    elif order.status == "open":
        next_action = "Move order to preparing when kitchen starts."
    elif order.status == "preparing":
        next_action = "Mark ready when the kitchen finishes."
    elif order.status == "closed":
        next_action = "Order is closed."
    elif order.status == "cancelled":
        next_action = "Order cancelled. No sales or inventory posted."
    else:
        next_action = order_next_action(order)

    return {
        "id": order.id,
        "stage": stage,
        "status": order.status,
        "source": metadata["source"],
        "fulfillment_type": metadata["fulfillment_type"],
        "customer_name": order.customer_name,
        "customer_phone": order.customer_phone,
        "total_amount": round(float(order.total_amount or 0), 2),
        "payment_status": order.payment_status,
        "payment_method": order.payment_method,
        "payment_due": payment_due,
        "ready_to_close": ready_to_close,
        "receipt_ready": order.id not in invoice_ids,
        "invoice_generated": order.id in invoice_ids,
        "customized": customized,
        "customized_line_count": sum(
            1
            for item in (order.items or [])
            if isinstance(item, dict) and item.get("selected_options")
        ),
        "eta_window": order_eta_window(order),
        "receipt_url": f"/receipt/{order.id}",
        "next_action": next_action,
        "created_at": order.created_at.isoformat() if order.created_at else None,
    }


def payment_production_next_actions(
    *,
    active_provider: dict,
    awaiting_settlement_count: int,
) -> list[str]:
    actions: list[str] = []
    provider = active_provider["provider"]
    if provider == "manual":
        actions.append("Select Direct Bank, Cashfree, or Razorpay before public prepaid checkout.")
    if not active_provider["checkout_configured"]:
        missing = ", ".join(active_provider["missing_checkout_settings"])
        actions.append(f"Add checkout settings for {provider}: {missing}.")
    if not active_provider["webhook_configured"]:
        missing = ", ".join(active_provider["missing_webhook_settings"])
        actions.append(f"Add webhook secret for {provider}: {missing}.")
    if awaiting_settlement_count:
        actions.append(
            f"Settle {awaiting_settlement_count} prepaid order(s) through a verified webhook or admin proof."
        )
    if not actions:
        actions.append("Run a low-value live checkout and compare the provider payout report.")
    return actions


def serialize_gateway_session_proof(order: RestaurantOrder | None) -> dict | None:
    if not order:
        return None
    return {
        "order_id": order.id,
        "provider": order.payment_provider,
        "session_id": order.payment_session_id,
        "checkout_url_present": bool(order.payment_session_url),
        "payment_status": order.payment_status,
        "total_amount": round(float(order.total_amount or 0), 2),
        "created_at": (
            order.payment_session_created_at.isoformat()
            if order.payment_session_created_at
            else order.created_at.isoformat() if order.created_at else None
        ),
    }


def gateway_activation_provider(
    *,
    provider_status: dict,
    session_proof: RestaurantOrder | None,
    webhook_event: PaymentEventAudit | None,
    session_count: int,
    webhook_count: int,
) -> dict:
    provider = provider_status["provider"]
    runbook = PAYMENT_GATEWAY_RUNBOOK[provider]
    missing_settings = list(
        dict.fromkeys(
            provider_status["missing_checkout_settings"]
            + provider_status["missing_webhook_settings"]
        )
    )
    steps = [
        {
            "name": "Credential environment",
            "status": "complete" if provider_status["checkout_configured"] else "blocked",
            "detail": runbook["credential_step"]
            if provider_status["checkout_configured"]
            else f"Missing {', '.join(provider_status['missing_checkout_settings'])}.",
        },
        {
            "name": "Webhook signature",
            "status": "complete" if provider_status["webhook_configured"] else "blocked",
            "detail": runbook["webhook_step"]
            if provider_status["webhook_configured"]
            else f"Missing {', '.join(provider_status['missing_webhook_settings'])}.",
        },
        {
            "name": "Provider session proof",
            "status": "complete" if session_proof else "pending",
            "detail": "A payment session has been created and stored for this provider."
            if session_proof
            else "Create one low-value prepaid checkout to store the provider order/session id.",
        },
        {
            "name": "Webhook settlement proof",
            "status": "complete" if webhook_event else "pending",
            "detail": "A provider event has reached the duplicate-safe audit ledger."
            if webhook_event
            else "Complete the test payment and confirm the signed webhook reaches the ledger.",
        },
    ]

    if provider == "manual":
        activation_status = "fallback_ready"
        next_action = "Keep manual as controlled staff fallback while Direct Bank, Cashfree, or Razorpay is activated."
        blockers = [
            "Manual mode is not a public payment gateway; select Direct Bank, Cashfree, or Razorpay before public prepaid checkout."
        ]
    else:
        blockers = []
        if missing_settings:
            blockers.append(f"Add missing production env vars: {', '.join(missing_settings)}.")
        if not session_proof:
            blockers.append("Run a low-value provider checkout session.")
        if not webhook_event:
            blockers.append("Confirm one signed provider webhook in the audit ledger.")

        if not provider_status["checkout_configured"] or not provider_status["webhook_configured"]:
            activation_status = "blocked"
            next_action = blockers[0]
        elif session_proof and webhook_event:
            activation_status = "live_ready"
            next_action = "Provider can be selected for public prepaid checkout after payout report comparison."
        else:
            activation_status = "proof_needed"
            next_action = blockers[0] if blockers else "Run final low-value checkout proof."

    return {
        "provider": provider,
        "label": runbook["label"],
        "environment": provider_status["environment"],
        "dashboard": runbook["dashboard"],
        "activation_status": activation_status,
        "next_action": next_action,
        "missing_settings": missing_settings,
        "checkout_configured": provider_status["checkout_configured"],
        "webhook_configured": provider_status["webhook_configured"],
        "session_endpoint": provider_status["session_endpoint"],
        "webhook_endpoint": provider_status["webhook_endpoint"],
        "session_count": session_count,
        "webhook_event_count": webhook_count,
        "latest_session": serialize_gateway_session_proof(session_proof),
        "latest_webhook_event": serialize_payment_event(webhook_event) if webhook_event else None,
        "blockers": blockers,
        "steps": steps,
    }


def normalize_coupon_code(value: Optional[str]) -> Optional[str]:
    if not value:
        return None
    code = value.strip().upper().replace(" ", "")
    return code or None


def calculate_promotion_discount(promo: Promotion, subtotal: float) -> float:
    if promo.discount_type == "percentage":
        discount = subtotal * (float(promo.discount_value or 0) / 100)
    else:
        discount = float(promo.discount_value or 0)
    return round(min(max(discount, 0), subtotal), 2)


def apply_coupon_to_subtotal(
    db: Session,
    coupon_code: Optional[str],
    subtotal: float,
) -> tuple[float, Optional[Promotion]]:
    code = normalize_coupon_code(coupon_code)
    if not code:
        return 0.0, None

    promo = db.query(Promotion).filter(Promotion.code == code).first()
    if not promo:
        raise HTTPException(status_code=404, detail="Coupon code not found.")

    today = date.today()
    if promo.start_date > today or promo.end_date < today:
        raise HTTPException(status_code=409, detail="Coupon is not active today.")
    if promo.status not in {"active", "scheduled"}:
        raise HTTPException(status_code=409, detail="Coupon is not active.")

    return calculate_promotion_discount(promo, subtotal), promo


def append_order_note(notes: Optional[str], extra: str) -> str:
    if notes and notes.strip():
        return f"{notes.strip()} | {extra}"
    return extra


def inventory_usage_note(order_id: int, menu_item: str) -> str:
    return f"{ORDER_USAGE_NOTE_PREFIX} #{order_id}: {menu_item}"


def order_inventory_already_deducted(db: Session, order_id: int) -> bool:
    return (
        db.query(InventoryTransaction)
        .filter(InventoryTransaction.transaction_type == "usage")
        .filter(InventoryTransaction.notes.like(f"{ORDER_USAGE_NOTE_PREFIX} #{order_id}:%"))
        .first()
        is not None
    )


def deduct_inventory_for_order(db: Session, order: RestaurantOrder) -> list[dict]:
    if order_inventory_already_deducted(db, order.id):
        return []

    recipe_by_menu_item = {
        recipe.menu_item.strip().lower(): recipe
        for recipe in db.query(Recipe).all()
        if recipe.menu_item
    }
    inventory_by_name = {
        item.name.strip().lower(): item
        for item in db.query(InventoryItem).all()
        if item.name
    }

    usage_rows = []
    for ordered_item in order.items or []:
        menu_item_name = str(ordered_item.get("name") or "").strip()
        ordered_quantity = float(ordered_item.get("quantity") or 0)
        if not menu_item_name or ordered_quantity <= 0:
            continue

        recipe = recipe_by_menu_item.get(menu_item_name.lower())
        if not recipe:
            continue

        for ingredient in recipe.ingredients or []:
            ingredient_name = str(ingredient.get("name") or "").strip()
            recipe_quantity = float(ingredient.get("quantity") or 0)
            if not ingredient_name or recipe_quantity <= 0:
                continue

            inventory_item = inventory_by_name.get(ingredient_name.lower())
            if not inventory_item:
                continue

            usage_quantity = round(recipe_quantity * ordered_quantity, 4)
            unit_cost = float(inventory_item.cost_per_unit or 0)
            inventory_item.current_stock = round(
                float(inventory_item.current_stock or 0) - usage_quantity,
                4,
            )
            transaction = InventoryTransaction(
                item_id=inventory_item.id,
                transaction_type="usage",
                quantity=usage_quantity,
                unit_cost=unit_cost,
                total_cost=round(usage_quantity * unit_cost, 2),
                notes=inventory_usage_note(order.id, menu_item_name),
            )
            db.add(transaction)
            usage_rows.append(
                {
                    "inventory_item_id": inventory_item.id,
                    "ingredient_name": inventory_item.name,
                    "menu_item": menu_item_name,
                    "quantity": usage_quantity,
                    "unit": ingredient.get("unit") or inventory_item.unit,
                    "new_stock": inventory_item.current_stock,
                    "estimated_cost": transaction.total_cost,
                }
            )

    return usage_rows


def upsert_customer_from_order(
    db: Session,
    order: RestaurantOrder,
    customer_email: Optional[str] = None,
    opt_in_marketing: Optional[bool] = None,
) -> None:
    phone = (order.customer_phone or "").strip()
    if not phone:
        return

    customer = db.query(Customer).filter(Customer.phone == phone).first()
    if customer is None:
        customer = Customer(
            name=order.customer_name,
            phone=phone,
            email=(customer_email or "").strip() or None,
            opt_in_marketing=True if opt_in_marketing is None else opt_in_marketing,
            total_orders=0,
            total_spend=0.0,
        )
        db.add(customer)

    if order.customer_name:
        customer.name = order.customer_name
    if customer_email and customer_email.strip():
        customer.email = customer_email.strip()
    if opt_in_marketing is not None:
        customer.opt_in_marketing = opt_in_marketing
    customer.total_orders = int(customer.total_orders or 0) + 1
    customer.total_spend = float(customer.total_spend or 0.0) + float(order.total_amount or 0.0)
    customer.last_order_at = datetime.utcnow()


KITCHEN_STATION_RULES = [
    {
        "key": "oven",
        "label": "Oven Station",
        "keywords": ["pizza", "garlic bread", "bread", "calzone", "pasta bake"],
    },
    {
        "key": "fryer",
        "label": "Fryer / Sides",
        "keywords": ["fries", "nugget", "wing", "stick", "popper", "side", "starter"],
    },
    {
        "key": "cold",
        "label": "Cold / Drinks",
        "keywords": ["drink", "beverage", "cola", "pepsi", "water", "shake", "dessert", "ice cream", "brownie"],
    },
]


def kitchen_station_for_item(name: str, category: str | None = None) -> dict:
    searchable = f"{category or ''} {name or ''}".strip().lower()
    for rule in KITCHEN_STATION_RULES:
        if any(keyword in searchable for keyword in rule["keywords"]):
            return {"key": rule["key"], "label": rule["label"]}
    return {"key": "prep", "label": "Prep Station"}


def normalize_order_items(db: Session, order_items: list[OrderItem]) -> list[dict]:
    normalized_items = []
    for item in order_items:
        quantity = int(item.quantity or 0)
        if quantity <= 0:
            continue

        menu_item = find_menu_item_for_order(
            db,
            item_name=item.name,
            menu_item_id=item.menu_item_id,
        )
        if menu_item:
            priced_item = calculate_customized_item_price(
                db,
                menu_item,
                item.selected_options or [],
            )
            station = kitchen_station_for_item(menu_item.name, menu_item.category)
            normalized_items.append(
                {
                    "menu_item_id": menu_item.id,
                    "name": menu_item.name,
                    "category": menu_item.category,
                    "kitchen_station": station["key"],
                    "kitchen_station_label": station["label"],
                    "quantity": quantity,
                    "price": priced_item["unit_price"],
                    "base_price": priced_item["base_price"],
                    "customization_total": priced_item["customization_total"],
                    "selected_options": priced_item["selected_options"],
                }
            )
            continue

        if item.selected_options:
            raise HTTPException(
                status_code=422,
                detail=f"{item.name} is not in the active menu, so customizations cannot be priced.",
            )

        fallback_price = round(float(item.price or 0), 2)
        station = kitchen_station_for_item(item.name)
        normalized_items.append(
            {
                "name": item.name,
                "kitchen_station": station["key"],
                "kitchen_station_label": station["label"],
                "quantity": quantity,
                "price": fallback_price,
                "base_price": round(float(item.base_price or fallback_price), 2),
                "customization_total": round(float(item.customization_total or 0), 2),
                "selected_options": [],
            }
        )
    return normalized_items


@router.get("/tables")
def get_tables(
    db: Session = Depends(get_db),
    session: dict = Depends(require_roles("admin", "staff")),
):
    ensure_default_tables(db)
    tables = db.query(DiningTable).order_by(DiningTable.table_number).all()
    return [serialize_table(table) for table in tables]


@router.post("/")
def create_order(order: OrderCreate, db: Session = Depends(get_db)):
    valid_items = normalize_order_items(db, order.items)
    if not valid_items:
        raise HTTPException(status_code=422, detail="Order must include at least one item.")

    if order.order_type == "dine-in" and not order.table_number:
        raise HTTPException(status_code=422, detail="Dine-in orders require a table number.")

    if order.table_number:
        table = db.query(DiningTable).filter(
            DiningTable.table_number == order.table_number
        ).first()
        if not table:
            raise HTTPException(status_code=404, detail="Table not found")
        if table.status == "occupied" and table.current_order_id:
            raise HTTPException(status_code=409, detail="Table already has an open order.")

    subtotal = round(
        sum(float(item["price"] or 0) * int(item["quantity"] or 0) for item in valid_items),
        2,
    )
    coupon_discount, applied_promo = apply_coupon_to_subtotal(
        db,
        order.coupon_code,
        subtotal,
    )
    discount = (
        coupon_discount
        if applied_promo
        else round(min(max(order.discount_amount or 0, 0), subtotal), 2)
    )
    taxable_subtotal = max(subtotal - discount, 0)
    tax = round(taxable_subtotal * 0.05, 2)
    delivery_fee = 0.0
    delivery_zone_id = None
    delivery_zone_name = None
    delivery_eta = None
    delivery_address = order.delivery_address or note_value(order.notes, "Address")
    if (order.order_type or "").lower() == "delivery":
        try:
            quote = delivery_quote(
                db,
                address=delivery_address,
                subtotal=subtotal,
                zone_id=order.delivery_zone_id,
            )
        except ValueError as exc:
            raise HTTPException(status_code=422, detail=str(exc)) from exc
        if not quote["is_deliverable"]:
            raise HTTPException(status_code=409, detail=quote["reason"])
        delivery_fee = float(quote["delivery_fee"] or 0)
        delivery_zone_id = quote["zone"]["id"] if quote.get("zone") else None
        delivery_zone_name = quote["zone"]["name"] if quote.get("zone") else None
        delivery_eta = quote.get("eta_window")
        delivery_address = quote["address"]
    total = round(taxable_subtotal + tax + delivery_fee, 2)
    items = valid_items
    payment_method = (order.payment_method or "cash").lower()
    payment_status = "awaiting_payment" if payment_method == "prepaid" else "pending"

    notes = order.notes
    if applied_promo and applied_promo.code:
        notes = append_order_note(notes, f"Coupon: {applied_promo.code}")
    if (order.order_type or "").lower() == "delivery":
        if delivery_address and not note_value(notes, "Address"):
            notes = append_order_note(notes, f"Address: {delivery_address}")
        if delivery_zone_name and not note_value(notes, "Delivery Zone"):
            notes = append_order_note(notes, f"Delivery Zone: {delivery_zone_name}")
        if not note_value(notes, "Delivery Fee"):
            notes = append_order_note(notes, f"Delivery Fee: {delivery_fee}")
        if delivery_eta and not note_value(notes, "ETA"):
            notes = append_order_note(notes, f"ETA: {delivery_eta}")

    row = RestaurantOrder(
        order_type=order.order_type,
        table_number=order.table_number,
        customer_name=order.customer_name,
        customer_phone=order.customer_phone,
        items=items,
        subtotal=subtotal,
        discount_amount=discount,
        tax_amount=tax,
        total_amount=total,
        payment_method=payment_method,
        payment_status=payment_status,
        notes=notes,
    )
    db.add(row)
    db.flush()
    if (order.order_type or "").lower() == "delivery":
        db.add(
            DeliveryAssignment(
                order_id=row.id,
                zone_id=delivery_zone_id,
                status="unassigned",
                notes="Awaiting rider assignment.",
            )
        )
    upsert_customer_from_order(
        db,
        row,
        customer_email=order.customer_email,
        opt_in_marketing=order.opt_in_marketing,
    )

    if order.table_number:
        table.status = "occupied"
        table.current_order_id = row.id
        table.last_updated = datetime.utcnow()

    db.commit()
    return {
        "order_id": row.id,
        "subtotal": subtotal,
        "discount": discount,
        "tax": tax,
        "delivery_fee": delivery_fee,
        "delivery_zone": delivery_zone_name,
        "total": total,
        "status": row.status,
        "payment_status": row.payment_status,
        "coupon_code": applied_promo.code if applied_promo else None,
    }


@router.patch("/{order_id}/cancel")
def cancel_order(
    order_id: int,
    payload: CancelOrderRequest,
    db: Session = Depends(get_db),
    session: dict = Depends(require_roles("admin", "staff")),
):
    order = db.query(RestaurantOrder).filter(RestaurantOrder.id == order_id).first()
    if not order:
        raise HTTPException(status_code=404, detail="Order not found")
    if order.status == "cancelled":
        return {
            "status": "cancelled",
            "payment_status": order.payment_status,
            "refund_required": (order.payment_status or "").lower() == "refund_due",
            "sales_posted": False,
            "inventory_posted": False,
            "order": serialize_order(order),
        }
    if order.status == "closed":
        raise HTTPException(
            status_code=409,
            detail="Closed orders already posted sales. Use refund adjustment instead.",
        )

    reason = (payload.reason or "").strip() or "Cancelled from portal"
    refund_required = (order.payment_status or "").lower() == "paid"
    if order.status != "cancelled":
        now = datetime.utcnow()
        order.status = "cancelled"
        order.payment_status = "refund_due" if refund_required else "voided"
        order.notes = append_order_note(order.notes, f"Cancelled: {reason}")
        order.notes = append_order_note(order.notes, f"Cancelled At: {now.isoformat()}")

        if order.table_number:
            table = db.query(DiningTable).filter(
                DiningTable.table_number == order.table_number
            ).first()
            if table and table.current_order_id == order.id:
                table.status = "available"
                table.current_order_id = None
                table.last_updated = now

        if order.delivery_assignment:
            order.delivery_assignment.status = "failed"
            order.delivery_assignment.notes = append_order_note(
                order.delivery_assignment.notes,
                f"Order cancelled: {reason}",
            )
            order.delivery_assignment.updated_at = now

    db.commit()
    db.refresh(order)
    return {
        "status": "cancelled",
        "payment_status": order.payment_status,
        "refund_required": refund_required,
        "sales_posted": False,
        "inventory_posted": False,
        "order": serialize_order(order),
    }


@router.patch("/{order_id}/close")
def close_order(
    order_id: int,
    payment_method: Optional[str] = None,
    db: Session = Depends(get_db),
    session: dict = Depends(require_roles("admin", "staff")),
):
    order = db.query(RestaurantOrder).filter(RestaurantOrder.id == order_id).first()
    if not order:
        raise HTTPException(status_code=404, detail="Order not found")
    if order.status == "cancelled":
        raise HTTPException(status_code=409, detail="Cancelled orders cannot be closed.")

    inventory_usage = []
    if order.status != "closed":
        requested_payment_method = (
            payment_method.strip().lower()
            if payment_method
            else (order.payment_method or "cash").strip().lower()
        ) or "cash"
        if (
            (order.payment_method or "").lower() == "prepaid"
            and order.payment_status != "paid"
            and requested_payment_method == "prepaid"
        ):
            raise HTTPException(
                status_code=409,
                detail="Prepaid orders must be confirmed before closing.",
            )

        order.payment_method = requested_payment_method
        order.payment_status = "paid"
        order.status = "closed"
        order.closed_at = datetime.utcnow()
        inventory_usage = deduct_inventory_for_order(db, order)

        if order.table_number:
            table = db.query(DiningTable).filter(
                DiningTable.table_number == order.table_number
            ).first()
            if table:
                table.status = "available"
                table.current_order_id = None
                table.last_updated = datetime.utcnow()

        daily = db.query(DailySales).filter(DailySales.date == date.today()).first()
        if daily:
            daily.total_sale = float(daily.total_sale or 0) + float(order.total_amount or 0)
            if (order.payment_method or "").lower() == "cash":
                daily.cash_collected = float(daily.cash_collected or 0) + float(order.total_amount or 0)
            daily.profit = float(daily.total_sale or 0) - float(daily.total_expense or 0)
        else:
            daily = DailySales(
                date=date.today(),
                total_sale=order.total_amount or 0,
                cash_collected=order.total_amount if (order.payment_method or "").lower() == "cash" else 0,
                total_expense=0,
                profit=order.total_amount or 0,
                payment_method=order.payment_method or "mixed",
                notes=f"Auto-created from order #{order.id}",
            )
            db.add(daily)

    db.commit()
    return {
        "status": "closed",
        "total_collected": order.total_amount,
        "inventory_usage": inventory_usage,
    }


@router.patch("/{order_id}/status")
def update_order_status(
    order_id: int,
    payload: OrderStatusUpdate,
    db: Session = Depends(get_db),
    session: dict = Depends(require_roles("admin", "staff")),
):
    order = db.query(RestaurantOrder).filter(RestaurantOrder.id == order_id).first()
    if not order:
        raise HTTPException(status_code=404, detail="Order not found")
    if order.status == "closed":
        raise HTTPException(status_code=409, detail="Closed orders cannot be moved.")
    if order.status == "cancelled":
        raise HTTPException(status_code=409, detail="Cancelled orders cannot be moved.")

    status = payload.status.strip().lower()
    allowed_statuses = {"open", "preparing", "ready"}
    if status not in allowed_statuses:
        raise HTTPException(
            status_code=422,
            detail=f"Status must be one of: {', '.join(sorted(allowed_statuses))}.",
        )

    order.status = status
    db.commit()
    db.refresh(order)
    return serialize_order(order)


@router.post("/{order_id}/payment-session")
def create_order_payment_session(
    order_id: int,
    payload: PaymentSessionRequest,
    db: Session = Depends(get_db),
):
    order = db.query(RestaurantOrder).filter(RestaurantOrder.id == order_id).first()
    if not order:
        raise HTTPException(status_code=404, detail="Order not found")
    if order.status in {"closed", "cancelled"}:
        raise HTTPException(status_code=409, detail="Closed or cancelled orders cannot start payment.")
    if order.payment_status == "paid":
        raise HTTPException(status_code=409, detail="Order is already paid.")

    session = create_payment_session(
        order_id=order.id,
        amount=order.total_amount or 0,
        customer_name=order.customer_name,
        customer_phone=order.customer_phone,
        provider=payload.provider,
        return_url=payload.return_url,
    )
    if session.get("status") == "provider_error":
        raise HTTPException(
            status_code=502,
            detail=session.get("message") or "Payment provider failed.",
        )
    if session.get("status") == "configuration_required":
        raise HTTPException(
            status_code=409,
            detail=session.get("message") or "Payment provider credentials are not configured.",
        )

    order.payment_method = "prepaid"
    order.payment_status = "awaiting_payment"
    order.payment_provider = session["provider"]
    order.payment_session_id = session["session_id"]
    order.payment_session_url = session["checkout_url"]
    order.payment_session_created_at = datetime.utcnow()
    db.commit()
    return {
        "order": serialize_order(order),
        "payment_session": session,
    }


@router.get("/payments/production-readiness")
def payment_production_readiness(
    db: Session = Depends(get_db),
    session: dict = Depends(require_roles("admin", "staff")),
):
    providers = [payment_provider_status(provider) for provider in PAYMENT_PROVIDER_ORDER]
    active_provider = payment_provider_status()

    awaiting_query = (
        db.query(RestaurantOrder)
        .filter(RestaurantOrder.payment_method == "prepaid")
        .filter(RestaurantOrder.payment_status != "paid")
    )
    awaiting_settlement_count = awaiting_query.count()
    awaiting_settlement = (
        awaiting_query
        .order_by(RestaurantOrder.created_at.desc(), RestaurantOrder.id.desc())
        .limit(8)
        .all()
    )

    paid_today_query = db.query(RestaurantOrder).filter(
        RestaurantOrder.date == date.today(),
        RestaurantOrder.payment_status == "paid",
    )
    paid_today_orders = paid_today_query.all()
    recent_paid = (
        db.query(RestaurantOrder)
        .filter(RestaurantOrder.payment_status == "paid")
        .order_by(RestaurantOrder.payment_confirmed_at.desc(), RestaurantOrder.id.desc())
        .limit(8)
        .all()
    )

    awaiting_settlement_total = round(
        sum(float(order.total_amount or 0) for order in awaiting_query.all()),
        2,
    )
    paid_today_total = round(
        sum(float(order.total_amount or 0) for order in paid_today_orders),
        2,
    )
    provider_ready_count = sum(
        1
        for provider in providers
        if provider["checkout_configured"] and provider["webhook_configured"]
    )
    webhook_ready_count = sum(1 for provider in providers if provider["webhook_configured"])
    gateway_ready = (
        active_provider["checkout_configured"]
        and active_provider["webhook_configured"]
    )
    live_gateway_ready = gateway_ready and active_provider["provider"] != "manual"
    settlement_clear = awaiting_settlement_count == 0
    if live_gateway_ready and settlement_clear:
        production_status = "live_ready"
    elif gateway_ready:
        production_status = "controlled_manual" if active_provider["provider"] == "manual" else "settlement_watch"
    else:
        production_status = "configuration_needed"

    return {
        "generated_at": datetime.utcnow().isoformat(),
        "active_provider": active_provider,
        "providers": providers,
        "summary": {
            "gateway_ready": gateway_ready,
            "live_gateway_ready": live_gateway_ready,
            "settlement_clear": settlement_clear,
            "awaiting_settlement_count": awaiting_settlement_count,
            "awaiting_settlement_total": awaiting_settlement_total,
            "paid_today_count": len(paid_today_orders),
            "paid_today_total": paid_today_total,
            "provider_ready_count": provider_ready_count,
            "webhook_ready_count": webhook_ready_count,
            "production_status": production_status,
        },
        "queues": {
            "awaiting_settlement": [
                serialize_payment_queue_order(order)
                for order in awaiting_settlement
            ],
            "recent_paid": [
                serialize_payment_queue_order(order)
                for order in recent_paid
            ],
        },
        "next_actions": payment_production_next_actions(
            active_provider=active_provider,
            awaiting_settlement_count=awaiting_settlement_count,
        ),
    }


@router.get("/payments/gateway-activation")
def payment_gateway_activation(
    db: Session = Depends(get_db),
    session: dict = Depends(require_roles("admin", "staff")),
):
    provider_statuses = [payment_provider_status(provider) for provider in PAYMENT_PROVIDER_ORDER]
    activation_providers = []

    for provider_status in provider_statuses:
        provider = provider_status["provider"]
        session_query = (
            db.query(RestaurantOrder)
            .filter(RestaurantOrder.payment_provider == provider)
            .filter(RestaurantOrder.payment_session_id.isnot(None))
        )
        latest_session = (
            session_query
            .order_by(
                RestaurantOrder.payment_session_created_at.desc(),
                RestaurantOrder.id.desc(),
            )
            .first()
        )
        webhook_query = db.query(PaymentEventAudit).filter(PaymentEventAudit.provider == provider)
        latest_webhook_event = (
            webhook_query
            .order_by(PaymentEventAudit.received_at.desc(), PaymentEventAudit.id.desc())
            .first()
        )
        activation_providers.append(
            gateway_activation_provider(
                provider_status=provider_status,
                session_proof=latest_session,
                webhook_event=latest_webhook_event,
                session_count=session_query.count(),
                webhook_count=webhook_query.count(),
            )
        )

    active_provider_name = payment_provider_status()["provider"]
    active_provider = next(
        (provider for provider in activation_providers if provider["provider"] == active_provider_name),
        activation_providers[0],
    )
    live_ready_count = sum(
        1 for provider in activation_providers if provider["activation_status"] == "live_ready"
    )
    blocked_count = sum(
        1 for provider in activation_providers if provider["activation_status"] == "blocked"
    )
    proof_needed_count = sum(
        1 for provider in activation_providers if provider["activation_status"] == "proof_needed"
    )
    selectable_live_providers = [
        provider["provider"]
        for provider in activation_providers
        if provider["activation_status"] == "live_ready"
    ]

    if live_ready_count:
        overall_status = "live_provider_ready"
        next_action = "Select a live-ready provider and run the final payout report comparison."
    elif proof_needed_count:
        overall_status = "gateway_proof_needed"
        next_action = "Finish one low-value checkout and signed webhook proof for the configured provider."
    elif blocked_count:
        overall_status = "credentials_needed"
        next_action = "Add provider credentials and webhook secrets in Vercel production env."
    else:
        overall_status = "manual_fallback"
        next_action = "Manual fallback is available while provider credentials are prepared."

    return {
        "generated_at": datetime.utcnow().isoformat(),
        "summary": {
            "overall_status": overall_status,
            "active_provider": active_provider_name,
            "active_provider_status": active_provider["activation_status"],
            "live_ready_provider_count": live_ready_count,
            "proof_needed_provider_count": proof_needed_count,
            "blocked_provider_count": blocked_count,
            "selectable_live_providers": selectable_live_providers,
            "next_action": next_action,
        },
        "providers": activation_providers,
        "controls": [
            {
                "name": "Secret-safe activation",
                "status": "Active",
                "detail": "Only env var names and readiness states are returned; credential values are never exposed.",
            },
            {
                "name": "Checkout proof",
                "status": "Active",
                "detail": "A gateway is not live-ready until a provider session id is created and stored.",
            },
            {
                "name": "Webhook proof",
                "status": "Active",
                "detail": "A gateway is not live-ready until a signed provider event lands in the audit ledger.",
            },
        ],
    }


@router.get("/payments/reconciliation")
def payment_reconciliation(
    db: Session = Depends(get_db),
    session: dict = Depends(require_roles("admin", "staff")),
):
    today_start = datetime.combine(date.today(), datetime.min.time())
    events_today = (
        db.query(PaymentEventAudit)
        .filter(PaymentEventAudit.received_at >= today_start)
        .all()
    )
    recent_events = (
        db.query(PaymentEventAudit)
        .order_by(PaymentEventAudit.received_at.desc(), PaymentEventAudit.id.desc())
        .limit(12)
        .all()
    )
    provider_breakdown = Counter(event.provider for event in recent_events)
    action_breakdown = Counter(event.action for event in events_today)
    duplicate_total = sum(int(event.duplicate_count or 0) for event in events_today)

    return {
        "generated_at": datetime.utcnow().isoformat(),
        "summary": {
            "events_today_count": len(events_today),
            "processed_today_count": action_breakdown.get("processed", 0),
            "already_paid_today_count": action_breakdown.get("already_paid", 0),
            "ignored_today_count": action_breakdown.get("ignored", 0),
            "duplicate_delivery_count": duplicate_total,
            "recent_event_count": len(recent_events),
        },
        "provider_breakdown": [
            {"provider": provider, "count": count}
            for provider, count in provider_breakdown.items()
        ],
        "recent_events": [serialize_payment_event(event) for event in recent_events],
        "controls": [
            {
                "name": "Stable webhook event key",
                "status": "Active",
                "detail": "Provider, event type, order, payment reference and status are hashed into a duplicate-safe key.",
            },
            {
                "name": "Duplicate delivery counter",
                "status": "Active",
                "detail": "Repeated webhook deliveries increment duplicate_count instead of applying payment twice.",
            },
            {
                "name": "Settlement trace",
                "status": "Active",
                "detail": "Processed, already-paid and ignored events remain visible for owner reconciliation.",
            },
        ],
    }


@router.post("/{order_id}/payment-confirmation")
def confirm_order_payment(
    order_id: int,
    payload: PaymentConfirmation,
    db: Session = Depends(get_db),
    _session: dict = Depends(require_roles("admin", "staff")),
):
    order = db.query(RestaurantOrder).filter(RestaurantOrder.id == order_id).first()
    if not order:
        raise HTTPException(status_code=404, detail="Order not found")

    payment_order, _ = apply_order_payment(
        db,
        order,
        provider=payload.payment_provider,
        reference=payload.payment_reference or f"PB-PAY-{order.id}",
        paid_amount=payload.paid_amount,
    )
    return payment_order


@router.post("/{order_id}/payment-verification")
def verify_order_payment(
    order_id: int,
    payload: ProviderPaymentVerification,
    db: Session = Depends(get_db),
):
    order = db.query(RestaurantOrder).filter(RestaurantOrder.id == order_id).first()
    if not order:
        raise HTTPException(status_code=404, detail="Order not found")

    provider = payload.provider.strip().lower()
    if provider != "razorpay":
        raise HTTPException(
            status_code=422,
            detail="Provider verification is available for Razorpay checkout.",
        )

    provider_order_id = (payload.provider_order_id or "").strip()
    provider_payment_id = (payload.provider_payment_id or "").strip()
    provider_signature = (payload.provider_signature or "").strip()
    if not provider_order_id or not provider_payment_id or not provider_signature:
        raise HTTPException(
            status_code=422,
            detail="Provider order, payment, and signature are required.",
        )
    if order.payment_session_id and order.payment_session_id != provider_order_id:
        raise HTTPException(
            status_code=409,
            detail="Payment order does not match this restaurant order.",
        )

    if not verify_razorpay_checkout_signature(
        provider_order_id=provider_order_id,
        provider_payment_id=provider_payment_id,
        provider_signature=provider_signature,
    ):
        raise HTTPException(status_code=401, detail="Payment signature is invalid.")

    payment_order, _ = apply_order_payment(
        db,
        order,
        provider="razorpay",
        reference=provider_payment_id,
        paid_amount=payload.paid_amount,
    )
    return payment_order


@router.post("/payments/webhook/{provider}")
async def process_payment_webhook(
    provider: str,
    request: Request,
    db: Session = Depends(get_db),
):
    if provider.strip().lower() in {"manual", "direct_bank"}:
        session = session_from_request(request)
        if session["role"] not in {"admin", "staff"}:
            raise HTTPException(
                status_code=403,
                detail="Manual or direct bank payment confirmation requires an admin or staff session.",
            )

    raw_body = await request.body()
    try:
        event = normalize_payment_webhook(provider, raw_body, request.headers)
    except PaymentWebhookError as exc:
        raise HTTPException(status_code=401, detail=str(exc)) from exc

    order = None
    if event.get("order_id"):
        order = db.query(RestaurantOrder).filter(
            RestaurantOrder.id == int(event["order_id"])
        ).first()
    if order is None and event.get("provider_order_id"):
        order = db.query(RestaurantOrder).filter(
            RestaurantOrder.payment_session_id == str(event["provider_order_id"])
        ).first()
    if order is None:
        raise HTTPException(
            status_code=404,
            detail="Webhook did not match an existing order.",
        )

    duplicate_event = existing_payment_event(db, event)
    if duplicate_event is not None:
        duplicate_event = mark_duplicate_payment_event(db, duplicate_event)
        return {
            "status": "duplicate",
            "event": event["event_type"],
            "payment_status": order.payment_status,
            "audit": serialize_payment_event(duplicate_event),
            "order": serialize_order(order),
        }

    if event["status"] != "paid":
        audit_event = record_payment_event(db, order, event, action="ignored")
        return {
            "status": "ignored",
            "event": event["event_type"],
            "payment_status": order.payment_status,
            "audit": serialize_payment_event(audit_event),
            "order": serialize_order(order),
        }

    payment_order, changed = apply_order_payment(
        db,
        order,
        provider=event["provider"],
        reference=event.get("provider_payment_id") or event.get("provider_order_id"),
        paid_amount=event.get("paid_amount"),
    )
    audit_event = record_payment_event(
        db,
        order,
        event,
        action="processed" if changed else "already_paid",
    )
    return {
        "status": "processed" if changed else "already_paid",
        "event": event["event_type"],
        "audit": serialize_payment_event(audit_event),
        "order": payment_order,
    }


@router.post("/{order_id}/invoice")
def generate_invoice(
    order_id: int,
    customer_name: str = "Walk-in Customer",
    customer_gstin: Optional[str] = None,
    db: Session = Depends(get_db),
    session: dict = Depends(require_roles("admin", "staff")),
):
    order = db.query(RestaurantOrder).filter(RestaurantOrder.id == order_id).first()
    if not order:
        raise HTTPException(status_code=404, detail="Order not found")

    existing = db.query(Invoice).filter(Invoice.order_id == order_id).first()
    if existing:
        return serialize_invoice(existing)

    count = db.query(Invoice).count()
    invoice_number = f"PB-{date.today().strftime('%Y%m')}-{str(count + 1).zfill(4)}"
    cgst = round((order.subtotal or 0) * 0.025, 2)
    sgst = round((order.subtotal or 0) * 0.025, 2)

    invoice = Invoice(
        invoice_number=invoice_number,
        order_id=order.id,
        customer_name=customer_name,
        customer_gstin=customer_gstin,
        items=order.items or [],
        subtotal=order.subtotal or 0,
        cgst=cgst,
        sgst=sgst,
        total=order.total_amount or 0,
        payment_method=order.payment_method,
    )
    db.add(invoice)
    db.commit()
    db.refresh(invoice)
    return serialize_invoice(invoice)


@router.get("/invoices")
def list_invoices(
    db: Session = Depends(get_db),
    session: dict = Depends(require_roles("admin")),
):
    invoices = db.query(Invoice).order_by(Invoice.created_at.desc()).limit(50).all()
    return [serialize_invoice(invoice) for invoice in invoices]


@router.get("/today")
def todays_orders(
    db: Session = Depends(get_db),
    session: dict = Depends(require_roles("admin", "staff")),
):
    rows = db.query(RestaurantOrder).filter(
        RestaurantOrder.date == date.today()
    ).order_by(RestaurantOrder.created_at.desc()).all()
    total = sum(float(row.total_amount or 0) for row in rows if row.status == "closed")
    return {
        "orders": [
            serialize_order(row)
            for row in rows
        ],
        "total_collected_today": total,
    }


@router.get("/flow-readiness")
def order_flow_readiness(
    db: Session = Depends(get_db),
    session: dict = Depends(require_roles("admin", "staff")),
):
    rows = (
        db.query(RestaurantOrder)
        .filter(RestaurantOrder.date == date.today())
        .order_by(RestaurantOrder.created_at.asc(), RestaurantOrder.id.asc())
        .all()
    )
    invoice_ids = {
        int(invoice.order_id)
        for invoice in db.query(Invoice.order_id).filter(Invoice.order_id.isnot(None)).all()
        if invoice.order_id is not None
    }
    flow_rows = [serialize_order_flow_row(order, invoice_ids) for order in rows]
    active_rows = [
        row for row in flow_rows if row["status"] not in {"closed", "cancelled"}
    ]
    ready_to_close_rows = [row for row in active_rows if row["ready_to_close"]]
    payment_due_rows = [row for row in active_rows if row["payment_due"]]
    customized_rows = [row for row in flow_rows if row["customized"]]

    next_actions: list[str] = []
    if payment_due_rows:
        next_actions.append(f"Confirm payment for {len(payment_due_rows)} prepaid order(s).")
    if ready_to_close_rows:
        next_actions.append(f"Print receipt and close {len(ready_to_close_rows)} ready order(s).")
    preparing_count = sum(1 for row in active_rows if row["status"] == "preparing")
    open_count = sum(1 for row in active_rows if row["status"] == "open")
    if open_count:
        next_actions.append(f"Start kitchen prep for {open_count} newly received order(s).")
    if preparing_count:
        next_actions.append(f"Move {preparing_count} preparing order(s) to ready when finished.")
    if not next_actions:
        next_actions.append("No active order-flow blockers right now.")

    return {
        "generated_at": datetime.utcnow().isoformat(),
        "summary": {
            "today_order_count": len(flow_rows),
            "active_order_count": len(active_rows),
            "open_count": open_count,
            "preparing_count": preparing_count,
            "ready_count": sum(1 for row in active_rows if row["status"] == "ready"),
            "ready_to_close_count": len(ready_to_close_rows),
            "payment_due_count": len(payment_due_rows),
            "receipt_ready_count": sum(1 for row in active_rows if row["receipt_ready"]),
            "customized_line_count": sum(row["customized_line_count"] for row in customized_rows),
            "closed_count": sum(1 for row in flow_rows if row["status"] == "closed"),
            "cancelled_count": sum(1 for row in flow_rows if row["status"] == "cancelled"),
        },
        "orders": flow_rows,
        "ready_to_close": ready_to_close_rows[:8],
        "payment_due": payment_due_rows[:8],
        "next_actions": next_actions,
    }


@router.get("/customer-history/{phone}")
def customer_order_history(phone: str, db: Session = Depends(get_db)):
    normalized_phone = phone.strip()
    if not normalized_phone:
        raise HTTPException(status_code=422, detail="Phone number is required.")

    customer = db.query(Customer).filter(Customer.phone == normalized_phone).first()
    orders = (
        db.query(RestaurantOrder)
        .filter(RestaurantOrder.customer_phone == normalized_phone)
        .order_by(RestaurantOrder.created_at.desc(), RestaurantOrder.id.desc())
        .limit(25)
        .all()
    )
    if customer is None and not orders:
        raise HTTPException(status_code=404, detail="No orders found for this phone number.")

    return {
        "customer": {
            "name": customer.name if customer else None,
            "phone": normalized_phone,
            "email": customer.email if customer else None,
            "opt_in_marketing": customer.opt_in_marketing if customer else True,
            "total_orders": customer.total_orders if customer else len(orders),
            "total_spend": (
                round(float(customer.total_spend or 0), 2)
                if customer
                else round(sum(float(order.total_amount or 0) for order in orders), 2)
            ),
            "last_order_at": customer.last_order_at.isoformat() if customer and customer.last_order_at else None,
        },
        "loyalty_summary": customer_history_insights(orders, customer),
        "orders": [serialize_order(order) for order in orders],
    }


@router.get("/track/{order_id}")
def track_order(order_id: int, phone: str, db: Session = Depends(get_db)):
    normalized_phone = phone.strip()
    if not normalized_phone:
        raise HTTPException(status_code=422, detail="Phone number is required.")

    order = db.query(RestaurantOrder).filter(RestaurantOrder.id == order_id).first()
    if not order or (order.customer_phone or "").strip() != normalized_phone:
        raise HTTPException(status_code=404, detail="Order not found for this phone number.")

    return serialize_order_tracking(order)


@router.post("/track/{order_id}/payment-confirmation")
def confirm_tracked_order_payment(
    order_id: int,
    payload: TrackedPaymentConfirmation,
    db: Session = Depends(get_db),
    _session: dict = Depends(require_roles("admin", "staff")),
):
    normalized_phone = payload.phone.strip()
    if not normalized_phone:
        raise HTTPException(status_code=422, detail="Phone number is required.")

    order = db.query(RestaurantOrder).filter(RestaurantOrder.id == order_id).first()
    if not order or (order.customer_phone or "").strip() != normalized_phone:
        raise HTTPException(status_code=404, detail="Order not found for this phone number.")
    if (order.payment_method or "").lower() != "prepaid":
        raise HTTPException(status_code=409, detail="This order does not require prepaid confirmation.")

    reference = (
        payload.payment_reference.strip()
        if payload.payment_reference and payload.payment_reference.strip()
        else f"TRACK-{order.id}-{datetime.utcnow().strftime('%Y%m%d%H%M%S')}"
    )
    provider = (payload.payment_provider or "manual").strip().lower() or "manual"
    apply_order_payment(
        db,
        order,
        provider=provider,
        reference=reference,
        paid_amount=payload.paid_amount,
    )
    return serialize_order_tracking(order)


@router.get("/customer-receipt/{order_id}")
def customer_receipt_order(order_id: int, phone: str, db: Session = Depends(get_db)):
    normalized_phone = phone.strip()
    if not normalized_phone:
        raise HTTPException(status_code=422, detail="Phone number is required.")

    order = db.query(RestaurantOrder).filter(RestaurantOrder.id == order_id).first()
    if not order or (order.customer_phone or "").strip() != normalized_phone:
        raise HTTPException(status_code=404, detail="Order not found for this phone number.")

    return serialize_order(order)


@router.get("/{order_id}")
def get_order(order_id: int, db: Session = Depends(get_db)):
    order = db.query(RestaurantOrder).filter(RestaurantOrder.id == order_id).first()
    if not order:
        raise HTTPException(status_code=404, detail="Order not found")
    return serialize_order(order)
