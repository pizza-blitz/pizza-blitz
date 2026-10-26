"""Trigger-based marketing journeys with durable enrollment steps."""

import hashlib
import secrets
from datetime import datetime, timedelta

from sqlalchemy import func
from sqlalchemy.orm import Session

from app.core.config import settings
from app.models.domain import (
    Customer,
    JourneyEnrollment,
    JourneyEvent,
    JourneyTouch,
    MarketingJourney,
    MessageTemplate,
    RestaurantOrder,
)
from app.services.campaign_dispatch_service import send_campaign_message
from app.services.holdout_service import two_proportion_test

TRIGGERS = {
    "order_completed": "Order completed",
    "order_delivered": "Order delivered",
    "feedback_low": "Low feedback score",
    "manual": "Manual enrollment",
}
CHANNELS = {"whatsapp", "sms", "email", "instagram"}


def journey_public_url() -> str:
    return settings.PIZZA_BLITZ_PUBLIC_URL.rstrip("/")


def journey_track_url(token: str) -> str:
    prefix = settings.PIZZA_BLITZ_PUBLIC_API_PREFIX.rstrip("/")
    return f"{journey_public_url()}{prefix}/api/v1/restaurant/journeys/track/{token}"


def journey_open_url(token: str) -> str:
    prefix = settings.PIZZA_BLITZ_PUBLIC_API_PREFIX.rstrip("/")
    return f"{journey_public_url()}{prefix}/api/v1/restaurant/journeys/open/{token}.png"


def journey_order_url(row: MarketingJourney) -> str:
    from urllib.parse import quote

    return (
        f"{journey_public_url()}/order?utm_source=journey"
        f"&utm_campaign={quote(row.name or '')}"
    )


def journey_holdout(journey_id: int, customer_id: int | None, percent: float) -> bool:
    if not customer_id or not percent:
        return False
    digest = hashlib.sha256(f"journey:{journey_id}:{customer_id}".encode()).hexdigest()
    return int(digest[:8], 16) % 100 < int(round(min(max(percent, 0), 100)))


def journey_attribution(
    db: Session,
    row: MarketingJourney,
    enrollments: list[JourneyEnrollment],
    *,
    window_days: int = 30,
) -> dict:
    events = (
        db.query(JourneyEvent)
        .join(JourneyEnrollment, JourneyEvent.enrollment_id == JourneyEnrollment.id)
        .filter(
            JourneyEnrollment.journey_id == row.id,
            JourneyEvent.step_type == "send",
            JourneyEvent.status == "sent",
        )
        .order_by(JourneyEvent.created_at.asc())
        .all()
    )
    empty = {
        "model": "journey_send_attribution",
        "window_days": window_days,
        "sent_events": 0,
        "unique_customers": 0,
        "converted_customers": 0,
        "conversion_rate_percent": 0.0,
        "orders_attributed": 0,
        "revenue": 0.0,
        "revenue_per_customer": 0.0,
        "channels": [],
        "engagement": {
            "touches": 0,
            "click_count": 0,
            "clicked": 0,
            "click_rate_percent": 0.0,
            "open_count": 0,
            "opened": 0,
            "open_rate_percent": 0.0,
        },
        "steps": [],
        "step_models": {"first_touch": [], "last_touch": [], "linear": []},
        "best_step": None,
        "note": "No successful journey sends yet.",
    }
    if not events:
        return empty

    enrollment_by_id = {item.id: item for item in enrollments}
    steps = row.steps or []
    first_send_at: dict[int, datetime] = {}
    sends_by_customer: dict[int, list[str]] = {}
    for event in events:
        enrollment = enrollment_by_id.get(event.enrollment_id)
        if enrollment is None or enrollment.customer_id is None or not event.created_at:
            continue
        customer_id = enrollment.customer_id
        first_send_at.setdefault(customer_id, event.created_at)
        step = steps[event.step_index] if event.step_index < len(steps) else {}
        channel = str(step.get("channel") or "unknown").lower()
        sends_by_customer.setdefault(customer_id, []).append(channel)
    if not first_send_at:
        return empty

    customers = {
        customer.id: customer
        for customer in db.query(Customer)
        .filter(Customer.id.in_(list(first_send_at.keys())))
        .all()
    }
    phones = {
        (customer.phone or "").strip(): customer_id
        for customer_id, customer in customers.items()
        if (customer.phone or "").strip()
    }
    earliest = min(first_send_at.values())
    latest = earliest + timedelta(days=window_days)
    orders = (
        db.query(RestaurantOrder)
        .filter(
            RestaurantOrder.customer_phone.in_(list(phones.keys())),
            RestaurantOrder.created_at >= earliest,
            RestaurantOrder.created_at <= latest,
        )
        .all()
    )
    revenue_by_customer: dict[int, float] = {}
    orders_by_customer: dict[int, int] = {}
    for order in orders:
        customer_id = phones.get((order.customer_phone or "").strip())
        if customer_id is None:
            continue
        if order.created_at and order.created_at < first_send_at.get(customer_id, earliest):
            continue
        revenue_by_customer[customer_id] = revenue_by_customer.get(customer_id, 0.0) + float(
            order.total_amount or 0
        )
        orders_by_customer[customer_id] = orders_by_customer.get(customer_id, 0) + 1

    channel_stats: dict[str, dict] = {}
    for customer_id, channels in sends_by_customer.items():
        converted = customer_id in revenue_by_customer
        first_channel = channels[0] if channels else "unknown"
        bucket = channel_stats.setdefault(
            first_channel,
            {"channel": first_channel, "sends": 0, "converted_customers": 0, "revenue": 0.0},
        )
        bucket["sends"] += len(channels)
        if converted:
            bucket["converted_customers"] += 1
            bucket["revenue"] = round(
                bucket["revenue"] + revenue_by_customer[customer_id], 2
            )

    converted = len(revenue_by_customer)
    unique_customers = len(first_send_at)
    revenue = round(sum(revenue_by_customer.values()), 2)

    touches = (
        db.query(JourneyTouch)
        .join(JourneyEnrollment, JourneyTouch.enrollment_id == JourneyEnrollment.id)
        .filter(JourneyEnrollment.journey_id == row.id)
        .order_by(JourneyTouch.created_at.asc())
        .all()
    )
    click_count = sum(int(touch.click_count or 0) for touch in touches)
    open_count = sum(int(touch.open_count or 0) for touch in touches)
    clicked_touches = [touch for touch in touches if (touch.click_count or 0) > 0]
    opened_touches = [touch for touch in touches if (touch.open_count or 0) > 0]
    step_stats: dict[int, dict] = {}
    first_step_by_customer: dict[int, int] = {}
    touches_by_customer: dict[int, list[JourneyTouch]] = {}
    for touch in touches:
        enrollment = enrollment_by_id.get(touch.enrollment_id)
        bucket = step_stats.setdefault(
            touch.step_index,
            {
                "step_index": touch.step_index,
                "channel": touch.channel,
                "sends": 0,
                "clicks": 0,
                "opens": 0,
                "converted_customers": 0,
                "revenue": 0.0,
            },
        )
        bucket["sends"] += 1
        bucket["clicks"] += int(touch.click_count or 0)
        bucket["opens"] += int(touch.open_count or 0)
        if enrollment and enrollment.customer_id is not None:
            first_step_by_customer.setdefault(enrollment.customer_id, touch.step_index)
            touches_by_customer.setdefault(enrollment.customer_id, []).append(touch)
    for customer_id in revenue_by_customer:
        step_index = first_step_by_customer.get(customer_id)
        if step_index in step_stats:
            step_stats[step_index]["converted_customers"] += 1
            step_stats[step_index]["revenue"] = round(
                step_stats[step_index]["revenue"] + revenue_by_customer[customer_id], 2
            )

    step_models: dict[str, dict[tuple[int, str], dict]] = {
        "first_touch": {},
        "last_touch": {},
        "linear": {},
    }

    def credit(model: str, touch: JourneyTouch, revenue: float) -> None:
        key = (touch.step_index, touch.channel)
        bucket = step_models[model].setdefault(
            key,
            {
                "step_index": touch.step_index,
                "channel": touch.channel,
                "credit_revenue": 0.0,
                "conversions": 0,
            },
        )
        bucket["credit_revenue"] += revenue
        bucket["conversions"] += 1

    for customer_id, revenue_value in revenue_by_customer.items():
        customer_touches = sorted(
            touches_by_customer.get(customer_id, []),
            key=lambda touch: (touch.created_at or datetime.min, touch.id),
        )
        if not customer_touches:
            continue
        credit("first_touch", customer_touches[0], revenue_value)
        credit("last_touch", customer_touches[-1], revenue_value)
        share = revenue_value / len(customer_touches)
        for touch in customer_touches:
            credit("linear", touch, share)

    step_model_payload = {
        model: sorted(
            (
                {
                    "step_index": row["step_index"],
                    "channel": row["channel"],
                    "credit_revenue": round(row["credit_revenue"], 2),
                    "conversions": row["conversions"],
                }
                for row in rows.values()
            ),
            key=lambda item: (-item["credit_revenue"], item["step_index"]),
        )
        for model, rows in step_models.items()
    }
    best_step = step_model_payload["linear"][0] if step_model_payload["linear"] else None

    return {
        "model": "journey_send_attribution",
        "window_days": window_days,
        "sent_events": len(events),
        "unique_customers": unique_customers,
        "converted_customers": converted,
        "conversion_rate_percent": round((converted / unique_customers) * 100, 2)
        if unique_customers
        else 0.0,
        "orders_attributed": sum(orders_by_customer.values()),
        "revenue": revenue,
        "revenue_per_customer": round(revenue / unique_customers, 2)
        if unique_customers
        else 0.0,
        "channels": sorted(
            channel_stats.values(), key=lambda item: (-item["revenue"], item["channel"])
        ),
        "engagement": {
            "touches": len(touches),
            "click_count": click_count,
            "clicked": len(clicked_touches),
            "click_rate_percent": round((len(clicked_touches) / len(touches)) * 100, 2)
            if touches
            else 0.0,
            "open_count": open_count,
            "opened": len(opened_touches),
            "open_rate_percent": round((len(opened_touches) / len(touches)) * 100, 2)
            if touches
            else 0.0,
        },
        "steps": [step_stats[index] for index in sorted(step_stats)],
        "step_models": step_model_payload,
        "best_step": best_step,
        "note": (
            "Orders are matched by customer phone after the first successful send and within "
            f"{window_days} days. This is journey-level send attribution, not incremental lift."
        ),
    }


def journey_experiment(
    db: Session,
    row: MarketingJourney,
    enrollments: list[JourneyEnrollment],
) -> dict:
    treated = [item for item in enrollments if item.status != "holdout"]
    holdout = [item for item in enrollments if item.status == "holdout"]
    empty = {
        "enabled": bool(row.holdout_percent),
        "holdout_percent": float(row.holdout_percent or 0),
        "treated": {"customers": 0, "converted": 0, "conversion_rate": 0.0, "revenue": 0.0},
        "holdout": {"customers": 0, "converted": 0, "conversion_rate": 0.0, "revenue": 0.0},
        "lift_percent": 0.0,
        "incremental_revenue": 0.0,
        "significance": None,
        "note": "No treated or holdout enrollments yet.",
    }
    if not treated and not holdout:
        return empty

    phones_by_group: dict[str, dict[str, datetime]] = {"treated": {}, "holdout": {}}
    customer_ids = [item.customer_id for item in enrollments if item.customer_id]
    customers = {
        customer.id: customer
        for customer in db.query(Customer).filter(Customer.id.in_(customer_ids)).all()
    }
    for group, rows in (("treated", treated), ("holdout", holdout)):
        for item in rows:
            customer = customers.get(item.customer_id)
            phone = (
                (customer.phone or "").strip()
                if customer
                else str((item.context or {}).get("phone") or "").strip()
            )
            if not phone:
                continue
            existing = phones_by_group[group].get(phone)
            stamp = item.created_at or datetime.utcnow()
            if existing is None or stamp < existing:
                phones_by_group[group][phone] = stamp

    all_phones = list(phones_by_group["treated"]) + list(phones_by_group["holdout"])
    orders = (
        db.query(RestaurantOrder)
        .filter(RestaurantOrder.customer_phone.in_(all_phones))
        .all()
        if all_phones
        else []
    )

    def summarize(group: str) -> dict:
        converted = 0
        revenue = 0.0
        for phone, enrolled_at in phones_by_group[group].items():
            matched = [
                order
                for order in orders
                if (order.customer_phone or "").strip() == phone
                and order.created_at
                and order.created_at >= enrolled_at
            ]
            if matched:
                converted += 1
                revenue += sum(float(order.total_amount or 0) for order in matched)
        count = len(phones_by_group[group])
        return {
            "customers": count,
            "converted": converted,
            "conversion_rate": round((converted / count) * 100, 2) if count else 0.0,
            "revenue": round(revenue, 2),
            "revenue_per_customer": round(revenue / count, 2) if count else 0.0,
        }

    treated_summary = summarize("treated")
    holdout_summary = summarize("holdout")
    lift = (
        round(
            (
                (treated_summary["conversion_rate"] - holdout_summary["conversion_rate"])
                / holdout_summary["conversion_rate"]
            )
            * 100,
            2,
        )
        if holdout_summary["conversion_rate"]
        else 0.0
    )
    incremental = round(
        treated_summary["revenue"]
        - (holdout_summary["revenue_per_customer"] * treated_summary["customers"]),
        2,
    )
    significance = None
    if treated_summary["customers"] and holdout_summary["customers"]:
        significance = two_proportion_test(
            treated_summary["converted"],
            treated_summary["customers"],
            holdout_summary["converted"],
            holdout_summary["customers"],
        )
    return {
        "enabled": bool(row.holdout_percent),
        "holdout_percent": float(row.holdout_percent or 0),
        "treated": treated_summary,
        "holdout": holdout_summary,
        "lift_percent": lift,
        "incremental_revenue": incremental,
        "significance": significance,
        "note": (
            "Holdout enrollments receive no journey sends. Orders after enrollment are matched "
            "by phone. Small samples are directional, not proof of incrementality."
        ),
    }


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
        "holdout_percent": float(row.holdout_percent or 0),
        "holdout_count": sum(1 for item in all_enrollments if item.status == "holdout"),
        "treated_count": sum(1 for item in all_enrollments if item.status != "holdout"),
        "holdout_experiment": journey_experiment(db, row, all_enrollments),
        "variants": [variant_stats[key] for key in sorted(variant_stats)],
        "attributed_revenue": attributed_revenue,
        "revenue_per_enrollment": round(attributed_revenue / enrollments, 2)
        if enrollments
        else 0.0,
        "touch_attribution": journey_attribution(db, row, all_enrollments),
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
    holdout_percent: float = 0,
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
        holdout_percent=max(0.0, min(float(holdout_percent or 0), 100.0)),
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
    holdout_percent: float | None = None,
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
    if holdout_percent is not None:
        row.holdout_percent = max(0.0, min(float(holdout_percent), 100.0))
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
                    tracking_token = secrets.token_urlsafe(12)
                    open_token = secrets.token_urlsafe(12)
                    tracked_url = journey_track_url(tracking_token)
                    message = body
                    if tracked_url not in message:
                        message = f"{message}\nOrder here: {tracked_url}"
                    open_url = journey_open_url(open_token)
                    html_extra = (
                        f'<img src="{open_url}" width="1" height="1" alt="" '
                        'style="display:none" />'
                        if channel == "email"
                        else ""
                    )
                    result = send_campaign_message(
                        channel=channel,
                        destination=destination,
                        message=message,
                        subject=str(step.get("subject") or ""),
                        html_extra=html_extra,
                    )
                    if result.status == "sent":
                        db.add(
                            JourneyTouch(
                                enrollment_id=enrollment.id,
                                step_index=index,
                                channel=channel,
                                tracking_token=tracking_token,
                                open_token=open_token,
                            )
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
    holdout = journey_holdout(
        journey.id, customer.id if customer else None, journey.holdout_percent or 0
    )
    enrollment = JourneyEnrollment(
        journey_id=journey.id,
        customer_id=customer.id if customer else None,
        trigger_ref=ref,
        status="holdout" if holdout else "running",
        current_step=0,
        next_run_at=None if holdout else datetime.utcnow(),
        context={**context, "holdout": holdout},
    )
    db.add(enrollment)
    db.flush()
    if holdout:
        enrollment.next_run_at = None
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
        holdout = journey_holdout(
            journey.id, customer.id if customer else None, journey.holdout_percent or 0
        )
        enrollment = JourneyEnrollment(
            journey_id=journey.id,
            customer_id=customer.id if customer else None,
            trigger_ref=ref,
            status="holdout" if holdout else "running",
            current_step=0,
            next_run_at=None if holdout else datetime.utcnow(),
            context={
                "name": order.customer_name or "",
                "phone": phone,
                "order_id": order.id,
                "total": order.total_amount,
                "order_total": order.total_amount,
                "variant": _pick_variant(journey),
                "holdout": holdout,
            },
        )
        db.add(enrollment)
        db.flush()
        if holdout:
            enrollment.next_run_at = None
        enrolled += 1
    if enrolled:
        db.commit()
    return enrolled


def enroll_feedback_trigger(db: Session, order: RestaurantOrder, nps: int) -> int:
    if nps > 6:
        return 0
    return enroll_order_trigger(db, "feedback_low", order)
