from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session
from sqlalchemy import text
from app.api.deps import get_db
from pydantic import BaseModel
from typing import Optional, List
from datetime import date

router = APIRouter()

class PromotionCreate(BaseModel):
    name: str
    start_date: str
    end_date: str
    description: Optional[str] = None
    discount_type: str = "percentage"
    discount_value: float = 0

@router.post("/")
def create_promotion(promo: PromotionCreate, db: Session = Depends(get_db)):
    db.execute(text("""
        INSERT INTO promotions (name, start_date, end_date, description, discount_type, discount_value)
        VALUES (:name, :start, :end, :desc, :type, :value)
    """), {"name": promo.name, "start": promo.start_date, "end": promo.end_date,
           "desc": promo.description, "type": promo.discount_type, "value": promo.discount_value})
    db.commit()
    return {"status": "promotion created", "name": promo.name}

@router.get("/")
def list_promotions(db: Session = Depends(get_db)):
    result = db.execute(text("SELECT * FROM promotions ORDER BY start_date DESC")).fetchall()
    return [dict(r._mapping) for r in result]

@router.get("/active")
def active_promotions(db: Session = Depends(get_db)):
    today = date.today()
    result = db.execute(text("""
        SELECT * FROM promotions 
        WHERE start_date <= :today AND end_date >= :today
    """), {"today": today}).fetchall()
    return [dict(r._mapping) for r in result]

@router.get("/performance/{promo_id}")
def promotion_performance(promo_id: int, db: Session = Depends(get_db)):
    promo = db.execute(text("SELECT * FROM promotions WHERE id=:id"), {"id": promo_id}).fetchone()
    if not promo: return {"error": "Not found"}
    
    stats = db.execute(text("""
        SELECT 
            AVG(total_sale) as avg_sale_during,
            SUM(total_sale) as total_rev_during
        FROM daily_sales
        WHERE date BETWEEN :start AND :end
    """), {"start": promo.start_date, "end": promo.end_date}).fetchone()
    
    return {
        "promotion": promo.name,
        "avg_daily_sale_during": float(stats.avg_sale_during or 0),
        "total_revenue_during": float(stats.total_rev_during or 0)
    }
