from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func, text
from sqlalchemy.orm import Session
from app.api.deps import get_db
from app.models.domain import DailySales
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

@router.post("/daily-entry")
def create_daily_entry(request: DailyEntryRequest, db: Session = Depends(get_db)):
    # Check if entry already exists for this date
    existing = db.query(DailySales).filter(DailySales.date == request.date).first()
    
    if existing:
        # Update existing
        existing.total_sale = request.total_sale
        existing.cash_collected = request.cash_collected
        existing.total_expense = request.total_expense
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
