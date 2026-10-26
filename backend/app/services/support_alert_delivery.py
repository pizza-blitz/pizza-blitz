"""Deliver support SLA alerts to Slack and/or email when configured."""

import json
import os
import urllib.request
from datetime import datetime, timedelta

from sqlalchemy.orm import Session

from app.models.domain import SupportNotification, SupportTicket
from app.services.campaign_dispatch_service import send_campaign_message

MAX_DELIVERY_ATTEMPTS = 3
RETRY_BACKOFF_MINUTES = {1: 5, 2: 15}


def _slack_alert(notification: SupportNotification, ticket: SupportTicket) -> str | None:
    webhook = os.getenv("SUPPORT_SLACK_WEBHOOK_URL", "").strip()
    if not webhook:
        return None
    payload = {
        "text": (
            f":rotating_light: *Support SLA alert*\n"
            f"{notification.message}\n"
            f"Ticket #{ticket.id} · {ticket.priority} · {ticket.status}"
        )
    }
    request = urllib.request.Request(
        webhook,
        data=json.dumps(payload).encode("utf-8"),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(request, timeout=10) as response:  # noqa: S310
            if 200 <= response.status < 300:
                return "slack"
    except OSError:
        return None
    return None


def _pager_eligible(notification: SupportNotification, ticket: SupportTicket) -> bool:
    if notification.kind == "resolution_overdue":
        return True
    return (
        notification.kind == "first_response_overdue"
        and ticket.priority in {"urgent", "high"}
    )


def _pager_alert(
    notification: SupportNotification, ticket: SupportTicket
) -> str | None:
    webhook = os.getenv("SUPPORT_PAGER_WEBHOOK_URL", "").strip()
    if not webhook or not _pager_eligible(notification, ticket):
        return None
    payload = {
        "routing_key": os.getenv("SUPPORT_PAGER_ROUTING_KEY", "").strip(),
        "event_action": "trigger",
        "payload": {
            "summary": f"[{ticket.priority}] {ticket.subject}: {notification.message}",
            "source": "pizza-blitz-support",
            "severity": "critical" if ticket.priority == "urgent" else "error",
            "custom_details": {
                "ticket_id": ticket.id,
                "priority": ticket.priority,
                "status": ticket.status,
                "customer": ticket.customer_name,
                "kind": notification.kind,
            },
        },
    }
    request = urllib.request.Request(
        webhook,
        data=json.dumps(payload).encode("utf-8"),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(request, timeout=10) as response:  # noqa: S310
            if 200 <= response.status < 300:
                return "pager"
    except OSError:
        return None
    return None


def _email_alert(notification: SupportNotification, ticket: SupportTicket) -> str | None:
    recipient = os.getenv("SUPPORT_ALERT_EMAIL", "").strip()
    if not recipient:
        return None
    result = send_campaign_message(
        channel="email",
        destination=recipient,
        subject=f"Support SLA alert: {ticket.priority} ticket #{ticket.id}",
        message=(
            f"{notification.message}\n\n"
            f"Ticket: {ticket.subject}\nPriority: {ticket.priority}\n"
            f"Status: {ticket.status}\nCustomer: {ticket.customer_name}"
        ),
    )
    return "email" if result.status == "sent" else None


def deliver_alert(
    db: Session, notification: SupportNotification, ticket: SupportTicket
) -> dict:
    channels: list[str] = []
    errors: list[str] = []
    pager_configured = bool(
        os.getenv("SUPPORT_PAGER_WEBHOOK_URL", "").strip()
    ) and _pager_eligible(notification, ticket)
    configured = bool(
        os.getenv("SUPPORT_SLACK_WEBHOOK_URL", "").strip()
        or os.getenv("SUPPORT_ALERT_EMAIL", "").strip()
        or pager_configured
    )
    notification.delivery_attempts = (notification.delivery_attempts or 0) + 1
    notification.last_attempt_at = datetime.utcnow()
    slack = _slack_alert(notification, ticket)
    if slack:
        channels.append(slack)
    elif os.getenv("SUPPORT_SLACK_WEBHOOK_URL", "").strip():
        errors.append("slack webhook failed")
    email = _email_alert(notification, ticket)
    if email:
        channels.append(email)
    elif os.getenv("SUPPORT_ALERT_EMAIL", "").strip():
        errors.append("email provider not configured or send failed")
    pager = _pager_alert(notification, ticket)
    if pager:
        channels.append(pager)
    elif pager_configured:
        errors.append("pager webhook failed")
    if channels:
        notification.delivery_status = "sent"
        notification.delivery_channels = ",".join(channels)
        notification.delivered_at = datetime.utcnow()
        notification.next_retry_at = None
    elif configured and notification.delivery_attempts < MAX_DELIVERY_ATTEMPTS:
        notification.delivery_status = "retrying"
        minutes = RETRY_BACKOFF_MINUTES.get(notification.delivery_attempts, 30)
        notification.next_retry_at = datetime.utcnow() + timedelta(minutes=minutes)
    elif configured:
        notification.delivery_status = "failed"
        notification.next_retry_at = None
    else:
        notification.delivery_status = "skipped"
        notification.next_retry_at = None
    notification.delivery_error = "; ".join(errors) or None
    db.commit()
    return {
        "id": notification.id,
        "status": notification.delivery_status,
        "channels": channels,
        "error": notification.delivery_error,
        "attempts": notification.delivery_attempts,
        "next_retry_at": notification.next_retry_at.isoformat()
        if notification.next_retry_at
        else None,
    }


def retry_due_alerts(db: Session, limit: int = 50) -> dict:
    due = (
        db.query(SupportNotification)
        .filter(
            SupportNotification.delivery_status.in_(["pending", "retrying"]),
            SupportNotification.next_retry_at.isnot(None),
            SupportNotification.next_retry_at <= datetime.utcnow(),
        )
        .order_by(SupportNotification.next_retry_at.asc())
        .limit(limit)
        .all()
    )
    sent = 0
    retrying = 0
    failed = 0
    for notification in due:
        ticket = (
            db.query(SupportTicket)
            .filter(SupportTicket.id == notification.ticket_id)
            .first()
        )
        if ticket is None:
            continue
        result = deliver_alert(db, notification, ticket)
        if result["status"] == "sent":
            sent += 1
        elif result["status"] == "retrying":
            retrying += 1
        else:
            failed += 1
    return {"attempted": len(due), "sent": sent, "retrying": retrying, "failed": failed}
