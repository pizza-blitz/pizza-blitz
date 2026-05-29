from collections import Counter
from datetime import date, datetime, timedelta
from typing import Any

from sqlalchemy import func
from sqlalchemy.orm import Session

from app.models.domain import OperationalAuditEvent


SENSITIVE_EVENT_TYPES = {
    "ad",
    "backup",
    "campaign",
    "cash_drawer",
    "credential",
    "delivery",
    "employee",
    "expense",
    "order",
    "payment",
    "security",
    "social",
}


def _json_safe(value: Any) -> Any:
    if isinstance(value, (datetime, date)):
        return value.isoformat()
    if isinstance(value, dict):
        return {str(key): _json_safe(item) for key, item in value.items()}
    if isinstance(value, (list, tuple, set)):
        return [_json_safe(item) for item in value]
    if isinstance(value, (str, int, float, bool)) or value is None:
        return value
    return str(value)


def _actor_from_session(session: dict | None) -> dict[str, str | None]:
    session = session or {}
    return {
        "actor_role": session.get("role"),
        "actor_subject": session.get("sub") or session.get("subject"),
        "actor_display_name": session.get("display_name") or session.get("name"),
    }


def _request_ip(request: Any | None) -> str | None:
    if request is None:
        return None
    forwarded_for = request.headers.get("x-forwarded-for")
    if forwarded_for:
        return forwarded_for.split(",", 1)[0].strip()
    client = getattr(request, "client", None)
    return getattr(client, "host", None)


def record_operational_audit_event(
    db: Session,
    *,
    session: dict | None = None,
    request: Any | None = None,
    event_type: str,
    action: str,
    resource_type: str,
    resource_id: str | int | None = None,
    status: str = "success",
    detail: str | None = None,
    metadata: dict[str, Any] | None = None,
) -> OperationalAuditEvent:
    actor = _actor_from_session(session)
    event = OperationalAuditEvent(
        event_type=(event_type or "system").strip().lower(),
        action=(action or "recorded").strip().lower(),
        resource_type=(resource_type or "system").strip().lower(),
        resource_id=str(resource_id) if resource_id is not None else None,
        status=(status or "success").strip().lower(),
        detail=detail,
        metadata_json=_json_safe(metadata or {}),
        ip_address=_request_ip(request),
        user_agent=request.headers.get("user-agent") if request is not None else None,
        **actor,
    )
    db.add(event)
    db.commit()
    db.refresh(event)
    return event


def serialize_operational_audit_event(event: OperationalAuditEvent) -> dict:
    return {
        "id": event.id,
        "event_type": event.event_type,
        "action": event.action,
        "resource_type": event.resource_type,
        "resource_id": event.resource_id,
        "status": event.status,
        "actor_role": event.actor_role,
        "actor_subject": event.actor_subject,
        "actor_display_name": event.actor_display_name,
        "detail": event.detail,
        "metadata": event.metadata_json or {},
        "ip_address": event.ip_address,
        "created_at": event.created_at.isoformat() if event.created_at else None,
        "is_sensitive": event.event_type in SENSITIVE_EVENT_TYPES,
    }


def operational_audit_report(db: Session, *, limit: int = 50) -> dict:
    limit = max(1, min(limit, 200))
    events = (
        db.query(OperationalAuditEvent)
        .order_by(OperationalAuditEvent.created_at.desc(), OperationalAuditEvent.id.desc())
        .limit(limit)
        .all()
    )
    since_24h = datetime.utcnow() - timedelta(hours=24)
    total_event_count = db.query(func.count(OperationalAuditEvent.id)).scalar() or 0
    last_24h_count = (
        db.query(func.count(OperationalAuditEvent.id))
        .filter(OperationalAuditEvent.created_at >= since_24h)
        .scalar()
        or 0
    )
    sensitive_event_count = (
        db.query(func.count(OperationalAuditEvent.id))
        .filter(OperationalAuditEvent.event_type.in_(SENSITIVE_EVENT_TYPES))
        .scalar()
        or 0
    )
    actor_counts = Counter(event.actor_role or "system" for event in events)
    type_counts = Counter(event.event_type or "system" for event in events)
    latest_sensitive = next(
        (event for event in events if event.event_type in SENSITIVE_EVENT_TYPES),
        None,
    )

    return {
        "generated_at": datetime.utcnow().isoformat(),
        "summary": {
            "total_event_count": total_event_count,
            "last_24h_count": last_24h_count,
            "sensitive_event_count": sensitive_event_count,
            "visible_event_count": len(events),
            "actor_role_counts": dict(actor_counts),
            "event_type_counts": dict(type_counts),
            "latest_event_at": events[0].created_at.isoformat() if events else None,
            "latest_sensitive_at": (
                latest_sensitive.created_at.isoformat()
                if latest_sensitive and latest_sensitive.created_at
                else None
            ),
            "status": "active" if total_event_count else "ready",
        },
        "controls": [
            {
                "name": "Admin-only ledger",
                "status": "Enforced",
                "detail": "Only signed admin sessions can read the operational audit trail.",
            },
            {
                "name": "Actor attribution",
                "status": "Captured",
                "detail": "Each event stores role, subject, display name, timestamp and request context when available.",
            },
            {
                "name": "Sensitive action coverage",
                "status": "Started",
                "detail": "Credentials, delivery controls, backups, order state changes and payment settlement actions are recorded.",
            },
        ],
        "events": [serialize_operational_audit_event(event) for event in events],
    }
