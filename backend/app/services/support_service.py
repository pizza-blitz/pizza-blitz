"""Guest/staff support tickets with a secure public conversation token."""

import secrets
from datetime import datetime

from sqlalchemy import func, or_
from sqlalchemy.orm import Session

from app.core.config import settings
from app.models.domain import RestaurantOrder, SupportMessage, SupportTicket

CATEGORIES = ("order", "delivery", "payment", "account", "other")
PRIORITIES = ("low", "normal", "high", "urgent")
STATUSES = ("open", "pending", "resolved", "closed")


def serialize_message(row: SupportMessage) -> dict:
    return {
        "id": row.id,
        "author_type": row.author_type,
        "author_name": row.author_name,
        "body": row.body,
        "internal": bool(row.internal),
        "created_at": row.created_at.isoformat() if row.created_at else None,
    }


def serialize_ticket(
    row: SupportTicket,
    *,
    detail: bool = False,
    include_internal: bool = False,
) -> dict:
    messages = sorted(row.messages, key=lambda item: item.id)
    visible = [item for item in messages if include_internal or not item.internal]
    payload = {
        "id": row.id,
        "customer_name": row.customer_name,
        "email": row.email,
        "phone": row.phone,
        "subject": row.subject,
        "category": row.category,
        "priority": row.priority,
        "status": row.status,
        "order_id": row.order_id,
        "created_at": row.created_at.isoformat() if row.created_at else None,
        "updated_at": row.updated_at.isoformat() if row.updated_at else None,
        "last_message_at": row.last_message_at.isoformat()
        if row.last_message_at
        else None,
        "message_count": len(messages),
        "last_message": visible[-1].body[:160] if visible else None,
    }
    if detail:
        payload["token"] = row.token
        payload["assigned_to"] = row.assigned_to
        payload["messages"] = [serialize_message(item) for item in visible]
    return payload


def public_payload(row: SupportTicket) -> dict:
    payload = serialize_ticket(row, detail=True, include_internal=False)
    payload.pop("id", None)
    payload.pop("token", None)
    payload["ticket_url"] = (
        f"{settings.PIZZA_BLITZ_PUBLIC_URL.rstrip('/')}/support/ticket/{row.token}"
    )
    return payload


def find_by_token(db: Session, token: str) -> SupportTicket | None:
    clean = (token or "").strip()
    if not clean:
        return None
    return db.query(SupportTicket).filter(SupportTicket.token == clean).first()


def create_ticket(
    db: Session,
    *,
    customer_name: str,
    subject: str,
    message: str,
    email: str = "",
    phone: str = "",
    category: str = "other",
    priority: str = "normal",
    order_id: int | None = None,
) -> dict:
    name = customer_name.strip()[:160]
    clean_subject = subject.strip()[:200]
    body = message.strip()[:5000]
    email = email.strip().lower()[:200]
    phone = phone.strip()[:30]
    category = category.strip().lower()
    priority = priority.strip().lower()
    if not name or not clean_subject or len(body) < 5:
        raise ValueError("Add your name, a subject and a message.")
    if len(name) < 2:
        raise ValueError("Name is too short.")
    if not email and not phone:
        raise ValueError("Add an email address or phone number.")
    if category not in CATEGORIES:
        raise ValueError("Unknown support category.")
    if priority not in PRIORITIES:
        raise ValueError("Unknown support priority.")
    if order_id is not None:
        order = db.query(RestaurantOrder).filter(RestaurantOrder.id == order_id).first()
        if order is None:
            raise ValueError("Order not found.")
    row = SupportTicket(
        token=secrets.token_urlsafe(24),
        customer_name=name,
        email=email or None,
        phone=phone or None,
        subject=clean_subject,
        category=category,
        priority=priority,
        status="open",
        order_id=order_id,
    )
    db.add(row)
    db.flush()
    db.add(
        SupportMessage(
            ticket_id=row.id,
            author_type="customer",
            author_name=name,
            body=body,
        )
    )
    db.commit()
    db.refresh(row)
    return {"ticket": public_payload(row), "token": row.token}


def add_message(
    db: Session,
    row: SupportTicket,
    *,
    author_type: str,
    author_name: str,
    body: str,
    internal: bool = False,
) -> SupportTicket:
    clean = body.strip()[:5000]
    if len(clean) < 2:
        raise ValueError("Message is too short.")
    if author_type not in {"customer", "staff", "system"}:
        raise ValueError("Unknown message author.")
    db.add(
        SupportMessage(
            ticket_id=row.id,
            author_type=author_type,
            author_name=author_name[:160] or author_type,
            body=clean,
            internal=internal,
        )
    )
    row.last_message_at = datetime.utcnow()
    if author_type == "customer":
        row.status = "open"
    elif author_type == "staff" and row.status == "open":
        row.status = "pending"
    db.commit()
    db.refresh(row)
    return row


def update_ticket(
    db: Session,
    row: SupportTicket,
    *,
    status: str | None = None,
    priority: str | None = None,
    category: str | None = None,
    assigned_to: str | None = None,
) -> SupportTicket:
    if status is not None:
        if status not in STATUSES:
            raise ValueError("Unknown ticket status.")
        row.status = status
    if priority is not None:
        if priority not in PRIORITIES:
            raise ValueError("Unknown ticket priority.")
        row.priority = priority
    if category is not None:
        if category not in CATEGORIES:
            raise ValueError("Unknown ticket category.")
        row.category = category
    if assigned_to is not None:
        row.assigned_to = assigned_to.strip()[:120] or None
    db.commit()
    db.refresh(row)
    return row


def list_tickets(
    db: Session, *, status: str = "", query: str = "", limit: int = 100
) -> list[dict]:
    rows = db.query(SupportTicket)
    if status:
        if status not in STATUSES:
            raise ValueError("Unknown ticket status.")
        rows = rows.filter(SupportTicket.status == status)
    needle = query.strip()
    if needle:
        pattern = f"%{needle}%"
        rows = rows.filter(
            or_(
                SupportTicket.subject.ilike(pattern),
                SupportTicket.customer_name.ilike(pattern),
                SupportTicket.email.ilike(pattern),
                SupportTicket.phone.ilike(pattern),
            )
        )
    ordered = (
        rows.order_by(SupportTicket.last_message_at.desc(), SupportTicket.id.desc())
        .limit(max(1, min(limit, 200)))
        .all()
    )
    return [serialize_ticket(row) for row in ordered]


def support_summary(db: Session) -> dict:
    counts = {
        status: db.query(func.count(SupportTicket.id))
        .filter(SupportTicket.status == status)
        .scalar()
        or 0
        for status in STATUSES
    }
    urgent = (
        db.query(func.count(SupportTicket.id))
        .filter(
            SupportTicket.priority.in_(["high", "urgent"]),
            SupportTicket.status.in_(["open", "pending"]),
        )
        .scalar()
        or 0
    )
    return {"counts": counts, "urgent_open": urgent}
