"""Aggregator intake: token-scoped webhooks that become restaurant orders."""

import hashlib
import hmac
import json
import secrets
from datetime import datetime, timedelta
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

from sqlalchemy.orm import Session

from app.core.clock import business_today
from app.services.billing_settings_service import tax_for_subtotal
from app.models.domain import (
    AggregatorEvent,
    AggregatorIntegration,
    AggregatorOrder,
    Customer,
    MenuItem,
    RestaurantOrder,
    Store,
)

PLATFORMS = {
    "swiggy": "Swiggy",
    "zomato": "Zomato",
    "ubereats": "Uber Eats",
    "doordash": "DoorDash",
}
DEFAULT_PLATFORM = "swiggy"


class AggregatorError(ValueError):
    """The aggregator payload cannot become an order."""


def serialize_integration(
    integration: AggregatorIntegration, *, include_token: bool = True
) -> dict:
    return {
        "id": integration.id,
        "platform": integration.platform,
        "platform_label": PLATFORMS.get(integration.platform, integration.platform),
        "store_id": integration.store_id,
        "store_name": integration.store.name if integration.store else None,
        "display_name": integration.display_name,
        "is_active": bool(integration.is_active),
        "auto_accept": bool(integration.auto_accept),
        "webhook_path": f"/api/v1/restaurant/integrations/aggregators/webhook/{integration.platform}",
        "webhook_token": integration.webhook_token if include_token else None,
        "outbound_url": integration.outbound_url,
        "outbound_secret": integration.outbound_secret if include_token else None,
        "outbound_enabled": bool(integration.outbound_enabled),
        "menu_sync_url": integration.menu_sync_url,
        "menu_sync_enabled": bool(integration.menu_sync_enabled),
        "created_at": integration.created_at.isoformat()
        if integration.created_at
        else None,
    }


def create_integration(
    db: Session,
    *,
    platform: str,
    store_id: int,
    display_name: str | None = None,
) -> AggregatorIntegration:
    normalized = (platform or "").strip().lower()
    if normalized not in PLATFORMS:
        raise AggregatorError(
            f"Platform must be one of: {', '.join(sorted(PLATFORMS))}."
        )
    store = db.query(Store).filter(Store.id == store_id).first()
    if store is None:
        raise AggregatorError("Store not found.")
    existing = (
        db.query(AggregatorIntegration)
        .filter(
            AggregatorIntegration.platform == normalized,
            AggregatorIntegration.store_id == store_id,
        )
        .first()
    )
    if existing is not None:
        return existing
    integration = AggregatorIntegration(
        platform=normalized,
        store_id=store_id,
        display_name=(display_name or "").strip()
        or f"{PLATFORMS[normalized]} · {store.name}",
        webhook_token="AG-" + secrets.token_urlsafe(24),
        is_active=True,
        auto_accept=True,
    )
    db.add(integration)
    db.commit()
    db.refresh(integration)
    return integration


def rotate_token(db: Session, integration: AggregatorIntegration) -> AggregatorIntegration:
    integration.webhook_token = "AG-" + secrets.token_urlsafe(24)
    db.commit()
    db.refresh(integration)
    return integration


def integration_for_token(
    db: Session, platform: str, token: str
) -> AggregatorIntegration:
    integration = (
        db.query(AggregatorIntegration)
        .filter(
            AggregatorIntegration.platform == (platform or "").strip().lower(),
            AggregatorIntegration.webhook_token == (token or "").strip(),
        )
        .first()
    )
    if integration is None:
        raise AggregatorError("Webhook token is not valid for this platform.")
    if not integration.is_active:
        raise AggregatorError("This aggregator integration is paused.")
    return integration


def _menu_price(db: Session, name: str) -> float | None:
    cleaned = name.strip().lower()
    items = db.query(MenuItem).all()
    for item in items:
        if not item.is_available:
            continue
        item_name = (item.name or "").strip().lower()
        if item_name == cleaned:
            return float(item.selling_price or 0)
        if cleaned.startswith(item_name) or item_name.startswith(cleaned):
            return float(item.selling_price or 0)
    return None


def _upsert_customer(db: Session, order: RestaurantOrder) -> None:
    phone = (order.customer_phone or "").strip()
    if not phone:
        return
    customer = db.query(Customer).filter(Customer.phone == phone).first()
    if customer is None:
        customer = Customer(
            name=order.customer_name,
            phone=phone,
            total_orders=0,
            total_spend=0.0,
        )
        db.add(customer)
    if order.customer_name:
        customer.name = order.customer_name
    customer.total_orders = int(customer.total_orders or 0) + 1
    customer.total_spend = float(customer.total_spend or 0) + float(order.total_amount or 0)
    customer.last_order_at = datetime.utcnow()


def ingest_order(
    db: Session, integration: AggregatorIntegration, payload: dict
) -> dict:
    external_id = str(payload.get("external_order_id") or "").strip()
    if not external_id:
        raise AggregatorError("external_order_id is required.")
    existing = (
        db.query(AggregatorOrder)
        .filter(
            AggregatorOrder.integration_id == integration.id,
            AggregatorOrder.external_order_id == external_id,
        )
        .first()
    )
    if existing is not None:
        return {
            "status": "duplicate",
            "duplicate": True,
            "order_id": existing.order_id,
            "external_order_id": external_id,
        }

    raw_items = payload.get("items") or []
    if not isinstance(raw_items, list) or not raw_items:
        raise AggregatorError("At least one item is required.")
    items: list[dict] = []
    for raw in raw_items:
        if not isinstance(raw, dict):
            raise AggregatorError("Each item must be an object.")
        name = str(raw.get("name") or "").strip()
        try:
            quantity = int(raw.get("quantity") or 0)
        except (TypeError, ValueError) as exc:
            raise AggregatorError("Item quantity must be a number.") from exc
        if not name or quantity <= 0:
            raise AggregatorError("Each item needs a name and a positive quantity.")
        menu_price = _menu_price(db, name)
        price = menu_price
        if price is None:
            try:
                price = float(raw.get("price") or 0)
            except (TypeError, ValueError) as exc:
                raise AggregatorError("Item price must be a number.") from exc
            if price <= 0:
                raise AggregatorError(f"Unknown menu item without a price: {name}.")
        items.append(
            {
                "name": name,
                "quantity": quantity,
                "price": round(price, 2),
                "selected_options": [],
            }
        )

    address = str(
        payload.get("delivery_address")
        or (payload.get("customer") or {}).get("address")
        or ""
    ).strip()
    if not address:
        raise AggregatorError("delivery_address is required.")
    customer = payload.get("customer") or {}
    name = str(customer.get("name") or payload.get("customer_name") or "Aggregator Guest")
    phone = str(customer.get("phone") or payload.get("customer_phone") or "").strip()

    subtotal = round(
        sum(item["price"] * item["quantity"] for item in items), 2
    )
    tax = tax_for_subtotal(db, subtotal)
    total = round(subtotal + tax, 2)
    payment_status = str(payload.get("payment_status") or "").lower()
    payment_method = str(payload.get("payment_method") or integration.platform)
    paid = payment_status in {"paid", "prepaid", "captured"}

    notes = " | ".join(
        part
        for part in [
            f"Address: {address}",
            f"Aggregator: {integration.platform}",
            f"External: {external_id}",
            str(payload.get("notes") or "").strip() or None,
        ]
        if part
    )
    order = RestaurantOrder(
        date=business_today(),
        store_id=integration.store_id,
        order_type="delivery",
        customer_name=name,
        customer_phone=phone or None,
        items=items,
        subtotal=subtotal,
        discount_amount=0.0,
        tax_amount=tax,
        tip_amount=0.0,
        total_amount=total,
        payment_method=payment_method,
        payment_status="paid" if paid else "pending",
        status="open",
        notes=notes,
    )
    db.add(order)
    db.flush()
    _upsert_customer(db, order)
    record = AggregatorOrder(
        integration_id=integration.id,
        external_order_id=external_id,
        order_id=order.id,
        status="accepted",
        payload=payload,
    )
    db.add(record)
    db.commit()
    db.refresh(order)
    return {
        "status": "accepted",
        "duplicate": False,
        "order_id": order.id,
        "external_order_id": external_id,
        "store_id": integration.store_id,
        "total": total,
    }


def recent_aggregator_orders(
    db: Session, integration: AggregatorIntegration, limit: int = 20
) -> list[dict]:
    rows = (
        db.query(AggregatorOrder)
        .filter(AggregatorOrder.integration_id == integration.id)
        .order_by(AggregatorOrder.created_at.desc(), AggregatorOrder.id.desc())
        .limit(limit)
        .all()
    )
    return [
        {
            "id": row.id,
            "external_order_id": row.external_order_id,
            "order_id": row.order_id,
            "status": row.status,
            "created_at": row.created_at.isoformat() if row.created_at else None,
        }
        for row in rows
    ]


def sign_outbound(secret: str, body: bytes) -> str:
    return "sha256=" + hmac.new(
        secret.encode("utf-8"), body, hashlib.sha256
    ).hexdigest()


def ensure_outbound_secret(integration: AggregatorIntegration) -> None:
    if not integration.outbound_secret:
        integration.outbound_secret = "AGOUT-" + secrets.token_urlsafe(24)


def build_menu_payload(
    db: Session, integration: AggregatorIntegration
) -> dict:
    items = db.query(MenuItem).order_by(MenuItem.name.asc()).all()
    return {
        "event": "menu.sync",
        "platform": integration.platform,
        "store": {
            "id": integration.store_id,
            "name": integration.store.name if integration.store else None,
            "code": integration.store.code if integration.store else None,
        },
        "generated_at": datetime.utcnow().isoformat(),
        "items": [
            {
                "id": item.id,
                "name": item.name,
                "category": item.category,
                "price": round(float(item.selling_price or 0), 2),
                "is_available": bool(item.is_available),
                "allergens": list(item.allergens or []),
                "dietary_tags": list(item.dietary_tags or []),
                "calories": item.calories,
                "protein_g": item.protein_g,
                "carbs_g": item.carbs_g,
                "fat_g": item.fat_g,
                "channel_prices": [
                    {
                        "channel": row.channel,
                        "price": round(float(row.price or 0), 2),
                        "is_available": bool(row.is_available),
                        "is_visible": bool(row.is_visible),
                    }
                    for row in (item.channel_prices or [])
                ],
            }
            for item in items
        ],
    }


def push_menu_sync(
    db: Session, integration: AggregatorIntegration
) -> dict:
    if not integration.menu_sync_enabled or not integration.menu_sync_url:
        raise AggregatorError("Enable menu sync and set a URL first.")
    ensure_outbound_secret(integration)
    db.commit()
    payload = build_menu_payload(db, integration)
    body = json.dumps(payload, separators=(",", ":")).encode("utf-8")
    request = Request(
        integration.menu_sync_url,
        data=body,
        headers={
            "Content-Type": "application/json",
            "User-Agent": "PizzaBlitz-Aggregator/1.0",
            "X-Pizza-Signature": sign_outbound(
                integration.outbound_secret or "", body
            ),
            "X-Pizza-Event": "menu.sync",
        },
        method="POST",
    )
    try:
        with urlopen(request, timeout=10) as response:  # noqa: S310 - configured URL
            return {
                "status": "sent" if 200 <= response.status < 300 else "failed",
                "http_status": response.status,
                "item_count": len(payload["items"]),
                "generated_at": payload["generated_at"],
            }
    except (HTTPError, URLError, TimeoutError, OSError) as exc:
        return {
            "status": "failed",
            "item_count": len(payload["items"]),
            "error": str(exc)[:500],
            "generated_at": payload["generated_at"],
        }


def queue_status_event(
    db: Session, order: RestaurantOrder, status: str
) -> AggregatorEvent | None:
    record = (
        db.query(AggregatorOrder)
        .filter(AggregatorOrder.order_id == order.id)
        .first()
    )
    if record is None:
        return None
    integration = (
        db.query(AggregatorIntegration)
        .filter(AggregatorIntegration.id == record.integration_id)
        .first()
    )
    if integration is None or not integration.outbound_enabled or not integration.outbound_url:
        return None
    existing = (
        db.query(AggregatorEvent)
        .filter(
            AggregatorEvent.integration_id == integration.id,
            AggregatorEvent.order_id == order.id,
            AggregatorEvent.status == status,
            AggregatorEvent.event_type == "order.status",
        )
        .first()
    )
    if existing is not None:
        return existing
    ensure_outbound_secret(integration)
    payload = {
        "event": "order.status",
        "external_order_id": record.external_order_id,
        "order_id": order.id,
        "status": status,
        "updated_at": datetime.utcnow().isoformat(),
        "store_id": order.store_id,
    }
    event = AggregatorEvent(
        integration_id=integration.id,
        order_id=order.id,
        external_order_id=record.external_order_id,
        event_type="order.status",
        status=status,
        payload=payload,
        delivery_status="pending",
        attempts=0,
        next_attempt_at=datetime.utcnow(),
    )
    db.add(event)
    db.commit()
    db.refresh(event)
    return event


def deliver_aggregator_events(db: Session, limit: int = 20) -> dict:
    now = datetime.utcnow()
    events = (
        db.query(AggregatorEvent)
        .filter(
            AggregatorEvent.delivery_status.in_(["pending", "failed"]),
            AggregatorEvent.attempts < 5,
            AggregatorEvent.next_attempt_at <= now,
        )
        .order_by(AggregatorEvent.created_at.asc())
        .limit(limit)
        .all()
    )
    sent = 0
    failed = 0
    for event in events:
        integration = event.integration
        if (
            integration is None
            or not integration.outbound_url
            or not integration.outbound_secret
        ):
            event.delivery_status = "failed"
            event.last_error = "Outbound URL or secret is missing."
            event.attempts += 1
            db.commit()
            failed += 1
            continue
        body = json.dumps(event.payload, separators=(",", ":")).encode("utf-8")
        request = Request(
            integration.outbound_url,
            data=body,
            headers={
                "Content-Type": "application/json",
                "User-Agent": "PizzaBlitz-Aggregator/1.0",
                "X-Pizza-Signature": sign_outbound(
                    integration.outbound_secret, body
                ),
                "X-Pizza-Event": event.event_type,
            },
            method="POST",
        )
        event.attempts += 1
        try:
            with urlopen(request, timeout=5) as response:  # noqa: S310 - configured URL
                if 200 <= response.status < 300:
                    event.delivery_status = "sent"
                    event.last_error = None
                    sent += 1
                else:
                    raise URLError(f"HTTP {response.status}")
        except (HTTPError, URLError, TimeoutError, OSError) as exc:
            event.delivery_status = "failed"
            event.last_error = str(exc)[:500]
            backoff_minutes = [1, 5, 15, 60, 180][min(event.attempts - 1, 4)]
            event.next_attempt_at = datetime.utcnow() + timedelta(
                minutes=backoff_minutes
            )
            failed += 1
        db.commit()
    return {"processed": len(events), "sent": sent, "failed": failed}


def recent_aggregator_events(
    db: Session, integration: AggregatorIntegration, limit: int = 20
) -> list[dict]:
    rows = (
        db.query(AggregatorEvent)
        .filter(AggregatorEvent.integration_id == integration.id)
        .order_by(AggregatorEvent.created_at.desc(), AggregatorEvent.id.desc())
        .limit(limit)
        .all()
    )
    return [
        {
            "id": row.id,
            "order_id": row.order_id,
            "external_order_id": row.external_order_id,
            "status": row.status,
            "delivery_status": row.delivery_status,
            "attempts": row.attempts,
            "last_error": row.last_error,
            "created_at": row.created_at.isoformat() if row.created_at else None,
        }
        for row in rows
    ]
