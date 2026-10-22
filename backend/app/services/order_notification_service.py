"""Transactional order-status notifications.

Messages are sent through the same provider configuration as campaigns, but are
gated by ``ORDER_NOTIFICATIONS_ENABLED`` and recorded in ``order_notifications``
so every attempt is auditable. The ``console`` channel records a successful send
without calling an external provider (development/demo).
"""

from datetime import datetime

from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.config import settings
from app.models.domain import OrderNotification, RestaurantOrder
from app.services.campaign_dispatch_service import (
    CampaignProviderResult,
    send_campaign_message,
)

NOTIFICATION_EVENTS = {
    "preparing",
    "ready",
    "out_for_delivery",
    "delivered",
    "completed",
    "cancelled",
}

STATUS_EVENT_MAP = {
    "preparing": "preparing",
    "ready": "ready",
    "cancelled": "cancelled",
    "closed": "completed",
}


def tracking_url(order: RestaurantOrder) -> str:
    base = (settings.PIZZA_BLITZ_PUBLIC_URL or "").rstrip("/")
    return f"{base}/track?order={order.id}"


def build_notification_message(order: RestaurantOrder, event: str) -> str:
    is_delivery = (order.order_type or "").lower() == "delivery"
    tracker = tracking_url(order)
    if event == "preparing":
        return f"Pizza Blitz: Order #{order.id} is being prepared. Track: {tracker}"
    if event == "ready":
        return (
            f"Pizza Blitz: Order #{order.id} is packed and waiting for a rider. Track: {tracker}"
            if is_delivery
            else f"Pizza Blitz: Order #{order.id} is ready for pickup. Track: {tracker}"
        )
    if event == "out_for_delivery":
        return f"Pizza Blitz: Order #{order.id} is on the way. Track: {tracker}"
    if event == "delivered":
        return f"Pizza Blitz: Order #{order.id} has been delivered. Enjoy!"
    if event == "completed":
        return f"Pizza Blitz: Order #{order.id} is complete. Thank you for ordering!"
    if event == "cancelled":
        return f"Pizza Blitz: Order #{order.id} was cancelled. Contact the store if you need help."
    return f"Pizza Blitz: Order #{order.id} update: {event}."


def serialize_notification(notification: OrderNotification) -> dict:
    return {
        "id": notification.id,
        "order_id": notification.order_id,
        "event": notification.event,
        "channel": notification.channel,
        "recipient": notification.recipient,
        "message": notification.message,
        "status": notification.status,
        "provider": notification.provider,
        "provider_message_id": notification.provider_message_id,
        "error": notification.error,
        "created_at": notification.created_at.isoformat() if notification.created_at else None,
        "sent_at": notification.sent_at.isoformat() if notification.sent_at else None,
    }


def notify_order_event(
    db: Session, order: RestaurantOrder, event: str, *, channel: str | None = None
) -> OrderNotification | None:
    normalized_event = (event or "").strip().lower()
    if normalized_event not in NOTIFICATION_EVENTS:
        return None

    existing = (
        db.query(OrderNotification)
        .filter(
            OrderNotification.order_id == order.id,
            OrderNotification.event == normalized_event,
        )
        .first()
    )
    if existing is not None:
        return existing

    channel_name = (channel or settings.ORDER_NOTIFICATION_CHANNEL or "sms").strip().lower()
    recipient = (order.customer_phone or "").strip() or None
    message = build_notification_message(order, normalized_event)
    status = "skipped"
    provider = None
    provider_message_id = None
    error = None
    sent_at = None

    if not settings.ORDER_NOTIFICATIONS_ENABLED:
        error = "Order notifications are disabled."
    elif not recipient:
        error = "Order has no customer phone number."
    else:
        try:
            if channel_name == "console":
                result = CampaignProviderResult(
                    provider="console",
                    status="sent",
                    external_id=f"console-{order.id}-{normalized_event}",
                )
            else:
                result = send_campaign_message(
                    channel=channel_name,
                    destination=recipient,
                    message=message,
                    subject=f"Pizza Blitz order #{order.id}",
                )
            provider = result.provider
            provider_message_id = result.external_id
            status = "sent" if result.status == "sent" else (result.status or "failed")
            error = result.error
            if status == "sent":
                sent_at = datetime.utcnow()
        except Exception as exc:  # noqa: BLE001 - notification failures must not break order updates
            status = "failed"
            error = str(exc)[:500]

    notification = OrderNotification(
        order_id=order.id,
        event=normalized_event,
        channel=channel_name,
        recipient=recipient,
        message=message,
        status=status,
        provider=provider,
        provider_message_id=provider_message_id,
        error=error,
        sent_at=sent_at,
    )
    db.add(notification)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        return (
            db.query(OrderNotification)
            .filter(
                OrderNotification.order_id == order.id,
                OrderNotification.event == normalized_event,
            )
            .first()
        )
    db.refresh(notification)
    return notification


def notify_order_status_change(
    db: Session, order: RestaurantOrder, previous_status: str | None
) -> OrderNotification | None:
    if not previous_status or previous_status == order.status:
        return None
    event = STATUS_EVENT_MAP.get((order.status or "").lower())
    if not event:
        return None
    return notify_order_event(db, order, event)


def sent_notifications_for_order(order: RestaurantOrder, limit: int = 8) -> list[dict]:
    notifications = [
        notification
        for notification in (order.notifications or [])
        if notification.status == "sent"
    ]
    notifications.sort(key=lambda row: (row.created_at or datetime.min, row.id or 0))
    return [
        {
            "event": notification.event,
            "channel": notification.channel,
            "provider": notification.provider,
            "created_at": notification.created_at.isoformat()
            if notification.created_at
            else None,
        }
        for notification in notifications[-limit:]
    ]
