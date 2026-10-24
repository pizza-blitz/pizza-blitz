import re
from collections import Counter
from datetime import datetime, timedelta
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.api.deps import get_db, require_roles
from app.models.domain import OrderFeedback, RestaurantOrder

router = APIRouter()


class FeedbackCreate(BaseModel):
    phone: str = Field(min_length=6, max_length=30)
    rating: int = Field(ge=1, le=5)
    nps: int = Field(ge=0, le=10)
    comment: Optional[str] = Field(default=None, max_length=1000)
    tags: list[str] = Field(default_factory=list)


def _digits(value: str | None) -> str:
    return re.sub(r"\D", "", str(value or ""))


def _phones_match(left: str | None, right: str | None) -> bool:
    a, b = _digits(left), _digits(right)
    if not a or not b:
        return False
    return a[-10:] == b[-10:]


def _serialize(feedback: OrderFeedback) -> dict:
    return {
        "order_id": feedback.order_id,
        "rating": feedback.rating,
        "nps": feedback.nps,
        "comment": feedback.comment,
        "tags": list(feedback.tags or []),
        "created_at": feedback.created_at.isoformat()
        if feedback.created_at
        else None,
    }


def _order_completed(order: RestaurantOrder) -> bool:
    if order.status == "closed":
        return True
    assignment = order.delivery_assignment
    return bool(assignment and assignment.status == "delivered")


@router.post("/{order_id}", status_code=201)
def submit_feedback(
    order_id: int,
    payload: FeedbackCreate,
    db: Session = Depends(get_db),
):
    order = db.query(RestaurantOrder).filter(RestaurantOrder.id == order_id).first()
    if order is None:
        raise HTTPException(status_code=404, detail="Order not found.")
    if not _phones_match(order.customer_phone, payload.phone):
        raise HTTPException(
            status_code=403, detail="Phone number does not match this order."
        )
    if order.status == "cancelled":
        raise HTTPException(status_code=409, detail="Cancelled orders cannot be rated.")
    if not _order_completed(order):
        raise HTTPException(
            status_code=409, detail="Feedback opens after the order is completed."
        )
    existing = (
        db.query(OrderFeedback)
        .filter(OrderFeedback.order_id == order_id)
        .first()
    )
    if existing is not None:
        raise HTTPException(status_code=409, detail="Feedback was already submitted.")

    tags = [
        tag.strip()[:60]
        for tag in payload.tags[:5]
        if tag and tag.strip()
    ]
    feedback = OrderFeedback(
        order_id=order_id,
        customer_phone=_digits(order.customer_phone),
        rating=payload.rating,
        nps=payload.nps,
        comment=(payload.comment or "").strip() or None,
        tags=tags,
    )
    db.add(feedback)
    db.commit()
    db.refresh(feedback)
    if feedback.nps <= 6:
        from app.services.journey_service import enroll_feedback_trigger

        enroll_feedback_trigger(db, order, feedback.nps)
    return {**_serialize(feedback), "status": "recorded"}


@router.get("/summary")
def feedback_summary(
    days: int = Query(default=30, ge=1, le=365),
    db: Session = Depends(get_db),
    _: dict = Depends(require_roles("admin")),
):
    since = datetime.utcnow() - timedelta(days=days)
    rows = (
        db.query(OrderFeedback)
        .filter(OrderFeedback.created_at >= since)
        .order_by(OrderFeedback.created_at.desc())
        .all()
    )
    count = len(rows)
    promoters = sum(1 for row in rows if row.nps >= 9)
    detractors = sum(1 for row in rows if row.nps <= 6)
    nps = round(((promoters - detractors) / count) * 100) if count else 0
    average_rating = (
        round(sum(row.rating for row in rows) / count, 2) if count else 0.0
    )
    distribution = {str(star): 0 for star in range(1, 6)}
    for row in rows:
        distribution[str(row.rating)] += 1
    tag_counts = Counter(tag for row in rows for tag in (row.tags or []))
    eligible_orders = (
        db.query(func.count(RestaurantOrder.id))
        .filter(
            RestaurantOrder.closed_at.isnot(None),
            RestaurantOrder.closed_at >= since,
        )
        .scalar()
        or 0
    )
    return {
        "days": days,
        "feedback_count": count,
        "eligible_orders": int(eligible_orders),
        "response_rate": round((count / eligible_orders) * 100, 1)
        if eligible_orders
        else 0.0,
        "nps": nps,
        "promoters": promoters,
        "detractors": detractors,
        "average_rating": average_rating,
        "rating_distribution": distribution,
        "top_tags": [
            {"tag": tag, "count": amount}
            for tag, amount in tag_counts.most_common(8)
        ],
        "recent": [_serialize(row) for row in rows[:20]],
        "low_ratings": [
            _serialize(row) for row in rows if row.rating <= 3
        ][:10],
    }


@router.get("/{order_id}")
def get_feedback(
    order_id: int,
    phone: Optional[str] = Query(default=None),
    db: Session = Depends(get_db),
):
    feedback = (
        db.query(OrderFeedback)
        .filter(OrderFeedback.order_id == order_id)
        .first()
    )
    if feedback is None:
        raise HTTPException(status_code=404, detail="No feedback for this order.")
    if phone is not None and not _phones_match(feedback.customer_phone, phone):
        raise HTTPException(
            status_code=403, detail="Phone number does not match this feedback."
        )
    return _serialize(feedback)
