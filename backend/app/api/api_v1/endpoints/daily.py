from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import func, text
from sqlalchemy.orm import Session
from app.api.deps import get_db, require_roles
from app.models.domain import DailySales, GoogleSheetSync, SalesRepairBlock, WasteLog
from pydantic import BaseModel
from datetime import date, datetime, timedelta
from typing import Optional
import calendar
import io
import csv
from fastapi.responses import StreamingResponse

router = APIRouter()

class SalesRepairBlockRequest(BaseModel):
    reason: Optional[str] = None
    source_url: Optional[str] = None
    blocked_by: Optional[str] = None

@router.get("/")
def list_sales(db: Session = Depends(get_db)):
    """List all daily sales records sorted by date descending."""
    sales = db.query(DailySales).order_by(DailySales.date.desc()).all()
    return sales

@router.get("/reconciliation")
def sales_reconciliation(
    expected_min_total: float = Query(default=3000000, ge=0),
    detail: str = Query(default="full"),
    limit: int = Query(default=12, ge=1, le=60),
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
    db: Session = Depends(get_db),
):
    """Month-wise import health so source-sheet gaps are visible before reports are trusted."""
    if detail not in {"full", "summary"}:
      raise HTTPException(status_code=400, detail="detail must be full or summary")

    today = date.today()
    parsed_start = datetime.strptime(start_date, "%Y-%m-%d").date() if start_date else None
    parsed_end = datetime.strptime(end_date, "%Y-%m-%d").date() if end_date else today

    query = db.query(DailySales).order_by(DailySales.date.asc())
    if parsed_start:
      query = query.filter(DailySales.date >= parsed_start)
    if parsed_end:
      query = query.filter(DailySales.date <= parsed_end)

    rows = query.all()
    blocked_rows = db.query(SalesRepairBlock).order_by(SalesRepairBlock.month.asc()).all()
    blocked_map = {
      row.month: {
        "month": row.month,
        "reason": row.reason,
        "source_url": row.source_url,
        "blocked_by": row.blocked_by,
        "blocked_at": row.blocked_at.isoformat() if row.blocked_at else None,
      }
      for row in blocked_rows
    }
    month_map: dict[str, dict] = {}
    for row in rows:
      if not row.date:
        continue
      month_key = row.date.strftime("%Y-%m")
      month = month_map.setdefault(
        month_key,
        {
          "month": month_key,
          "total_sale": 0.0,
          "total_expense": 0.0,
          "profit": 0.0,
          "days_with_sales": 0,
          "days_with_amount": 0,
          "zero_sale_days": 0,
          "first_date": row.date.isoformat(),
          "last_date": row.date.isoformat(),
          "imported_dates": set(),
          "zero_sale_dates": [],
        },
      )
      sale_amount = float(row.total_sale or 0)
      month["total_sale"] += sale_amount
      month["total_expense"] += float(row.total_expense or 0)
      month["profit"] += float(row.profit or 0)
      month["days_with_sales"] += 1
      month["imported_dates"].add(row.date.isoformat())
      if sale_amount > 0:
        month["days_with_amount"] += 1
      else:
        month["zero_sale_days"] += 1
        month["zero_sale_dates"].append(row.date.isoformat())
      month["first_date"] = min(month["first_date"], row.date.isoformat())
      month["last_date"] = max(month["last_date"], row.date.isoformat())

    month_rows = []
    for month_key in sorted(month_map):
      year, month_number = (int(part) for part in month_key.split("-"))
      month_start = date(year, month_number, 1)
      month_end = date(year, month_number, calendar.monthrange(year, month_number)[1])
      if parsed_start:
        month_start = max(month_start, parsed_start)
      if parsed_end:
        month_end = min(month_end, parsed_end)
      expected_days = max((month_end - month_start).days + 1, 0)
      row = month_map[month_key]
      expected_dates = [
        (month_start + timedelta(days=offset)).isoformat()
        for offset in range(expected_days)
      ]
      imported_dates = set(row.pop("imported_dates"))
      missing_dates = [item for item in expected_dates if item not in imported_dates]
      row["expected_days"] = expected_days
      row["missing_days"] = len(missing_dates)
      row["missing_dates"] = missing_dates
      row["zero_sale_dates"] = sorted(row["zero_sale_dates"])
      row["coverage_percent"] = round(
        (int(row["days_with_sales"]) / expected_days) * 100,
        1,
      ) if expected_days else 0
      if row["missing_days"] == 0 and row["zero_sale_days"] == 0:
        row["status"] = "complete"
        row["repair_priority"] = "clear"
        row["repair_action"] = "No repair needed."
      elif month_key in blocked_map:
        row["status"] = "source_missing"
        row["repair_priority"] = "blocked"
        row["source_block"] = blocked_map[month_key]
        row["repair_action"] = "Source sheet is missing the listed dates. Keep visible, but continue with the next month."
      elif row["missing_days"] >= 7 or row["zero_sale_days"] > 0:
        row["status"] = "needs_review"
        row["repair_priority"] = "high"
        row["repair_action"] = "Open the source sheet month and repair missing or zero-sale dates first."
      else:
        row["status"] = "needs_review"
        row["repair_priority"] = "medium"
        row["repair_action"] = "Cross-check the listed dates against the source sheet."
      month_rows.append(row)

    imported_total = sum(float(row.total_sale or 0) for row in rows)
    repair_queue = [
      row for row in month_rows
      if row["status"] == "needs_review"
    ]
    repair_queue.sort(key=lambda row: row["month"])
    blocked_queue = [
      row for row in month_rows
      if row["status"] == "source_missing"
    ]
    blocked_queue.sort(key=lambda row: row["month"])
    def compact_month(row: dict) -> dict:
      compact = dict(row)
      if detail == "summary":
        compact["missing_dates"] = list(compact.get("missing_dates") or [])[:8]
        compact["zero_sale_dates"] = list(compact.get("zero_sale_dates") or [])[:8]
      return compact

    response_months = [compact_month(row) for row in month_rows]
    response_repair_queue = [
      compact_month(row)
      for row in (repair_queue[:limit] if detail == "summary" else repair_queue)
    ]
    last_sync = db.query(GoogleSheetSync).order_by(GoogleSheetSync.id.desc()).first()
    return {
      "expected_min_total": expected_min_total,
      "imported_total": round(imported_total, 2),
      "gap_to_expected": round(max(expected_min_total - imported_total, 0), 2),
      "coverage_percent": round((imported_total / expected_min_total) * 100, 1) if expected_min_total else 100,
      "record_count": len(rows),
      "months_imported": len(month_rows),
      "date_start": rows[0].date.isoformat() if rows else None,
      "date_end": rows[-1].date.isoformat() if rows else None,
      "last_sheet_sync": {
        "status": last_sync.sync_status,
        "rows_imported": last_sync.rows_imported,
        "last_synced_at": last_sync.last_synced_at.isoformat() if last_sync.last_synced_at else None,
      } if last_sync else None,
      "months": response_months,
      "repair_queue": response_repair_queue,
      "repair_queue_count": len(repair_queue),
      "blocked_queue": [compact_month(row) for row in blocked_queue],
      "blocked_queue_count": len(blocked_queue),
      "next_repair_month": repair_queue[0]["month"] if repair_queue else None,
      "next_action": "Repair the next chronological unblocked month, and mark months as source-missing only after confirming the source sheet lacks those dates.",
    }

@router.post("/reconciliation/blocked/{month_key}")
def block_sales_repair_month(
    month_key: str,
    request: SalesRepairBlockRequest,
    db: Session = Depends(get_db),
    session: dict = Depends(require_roles("admin")),
):
    if not month_key or len(month_key) != 7:
      raise HTTPException(status_code=422, detail="Month must use YYYY-MM format.")
    try:
      datetime.strptime(f"{month_key}-01", "%Y-%m-%d")
    except ValueError:
      raise HTTPException(status_code=422, detail="Month must use YYYY-MM format.")

    existing = db.query(SalesRepairBlock).filter(SalesRepairBlock.month == month_key).first()
    actor = request.blocked_by or session.get("role") or "admin"
    reason = request.reason or "Source sheet missing listed dates after targeted repair import."
    if existing:
      existing.reason = reason
      existing.source_url = request.source_url
      existing.blocked_by = actor
      existing.blocked_at = datetime.utcnow()
      block = existing
    else:
      block = SalesRepairBlock(
        month=month_key,
        reason=reason,
        source_url=request.source_url,
        blocked_by=actor,
      )
      db.add(block)

    db.commit()
    db.refresh(block)
    return {
      "status": "blocked",
      "month": block.month,
      "reason": block.reason,
      "source_url": block.source_url,
      "blocked_by": block.blocked_by,
      "blocked_at": block.blocked_at.isoformat() if block.blocked_at else None,
    }

@router.delete("/reconciliation/blocked/{month_key}")
def unblock_sales_repair_month(
    month_key: str,
    db: Session = Depends(get_db),
    session: dict = Depends(require_roles("admin")),
):
    del session
    block = db.query(SalesRepairBlock).filter(SalesRepairBlock.month == month_key).first()
    if not block:
      raise HTTPException(status_code=404, detail="Blocked month was not found.")
    db.delete(block)
    db.commit()
    return {"status": "unblocked", "month": month_key}

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
