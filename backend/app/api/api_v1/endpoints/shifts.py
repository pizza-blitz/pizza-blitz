from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session
from sqlalchemy import text
from app.api.deps import get_db
from pydantic import BaseModel
from typing import Optional

router = APIRouter()

class ShiftEntry(BaseModel):
    date: str
    staff_name: str
    role: Optional[str] = None
    shift_start: Optional[str] = None
    shift_end: Optional[str] = None
    notes: Optional[str] = None

@router.post("/")
def log_shift(entry: ShiftEntry, db: Session = Depends(get_db)):
    db.execute(text("""
        INSERT INTO shift_log (date, staff_name, role, shift_start, shift_end, notes)
        VALUES (:date, :name, :role, :start, :end, :notes)
    """), {"date": entry.date, "name": entry.staff_name, "role": entry.role,
           "start": entry.shift_start, "end": entry.shift_end, "notes": entry.notes})
    db.commit()
    return {"status": "logged", "staff": entry.staff_name}

@router.get("/")
def get_shifts(db: Session = Depends(get_db)):
    result = db.execute(text(
        "SELECT * FROM shift_log ORDER BY date DESC, shift_start ASC LIMIT 100"
    )).fetchall()
    return [dict(r._mapping) for r in result]

@router.get("/performance")
def shift_performance(db: Session = Depends(get_db)):
    result = db.execute(text("""
        SELECT s.staff_name,
            COUNT(DISTINCT s.date) as days_worked,
            COALESCE(AVG(d.total_sale), 0) as avg_revenue_on_shift_days,
            COALESCE(MAX(d.total_sale), 0) as best_day_revenue,
            COALESCE(MIN(d.total_sale), 0) as worst_day_revenue
        FROM shift_log s
        LEFT JOIN daily_sales d ON d.date = s.date
        GROUP BY s.staff_name
        ORDER BY avg_revenue_on_shift_days DESC
    """)).fetchall()
    return [dict(r._mapping) for r in result]

@router.get("/by-date/{target_date}")
def shifts_by_date(target_date: str, db: Session = Depends(get_db)):
    shifts = db.execute(text(
        "SELECT * FROM shift_log WHERE date = :d ORDER BY shift_start"
    ), {"d": target_date}).fetchall()
    sales = db.execute(text(
        "SELECT total_sale, profit FROM daily_sales WHERE date = :d"
    ), {"d": target_date}).fetchone()
    return {
        "date": target_date,
        "staff": [dict(r._mapping) for r in shifts],
        "total_sale": float(sales.total_sale) if sales else 0,
        "profit": float(sales.profit) if sales else 0
    }
