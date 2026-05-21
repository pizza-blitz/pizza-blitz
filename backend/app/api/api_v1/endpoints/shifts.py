from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from app.api.deps import get_db
from app.models.domain import DailySales, ShiftLog
from pydantic import BaseModel
from typing import Optional
from datetime import date

router = APIRouter()

class ShiftEntry(BaseModel):
    date: str
    staff_name: str
    role: Optional[str] = None
    shift_start: Optional[str] = None
    shift_end: Optional[str] = None
    notes: Optional[str] = None

def _parse_date(value: str) -> date:
    try:
        return date.fromisoformat(value)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=f"Invalid date: {value}") from exc

def _shift_dict(shift: ShiftLog) -> dict:
    return {
        "id": shift.id,
        "date": shift.date.isoformat(),
        "staff_name": shift.staff_name,
        "role": shift.role,
        "shift_start": shift.shift_start,
        "shift_end": shift.shift_end,
        "notes": shift.notes,
        "created_at": shift.created_at.isoformat() if shift.created_at else None,
    }

@router.post("/")
def log_shift(entry: ShiftEntry, db: Session = Depends(get_db)):
    shift = ShiftLog(
        date=_parse_date(entry.date),
        staff_name=entry.staff_name,
        role=entry.role,
        shift_start=entry.shift_start,
        shift_end=entry.shift_end,
        notes=entry.notes,
    )
    db.add(shift)
    db.commit()
    db.refresh(shift)
    return {"status": "logged", "shift": _shift_dict(shift), "staff": entry.staff_name}

@router.get("/")
def get_shifts(db: Session = Depends(get_db)):
    shifts = (
        db.query(ShiftLog)
        .order_by(ShiftLog.date.desc(), ShiftLog.shift_start.asc())
        .limit(100)
        .all()
    )
    return [_shift_dict(shift) for shift in shifts]

@router.get("/performance")
def shift_performance(db: Session = Depends(get_db)):
    shifts = db.query(ShiftLog).all()
    if not shifts:
        return []

    shift_dates = {shift.date for shift in shifts}
    sales_rows = db.query(DailySales).filter(DailySales.date.in_(shift_dates)).all()
    sales_by_date = {row.date: float(row.total_sale or 0) for row in sales_rows}

    dates_by_staff: dict[str, set[date]] = {}
    for shift in shifts:
        dates_by_staff.setdefault(shift.staff_name, set()).add(shift.date)

    performance = []
    for staff_name, worked_dates in dates_by_staff.items():
        revenue_values = [sales_by_date.get(worked_date, 0.0) for worked_date in worked_dates]
        avg_revenue = sum(revenue_values) / len(revenue_values) if revenue_values else 0.0
        performance.append({
            "staff_name": staff_name,
            "days_worked": len(worked_dates),
            "avg_revenue_on_shift_days": avg_revenue,
            "best_day_revenue": max(revenue_values) if revenue_values else 0.0,
            "worst_day_revenue": min(revenue_values) if revenue_values else 0.0,
        })

    return sorted(performance, key=lambda row: row["avg_revenue_on_shift_days"], reverse=True)

@router.get("/by-date/{target_date}")
def shifts_by_date(target_date: str, db: Session = Depends(get_db)):
    parsed_date = _parse_date(target_date)
    shifts = (
        db.query(ShiftLog)
        .filter(ShiftLog.date == parsed_date)
        .order_by(ShiftLog.shift_start.asc())
        .all()
    )
    sales = db.query(DailySales).filter(DailySales.date == parsed_date).first()
    return {
        "date": parsed_date.isoformat(),
        "staff": [_shift_dict(shift) for shift in shifts],
        "total_sale": float(sales.total_sale) if sales else 0,
        "profit": float(sales.profit) if sales else 0
    }
