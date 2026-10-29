"""Outlet P&L built from the daily ledger, expense ledger, waste and POS orders.

The daily sales ledger is the accounting source of truth for revenue and total
cost. Itemised expenses split that cost into cost of goods (inventory
purchases) and operating expense. Any ledger cost that has no itemised expense
is surfaced as an "untracked" gap instead of being silently dropped, and POS
billed revenue is reported as an independent cross-check.
"""

from datetime import date, datetime, time, timedelta

from sqlalchemy import func
from sqlalchemy.orm import Session

from app.models.domain import (
    DailySales,
    Expense,
    ExpenseCategory,
    RestaurantOrder,
    Store,
    WasteLog,
)

COGS_CATEGORY_KEY = "inventory purchase"


def _money(value) -> float:
    return round(float(value or 0), 2)


def _margin(profit: float, revenue: float) -> float:
    return round((profit / revenue) * 100, 2) if revenue else 0.0


def _empty_bucket() -> dict:
    return {
        "revenue": 0.0,
        "ledger_expense": 0.0,
        "cogs": 0.0,
        "opex": 0.0,
        "itemised": 0.0,
        "waste": 0.0,
        "untracked": 0.0,
    }


def _finalise_bucket(bucket: dict) -> dict:
    revenue = _money(bucket["revenue"])
    cogs = _money(bucket["cogs"])
    opex = _money(bucket["opex"])
    waste = _money(bucket["waste"])
    itemised = _money(bucket["itemised"])
    ledger_expense = _money(bucket["ledger_expense"])
    untracked = _money(bucket["untracked"])
    # Keep every recorded rupee of cost: the higher of the ledgers is the
    # expense base, and waste is an additional operating cost.
    total_cost = _money(max(ledger_expense, itemised) + waste)
    gross_profit = _money(revenue - cogs)
    net_profit = _money(revenue - total_cost)
    return {
        "revenue": revenue,
        "ledger_expense": ledger_expense,
        "cogs": cogs,
        "gross_profit": gross_profit,
        "gross_margin_percent": _margin(gross_profit, revenue),
        "opex": opex,
        "waste": waste,
        "untracked_cost": untracked,
        "total_cost": total_cost,
        "net_profit": net_profit,
        "net_margin_percent": _margin(net_profit, revenue),
        "expense_ratio_percent": (
            round((total_cost / revenue) * 100, 2) if revenue else 0.0
        ),
    }


def _scope_stores(
    db: Session, store_id: int | None
) -> list[Store]:
    query = db.query(Store)
    if store_id is not None:
        query = query.filter(Store.id == store_id)
    return query.order_by(Store.id.asc()).all()


def outlet_pnl(
    db: Session,
    start_date: date,
    end_date: date,
    store_id: int | None = None,
) -> dict:
    """Return outlet-level and consolidated P&L for a date range."""
    stores = _scope_stores(db, store_id)
    store_by_id = {store.id: store for store in stores}
    scoped_store_ids = set(store_by_id)

    sales_query = db.query(DailySales).filter(
        DailySales.date >= start_date, DailySales.date <= end_date
    )
    expense_query = db.query(Expense).filter(
        Expense.date >= datetime.combine(start_date, time.min),
        Expense.date <= datetime.combine(end_date, time.max),
    )
    waste_query = db.query(WasteLog).filter(
        WasteLog.date >= start_date, WasteLog.date <= end_date
    )
    order_query = db.query(RestaurantOrder).filter(
        RestaurantOrder.date >= start_date,
        RestaurantOrder.date <= end_date,
        func.coalesce(RestaurantOrder.status, "") != "cancelled",
    )
    if store_id is not None:
        sales_query = sales_query.filter(DailySales.store_id == store_id)
        expense_query = expense_query.filter(Expense.store_id == store_id)
        waste_query = waste_query.filter(WasteLog.store_id == store_id)
        order_query = order_query.filter(RestaurantOrder.store_id == store_id)

    sales_rows = sales_query.all()
    expenses = expense_query.all()
    waste_rows = waste_query.all()
    orders = order_query.all()

    category_by_id = {
        category.id: category
        for category in db.query(ExpenseCategory).all()
    }

    buckets: dict[int, dict] = {
        current_id: _empty_bucket() for current_id in scoped_store_ids
    }
    daily: dict[date, dict] = {}
    category_totals: dict[str, dict] = {}
    pos_by_store: dict[int, dict] = {}

    def bucket_for(current_store_id: int) -> dict:
        return buckets.setdefault(current_store_id, _empty_bucket())

    for row in sales_rows:
        bucket = bucket_for(row.store_id)
        bucket["revenue"] += float(row.total_sale or 0)
        bucket["ledger_expense"] += float(row.total_expense or 0)
        day = daily.setdefault(
            row.date,
            {"revenue": 0.0, "ledger_expense": 0.0, "itemised": 0.0, "cogs": 0.0, "opex": 0.0, "waste": 0.0},
        )
        day["revenue"] += float(row.total_sale or 0)
        day["ledger_expense"] += float(row.total_expense or 0)

    for expense in expenses:
        store_bucket = bucket_for(expense.store_id)
        amount = float(expense.amount or 0)
        category = category_by_id.get(int(expense.category_id or 0))
        category_name = category.name if category else "Unmapped"
        is_cogs = category_name.strip().lower() == COGS_CATEGORY_KEY
        store_bucket["itemised"] += amount
        store_bucket["cogs" if is_cogs else "opex"] += amount
        bucket = category_totals.setdefault(
            category_name,
            {"category": category_name, "amount": 0.0, "count": 0},
        )
        bucket["amount"] += amount
        bucket["count"] += 1
        expense_day = expense.date.date() if expense.date else None
        if expense_day is not None:
            day = daily.setdefault(
                expense_day,
                {"revenue": 0.0, "ledger_expense": 0.0, "itemised": 0.0, "cogs": 0.0, "opex": 0.0, "waste": 0.0},
            )
            day["itemised"] += amount
            day["cogs" if is_cogs else "opex"] += amount

    for waste in waste_rows:
        bucket = bucket_for(waste.store_id)
        amount = float(waste.estimated_cost or 0)
        bucket["waste"] += amount
        if waste.date is not None:
            day = daily.setdefault(
                waste.date,
                {"revenue": 0.0, "ledger_expense": 0.0, "itemised": 0.0, "cogs": 0.0, "opex": 0.0, "waste": 0.0},
            )
            day["waste"] += amount

    for order in orders:
        bucket = pos_by_store.setdefault(
            order.store_id, {"revenue": 0.0, "orders": 0}
        )
        bucket["revenue"] += float(order.total_amount or 0)
        bucket["orders"] += 1

    for bucket in buckets.values():
        bucket["untracked"] = max(
            bucket["ledger_expense"] - bucket["itemised"], 0.0
        )

    summary_bucket = _empty_bucket()
    for bucket in buckets.values():
        for key in summary_bucket:
            summary_bucket[key] += bucket[key]
    summary_bucket["untracked"] = sum(
        bucket["untracked"] for bucket in buckets.values()
    )
    summary = _finalise_bucket(summary_bucket)

    pos_revenue = _money(sum(bucket["revenue"] for bucket in pos_by_store.values()))
    pos_orders = int(sum(bucket["orders"] for bucket in pos_by_store.values()))
    days_with_sales = len({row.date for row in sales_rows})
    summary.update(
        {
            "pos_revenue": pos_revenue,
            "pos_orders": pos_orders,
            "ledger_variance": _money(summary["revenue"] - pos_revenue),
            "days_with_sales": days_with_sales,
            "revenue_per_day": (
                _money(summary["revenue"] / days_with_sales)
                if days_with_sales
                else 0.0
            ),
            "expense_count": len(expenses),
        }
    )

    store_rows = []
    for current in stores:
        bucket = buckets.get(current.id, _empty_bucket())
        row = {
            "store_id": current.id,
            "store_name": current.name,
            "store_code": current.code,
            "is_active": bool(current.is_active),
            **_finalise_bucket(bucket),
        }
        pos = pos_by_store.get(current.id, {"revenue": 0.0, "orders": 0})
        row["pos_revenue"] = _money(pos["revenue"])
        row["pos_orders"] = int(pos["orders"])
        row["ledger_variance"] = _money(row["revenue"] - row["pos_revenue"])
        row["days_with_sales"] = len(
            {sale.date for sale in sales_rows if sale.store_id == current.id}
        )
        store_rows.append(row)

    category_rows = []
    itemised_total = sum(float(row["amount"] or 0) for row in category_totals.values())
    for row in category_totals.values():
        amount = _money(row["amount"])
        category_rows.append(
            {
                "category": row["category"],
                "amount": amount,
                "count": row["count"],
                "share_percent": (
                    round((amount / itemised_total) * 100, 2)
                    if itemised_total
                    else 0.0
                ),
                "kind": (
                    "cogs"
                    if row["category"].strip().lower() == COGS_CATEGORY_KEY
                    else "opex"
                ),
            }
        )
    category_rows.sort(key=lambda row: row["amount"], reverse=True)

    trend = []
    cursor = start_date
    while cursor <= end_date:
        bucket = daily.get(cursor)
        if bucket is None:
            trend.append(
                {
                    "date": cursor.isoformat(),
                    "revenue": 0.0,
                    "cogs": 0.0,
                    "opex": 0.0,
                    "waste": 0.0,
                    "untracked_cost": 0.0,
                    "total_cost": 0.0,
                    "net_profit": 0.0,
                }
            )
        else:
            bucket = dict(bucket)
            bucket["untracked"] = max(
                bucket["ledger_expense"] - bucket["itemised"], 0.0
            )
            row = _finalise_bucket(bucket)
            trend.append(
                {
                    "date": cursor.isoformat(),
                    "revenue": row["revenue"],
                    "cogs": row["cogs"],
                    "opex": row["opex"],
                    "waste": row["waste"],
                    "untracked_cost": row["untracked_cost"],
                    "total_cost": row["total_cost"],
                    "net_profit": row["net_profit"],
                }
            )
        cursor += timedelta(days=1)

    flags = []
    if summary["revenue"] <= 0:
        flags.append(
            {
                "severity": "warn",
                "label": "No ledger revenue",
                "detail": "No daily sales were recorded for this range.",
            }
        )
    if summary["revenue"] > 0 and summary["cogs"] <= 0:
        flags.append(
            {
                "severity": "warn",
                "label": "Inventory cost missing",
                "detail": "No Inventory Purchase expense is recorded, so gross margin is overstated.",
            }
        )
    if summary["untracked_cost"] > 0:
        flags.append(
            {
                "severity": "warn",
                "label": "Unitemised ledger cost",
                "detail": (
                    f"Rs {summary['untracked_cost']:,.2f} of daily-ledger expenses "
                    "have no matching expense entry."
                ),
            }
        )
    if summary["net_margin_percent"] < 0:
        flags.append(
            {
                "severity": "fail",
                "label": "Loss-making period",
                "detail": f"Net margin is {summary['net_margin_percent']}%.",
            }
        )
    elif summary["revenue"] > 0 and summary["net_margin_percent"] < 10:
        flags.append(
            {
                "severity": "warn",
                "label": "Thin net margin",
                "detail": f"Net margin is {summary['net_margin_percent']}% (target 10%+).",
            }
        )
    variance_threshold = max(1000.0, summary["revenue"] * 0.05)
    if abs(summary["ledger_variance"]) > variance_threshold:
        flags.append(
            {
                "severity": "warn",
                "label": "POS vs ledger gap",
                "detail": (
                    f"POS billed {summary['pos_revenue']:,.2f} vs ledger "
                    f"{summary['revenue']:,.2f}."
                ),
            }
        )
    if summary["days_with_sales"] == 0 and summary["pos_orders"] > 0:
        flags.append(
            {
                "severity": "fail",
                "label": "Ledger gap",
                "detail": "POS has billed orders but no daily sales ledger entries.",
            }
        )

    return {
        "start_date": start_date.isoformat(),
        "end_date": end_date.isoformat(),
        "store_id": store_id,
        "currency": "INR",
        "summary": summary,
        "stores": store_rows,
        "daily_trend": trend,
        "expense_categories": category_rows,
        "flags": flags,
        "generated_at": datetime.utcnow().isoformat(),
    }
