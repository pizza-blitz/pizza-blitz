from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session
from app.api.deps import get_db
from app.models.domain import DailySales
from datetime import date
from typing import List, Optional
from pydantic import BaseModel

router = APIRouter()

class ReportSummary(BaseModel):
    total_sales: float
    total_expense: float
    net_profit: float
    order_count: int # Using daily entries count for now
    avg_per_day: float

class DailyRecord(BaseModel):
    date: date
    sale: float
    expense: float
    profit: float

@router.get("/reports")
def get_reports_data(
    start_date: Optional[date] = None, 
    end_date: Optional[date] = None, 
    db: Session = Depends(get_db)
):
    query = db.query(DailySales)
    if start_date:
        query = query.filter(DailySales.date >= start_date)
    if end_date:
        query = query.filter(DailySales.date <= end_date)
    
    records = query.order_by(DailySales.date.desc()).all()
    
    total_sale = sum(float(r.total_sale) for r in records)
    total_expense = sum(float(r.total_expense) for r in records)
    
    return {
        "summary": {
            "total_sales": total_sale,
            "total_expense": total_expense,
            "net_profit": total_sale - total_expense,
            "days_count": len(records),
            "avg_sale": total_sale / len(records) if records else 0
        },
        "records": [
            {
                "date": r.date,
                "sale": float(r.total_sale),
                "expense": float(r.total_expense),
                "profit": float(r.total_sale - r.total_expense)
            } for r in records
        ]
    }
