from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session
from sqlalchemy import func, extract, text
from app.api.deps import get_db
from app.models.domain import DailySales
from datetime import datetime, timedelta

router = APIRouter()

@router.get("/dashboard-stats")
def get_dashboard_stats(period: str = "30days", db: Session = Depends(get_db)):
    today = datetime.utcnow().date()
    if period == "7days":
        start_date = today - timedelta(days=7)
    elif period == "90days" or period == "3months":
        start_date = today - timedelta(days=90)
    elif period == "1year":
        start_date = today - timedelta(days=365)
    elif period == "2years":
        start_date = today - timedelta(days=730)
    elif period == "lifetime":
        # Get earliest date in DB
        first_record = db.query(func.min(DailySales.date)).scalar()
        start_date = first_record if first_record else today
    else:
        start_date = today - timedelta(days=30)
    
    # Current Period Summary
    current = db.query(
        func.sum(DailySales.total_sale).label("sales"),
        func.sum(DailySales.total_expense).label("expenses"),
        func.avg(DailySales.total_sale).label("avg_sale")
    ).filter(DailySales.date >= start_date, DailySales.date <= today).first()
    
    # Previous Period for Trend (Same duration as start_date to today)
    delta = (today - start_date).days
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
    
    # Best Month
    best_month_res = db.query(
        extract('year', DailySales.date).label('year'),
        extract('month', DailySales.date).label('month'),
        func.sum(DailySales.total_sale).label('total')
    ).group_by('year', 'month').order_by(text('total DESC')).first()
    
    # Worst Month
    worst_month_res = db.query(
        extract('year', DailySales.date).label('year'),
        extract('month', DailySales.date).label('month'),
        func.sum(DailySales.total_sale).label('total')
    ).group_by('year', 'month').order_by(text('total ASC')).first()
    
    best_month_name = datetime(int(best_month_res.year), int(best_month_res.month), 1).strftime("%b %Y")
    worst_month_name = datetime(int(worst_month_res.year), int(worst_month_res.month), 1).strftime("%b %Y")
    
    # Avg Monthly Revenue
    total_months = db.query(func.count(func.distinct(func.date_trunc('month', DailySales.date)))).scalar()
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
    if period == "7days":
        days = 7
    elif period == "3months":
        days = 90
    else:
        days = 30
    
    today = datetime.utcnow().date()
    current_start = today - timedelta(days=days)
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
    fixed = db.execute(text("SELECT * FROM fixed_costs WHERE month=:m"), {"m": month_str}).fetchone()
    rent = float(fixed.rent) if fixed else 0
    salaries = float(fixed.salaries) if fixed else 0
    utilities = float(fixed.utilities) if fixed else 0
    other = float(fixed.other_fixed) if fixed else 0
    avg_order = float(fixed.avg_order_value) if fixed else 250
    total_fixed = rent + salaries + utilities + other
    month_start = today.replace(day=1)
    variable = db.execute(text("""
        SELECT COALESCE(AVG(total_expense),0) as avg_expense,
               COALESCE(AVG(total_sale),0) as avg_sale
        FROM daily_sales WHERE date >= :start
    """), {"start": month_start}).fetchone()
    avg_variable_per_day = float(variable.avg_expense) if variable else 0
    avg_daily_sale = float(variable.avg_sale) if variable else 0
    days_in_month = calendar.monthrange(today.year, today.month)[1]
    variable_cost_per_order = (avg_variable_per_day / (avg_daily_sale / avg_order)) if avg_daily_sale > 0 else avg_order * 0.4
    contribution_margin = avg_order - variable_cost_per_order
    orders_to_breakeven_daily = (total_fixed / days_in_month) / contribution_margin if contribution_margin > 0 else 0
    revenue_to_breakeven_daily = orders_to_breakeven_daily * avg_order
    today_sales = db.execute(text("SELECT COALESCE(total_sale,0) as s FROM daily_sales WHERE date=:d"), {"d": today}).fetchone()
    today_revenue = float(today_sales.s) if today_sales else 0
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
    db.execute(text("""
        INSERT INTO fixed_costs (month, rent, salaries, utilities, other_fixed, avg_order_value)
        VALUES (:month, :rent, :sal, :util, :other, :avg)
        ON CONFLICT (month) DO UPDATE
        SET rent=EXCLUDED.rent, salaries=EXCLUDED.salaries,
            utilities=EXCLUDED.utilities, other_fixed=EXCLUDED.other_fixed,
            avg_order_value=EXCLUDED.avg_order_value
    """), {"month": month, "rent": rent, "sal": salaries,
           "util": utilities, "other": other_fixed, "avg": avg_order_value})
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
    target_pct = (revenue_so_far / monthly_target * 100) if monthly_target > 0 else 0
    required_daily = (monthly_target - revenue_so_far) / days_remaining if days_remaining > 0 else 0
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
