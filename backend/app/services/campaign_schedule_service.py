from datetime import date

from sqlalchemy.orm import Session

from app.core.clock import business_today
from app.models.domain import Promotion


def due_scheduled_campaigns(db: Session, today_value: date | None = None) -> list[Promotion]:
    current_date = today_value or business_today()
    return (
        db.query(Promotion)
        .filter(Promotion.status == "scheduled")
        .filter(Promotion.start_date <= current_date)
        .filter(Promotion.end_date >= current_date)
        .order_by(Promotion.start_date.asc(), Promotion.id.asc())
        .all()
    )


def activate_due_scheduled_campaigns(db: Session, today_value: date | None = None) -> list[Promotion]:
    promotions = due_scheduled_campaigns(db, today_value)
    for promotion in promotions:
        promotion.status = "active"
    if promotions:
        db.commit()
        for promotion in promotions:
            db.refresh(promotion)
    return promotions
