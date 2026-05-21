from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from sqlalchemy import func
from app.api.deps import get_db
from app.models.domain import DailySales, Promotion
from pydantic import BaseModel
from typing import Optional
from datetime import date

router = APIRouter()

class PromotionCreate(BaseModel):
    name: str
    start_date: str
    end_date: str
    description: Optional[str] = None
    discount_type: str = "percentage"
    discount_value: float = 0

def _parse_date(value: str) -> date:
    try:
        return date.fromisoformat(value)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=f"Invalid date: {value}") from exc

def _promotion_dict(promo: Promotion) -> dict:
    return {
        "id": promo.id,
        "name": promo.name,
        "start_date": promo.start_date.isoformat(),
        "end_date": promo.end_date.isoformat(),
        "description": promo.description,
        "discount_type": promo.discount_type,
        "discount_value": promo.discount_value,
        "created_at": promo.created_at.isoformat() if promo.created_at else None,
    }

@router.post("/")
def create_promotion(promo: PromotionCreate, db: Session = Depends(get_db)):
    db_promo = Promotion(
        name=promo.name,
        start_date=_parse_date(promo.start_date),
        end_date=_parse_date(promo.end_date),
        description=promo.description,
        discount_type=promo.discount_type,
        discount_value=promo.discount_value,
    )
    db.add(db_promo)
    db.commit()
    db.refresh(db_promo)
    return {"status": "promotion created", "promotion": _promotion_dict(db_promo)}

@router.get("/")
def list_promotions(db: Session = Depends(get_db)):
    promotions = db.query(Promotion).order_by(Promotion.start_date.desc()).all()
    return [_promotion_dict(promo) for promo in promotions]

@router.get("/active")
def active_promotions(db: Session = Depends(get_db)):
    today = date.today()
    promotions = (
        db.query(Promotion)
        .filter(Promotion.start_date <= today, Promotion.end_date >= today)
        .order_by(Promotion.end_date.asc())
        .all()
    )
    return [_promotion_dict(promo) for promo in promotions]

@router.get("/performance/{promo_id}")
def promotion_performance(promo_id: int, db: Session = Depends(get_db)):
    promo = db.get(Promotion, promo_id)
    if not promo:
        raise HTTPException(status_code=404, detail="Promotion not found")

    avg_sale, total_revenue = (
        db.query(func.avg(DailySales.total_sale), func.sum(DailySales.total_sale))
        .filter(DailySales.date.between(promo.start_date, promo.end_date))
        .one()
    )
    
    return {
        "promotion": promo.name,
        "avg_daily_sale_during": float(avg_sale or 0),
        "total_revenue_during": float(total_revenue or 0)
    }
