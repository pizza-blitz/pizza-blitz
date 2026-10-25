"""Guest/staff support tickets with a secure public conversation token."""

import secrets
from datetime import datetime, timedelta

from sqlalchemy import func, or_
from sqlalchemy.orm import Session

from app.core.config import settings
from app.models.domain import RestaurantOrder, SupportMessage, SupportTicket

CATEGORIES = ("order", "delivery", "payment", "account", "other")
PRIORITIES = ("low", "normal", "high", "urgent")
STATUSES = ("open", "pending", "resolved", "closed")
SLA_HOURS = {"urgent": 2, "high": 8, "normal": 24, "low": 48}
DUE_SOON_MINUTES = 240


def sla_state(row: SupportTicket, now: datetime | None = None) -> str:
    now = now or datetime.utcnow()
    if row.resolved_at and row.sla_due_at:
        return "met" if row.resolved_at <= row.sla_due_at else "breached"
    if row.status in {"resolved", "closed"}:
        return "closed"
    if row.sla_due_at is None:
        return "no_target"
    if row.sla_due_at < now:
        return "overdue"
    if row.sla_due_at - now <= timedelta(minutes=DUE_SOON_MINUTES):
        return "due_soon"
    return "on_track"


def _sla_payload(row: SupportTicket) -> dict:
    now = datetime.utcnow()
    remaining = (
        int((row.sla_due_at - now).total_seconds() // 60)
        if row.sla_due_at
        else None
    )
    return {
        "sla_due_at": row.sla_due_at.isoformat() if row.sla_due_at else None,
        "first_response_at": row.first_response_at.isoformat()
        if row.first_response_at
        else None,
        "resolved_at": row.resolved_at.isoformat() if row.resolved_at else None,
        "sla_state": sla_state(row, now),
        "sla_remaining_minutes": remaining,
        "sla_target_hours": SLA_HOURS.get(row.priority, 24),
    }


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
        **_sla_payload(row),
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
        sla_due_at=datetime.utcnow() + timedelta(hours=SLA_HOURS[priority]),
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
        row.resolved_at = None
    elif author_type == "staff":
        if not internal and row.first_response_at is None:
            row.first_response_at = datetime.utcnow()
        if row.status == "open":
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
        if status in {"resolved", "closed"}:
            if row.resolved_at is None:
                row.resolved_at = datetime.utcnow()
        else:
            row.resolved_at = None
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
    now = datetime.utcnow()
    active = (
        db.query(SupportTicket)
        .filter(SupportTicket.status.in_(["open", "pending"]))
        .all()
    )
    overdue = sum(1 for row in active if sla_state(row, now) == "overdue")
    due_soon = sum(1 for row in active if sla_state(row, now) == "due_soon")
    responded = [row for row in active if row.first_response_at and row.created_at]
    avg_first_response = (
        round(
            sum(
                (row.first_response_at - row.created_at).total_seconds() / 60
                for row in responded
            )
            / len(responded),
            1,
        )
        if responded
        else 0.0
    )
    resolved = (
        db.query(SupportTicket)
        .filter(SupportTicket.resolved_at.isnot(None), SupportTicket.created_at.isnot(None))
        .all()
    )
    avg_resolution = (
        round(
            sum(
                (row.resolved_at - row.created_at).total_seconds() / 60
                for row in resolved
            )
            / len(resolved),
            1,
        )
        if resolved
        else 0.0
    )
    breached = sum(
        1
        for row in resolved
        if row.sla_due_at and row.resolved_at > row.sla_due_at
    )
    return {
        "counts": counts,
        "urgent_open": urgent,
        "sla": {
            "overdue": overdue,
            "due_soon": due_soon,
            "breached_resolved": breached,
            "avg_first_response_minutes": avg_first_response,
            "avg_resolution_minutes": avg_resolution,
            "targets_hours": SLA_HOURS,
        },
    }
