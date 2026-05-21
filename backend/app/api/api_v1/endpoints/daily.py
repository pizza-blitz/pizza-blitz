from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func, text
from sqlalchemy.orm import Session
from app.api.deps import get_db
from app.models.domain import DailySales, WasteLog
from pydantic import BaseModel
from datetime import date
from typing import Optional
import io
import csv
from fastapi.responses import StreamingResponse

router = APIRouter()

@router.get("/")
def list_sales(db: Session = Depends(get_db)):
    """List all daily sales records sorted by date descending."""
    sales = db.query(DailySales).order_by(DailySales.date.desc()).all()
    return sales

class DailyEntryRequest(BaseModel):
    date: date
    total_sale: float
    cash_collected: float
    total_expense: float
    payment_method: str = "mixed"
    notes: Optional[str] = None

class WasteEntryRequest(BaseModel):
    date: date
    item_name: str
    quantity: float
    unit: str = "kg"
    estimated_cost: float
    reason: str

@router.post("/daily-entry")
def create_daily_entry(request: DailyEntryRequest, db: Session = Depends(get_db)):
    # Check if entry already exists for this date
    existing = db.query(DailySales).filter(DailySales.date == request.date).first()
    
    if existing:
        # Update existing
        existing.total_sale = request.total_sale
        existing.cash_collected = request.cash_collected
        existing.total_expense = request.total_expense
        existing.profit = request.total_sale - request.total_expense
        existing.payment_method = request.payment_method
        existing.notes = request.notes
        action = "updated"
        entry = existing
    else:
        # Create new
        entry = DailySales(
            date=request.date,
            total_sale=request.total_sale,
            cash_collected=request.cash_collected,
            total_expense=request.total_expense,
            profit=request.total_sale - request.total_expense,
            payment_method=request.payment_method,
            notes=request.notes
        )
        db.add(entry)
        action = "created"
    
    try:
        db.commit()
        db.refresh(entry)
        return {
            "status": "success", 
            "action": action,
            "data": {
                "date": str(entry.date),
                "total_sale": float(entry.total_sale),
                "total_expense": float(entry.total_expense),
                "profit": float(entry.profit)
            }
        }
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/export/csv")
def export_sales_csv(
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
    db: Session = Depends(get_db)
):
    query = db.query(DailySales).order_by(DailySales.date.desc())
    if start_date:
        query = query.filter(DailySales.date >= start_date)
    if end_date:
        query = query.filter(DailySales.date <= end_date)
        
    sales = query.all()
    
    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow(["Date", "Total Sale", "Cash Collected", "Total Expense", "Net Profit", "Payment Method", "Notes"])
    
    for sale in sales:
        writer.writerow([
            sale.date, 
            sale.total_sale, 
            sale.cash_collected, 
            sale.total_expense, 
            sale.profit, 
            sale.payment_method, 
            sale.notes
        ])
        
    output.seek(0)
    return StreamingResponse(
        iter([output.getvalue()]), 
        media_type="text/csv", 
        headers={"Content-Disposition": "attachment; filename=sales_export.csv"}
    )

@router.get("/waste")
def list_waste(db: Session = Depends(get_db)):
    rows = db.query(WasteLog).order_by(WasteLog.date.desc(), WasteLog.id.desc()).limit(100).all()
    return [
        {
            "id": str(row.id),
            "date": row.date.isoformat() if row.date else None,
            "item_name": row.item_name,
            "quantity": row.quantity,
            "unit": row.unit,
            "estimated_cost": row.estimated_cost,
            "reason": row.reason,
        }
        for row in rows
    ]

@router.post("/waste")
def create_waste_entry(request: WasteEntryRequest, db: Session = Depends(get_db)):
    row = WasteLog(
        date=request.date,
        item_name=request.item_name,
        quantity=request.quantity,
        unit=request.unit,
        estimated_cost=request.estimated_cost,
        reason=request.reason,
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return {
        "id": str(row.id),
        "date": row.date.isoformat(),
        "item_name": row.item_name,
        "quantity": row.quantity,
        "unit": row.unit,
        "estimated_cost": row.estimated_cost,
        "reason": row.reason,
    }

@router.get("/waste/summary")
def waste_summary(db: Session = Depends(get_db)):
    from datetime import timedelta

    start_date = date.today() - timedelta(days=30)
    rows = db.query(WasteLog).filter(WasteLog.date >= start_date).all()
    total = sum(float(row.estimated_cost or 0) for row in rows)
    by_item = {}
    for row in rows:
        by_item[row.item_name] = by_item.get(row.item_name, 0.0) + float(row.estimated_cost or 0)

    top_items = [
        {
            "item_name": item_name,
            "cost": round(cost, 2),
            "percentage": round((cost / total * 100), 1) if total > 0 else 0,
        }
        for item_name, cost in sorted(by_item.items(), key=lambda item: item[1], reverse=True)[:10]
    ]

    return {
        "total_waste_cost": round(total, 2),
        "top_items": top_items,
        "count": len(rows),
    }
