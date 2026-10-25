"""Trigger-based marketing journeys with durable enrollment steps."""

import secrets
from datetime import datetime, timedelta

from sqlalchemy import func
from sqlalchemy.orm import Session

from app.models.domain import (
    Customer,
    JourneyEnrollment,
    JourneyEvent,
    MarketingJourney,
    MessageTemplate,
    RestaurantOrder,
)
from app.services.campaign_dispatch_service import send_campaign_message

TRIGGERS = {
    "order_completed": "Order completed",
    "order_delivered": "Order delivered",
    "feedback_low": "Low feedback score",
    "manual": "Manual enrollment",
}
CHANNELS = {"whatsapp", "sms", "email", "instagram"}


def serialize_journey(db: Session, row: MarketingJourney) -> dict:
    enrollments = (
        db.query(func.count(JourneyEnrollment.id))
        .filter(JourneyEnrollment.journey_id == row.id)
        .scalar()
        or 0
    )
    completed = (
        db.query(func.count(JourneyEnrollment.id))
        .filter(
            JourneyEnrollment.journey_id == row.id,
            JourneyEnrollment.status == "completed",
        )
        .scalar()
        or 0
    )
    recent = (
        db.query(JourneyEnrollment)
        .filter(JourneyEnrollment.journey_id == row.id)
        .order_by(JourneyEnrollment.created_at.desc())
        .limit(8)
        .all()
    )
    all_enrollments = (
        db.query(JourneyEnrollment)
        .filter(JourneyEnrollment.journey_id == row.id)
        .all()
    )
    variant_stats: dict[str, dict] = {}
    for item in all_enrollments:
        variant = (item.context or {}).get("variant")
        if variant not in {"A", "B"}:
            continue
        bucket = variant_stats.setdefault(
            variant, {"variant": variant, "enrollments": 0, "completed": 0, "revenue": 0.0}
        )
        bucket["enrollments"] += 1
        if item.status == "completed":
            bucket["completed"] += 1
        order_id = (item.context or {}).get("order_id")
        if order_id:
            order = (
                db.query(RestaurantOrder)
                .filter(RestaurantOrder.id == int(order_id))
                .first()
            )
            if order is not None:
                bucket["revenue"] = round(
                    bucket["revenue"] + float(order.total_amount or 0), 2
                )
    order_ids = {
        int(item.context["order_id"])
        for item in all_enrollments
        if (item.context or {}).get("order_id")
    }
    attributed_revenue = 0.0
    if order_ids:
        attributed_revenue = round(
            float(
                db.query(func.coalesce(func.sum(RestaurantOrder.total_amount), 0.0))
                .filter(RestaurantOrder.id.in_(order_ids))
                .scalar()
                or 0.0
            ),
            2,
        )
    return {
        "id": row.id,
        "name": row.name,
        "description": row.description,
        "trigger": row.trigger,
        "trigger_label": TRIGGERS.get(row.trigger, row.trigger),
        "status": row.status,
        "steps": row.steps or [],
        "enrollment_count": enrollments,
        "completed_count": completed,
        "max_sends_per_customer": row.max_sends_per_customer or 0,
        "frequency_window_hours": row.frequency_window_hours or 24,
        "variants": [variant_stats[key] for key in sorted(variant_stats)],
        "attributed_revenue": attributed_revenue,
        "revenue_per_enrollment": round(attributed_revenue / enrollments, 2)
        if enrollments
        else 0.0,
        "recent_enrollments": [serialize_enrollment(item) for item in recent],
        "created_at": row.created_at.isoformat() if row.created_at else None,
        "updated_at": row.updated_at.isoformat() if row.updated_at else None,
    }


def serialize_enrollment(row: JourneyEnrollment) -> dict:
    events = sorted(row.events, key=lambda item: item.id)
    context = row.context or {}
    return {
        "id": row.id,
        "journey_id": row.journey_id,
        "customer_id": row.customer_id,
        "trigger_ref": row.trigger_ref,
        "status": row.status,
        "current_step": row.current_step,
        "next_run_at": row.next_run_at.isoformat() if row.next_run_at else None,
        "context": context,
        "contact": context.get("name") or context.get("phone") or context.get("email"),
        "events": [
            {
                "id": event.id,
                "step_index": event.step_index,
                "step_type": event.step_type,
                "status": event.status,
                "detail": event.detail,
                "created_at": event.created_at.isoformat() if event.created_at else None,
            }
            for event in events
        ],
        "created_at": row.created_at.isoformat() if row.created_at else None,
    }


def validate_steps(steps: list) -> list[dict]:
    cleaned: list[dict] = []
    for raw in steps or []:
        if not isinstance(raw, dict):
            raise ValueError("Each journey step must be an object.")
        step_type = str(raw.get("type") or "").lower()
        if step_type == "delay":
            try:
                hours = float(raw.get("hours", 0))
            except (TypeError, ValueError):
                raise ValueError("Delay hours must be a number.") from None
            if hours < 0 or hours > 720:
                raise ValueError("Delay must be between 0 and 720 hours.")
            cleaned.append({"type": "delay", "hours": round(hours, 2)})
        elif step_type == "send":
            channel = str(raw.get("channel") or "").lower()
            if channel not in CHANNELS:
                raise ValueError(f"Unsupported journey channel: {channel}.")
            body = str(raw.get("body") or "").strip()[:4000]
            template_id = raw.get("template_id")
            if not body and not template_id:
                raise ValueError("A send step needs a body or template.")
            cleaned.append(
                {
                    "type": "send",
                    "channel": channel,
                    "subject": str(raw.get("subject") or "").strip()[:255],
                    "body": body,
                    "template_id": int(template_id) if template_id else None,
                    "variant": str(raw.get("variant") or "").strip().upper()
                    if str(raw.get("variant") or "").strip().upper() in {"A", "B"}
                    else None,
                }
            )
        elif step_type == "condition":
            field = str(raw.get("field") or "order_total").strip()[:40]
            operator = str(raw.get("operator") or ">=").strip()
            if operator not in {">=", ">", "<=", "<", "==", "!="}:
                raise ValueError("Condition operator must be >=, >, <=, <, == or !=.")
            try:
                value = float(raw.get("value"))
            except (TypeError, ValueError):
                raise ValueError("Condition value must be a number.") from None
            cleaned.append(
                {
                    "type": "condition",
                    "field": field,
                    "operator": operator,
                    "value": value,
                }
            )
        elif step_type == "branch":
            field = str(raw.get("field") or "order_total").strip()[:40]
            operator = str(raw.get("operator") or ">=").strip()
            if operator not in {">=", ">", "<=", "<", "==", "!="}:
                raise ValueError("Branch operator must be >=, >, <=, <, == or !=.")
            try:
                value = float(raw.get("value"))
                true_step = int(raw.get("true_step"))
                false_step = int(raw.get("false_step"))
            except (TypeError, ValueError):
                raise ValueError(
                    "Branch needs a numeric value and true/false step targets."
                ) from None
            cleaned.append(
                {
                    "type": "branch",
                    "field": field,
                    "operator": operator,
                    "value": value,
                    "true_step": true_step,
                    "false_step": false_step,
                }
            )
        elif step_type == "stop":
            cleaned.append({"type": "stop"})
        else:
            raise ValueError(
                "Journey steps must be delay, condition, branch, stop or send."
            )
    if not cleaned:
        raise ValueError("Add at least one journey step.")
    if not any(step["type"] == "send" for step in cleaned):
        raise ValueError("A journey needs at least one send step.")
    for index, step in enumerate(cleaned):
        if step["type"] != "branch":
            continue
        for key in ("true_step", "false_step"):
            target = step[key]
            if target <= index or target > len(cleaned):
                raise ValueError(
                    f"Branch {key} must point forward to step {index + 2} or later."
                )
    return cleaned


def list_journeys(db: Session) -> list[dict]:
    rows = (
        db.query(MarketingJourney)
        .order_by(MarketingJourney.created_at.desc())
        .all()
    )
    return [serialize_journey(db, row) for row in rows]


def get_journey(db: Session, journey_id: int) -> MarketingJourney | None:
    return db.query(MarketingJourney).filter(MarketingJourney.id == journey_id).first()


def create_journey(
    db: Session,
    *,
    name: str,
    description: str,
    trigger: str,
    steps: list,
    status: str = "draft",
    max_sends_per_customer: int = 0,
    frequency_window_hours: int = 24,
) -> dict:
    if trigger not in TRIGGERS:
        raise ValueError("Unknown journey trigger.")
    row = MarketingJourney(
        name=name.strip()[:160],
        description=(description or "").strip()[:500] or None,
        trigger=trigger,
        status=status if status in {"draft", "active", "paused"} else "draft",
        steps=validate_steps(steps),
        max_sends_per_customer=max(0, min(int(max_sends_per_customer), 50)),
        frequency_window_hours=max(1, min(int(frequency_window_hours), 720)),
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return serialize_journey(db, row)


def update_journey(
    db: Session,
    row: MarketingJourney,
    *,
    name: str | None = None,
    description: str | None = None,
    trigger: str | None = None,
    steps: list | None = None,
    status: str | None = None,
    max_sends_per_customer: int | None = None,
    frequency_window_hours: int | None = None,
) -> dict:
    if name is not None:
        row.name = name.strip()[:160]
    if description is not None:
        row.description = description.strip()[:500] or None
    if trigger is not None:
        if trigger not in TRIGGERS:
            raise ValueError("Unknown journey trigger.")
        row.trigger = trigger
    if steps is not None:
        row.steps = validate_steps(steps)
    if status is not None:
        if status not in {"draft", "active", "paused"}:
            raise ValueError("Journey status must be draft, active or paused.")
        row.status = status
    if max_sends_per_customer is not None:
        row.max_sends_per_customer = max(0, min(int(max_sends_per_customer), 50))
    if frequency_window_hours is not None:
        row.frequency_window_hours = max(1, min(int(frequency_window_hours), 720))
    db.commit()
    db.refresh(row)
    return serialize_journey(db, row)


def _destination_for(channel: str, customer: Customer | None, context: dict) -> str:
    if channel == "email":
        return (customer.email if customer and customer.email else context.get("email") or "").strip()
    return (context.get("phone") or (customer.phone if customer else "") or "").strip()


def _log(
    db: Session,
    enrollment: JourneyEnrollment,
    *,
    step_index: int,
    step_type: str,
    status: str,
    detail: str = "",
) -> None:
    db.add(
        JourneyEvent(
            enrollment_id=enrollment.id,
            step_index=step_index,
            step_type=step_type,
            status=status,
            detail=detail[:500] or None,
        )
    )


def _condition_passes(step: dict, context: dict) -> tuple[bool, str]:
    field = str(step.get("field") or "order_total")
    raw_value = context.get(field)
    if raw_value is None:
        return False, f"No {field} in enrollment context."
    try:
        actual = float(raw_value)
        expected = float(step.get("value"))
    except (TypeError, ValueError):
        return False, f"{field} is not numeric."
    operator = step.get("operator") or ">="
    checks = {
        ">=": actual >= expected,
        ">": actual > expected,
        "<=": actual <= expected,
        "<": actual < expected,
        "==": actual == expected,
        "!=": actual != expected,
    }
    passed = checks.get(operator, False)
    return passed, f"{field} {actual:g} {operator} {expected:g} is {str(passed).lower()}."


def _pick_variant(journey: MarketingJourney) -> str | None:
    has_variants = any(
        step.get("type") == "send" and step.get("variant")
        for step in (journey.steps or [])
    )
    if not has_variants:
        return None
    return secrets.choice(("A", "B"))


def _frequency_capped(db: Session, enrollment: JourneyEnrollment) -> bool:
    journey = enrollment.journey
    limit = int(journey.max_sends_per_customer or 0)
    if limit <= 0 or not enrollment.customer_id:
        return False
    window_hours = int(journey.frequency_window_hours or 24)
    since = datetime.utcnow() - timedelta(hours=window_hours)
    sent = (
        db.query(func.count(JourneyEvent.id))
        .join(
            JourneyEnrollment,
            JourneyEvent.enrollment_id == JourneyEnrollment.id,
        )
        .filter(
            JourneyEnrollment.customer_id == enrollment.customer_id,
            JourneyEvent.step_type == "send",
            JourneyEvent.status == "sent",
            JourneyEvent.created_at >= since,
        )
        .scalar()
        or 0
    )
    customer_enrollment_ids = {
        row[0]
        for row in db.query(JourneyEnrollment.id)
        .filter(JourneyEnrollment.customer_id == enrollment.customer_id)
        .all()
    }
    pending_sent = sum(
        1
        for item in db.new
        if isinstance(item, JourneyEvent)
        and item.status == "sent"
        and item.enrollment_id in customer_enrollment_ids
    )
    return int(sent) + pending_sent >= limit


def _advance(db: Session, enrollment: JourneyEnrollment) -> None:
    journey = enrollment.journey
    steps = journey.steps or []
    while (
        enrollment.status == "running"
        and enrollment.next_run_at
        and enrollment.next_run_at <= datetime.utcnow()
        and enrollment.current_step < len(steps)
    ):
        index = enrollment.current_step
        step = steps[index]
        if step.get("type") == "branch":
            passed, detail = _condition_passes(step, enrollment.context or {})
            target = int(step.get("true_step") if passed else step.get("false_step"))
            _log(
                db,
                enrollment,
                step_index=index,
                step_type="branch",
                status="passed" if passed else "alternate",
                detail=f"{detail} Moved to step {target + 1}.",
            )
            enrollment.current_step = target
            if target >= len(steps):
                enrollment.status = "completed"
                enrollment.next_run_at = None
            else:
                enrollment.next_run_at = datetime.utcnow()
        elif step.get("type") == "stop":
            _log(
                db,
                enrollment,
                step_index=index,
                step_type="stop",
                status="stopped",
                detail="Journey path ended at a stop step.",
            )
            enrollment.status = "completed"
            enrollment.next_run_at = None
            break
        elif step.get("type") == "condition":
            passed, detail = _condition_passes(step, enrollment.context or {})
            _log(
                db,
                enrollment,
                step_index=index,
                step_type="condition",
                status="passed" if passed else "stopped",
                detail=detail,
            )
            enrollment.current_step = index + 1
            if not passed:
                enrollment.status = "stopped"
                enrollment.next_run_at = None
                break
            if enrollment.current_step >= len(steps):
                enrollment.status = "completed"
                enrollment.next_run_at = None
            else:
                enrollment.next_run_at = datetime.utcnow()
        elif step.get("type") == "delay":
            hours = float(step.get("hours") or 0)
            _log(
                db,
                enrollment,
                step_index=index,
                step_type="delay",
                status="waited",
                detail=f"Waited {hours:g} hour(s).",
            )
            enrollment.current_step = index + 1
            if enrollment.current_step >= len(steps):
                enrollment.status = "completed"
                enrollment.next_run_at = None
            else:
                enrollment.next_run_at = datetime.utcnow() + timedelta(hours=hours)
                if hours > 0:
                    break
        else:
            channel = str(step.get("channel") or "whatsapp").lower()
            body = str(step.get("body") or "").strip()
            assigned_variant = (enrollment.context or {}).get("variant")
            step_variant = step.get("variant")
            if step_variant and assigned_variant and step_variant != assigned_variant:
                _log(
                    db,
                    enrollment,
                    step_index=index,
                    step_type="send",
                    status="skipped",
                    detail=f"Step is variant {step_variant}; contact is variant {assigned_variant}.",
                )
            elif _frequency_capped(db, enrollment):
                _log(
                    db,
                    enrollment,
                    step_index=index,
                    step_type="send",
                    status="skipped",
                    detail=(
                        f"Frequency cap reached: {enrollment.journey.max_sends_per_customer} "
                        f"send(s) per {enrollment.journey.frequency_window_hours}h."
                    ),
                )
            else:
                template_id = step.get("template_id")
                if template_id:
                    template = (
                        db.query(MessageTemplate)
                        .filter(MessageTemplate.id == int(template_id))
                        .first()
                    )
                    if template is not None:
                        body = body or template.body
                        step = {
                            **step,
                            "subject": step.get("subject") or template.subject or "",
                        }
                customer = enrollment.customer
                destination = _destination_for(
                    channel, customer, enrollment.context or {}
                )
                if not body:
                    _log(
                        db,
                        enrollment,
                        step_index=index,
                        step_type="send",
                        status="skipped",
                        detail="No message body or template.",
                    )
                elif not destination:
                    _log(
                        db,
                        enrollment,
                        step_index=index,
                        step_type="send",
                        status="skipped",
                        detail=f"No {channel} destination on file.",
                    )
                else:
                    result = send_campaign_message(
                        channel=channel,
                        destination=destination,
                        message=body,
                        subject=str(step.get("subject") or ""),
                    )
                    _log(
                        db,
                        enrollment,
                        step_index=index,
                        step_type="send",
                        status=result.status,
                        detail=result.error or f"Sent via {result.provider}.",
                    )
            enrollment.current_step = index + 1
            if enrollment.current_step >= len(steps):
                enrollment.status = "completed"
                enrollment.next_run_at = None
            else:
                enrollment.next_run_at = datetime.utcnow()
    if enrollment.status == "running" and enrollment.current_step >= len(steps):
        enrollment.status = "completed"
        enrollment.next_run_at = None


def process_due(db: Session, limit: int = 100) -> dict:
    due = (
        db.query(JourneyEnrollment)
        .filter(
            JourneyEnrollment.status == "running",
            JourneyEnrollment.next_run_at <= datetime.utcnow(),
        )
        .order_by(JourneyEnrollment.next_run_at.asc())
        .limit(max(1, min(limit, 500)))
        .all()
    )
    processed = 0
    completed = 0
    for enrollment in due:
        _advance(db, enrollment)
        processed += 1
        if enrollment.status == "completed":
            completed += 1
    db.commit()
    return {"processed": processed, "completed": completed}


def enroll_manual(
    db: Session,
    journey: MarketingJourney,
    *,
    destination: str,
    name: str = "",
    email: str = "",
    customer_id: int | None = None,
    trigger_ref: str = "",
) -> dict:
    if journey.status != "active":
        raise ValueError("Only active journeys can enroll contacts.")
    ref = (trigger_ref or f"manual:{destination}:{datetime.utcnow().isoformat()}")[:160]
    existing = (
        db.query(JourneyEnrollment)
        .filter(
            JourneyEnrollment.journey_id == journey.id,
            JourneyEnrollment.trigger_ref == ref,
        )
        .first()
    )
    if existing:
        return serialize_enrollment(existing)
    context = {
        "name": name.strip(),
        "phone": destination.strip(),
        "email": email.strip(),
        "variant": _pick_variant(journey),
    }
    customer = (
        db.query(Customer).filter(Customer.id == customer_id).first()
        if customer_id
        else None
    )
    if customer is None and destination.strip():
        customer = db.query(Customer).filter(Customer.phone == destination.strip()).first()
    enrollment = JourneyEnrollment(
        journey_id=journey.id,
        customer_id=customer.id if customer else None,
        trigger_ref=ref,
        status="running",
        current_step=0,
        next_run_at=datetime.utcnow(),
        context=context,
    )
    db.add(enrollment)
    db.commit()
    db.refresh(enrollment)
    return serialize_enrollment(enrollment)


def enroll_order_trigger(db: Session, trigger: str, order: RestaurantOrder) -> int:
    """Enroll one order into every active journey for a trigger."""
    if trigger not in TRIGGERS:
        return 0
    phone = (order.customer_phone or "").strip()
    if not phone:
        return 0
    journeys = (
        db.query(MarketingJourney)
        .filter(
            MarketingJourney.trigger == trigger,
            MarketingJourney.status == "active",
        )
        .all()
    )
    enrolled = 0
    for journey in journeys:
        ref = f"order:{order.id}:{trigger}"
        existing = (
            db.query(JourneyEnrollment)
            .filter(
                JourneyEnrollment.journey_id == journey.id,
                JourneyEnrollment.trigger_ref == ref,
            )
            .first()
        )
        if existing:
            continue
        customer = db.query(Customer).filter(Customer.phone == phone).first()
        db.add(
            JourneyEnrollment(
                journey_id=journey.id,
                customer_id=customer.id if customer else None,
                trigger_ref=ref,
                status="running",
                current_step=0,
                next_run_at=datetime.utcnow(),
                context={
                    "name": order.customer_name or "",
                    "phone": phone,
                    "order_id": order.id,
                    "total": order.total_amount,
                    "order_total": order.total_amount,
                    "variant": _pick_variant(journey),
                },
            )
        )
        enrolled += 1
    if enrolled:
        db.commit()
    return enrolled


def enroll_feedback_trigger(db: Session, order: RestaurantOrder, nps: int) -> int:
    if nps > 6:
        return 0
    return enroll_order_trigger(db, "feedback_low", order)
