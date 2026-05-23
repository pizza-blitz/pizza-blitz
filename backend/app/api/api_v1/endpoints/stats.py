from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session
from sqlalchemy import func, extract, text
from app.api.deps import get_db, require_roles
from app.models.domain import DailySales, FixedCost, RestaurantOrder
from datetime import datetime, timedelta

router = APIRouter()

def _period_days(period: str) -> int:
    if period == "7days":
        return 7
    if period in ["90days", "3months"]:
        return 90
    if period == "1year":
        return 365
    return 30

def _percent_change(current: float, baseline: float) -> float:
    if baseline == 0:
        return 0
    return round(((current - baseline) / baseline) * 100, 2)

def _direction(change_percent: float) -> str:
    return "up" if change_percent >= 0 else "down"

def _bucket_label(value: str | None, fallback: str = "unknown") -> str:
    normalized = (value or fallback).strip().lower() or fallback
    return normalized.replace("_", " ").replace("-", " ").title()

def _aggregate_range(db: Session, start_date, end_date):
    row = db.query(
        func.sum(DailySales.total_sale).label("sales"),
        func.sum(DailySales.total_expense).label("expenses"),
        func.count(DailySales.id).label("days"),
    ).filter(DailySales.date >= start_date, DailySales.date <= end_date).first()

    revenue = float(row.sales or 0)
    expenses = float(row.expenses or 0)
    profit = revenue - expenses
    days_with_entries = int(row.days or 0)
    margin = (profit / revenue * 100) if revenue > 0 else 0

    return {
        "revenue": round(revenue, 2),
        "expenses": round(expenses, 2),
        "profit": round(profit, 2),
        "margin_percent": round(margin, 2),
        "daily_average": round(revenue / days_with_entries, 2) if days_with_entries else 0,
        "days_with_entries": days_with_entries,
    }

def _daily_map(db: Session, start_date, end_date):
    rows = db.query(DailySales).filter(
        DailySales.date >= start_date,
        DailySales.date <= end_date,
    ).all()
    return {row.date: row for row in rows}

def _metric_card(key: str, label: str, value_key: str, current: dict, previous: dict, last_year: dict):
    current_value = current[value_key]
    previous_value = previous[value_key]
    last_year_value = last_year[value_key]
    previous_change = _percent_change(current_value, previous_value)
    yoy_change = _percent_change(current_value, last_year_value)

    return {
        "key": key,
        "label": label,
        "current": current_value,
        "previous": previous_value,
        "last_year": last_year_value,
        "previous_change_percent": previous_change,
        "previous_direction": _direction(previous_change),
        "yoy_change_percent": yoy_change,
        "yoy_direction": _direction(yoy_change),
    }

def _order_query(db: Session, start_date, end_date):
    return db.query(RestaurantOrder).filter(
        RestaurantOrder.date >= start_date,
        RestaurantOrder.date <= end_date,
    )

def _order_aggregate_range(db: Session, start_date, end_date) -> dict:
    row = _order_query(db, start_date, end_date).with_entities(
        func.count(RestaurantOrder.id).label("orders"),
        func.sum(RestaurantOrder.subtotal).label("subtotal"),
        func.sum(RestaurantOrder.discount_amount).label("discount"),
        func.sum(RestaurantOrder.tax_amount).label("tax"),
        func.sum(RestaurantOrder.total_amount).label("revenue"),
    ).first()

    order_count = int(row.orders or 0)
    revenue = float(row.revenue or 0)
    subtotal = float(row.subtotal or 0)
    discount = float(row.discount or 0)
    tax = float(row.tax or 0)
    return {
        "orders": order_count,
        "subtotal": round(subtotal, 2),
        "discount": round(discount, 2),
        "tax": round(tax, 2),
        "revenue": round(revenue, 2),
        "average_order_value": round(revenue / order_count, 2) if order_count else 0,
        "discount_rate_percent": round((discount / subtotal) * 100, 2) if subtotal else 0,
    }

def _order_dimension_map(db: Session, start_date, end_date, column) -> dict:
    rows = (
        _order_query(db, start_date, end_date)
        .with_entities(
            column.label("bucket"),
            func.count(RestaurantOrder.id).label("orders"),
            func.sum(RestaurantOrder.total_amount).label("revenue"),
            func.sum(RestaurantOrder.discount_amount).label("discount"),
        )
        .group_by(column)
        .all()
    )
    data = {}
    for row in rows:
        key = (row.bucket or "unknown").strip().lower() or "unknown"
        orders = int(row.orders or 0)
        revenue = float(row.revenue or 0)
        data[key] = {
            "key": key,
            "label": _bucket_label(key),
            "orders": orders,
            "revenue": round(revenue, 2),
            "discount": round(float(row.discount or 0), 2),
            "average_order_value": round(revenue / orders, 2) if orders else 0,
        }
    return data

def _dimension_comparison_rows(current: dict, previous: dict, last_year: dict, total_revenue: float) -> list[dict]:
    keys = sorted(
        set(current.keys()) | set(previous.keys()) | set(last_year.keys()),
        key=lambda key: current.get(key, {}).get("revenue", 0),
        reverse=True,
    )
    rows = []
    for key in keys:
        current_row = current.get(key) or {"key": key, "label": _bucket_label(key), "orders": 0, "revenue": 0, "discount": 0, "average_order_value": 0}
        previous_row = previous.get(key) or {"orders": 0, "revenue": 0, "discount": 0, "average_order_value": 0}
        last_year_row = last_year.get(key) or {"orders": 0, "revenue": 0, "discount": 0, "average_order_value": 0}
        current_revenue = float(current_row["revenue"] or 0)
        previous_revenue = float(previous_row["revenue"] or 0)
        last_year_revenue = float(last_year_row["revenue"] or 0)
        rows.append({
            "key": key,
            "label": current_row["label"],
            "current": current_row,
            "previous": previous_row,
            "last_year": last_year_row,
            "current_share_percent": round((current_revenue / total_revenue) * 100, 2) if total_revenue else 0,
            "previous_change_percent": _percent_change(current_revenue, previous_revenue),
            "yoy_change_percent": _percent_change(current_revenue, last_year_revenue),
        })
    return rows

@router.get("/dashboard-stats")
def get_dashboard_stats(period: str = "30days", db: Session = Depends(get_db)):
    today = datetime.utcnow().date()
    if period == "7days":
        start_date = today - timedelta(days=6)
    elif period == "90days" or period == "3months":
        start_date = today - timedelta(days=89)
    elif period == "1year":
        start_date = today - timedelta(days=364)
    elif period == "2years":
        start_date = today - timedelta(days=729)
    elif period == "lifetime":
        # Get earliest date in DB
        first_record = db.query(func.min(DailySales.date)).scalar()
        start_date = first_record if first_record else today
    else:
        start_date = today - timedelta(days=29)
    
    # Current Period Summary
    current = db.query(
        func.sum(DailySales.total_sale).label("sales"),
        func.sum(DailySales.total_expense).label("expenses"),
        func.avg(DailySales.total_sale).label("avg_sale")
    ).filter(DailySales.date >= start_date, DailySales.date <= today).first()
    
    # Previous Period for Trend (Same duration as start_date to today)
    delta = (today - start_date).days + 1
    prev_start = start_date - timedelta(days=delta if delta > 0 else 30)
    prev_end = start_date - timedelta(days=1)
    
    previous_sales = float(db.query(
        func.sum(DailySales.total_sale).label("sales")
    ).filter(DailySales.date >= prev_start, DailySales.date <= prev_end).scalar() or 0)
    
    total_sales = float(current.sales) if current.sales else 0
    total_expenses = float(current.expenses) if current.expenses else 0
    avg_daily_sale = float(current.avg_sale) if current.avg_sale else 0
    net_profit = total_sales - total_expenses
    
    # Chart Data (Last 30-60 points depending on period)
    chart_query = db.query(DailySales).filter(DailySales.date >= start_date, DailySales.date <= today).order_by(DailySales.date.asc())
    if period in ["1year", "2years", "lifetime"]:
        # For long periods, don't return 800 days of daily data for the main chart?
        # Maybe just the last 60 days for granular chart, but we need monthly data too.
        # Let's keep it daily for now, or the frontend will struggle.
        chart_sales = chart_query.all()
    else:
        chart_sales = chart_query.all()
    
    chart_data = [
        {
            "date": s.date.strftime("%d %b"),
            "sale": float(s.total_sale),
            "expense": float(s.total_expense),
            "profit": float(s.profit or 0)
        } for s in chart_sales
    ]

    return {
        "chart_data": chart_data,
        "metrics": {
            "total_sales": total_sales,
            "total_expense": total_expenses,
            "total_profit": net_profit,
            "avg_daily_sale": avg_daily_sale,
            "sales_growth": round(((total_sales - previous_sales) / previous_sales * 100), 2) if previous_sales > 0 else 0
        }
    }

@router.get("/insights/monthly-breakdown")
def monthly_breakdown(db: Session = Depends(get_db)):
    """Groups ALL sales data by month for the multi-year chart."""
    results = db.query(
        extract('year', DailySales.date).label('year'),
        extract('month', DailySales.date).label('month'),
        func.sum(DailySales.total_sale).label('total_sale'),
        func.sum(DailySales.total_expense).label('total_expense')
    ).group_by('year', 'month').order_by('year', 'month').all()
    
    data = []
    for r in results:
        sale = float(r.total_sale)
        expense = float(r.total_expense)
        profit = sale - expense
        margin = (profit / sale * 100) if sale > 0 else 0
        
        month_name = datetime(int(r.year), int(r.month), 1).strftime("%b %Y")
        
        data.append({
            "month": month_name,
            "year": int(r.year),
            "total_sale": sale,
            "total_expense": expense,
            "profit": profit,
            "margin_percent": round(margin, 2)
        })
    return data

@router.get("/insights/lifetime-summary")
def get_lifetime_summary(db: Session = Depends(get_db)):
    """Summary data for the lifetime performance card."""
    stats = db.query(
        func.sum(DailySales.total_sale).label("total_revenue"),
        func.sum(DailySales.total_sale - DailySales.total_expense).label("total_profit"),
        func.min(DailySales.date).label("start_date")
    ).first()
    
    if not stats.total_revenue:
        return {"error": "No data"}
        
    revenue = float(stats.total_revenue)
    profit = float(stats.total_profit)
    
    monthly_rows = db.query(
        extract('year', DailySales.date).label('year'),
        extract('month', DailySales.date).label('month'),
        func.sum(DailySales.total_sale).label('total')
    ).group_by('year', 'month').all()
    
    # Best Month
    best_month_res = max(monthly_rows, key=lambda row: float(row.total))
    
    # Worst Month
    worst_month_res = min(monthly_rows, key=lambda row: float(row.total))
    
    best_month_name = datetime(int(best_month_res.year), int(best_month_res.month), 1).strftime("%b %Y")
    worst_month_name = datetime(int(worst_month_res.year), int(worst_month_res.month), 1).strftime("%b %Y")
    
    # Avg Monthly Revenue
    total_months = len(monthly_rows)
    avg_monthly = revenue / total_months if total_months > 0 else revenue
    
    return {
        "total_revenue": revenue,
        "total_profit": profit,
        "avg_monthly_revenue": round(avg_monthly, 2),
        "best_month": {"name": best_month_name, "amount": float(best_month_res.total)},
        "worst_month": {"name": worst_month_name, "amount": float(worst_month_res.total)},
        "start_date": stats.start_date.strftime("%d %b %Y")
    }

@router.get("/compare/same-period")
def compare_same_period(period: str = "7days", db: Session = Depends(get_db)):
    days = _period_days(period)
    
    today = datetime.utcnow().date()
    current_start = today - timedelta(days=days - 1)
    last_year_start = current_start - timedelta(days=365)
    last_year_end = today - timedelta(days=365)
    
    current = db.query(func.sum(DailySales.total_sale)).filter(
        DailySales.date >= current_start, DailySales.date <= today
    ).scalar() or 0
    
    last_year = db.query(func.sum(DailySales.total_sale)).filter(
        DailySales.date >= last_year_start, DailySales.date <= last_year_end
    ).scalar() or 0
    
    change_percent = ((float(current) - float(last_year)) / float(last_year) * 100) if last_year else 0
    
    return {
        "period": period,
        "current_total": float(current),
        "last_year_total": float(last_year),
        "change_percent": round(change_percent, 2),
        "direction": "up" if change_percent >= 0 else "down"
    }

@router.get("/compare/performance-dashboard")
def performance_comparison_dashboard(period: str = "30days", db: Session = Depends(get_db)):
    days = _period_days(period)
    today = datetime.utcnow().date()
    current_start = today - timedelta(days=days - 1)
    current_end = today
    previous_start = current_start - timedelta(days=days)
    previous_end = current_start - timedelta(days=1)
    last_year_start = current_start - timedelta(days=365)
    last_year_end = current_end - timedelta(days=365)

    current = _aggregate_range(db, current_start, current_end)
    previous = _aggregate_range(db, previous_start, previous_end)
    last_year = _aggregate_range(db, last_year_start, last_year_end)

    current_rows = _daily_map(db, current_start, current_end)
    previous_rows = _daily_map(db, previous_start, previous_end)
    last_year_rows = _daily_map(db, last_year_start, last_year_end)

    day_names = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]
    weekday_totals = {
        index: {"current": 0.0, "previous": 0.0, "last_year": 0.0, "days": 0}
        for index in range(7)
    }
    daily_comparison = []

    for index in range(days):
        current_date = current_start + timedelta(days=index)
        previous_date = previous_start + timedelta(days=index)
        last_year_date = last_year_start + timedelta(days=index)
        current_row = current_rows.get(current_date)
        previous_row = previous_rows.get(previous_date)
        last_year_row = last_year_rows.get(last_year_date)

        current_sale = float(current_row.total_sale or 0) if current_row else 0.0
        previous_sale = float(previous_row.total_sale or 0) if previous_row else 0.0
        last_year_sale = float(last_year_row.total_sale or 0) if last_year_row else 0.0
        current_profit = (
            float((current_row.profit if current_row else 0) or 0)
            if current_row
            else 0.0
        )
        previous_profit = (
            float((previous_row.profit if previous_row else 0) or 0)
            if previous_row
            else 0.0
        )
        last_year_profit = (
            float((last_year_row.profit if last_year_row else 0) or 0)
            if last_year_row
            else 0.0
        )

        weekday_index = current_date.weekday()
        weekday_totals[weekday_index]["current"] += current_sale
        weekday_totals[weekday_index]["previous"] += previous_sale
        weekday_totals[weekday_index]["last_year"] += last_year_sale
        weekday_totals[weekday_index]["days"] += 1

        daily_comparison.append({
            "day_index": index + 1,
            "date": current_date.isoformat(),
            "label": current_date.strftime("%d %b"),
            "weekday": day_names[weekday_index],
            "current_sale": round(current_sale, 2),
            "previous_sale": round(previous_sale, 2),
            "last_year_sale": round(last_year_sale, 2),
            "current_profit": round(current_profit, 2),
            "previous_profit": round(previous_profit, 2),
            "last_year_profit": round(last_year_profit, 2),
        })

    summary_cards = [
        _metric_card("revenue", "Revenue", "revenue", current, previous, last_year),
        _metric_card("expenses", "Expenses", "expenses", current, previous, last_year),
        _metric_card("profit", "Profit", "profit", current, previous, last_year),
        _metric_card("margin", "Margin %", "margin_percent", current, previous, last_year),
        _metric_card("daily_average", "Daily Average", "daily_average", current, previous, last_year),
    ]

    best_day = max(daily_comparison, key=lambda row: row["current_sale"], default=None)
    slowest_day = min(daily_comparison, key=lambda row: row["current_sale"], default=None)

    revenue_card = next(card for card in summary_cards if card["key"] == "revenue")
    expense_ratio = (current["expenses"] / current["revenue"] * 100) if current["revenue"] > 0 else 0
    risk_flags = []
    if current["revenue"] <= 0:
        risk_flags.append("No revenue captured in this period.")
    if current["margin_percent"] < 20 and current["revenue"] > 0:
        risk_flags.append("Profit margin is below 20%.")
    if revenue_card["previous_change_percent"] < -5:
        risk_flags.append("Revenue is down more than 5% vs the previous period.")
    if revenue_card["yoy_change_percent"] < 0:
        risk_flags.append("Revenue is behind the same period last year.")
    if expense_ratio > 65:
        risk_flags.append("Expenses are consuming more than 65% of revenue.")
    if not risk_flags:
        risk_flags.append("Performance is stable against comparison baselines.")

    weekday_breakdown = []
    for weekday_index, values in weekday_totals.items():
        current_total = round(values["current"], 2)
        previous_total = round(values["previous"], 2)
        last_year_total = round(values["last_year"], 2)
        weekday_breakdown.append({
            "weekday": day_names[weekday_index],
            "current_sale": current_total,
            "previous_sale": previous_total,
            "last_year_sale": last_year_total,
            "previous_change_percent": _percent_change(current_total, previous_total),
            "yoy_change_percent": _percent_change(current_total, last_year_total),
            "days": values["days"],
        })

    return {
        "period": {
            "label": period,
            "days": days,
            "current_start": current_start.isoformat(),
            "current_end": current_end.isoformat(),
            "previous_start": previous_start.isoformat(),
            "previous_end": previous_end.isoformat(),
            "last_year_start": last_year_start.isoformat(),
            "last_year_end": last_year_end.isoformat(),
        },
        "current": current,
        "previous": previous,
        "last_year": last_year,
        "summary_cards": summary_cards,
        "daily_comparison": daily_comparison,
        "weekday_breakdown": weekday_breakdown,
        "best_day": best_day,
        "slowest_day": slowest_day,
        "risk_flags": risk_flags,
    }

@router.get("/compare/order-channel-dashboard")
def order_channel_comparison_dashboard(
    period: str = Query("30days"),
    db: Session = Depends(get_db),
    session: dict = Depends(require_roles("admin", "staff")),
):
    days = _period_days(period)
    today = datetime.utcnow().date()
    current_start = today - timedelta(days=days - 1)
    current_end = today
    previous_start = current_start - timedelta(days=days)
    previous_end = current_start - timedelta(days=1)
    last_year_start = current_start - timedelta(days=365)
    last_year_end = current_end - timedelta(days=365)

    current = _order_aggregate_range(db, current_start, current_end)
    previous = _order_aggregate_range(db, previous_start, previous_end)
    last_year = _order_aggregate_range(db, last_year_start, last_year_end)
    current_revenue = float(current["revenue"] or 0)

    channel_mix = _dimension_comparison_rows(
        _order_dimension_map(db, current_start, current_end, RestaurantOrder.order_type),
        _order_dimension_map(db, previous_start, previous_end, RestaurantOrder.order_type),
        _order_dimension_map(db, last_year_start, last_year_end, RestaurantOrder.order_type),
        current_revenue,
    )
    payment_mix = _dimension_comparison_rows(
        _order_dimension_map(db, current_start, current_end, RestaurantOrder.payment_method),
        _order_dimension_map(db, previous_start, previous_end, RestaurantOrder.payment_method),
        _order_dimension_map(db, last_year_start, last_year_end, RestaurantOrder.payment_method),
        current_revenue,
    )
    payment_status_mix = _dimension_comparison_rows(
        _order_dimension_map(db, current_start, current_end, RestaurantOrder.payment_status),
        _order_dimension_map(db, previous_start, previous_end, RestaurantOrder.payment_status),
        _order_dimension_map(db, last_year_start, last_year_end, RestaurantOrder.payment_status),
        current_revenue,
    )
    fulfillment_status_mix = _dimension_comparison_rows(
        _order_dimension_map(db, current_start, current_end, RestaurantOrder.status),
        _order_dimension_map(db, previous_start, previous_end, RestaurantOrder.status),
        _order_dimension_map(db, last_year_start, last_year_end, RestaurantOrder.status),
        current_revenue,
    )

    strongest_channel = channel_mix[0] if channel_mix else None
    paid_row = next((row for row in payment_status_mix if row["key"] == "paid"), None)
    awaiting_row = next((row for row in payment_status_mix if row["key"] == "awaiting_payment"), None)
    pending_row = next((row for row in payment_status_mix if row["key"] == "pending"), None)
    paid_orders = int(paid_row["current"]["orders"]) if paid_row else 0
    unsettled_orders = sum(
        int(row["current"]["orders"] or 0)
        for row in [awaiting_row, pending_row]
        if row
    )
    order_change_percent = _percent_change(current["orders"], previous["orders"])
    revenue_change_percent = _percent_change(current["revenue"], previous["revenue"])
    yoy_revenue_change_percent = _percent_change(current["revenue"], last_year["revenue"])

    insights = []
    if strongest_channel:
        insights.append(
            f"{strongest_channel['label']} leads this period with "
            f"{strongest_channel['current_share_percent']}% of order revenue."
        )
    if unsettled_orders:
        insights.append(f"{unsettled_orders} orders still need payment settlement review.")
    if revenue_change_percent < 0:
        insights.append(f"Order revenue is {abs(revenue_change_percent)}% below the previous period.")
    elif current["orders"]:
        insights.append(f"Order revenue is {revenue_change_percent}% above the previous period.")
    if yoy_revenue_change_percent < 0:
        insights.append(f"Order revenue is {abs(yoy_revenue_change_percent)}% behind last year.")
    if not insights:
        insights.append("Order channels are ready for deeper comparison once more orders are captured.")

    return {
        "period": {
            "label": period,
            "days": days,
            "current_start": current_start.isoformat(),
            "current_end": current_end.isoformat(),
            "previous_start": previous_start.isoformat(),
            "previous_end": previous_end.isoformat(),
            "last_year_start": last_year_start.isoformat(),
            "last_year_end": last_year_end.isoformat(),
        },
        "current": current,
        "previous": previous,
        "last_year": last_year,
        "summary": {
            "order_change_percent": order_change_percent,
            "revenue_change_percent": revenue_change_percent,
            "yoy_revenue_change_percent": yoy_revenue_change_percent,
            "paid_orders": paid_orders,
            "unsettled_orders": unsettled_orders,
        },
        "channel_mix": channel_mix,
        "payment_mix": payment_mix,
        "payment_status_mix": payment_status_mix,
        "fulfillment_status_mix": fulfillment_status_mix,
        "insights": insights[:5],
    }

@router.get("/insights/day-of-week")
def day_of_week_analysis(db: Session = Depends(get_db)):
    records = db.query(DailySales).all()
    day_names = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]
    day_totals = {i: [] for i in range(7)}
    
    for r in records:
        dow = r.date.weekday()
        day_totals[dow].append(float(r.total_sale))
    
    result = []
    for i, name in enumerate(day_names):
        avg = sum(day_totals[i]) / len(day_totals[i]) if day_totals[i] else 0
        result.append({"day": name, "average_sale": round(avg, 2), "data_points": len(day_totals[i])})
    
    best = max(result, key=lambda x: x["average_sale"])
    worst = min(result, key=lambda x: x["average_sale"])
    
    return {"by_day": result, "best_day": best, "worst_day": worst}

@router.get("/insights/best-worst")
def best_worst_days(limit: int = 10, db: Session = Depends(get_db)):
    best = db.query(DailySales).order_by(DailySales.total_sale.desc()).limit(limit).all()
    worst = db.query(DailySales).order_by(DailySales.total_sale.asc()).limit(limit).all()
    
    def fmt(r):
        return {"date": r.date.strftime("%d %b %Y"), "total_sale": float(r.total_sale), "profit": float(r.profit or 0)}
    
    return {"best_days": [fmt(r) for r in best], "worst_days": [fmt(r) for r in worst]}

@router.get("/insights/monthly-forecast")
def monthly_forecast(db: Session = Depends(get_db)):
    today = datetime.utcnow().date()
    month_start = today.replace(day=1)
    
    current_month = db.query(DailySales).filter(DailySales.date >= month_start).all()
    days_elapsed = today.day
    import calendar
    days_in_month = calendar.monthrange(today.year, today.month)[1]
    
    current_total = sum(float(r.total_sale) for r in current_month)
    daily_avg = current_total / days_elapsed if days_elapsed else 0
    projected = daily_avg * days_in_month
    
    last_year_start = month_start.replace(year=today.year - 1)
    last_year_end = last_year_start.replace(day=calendar.monthrange(last_year_start.year, last_year_start.month)[1])
    last_year = db.query(func.sum(DailySales.total_sale)).filter(
        DailySales.date >= last_year_start, DailySales.date <= last_year_end
    ).scalar() or 0
    
    change_percent = ((projected - float(last_year)) / float(last_year) * 100) if last_year else 0
    
    return {
        "month": today.strftime("%B %Y"),
        "current_total": round(current_total, 2),
        "daily_average": round(daily_avg, 2),
        "projected_total": round(projected, 2),
        "last_year_actual": round(float(last_year), 2),
        "change_percent": round(change_percent, 2),
        "direction": "up" if change_percent >= 0 else "down"
    }

@router.get("/insights/profit-trend")
def profit_trend(months: int = 12, db: Session = Depends(get_db)):
    today = datetime.utcnow().date()
    result = []
    
    for i in range(months - 1, -1, -1):
        # Approximate month subtraction
        month_date = today.replace(day=1) - timedelta(days=i * 30.4)
        month_start = month_date.replace(day=1)
        import calendar
        last_day = calendar.monthrange(month_start.year, month_start.month)[1]
        month_end = month_start.replace(day=last_day)
        
        rows = db.query(DailySales).filter(
            DailySales.date >= month_start, DailySales.date <= month_end
        ).all()
        
        if rows:
            total_sale = sum(float(r.total_sale) for r in rows)
            total_expense = sum(float(r.total_expense) for r in rows)
            profit = total_sale - total_expense
            margin = (profit / total_sale * 100) if total_sale else 0
            result.append({
                "month": month_start.strftime("%b %Y"),
                "total_sale": round(total_sale, 2),
                "total_expense": round(total_expense, 2),
                "profit": round(profit, 2),
                "margin_percent": round(margin, 2)
            })
    
    return {"trend": result, "months_analyzed": len(result)}

@router.get("/insights/health-score")
def operational_health_score(db: Session = Depends(get_db)):
    from datetime import date, timedelta
    
    today = date.today()
    month_start = today.replace(day=1)
    week_ago = today - timedelta(days=7)
    
    # Last year same month baseline
    try:
        last_year_month = month_start.replace(year=today.year-1)
    except ValueError: # Leap year case
        last_year_month = month_start - timedelta(days=365)
    
    # Get current month data
    current = db.execute(text("""
        SELECT 
            COALESCE(SUM(total_sale),0) as revenue,
            COALESCE(SUM(total_expense),0) as expense,
            COALESCE(SUM(profit),0) as profit,
            COUNT(*) as days
        FROM daily_sales WHERE date >= :start
    """), {"start": month_start}).fetchone()
    
    # Get last 7 days waste cost
    waste = db.execute(text("""
        SELECT COALESCE(SUM(estimated_cost),0) as waste_cost
        FROM waste_log WHERE date >= :week_ago
    """), {"week_ago": week_ago}).fetchone()
    
    # Get last year same month
    import calendar
    days_in_ly_month = calendar.monthrange(last_year_month.year, last_year_month.month)[1]
    ly_month_end = last_year_month.replace(day=days_in_ly_month)
    
    last_year = db.execute(text("""
        SELECT COALESCE(SUM(total_sale),0) as revenue
        FROM daily_sales WHERE date >= :start AND date <= :end
    """), {"start": last_year_month, "end": ly_month_end}).fetchone()
    
    revenue = float(current.revenue or 0)
    expense = float(current.expense or 0)
    profit = float(current.profit or 0)
    waste_cost = float(waste.waste_cost or 0)
    last_year_revenue = float(last_year.revenue or 0)
    
    # Calculate scores (each out of 25)
    margin_pct = (profit / revenue * 100) if revenue > 0 else 0
    margin_score = min(25, (margin_pct / 40) * 25)  # 40% margin = perfect score
    
    growth_pct = ((revenue - last_year_revenue) / last_year_revenue * 100) if last_year_revenue > 0 else 0
    growth_score = min(25, max(0, 12.5 + (growth_pct / 20) * 12.5))  # 0% = 12.5, +20% = 25
    
    expense_ratio = (expense / revenue * 100) if revenue > 0 else 100
    expense_score = min(25, max(0, 25 - ((expense_ratio - 50) / 2)))  # 50% expense ratio = 25
    
    waste_ratio = (waste_cost / (revenue/7 * 7)) * 100 if revenue > 0 else 0 # Simplified waste % of expected wk rev
    waste_score = min(25, max(0, 25 - (waste_ratio * 5)))  # 0% waste = 25
    
    total_score = round(margin_score + growth_score + expense_score + waste_score)
    
    if total_score >= 80: grade, color = "Excellent", "green"
    elif total_score >= 60: grade, color = "Good", "blue"
    elif total_score >= 40: grade, color = "Average", "yellow"
    else: grade, color = "Needs Attention", "red"
    
    return {
        "health_score": total_score,
        "grade": grade,
        "color": color,
        "breakdown": {
            "profit_margin": {"score": round(margin_score), "value": round(margin_pct, 1), "label": "Profit Margin %"},
            "growth": {"score": round(growth_score), "value": round(growth_pct, 1), "label": "YoY Growth %"},
            "expense_control": {"score": round(expense_score), "value": round(expense_ratio, 1), "label": "Expense Ratio %"},
            "waste_control": {"score": round(waste_score), "value": round(waste_ratio, 2), "label": "Waste % of Revenue"}
        },
        "recommendation": (
            "Outstanding performance. Maintain current operations." if total_score >= 80
            else "Good performance. Focus on reducing waste and expenses." if total_score >= 60
            else "Average performance. Review pricing and cost controls." if total_score >= 40
            else "Urgent attention needed. Review all cost centers immediately."
        )
    }

@router.get("/breakeven")
def breakeven_analysis(db: Session = Depends(get_db)):
    from datetime import date
    import calendar
    today = date.today()
    month_str = today.strftime("%Y-%m")
    fixed = db.query(FixedCost).filter(FixedCost.month == month_str).first()
    rent = float(fixed.rent) if fixed else 0
    salaries = float(fixed.salaries) if fixed else 0
    utilities = float(fixed.utilities) if fixed else 0
    other = float(fixed.other_fixed) if fixed else 0
    avg_order = float(fixed.avg_order_value) if fixed else 250
    total_fixed = rent + salaries + utilities + other
    month_start = today.replace(day=1)
    avg_expense, avg_sale = (
        db.query(func.avg(DailySales.total_expense), func.avg(DailySales.total_sale))
        .filter(DailySales.date >= month_start)
        .one()
    )
    avg_variable_per_day = float(avg_expense or 0)
    avg_daily_sale = float(avg_sale or 0)
    days_in_month = calendar.monthrange(today.year, today.month)[1]
    variable_cost_per_order = (avg_variable_per_day / (avg_daily_sale / avg_order)) if avg_daily_sale > 0 else avg_order * 0.4
    contribution_margin = avg_order - variable_cost_per_order
    orders_to_breakeven_daily = (total_fixed / days_in_month) / contribution_margin if contribution_margin > 0 else 0
    revenue_to_breakeven_daily = orders_to_breakeven_daily * avg_order
    today_sales = db.query(DailySales).filter(DailySales.date == today).first()
    today_revenue = float(today_sales.total_sale or 0) if today_sales else 0
    above_breakeven = today_revenue > revenue_to_breakeven_daily
    return {
        "month": month_str,
        "fixed_costs": {"rent": rent, "salaries": salaries, "utilities": utilities, "other": other, "total": total_fixed},
        "avg_order_value": avg_order,
        "daily_breakeven_revenue": round(revenue_to_breakeven_daily, 2),
        "daily_breakeven_orders": round(orders_to_breakeven_daily, 1),
        "today_revenue": round(today_revenue, 2),
        "today_above_breakeven": above_breakeven,
        "status_message": (f"Above break-even today by ₹{round(today_revenue - revenue_to_breakeven_daily):,}"
                          if above_breakeven else f"Below break-even — need ₹{round(revenue_to_breakeven_daily - today_revenue):,} more today")
    }

@router.post("/breakeven/setup")
def set_fixed_costs(month: str, rent: float = 0, salaries: float = 0,
                    utilities: float = 0, other_fixed: float = 0,
                    avg_order_value: float = 250, db: Session = Depends(get_db)):
    fixed = db.query(FixedCost).filter(FixedCost.month == month).first()
    if fixed is None:
        fixed = FixedCost(month=month)
        db.add(fixed)

    fixed.rent = rent
    fixed.salaries = salaries
    fixed.utilities = utilities
    fixed.other_fixed = other_fixed
    fixed.avg_order_value = avg_order_value
    db.commit()
    return {"status": "saved", "month": month}

@router.get("/target/status")
def target_status(monthly_target: float = 0, db: Session = Depends(get_db)):
    from datetime import date
    import calendar
    today = date.today()
    month_start = today.replace(day=1)
    days_in_month = calendar.monthrange(today.year, today.month)[1]
    days_elapsed = today.day
    days_remaining = days_in_month - days_elapsed
    current = db.execute(text("SELECT COALESCE(SUM(total_sale),0) as revenue FROM daily_sales WHERE date >= :start"), {"start": month_start}).fetchone()
    revenue_so_far = float(current.revenue or 0)
    daily_avg = revenue_so_far / days_elapsed if days_elapsed > 0 else 0
    projected = daily_avg * days_in_month
    if monthly_target <= 0:
        last_year_start = month_start.replace(year=today.year-1)
        ly = db.execute(text("SELECT COALESCE(SUM(total_sale),0) as revenue FROM daily_sales WHERE date >= :start AND date < :end"),
                       {"start": last_year_start, "end": last_year_start.replace(month=last_year_start.month+1) if last_year_start.month < 12 else last_year_start.replace(year=last_year_start.year+1, month=1)}).fetchone()
        monthly_target = float(ly.revenue or 0) * 1.1
        if monthly_target <= 0 and revenue_so_far > 0:
            monthly_target = revenue_so_far
    target_pct = (revenue_so_far / monthly_target * 100) if monthly_target > 0 else 0
    required_daily = max(0, (monthly_target - revenue_so_far) / days_remaining) if days_remaining > 0 else 0
    on_track = daily_avg >= required_daily
    return {
        "month": today.strftime("%B %Y"),
        "monthly_target": round(monthly_target, 2),
        "revenue_so_far": round(revenue_so_far, 2),
        "target_achieved_pct": round(target_pct, 1),
        "daily_average": round(daily_avg, 2),
        "required_daily_to_hit_target": round(required_daily, 2),
        "days_remaining": days_remaining,
        "projected_month_total": round(projected, 2),
        "on_track": on_track,
        "status_message": f"On track — averaging ₹{round(daily_avg):,}/day" if on_track else f"Behind — need ₹{round(required_daily):,}/day but averaging ₹{round(daily_avg):,}/day"
    }

@router.get("/weekly-summary/whatsapp")
def weekly_whatsapp_summary(db: Session = Depends(get_db)):
    from datetime import date, timedelta
    import urllib.parse
    today = date.today()
    week_start = today - timedelta(days=7)
    prev_week_start = week_start - timedelta(days=7)
    this_week = db.execute(text("SELECT COALESCE(SUM(total_sale),0) as rev, COALESCE(SUM(profit),0) as profit FROM daily_sales WHERE date >= :s"), {"s": week_start}).fetchone()
    last_week = db.execute(text("SELECT COALESCE(SUM(total_sale),0) as rev FROM daily_sales WHERE date >= :s AND date < :e"), {"s": prev_week_start, "e": week_start}).fetchone()
    best = db.execute(text("SELECT date, total_sale FROM daily_sales WHERE date >= :s ORDER BY total_sale DESC LIMIT 1"), {"s": week_start}).fetchone()
    worst = db.execute(text("SELECT date, total_sale FROM daily_sales WHERE date >= :s ORDER BY total_sale ASC LIMIT 1"), {"s": week_start}).fetchone()
    top_waste = db.execute(text("SELECT item_name, SUM(estimated_cost) as cost FROM waste_log WHERE date >= :s GROUP BY item_name ORDER BY cost DESC LIMIT 1"), {"s": week_start}).fetchone()
    this_rev = float(this_week.rev)
    last_rev = float(last_week.rev)
    wow = round((this_rev - last_rev) / last_rev * 100, 1) if last_rev > 0 else 0
    margin = round(float(this_week.profit) / this_rev * 100, 1) if this_rev > 0 else 0
    arrow = "↑" if wow >= 0 else "↓"
    message = f"""🍕 *Pizza Blitz — Weekly Summary*
📅 {week_start.strftime('%d %b')} – {today.strftime('%d %b %Y')}

💰 *Revenue:* ₹{round(this_rev):,}
{arrow} *vs Last Week:* {wow}%
📊 *Profit Margin:* {margin}%

🏆 *Best Day:* {best.date.strftime('%a %d %b') if best else 'N/A'} — ₹{round(float(best.total_sale)):,}
📉 *Slowest Day:* {worst.date.strftime('%a %d %b') if worst else 'N/A'} — ₹{round(float(worst.total_sale)):,}
🗑️ *Top Waste:* {top_waste.item_name if top_waste else 'None'} (₹{round(float(top_waste.cost)) if top_waste else 0})

{'✅ Strong week!' if wow > 5 else '⚠️ Revenue dipped. Review slow days.' if wow < -5 else '➡️ Stable week. Push weekend offers.'}

_Pizza Blitz Management System_"""
    encoded = urllib.parse.quote(message)
    return {"message": message, "whatsapp_url": f"https://wa.me/?text={encoded}", "this_week_revenue": round(this_rev, 2), "wow_change": wow}

@router.get("/ceo-summary")
def ceo_weekly_summary(db: Session = Depends(get_db)):
    from datetime import date, timedelta
    today = date.today()
    week_start = today - timedelta(days=7)
    prev_week_start = week_start - timedelta(days=7)
    this_week = db.execute(text("SELECT COALESCE(SUM(total_sale),0) as rev, COALESCE(SUM(profit),0) as profit FROM daily_sales WHERE date >= :s"), {"s": week_start}).fetchone()
    last_week = db.execute(text("SELECT COALESCE(SUM(total_sale),0) as rev FROM daily_sales WHERE date >= :s AND date < :e"), {"s": prev_week_start, "e": week_start}).fetchone()
    best = db.execute(text("SELECT date, total_sale FROM daily_sales WHERE date >= :s ORDER BY total_sale DESC LIMIT 1"), {"s": week_start}).fetchone()
    worst = db.execute(text("SELECT date, total_sale FROM daily_sales WHERE date >= :s ORDER BY total_sale ASC LIMIT 1"), {"s": week_start}).fetchone()
    this_rev = float(this_week.rev)
    last_rev = float(last_week.rev)
    wow = round((this_rev - last_rev) / last_rev * 100, 1) if last_rev > 0 else 0
    margin = round(float(this_week.profit) / this_rev * 100, 1) if this_rev > 0 else 0
    return {
        "period": f"{week_start.strftime('%d %b')} – {today.strftime('%d %b %Y')}",
        "this_week_revenue": round(this_rev, 2),
        "last_week_revenue": round(last_rev, 2),
        "week_on_week_change": wow,
        "direction": "up" if wow >= 0 else "down",
        "profit_margin": margin,
        "best_day": {"date": best.date.strftime("%A %d %b") if best else "N/A", "revenue": float(best.total_sale) if best else 0},
        "worst_day": {"date": worst.date.strftime("%A %d %b") if worst else "N/A", "revenue": float(worst.total_sale) if worst else 0},
        "ai_recommendation": (f"Strong week with {wow}% growth. Maintain consistency on slower days." if wow > 10 else f"Stable week. Push weekend promotions." if wow > 0 else f"Revenue declined {abs(wow)}% vs last week. Review pricing and staffing.")
    }
