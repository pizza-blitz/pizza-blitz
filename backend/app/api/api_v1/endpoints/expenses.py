from datetime import datetime, time, timedelta
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.api.deps import get_db
from app.models.domain import DailySales, Expense, ExpenseCategory

router = APIRouter()

class ExpenseSchema(BaseModel):
    id: Optional[int] = None
    date: datetime
    category_id: int
    amount: float
    description: Optional[str] = None
    receipt_photo_url: Optional[str] = None

    class Config:
        from_attributes = True

class CategorySchema(BaseModel):
    id: int
    name: str
    is_active: bool

    class Config:
        from_attributes = True

@router.get("/expenses", response_model=List[ExpenseSchema])
def get_expenses(db: Session = Depends(get_db)):
    return db.query(Expense).order_by(Expense.date.desc()).all()

@router.get("/categories", response_model=List[CategorySchema])
def get_categories(db: Session = Depends(get_db)):
    return db.query(ExpenseCategory).filter(ExpenseCategory.is_active == True).all()

@router.post("/expenses", response_model=ExpenseSchema)
def add_expense(req: ExpenseSchema, db: Session = Depends(get_db)):
    category = db.query(ExpenseCategory).filter(
        ExpenseCategory.id == req.category_id,
        ExpenseCategory.is_active == True,
    ).first()
    if not category:
        raise HTTPException(status_code=404, detail="Expense category not found")

    db_expense = Expense(
        date=req.date,
        category_id=req.category_id,
        amount=req.amount,
        description=req.description,
        receipt_photo_url=req.receipt_photo_url
    )
    db.add(db_expense)

    expense_day = req.date.date()
    daily = db.query(DailySales).filter(DailySales.date == expense_day).first()
    if daily:
        daily.total_expense = round(float(daily.total_expense or 0) + req.amount, 2)
        daily.profit = round(float(daily.total_sale or 0) - float(daily.total_expense or 0), 2)
    else:
        db.add(DailySales(
            date=expense_day,
            cash_collected=0,
            total_sale=0,
            total_expense=req.amount,
            profit=round(-req.amount, 2),
            payment_method="mixed",
            notes=f"Manual expense: {req.description or category.name}",
        ))

    db.commit()
    db.refresh(db_expense)
    return db_expense


def _expense_row(expense: Expense, category_by_id: dict[int, ExpenseCategory]) -> dict:
    category = category_by_id.get(int(expense.category_id or 0))
    return {
        "id": expense.id,
        "date": expense.date.date().isoformat() if expense.date else None,
        "category_id": expense.category_id,
        "category": category.name if category else "Unmapped",
        "amount": round(float(expense.amount or 0), 2),
        "description": expense.description,
        "receipt_photo_url": expense.receipt_photo_url,
    }


@router.get("/audit-command")
def expense_audit_command(
    days: int = Query(default=30, ge=7, le=365),
    db: Session = Depends(get_db),
):
    today = datetime.utcnow().date()
    start_date = today - timedelta(days=days - 1)
    start_at = datetime.combine(start_date, time.min)
    end_at = datetime.combine(today, time.max)

    categories = (
        db.query(ExpenseCategory)
        .filter(ExpenseCategory.is_active == True)
        .order_by(ExpenseCategory.name.asc())
        .all()
    )
    category_by_id = {int(category.id): category for category in categories}
    expenses = (
        db.query(Expense)
        .filter(Expense.date >= start_at, Expense.date <= end_at)
        .order_by(Expense.date.desc(), Expense.id.desc())
        .all()
    )
    sales_rows = (
        db.query(DailySales)
        .filter(DailySales.date >= start_date, DailySales.date <= today)
        .order_by(DailySales.date.asc())
        .all()
    )

    total_sales = round(sum(float(row.total_sale or 0) for row in sales_rows), 2)
    sales_expenses = round(sum(float(row.total_expense or 0) for row in sales_rows), 2)
    ledger_total = round(sum(float(expense.amount or 0) for expense in expenses), 2)
    profit = round(total_sales - sales_expenses, 2)
    expense_ratio = round((sales_expenses / total_sales) * 100, 2) if total_sales else 0.0
    margin_percent = round((profit / total_sales) * 100, 2) if total_sales else 0.0
    variance = round(sales_expenses - ledger_total, 2)
    variance_percent = round((abs(variance) / sales_expenses) * 100, 2) if sales_expenses else 0.0

    category_totals: dict[int, dict] = {}
    for expense in expenses:
        category_id = int(expense.category_id or 0)
        category = category_by_id.get(category_id)
        if category_id not in category_totals:
            category_totals[category_id] = {
                "category_id": category_id,
                "category": category.name if category else "Unmapped",
                "amount": 0.0,
                "count": 0,
                "share_percent": 0.0,
            }
        category_totals[category_id]["amount"] += float(expense.amount or 0)
        category_totals[category_id]["count"] += 1

    category_breakdown = []
    for row in category_totals.values():
        amount = round(float(row["amount"] or 0), 2)
        row["amount"] = amount
        row["share_percent"] = round((amount / ledger_total) * 100, 2) if ledger_total else 0.0
        category_breakdown.append(row)
    category_breakdown.sort(key=lambda item: item["amount"], reverse=True)

    daily_risks = []
    expense_days = {expense.date.date() for expense in expenses if expense.date}
    for row in sales_rows:
        sale = float(row.total_sale or 0)
        expense = float(row.total_expense or 0)
        day_ratio = round((expense / sale) * 100, 2) if sale else (100.0 if expense else 0.0)
        severity = None
        reason = ""
        if sale > 0 and expense <= 0 and row.date not in expense_days:
            severity = "warn"
            reason = "Sales exist but no expense is recorded for this day."
        elif sale > 0 and day_ratio > 75:
            severity = "fail"
            reason = "Expenses consumed more than 75% of sales."
        elif sale > 0 and day_ratio > 60:
            severity = "warn"
            reason = "Expense ratio is above 60% of sales."
        elif sale == 0 and expense > 0:
            severity = "warn"
            reason = "Expense recorded on a no-sales day."
        if severity:
            daily_risks.append(
                {
                    "date": row.date.isoformat(),
                    "sales": round(sale, 2),
                    "expenses": round(expense, 2),
                    "profit": round(float(row.profit or sale - expense), 2),
                    "expense_ratio": day_ratio,
                    "severity": severity,
                    "reason": reason,
                }
            )

    checks = [
        {
            "key": "expense_signal",
            "label": "Expense signal captured",
            "status": "pass" if sales_expenses > 0 or ledger_total > 0 else "fail",
            "detail": f"Sales ledger expense total is Rs. {sales_expenses:,.0f}; manual ledger is Rs. {ledger_total:,.0f}.",
        },
        {
            "key": "manual_ledger",
            "label": "Manual expense ledger",
            "status": "pass" if expenses else "warn",
            "detail": f"{len(expenses)} manual expense record(s) in the selected period.",
        },
        {
            "key": "active_categories",
            "label": "Active categories",
            "status": "pass" if len(categories) >= 5 else "warn" if categories else "fail",
            "detail": f"{len(categories)} active cost categories are available.",
        },
        {
            "key": "ledger_reconciliation",
            "label": "Ledger reconciliation",
            "status": "pass" if sales_expenses == 0 or variance_percent <= 5 else "warn",
            "detail": f"Sales expense vs manual ledger variance is Rs. {variance:,.0f} ({variance_percent}%).",
        },
        {
            "key": "daily_cost_risk",
            "label": "Daily cost risk",
            "status": "fail" if any(item["severity"] == "fail" for item in daily_risks) else "warn" if daily_risks else "pass",
            "detail": f"{len(daily_risks)} day(s) need cost review.",
        },
    ]
    score_weights = {"pass": 1.0, "warn": 0.5, "fail": 0.0}
    readiness_score = round(
        sum(score_weights[check["status"]] for check in checks) / len(checks) * 100
    )
    overall = "pass" if readiness_score >= 80 else "warn" if readiness_score >= 50 else "fail"

    return {
        "period": {
            "start_date": start_date.isoformat(),
            "end_date": today.isoformat(),
            "days": days,
        },
        "overall": overall,
        "readiness_score": readiness_score,
        "summary": {
            "total_sales": total_sales,
            "sales_expenses": sales_expenses,
            "ledger_total": ledger_total,
            "profit": profit,
            "expense_ratio": expense_ratio,
            "margin_percent": margin_percent,
            "ledger_variance": variance,
            "ledger_variance_percent": variance_percent,
            "expense_count": len(expenses),
            "category_count": len(categories),
            "risk_day_count": len(daily_risks),
        },
        "checks": checks,
        "category_breakdown": category_breakdown[:8],
        "daily_risks": daily_risks[-12:],
        "top_expenses": [_expense_row(expense, category_by_id) for expense in expenses[:8]],
        "next_actions": [
            check["detail"]
            for check in checks
            if check["status"] != "pass"
        ][:5],
    }
