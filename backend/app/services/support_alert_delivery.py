"""Deliver support SLA alerts to Slack and/or email when configured."""

import json
import os
import urllib.request
from datetime import datetime

from sqlalchemy.orm import Session

from app.models.domain import SupportNotification, SupportTicket
from app.services.campaign_dispatch_service import send_campaign_message


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
    if channels:
        notification.delivery_status = "sent"
        notification.delivery_channels = ",".join(channels)
        notification.delivered_at = datetime.utcnow()
    else:
        notification.delivery_status = "skipped"
    notification.delivery_error = "; ".join(errors) or None
    db.commit()
    return {
        "id": notification.id,
        "status": notification.delivery_status,
        "channels": channels,
        "error": notification.delivery_error,
    }
