"""Conversation inbox: threads, messages, templates and inbound payloads."""

from datetime import datetime

from sqlalchemy import or_
from sqlalchemy.orm import Session

from app.models.domain import (
    Customer,
    Message,
    MessageTemplate,
    MessageThread,
)

CHANNELS = {"whatsapp", "sms", "email", "instagram"}
DIRECTIONS = {"inbound", "outbound"}


def normalize_destination(channel: str, destination: str) -> str:
    value = (destination or "").strip()
    if channel in {"whatsapp", "sms"}:
        digits = "".join(char for char in value if char.isdigit())
        return digits[-15:] if digits else value
    return value.lower() if channel == "email" else value


def _customer_for(db: Session, channel: str, destination: str) -> Customer | None:
    if channel == "email":
        return db.query(Customer).filter(Customer.email == destination).first()
    digits = normalize_destination(channel, destination)
    rows = db.query(Customer).filter(Customer.phone.isnot(None)).all()
    for row in rows:
        if normalize_destination(channel, row.phone or "") == digits:
            return row
    return None


def serialize_message(row: Message) -> dict:
    return {
        "id": row.id,
        "thread_id": row.thread_id,
        "direction": row.direction,
        "channel": row.channel,
        "body": row.body,
        "subject": row.subject,
        "status": row.status,
        "provider": row.provider,
        "external_id": row.external_id,
        "error": row.error,
        "actor": row.actor,
        "created_at": row.created_at.isoformat() if row.created_at else None,
    }


def serialize_thread(row: MessageThread, *, include_last: bool = True) -> dict:
    last = (
        max(row.messages, key=lambda item: item.created_at or datetime.min)
        if row.messages
        else None
    )
    return {
        "id": row.id,
        "channel": row.channel,
        "destination": row.destination,
        "contact_name": row.contact_name,
        "customer_id": row.customer_id,
        "status": row.status,
        "assigned_to": row.assigned_to,
        "unread_count": row.unread_count,
        "last_message_at": row.last_message_at.isoformat() if row.last_message_at else None,
        "last_message": last.body[:160] if include_last and last else None,
        "last_direction": last.direction if include_last and last else None,
        "created_at": row.created_at.isoformat() if row.created_at else None,
    }


def serialize_template(row: MessageTemplate) -> dict:
    return {
        "id": row.id,
        "name": row.name,
        "channel": row.channel,
        "subject": row.subject,
        "body": row.body,
        "category": row.category,
        "status": row.status,
        "created_at": row.created_at.isoformat() if row.created_at else None,
        "updated_at": row.updated_at.isoformat() if row.updated_at else None,
    }


def list_threads(
    db: Session,
    *,
    status: str | None = None,
    channel: str | None = None,
    search: str = "",
    limit: int = 100,
) -> list[dict]:
    query = db.query(MessageThread)
    if status:
        query = query.filter(MessageThread.status == status)
    if channel:
        query = query.filter(MessageThread.channel == channel)
    if search.strip():
        needle = f"%{search.strip()}%"
        query = query.filter(
            or_(
                MessageThread.destination.ilike(needle),
                MessageThread.contact_name.ilike(needle),
            )
        )
    rows = query.order_by(MessageThread.last_message_at.desc()).limit(max(1, min(limit, 200))).all()
    return [serialize_thread(row) for row in rows]


def get_thread(db: Session, thread_id: int) -> MessageThread | None:
    return db.query(MessageThread).filter(MessageThread.id == thread_id).first()


def find_or_create_thread(
    db: Session,
    *,
    channel: str,
    destination: str,
    contact_name: str = "",
) -> MessageThread:
    channel = channel.lower()
    if channel not in CHANNELS:
        raise ValueError(f"Unsupported messaging channel: {channel}")
    normalized = normalize_destination(channel, destination)
    if not normalized:
        raise ValueError("A destination is required.")
    row = (
        db.query(MessageThread)
        .filter(
            MessageThread.channel == channel,
            MessageThread.destination == normalized,
        )
        .first()
    )
    customer = _customer_for(db, channel, normalized)
    if row is None:
        row = MessageThread(
            channel=channel,
            destination=normalized,
            contact_name=(contact_name or "").strip()[:160] or customer.name if customer else (contact_name or "").strip()[:160] or None,
            customer_id=customer.id if customer else None,
            status="open",
            last_message_at=datetime.utcnow(),
        )
        db.add(row)
        db.flush()
    else:
        if contact_name and not row.contact_name:
            row.contact_name = contact_name.strip()[:160]
        if customer and not row.customer_id:
            row.customer_id = customer.id
    return row


def add_message(
    db: Session,
    thread: MessageThread,
    *,
    direction: str,
    body: str,
    subject: str = "",
    status: str = "received",
    provider: str = "",
    external_id: str = "",
    error: str = "",
    actor: str = "",
) -> Message:
    if direction not in DIRECTIONS:
        raise ValueError("Invalid message direction.")
    body = (body or "").strip()
    if not body:
        raise ValueError("A message body is required.")
    row = Message(
        thread_id=thread.id,
        direction=direction,
        channel=thread.channel,
        body=body[:8000],
        subject=(subject or "").strip()[:255] or None,
        status=status,
        provider=provider[:60] or None,
        external_id=external_id[:255] or None,
        error=error[:2000] or None,
        actor=actor[:120] or None,
    )
    db.add(row)
    thread.last_message_at = datetime.utcnow()
    thread.updated_at = datetime.utcnow()
    if direction == "inbound":
        thread.unread_count = int(thread.unread_count or 0) + 1
        thread.status = "open"
    db.flush()
    return row


def mark_read(db: Session, thread: MessageThread) -> None:
    thread.unread_count = 0
    db.commit()


def update_thread(
    db: Session,
    thread: MessageThread,
    *,
    status: str | None = None,
    assigned_to: str | None = None,
) -> dict:
    if status is not None:
        if status not in {"open", "pending", "closed"}:
            raise ValueError("Thread status must be open, pending or closed.")
        thread.status = status
    if assigned_to is not None:
        thread.assigned_to = assigned_to.strip()[:120] or None
    thread.updated_at = datetime.utcnow()
    db.commit()
    db.refresh(thread)
    return serialize_thread(thread)


def inbound_payload(channel: str, payload: dict) -> dict:
    """Normalize common Meta, Twilio and email inbound payloads."""
    channel = channel.lower()
    destination = ""
    body = ""
    name = ""
    external_id = ""
    subject = ""

    if channel == "whatsapp":
        entries = payload.get("entry") or []
        changes = (entries[0].get("changes") if entries else []) or []
        value = (changes[0].get("value") if changes else {}) or {}
        messages = value.get("messages") or []
        if messages:
            message = messages[0]
            destination = str(message.get("from") or "")
            body = str((message.get("text") or {}).get("body") or "")
            external_id = str(message.get("id") or "")
            contacts = value.get("contacts") or []
            if contacts:
                name = str((contacts[0].get("profile") or {}).get("name") or "")
    elif channel == "sms":
        destination = str(payload.get("From") or payload.get("from") or payload.get("destination") or "")
        body = str(payload.get("Body") or payload.get("body") or "")
        external_id = str(payload.get("MessageSid") or payload.get("SmsSid") or "")
    elif channel == "email":
        destination = str(payload.get("from") or payload.get("sender") or "")
        body = str(payload.get("text") or payload.get("body") or payload.get("plain") or "")
        subject = str(payload.get("subject") or "")
        external_id = str(payload.get("id") or payload.get("message_id") or "")
        name = str(payload.get("name") or "")
    elif channel == "instagram":
        destination = str(payload.get("from") or payload.get("sender_id") or "")
        body = str(payload.get("text") or payload.get("message") or "")
        external_id = str(payload.get("id") or "")
    else:
        destination = str(payload.get("from") or payload.get("destination") or "")
        body = str(payload.get("body") or payload.get("text") or "")
        name = str(payload.get("name") or "")

    return {
        "channel": channel,
        "destination": destination,
        "body": body,
        "name": name,
        "subject": subject,
        "external_id": external_id,
    }


def list_templates(db: Session, channel: str | None = None) -> list[dict]:
    query = db.query(MessageTemplate)
    if channel:
        query = query.filter(MessageTemplate.channel == channel)
    return [serialize_template(row) for row in query.order_by(MessageTemplate.name.asc()).all()]


def create_template(
    db: Session,
    *,
    name: str,
    channel: str,
    body: str,
    subject: str = "",
    category: str = "marketing",
    status: str = "draft",
) -> dict:
    channel = channel.lower()
    if channel not in CHANNELS:
        raise ValueError(f"Unsupported messaging channel: {channel}")
    row = MessageTemplate(
        name=name.strip()[:140],
        channel=channel,
        subject=(subject or "").strip()[:255] or None,
        body=body.strip()[:8000],
        category=category.strip()[:40] or "marketing",
        status=status if status in {"draft", "approved", "archived"} else "draft",
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return serialize_template(row)
