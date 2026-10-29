"""Live department KPIs for the company operating system.

Everything here aggregates existing operating tables. No KPI is stored or
invented: if the underlying data is absent the card shows a zero or "No data"
state instead of a fake trend.
"""

from __future__ import annotations

from datetime import date, datetime, timedelta

from sqlalchemy import func
from sqlalchemy.orm import Session

from app.core.clock import business_today
from app.models.domain import (
    AdCampaign,
    AggregatorIntegration,
    BusinessDepartment,
    CampaignDelivery,
    ClientErrorReport,
    Customer,
    DailySales,
    DeliveryAssignment,
    Expense,
    HRAttendance,
    HREmployee,
    HRLeaveRequest,
    InventoryItem,
    LoyaltyAccount,
    MenuItem,
    OperationalAuditEvent,
    OrderFeedback,
    Promotion,
    ProviderSetting,
    PurchaseOrder,
    Recipe,
    RestaurantOrder,
    SocialPost,
    StaffCredential,
    SupportTicket,
    Vendor,
    WasteLog,
)


def _money(value: float | int | None) -> str:
    return f"Rs {float(value or 0):,.0f}"


def _count(value: int | None) -> str:
    return f"{int(value or 0):,}"


def _percent(value: float | None) -> str:
    return f"{float(value or 0):.1f}%"


def _tone(value: float, *, watch: float, alert: float, higher_is_better: bool = False) -> str:
    if higher_is_better:
        if value <= alert:
            return "alert"
        if value <= watch:
            return "watch"
        return "good"
    if value >= alert:
        return "alert"
    if value >= watch:
        return "watch"
    return "good"


def _kpi(
    key: str,
    label: str,
    value: float | int | str,
    display: str,
    *,
    detail: str = "",
    tone: str = "neutral",
    target: str | None = None,
    cadence: str = "daily",
    owner: str | None = None,
    href: str | None = None,
) -> dict:
    return {
        "key": key,
        "label": label,
        "value": value,
        "display": display,
        "detail": detail,
        "tone": tone,
        "target": target,
        "cadence": cadence,
        "owner": owner,
        "href": href,
    }


def _scalar(db: Session, query) -> float:
    value = query.scalar()
    return float(value or 0)


def _head_name(db: Session, department_key: str) -> str:
    department = (
        db.query(BusinessDepartment)
        .filter(BusinessDepartment.key == department_key)
        .first()
    )
    if department is None:
        return "Unassigned"
    if not department.head_staff_id:
        return "Unassigned"
    staff = (
        db.query(StaffCredential)
        .filter(StaffCredential.staff_id == department.head_staff_id)
        .first()
    )
    return staff.display_name if staff else department.head_staff_id


def _open_ticket_count(db: Session) -> int:
    return int(
        db.query(func.count(SupportTicket.id))
        .filter(SupportTicket.status.notin_(["resolved", "closed"]))
        .scalar()
        or 0
    )


def _month_waste_value(db: Session, today: date) -> float:
    month_start = date(today.year, today.month, 1)
    return _scalar(
        db,
        db.query(func.sum(WasteLog.estimated_cost)).filter(
            WasteLog.date >= month_start
        ),
    )


def _executive_kpis(db: Session, today: date) -> list[dict]:
    yesterday = today - timedelta(days=1)
    today_sales = _scalar(
        db,
        db.query(func.sum(DailySales.total_sale)).filter(
            DailySales.date == today
        ),
    )
    yesterday_sales = _scalar(
        db,
        db.query(func.sum(DailySales.total_sale)).filter(
            DailySales.date == yesterday
        ),
    )
    today_orders = int(
        db.query(func.count(RestaurantOrder.id))
        .filter(RestaurantOrder.date == today)
        .scalar()
        or 0
    )
    week_start = today - timedelta(days=6)
    week_sales = _scalar(
        db,
        db.query(func.sum(DailySales.total_sale)).filter(
            DailySales.date >= week_start, DailySales.date <= today
        ),
    )
    active_customers = int(
        db.query(func.count(Customer.id))
        .filter(Customer.last_order_at >= datetime.utcnow() - timedelta(days=7))
        .scalar()
        or 0
    )
    change = (
        ((today_sales - yesterday_sales) / yesterday_sales) * 100
        if yesterday_sales
        else 0
    )
    return [
        _kpi(
            "today-sales",
            "Today's revenue",
            today_sales,
            _money(today_sales),
            detail=(
                f"{change:+.1f}% vs yesterday"
                if yesterday_sales
                else "No sales logged yesterday"
            ),
            tone=_tone(change, watch=-10, alert=-25, higher_is_better=True),
            owner=_head_name(db, "executive"),
            href="/daily",
        ),
        _kpi(
            "today-orders",
            "Orders today",
            today_orders,
            _count(today_orders),
            detail="All order channels",
            tone="neutral",
            owner=_head_name(db, "operations"),
            href="/orders",
        ),
        _kpi(
            "week-sales",
            "Last 7 days",
            week_sales,
            _money(week_sales),
            detail="Rolling revenue",
            tone="neutral",
            cadence="weekly",
            href="/reports",
        ),
        _kpi(
            "active-customers",
            "Active customers",
            active_customers,
            _count(active_customers),
            detail="Ordered in the last 7 days",
            tone="neutral",
            cadence="weekly",
            href="/customers",
        ),
    ]


def _operations_kpis(db: Session, today: date) -> list[dict]:
    today_orders = int(
        db.query(func.count(RestaurantOrder.id))
        .filter(RestaurantOrder.date == today)
        .scalar()
        or 0
    )
    open_orders = int(
        db.query(func.count(RestaurantOrder.id))
        .filter(
            RestaurantOrder.date == today,
            RestaurantOrder.status.notin_(["closed", "cancelled"]),
        )
        .scalar()
        or 0
    )
    aov = _scalar(
        db,
        db.query(func.avg(RestaurantOrder.total_amount)).filter(
            RestaurantOrder.date == today,
            RestaurantOrder.status == "closed",
        ),
    )
    active_riders = int(
        db.query(func.count(func.distinct(DeliveryAssignment.assigned_to)))
        .filter(
            DeliveryAssignment.status.in_(
                ["assigned", "out_for_delivery", "picked_up"]
            ),
            DeliveryAssignment.assigned_to.isnot(None),
        )
        .scalar()
        or 0
    )
    open_tickets = _open_ticket_count(db)
    return [
        _kpi(
            "today-orders",
            "Orders today",
            today_orders,
            _count(today_orders),
            detail=f"{open_orders} still open",
            tone="neutral",
            owner=_head_name(db, "operations"),
            href="/orders",
        ),
        _kpi(
            "open-orders",
            "Open orders",
            open_orders,
            _count(open_orders),
            detail="Not closed or cancelled",
            tone=_tone(open_orders, watch=10, alert=20),
            target="0 at close",
            href="/operations",
        ),
        _kpi(
            "aov",
            "Average order value",
            round(aov, 2),
            _money(aov),
            detail="Closed orders today",
            tone="neutral",
            href="/sales",
        ),
        _kpi(
            "active-riders",
            "Riders active",
            active_riders,
            _count(active_riders),
            detail="Assigned or on the road",
            tone="neutral",
            href="/delivery",
        ),
        _kpi(
            "open-tickets",
            "Open support tickets",
            open_tickets,
            _count(open_tickets),
            detail="Guest issues awaiting resolution",
            tone=_tone(open_tickets, watch=3, alert=8),
            target="0",
            href="/support-inbox",
        ),
    ]


def _kitchen_kpis(db: Session, today: date) -> list[dict]:
    items = int(db.query(func.count(MenuItem.id)).scalar() or 0)
    sold_out = int(
        db.query(func.count(MenuItem.id))
        .filter(MenuItem.is_available.is_(False))
        .scalar()
        or 0
    )
    recipes = int(db.query(func.count(Recipe.id)).scalar() or 0)
    coverage = (recipes / items * 100) if items else 0
    waste = _month_waste_value(db, today)
    return [
        _kpi(
            "menu-items",
            "Menu items",
            items,
            _count(items),
            detail="Active menu catalogue",
            tone="neutral",
            cadence="monthly",
            owner=_head_name(db, "kitchen"),
            href="/menu",
        ),
        _kpi(
            "sold-out",
            "Sold out",
            sold_out,
            _count(sold_out),
            detail="Items hidden from ordering",
            tone=_tone(sold_out, watch=3, alert=8),
            target="0",
            href="/menu",
        ),
        _kpi(
            "recipe-coverage",
            "Recipe coverage",
            round(coverage, 1),
            _percent(coverage),
            detail=f"{recipes} recipes for {items} items",
            tone=_tone(coverage, watch=70, alert=40, higher_is_better=True),
            cadence="monthly",
            href="/recipes",
        ),
        _kpi(
            "waste-month",
            "Waste this month",
            waste,
            _money(waste),
            detail="Estimated cost logged",
            tone="neutral",
            cadence="monthly",
            href="/waste",
        ),
    ]


def _supply_kpis(db: Session, today: date) -> list[dict]:
    low_stock = int(
        db.query(func.count(InventoryItem.id))
        .filter(InventoryItem.current_stock < InventoryItem.minimum_stock)
        .scalar()
        or 0
    )
    open_pos = int(
        db.query(func.count(PurchaseOrder.id))
        .filter(PurchaseOrder.status.in_(["draft", "sent"]))
        .scalar()
        or 0
    )
    vendors = int(
        db.query(func.count(Vendor.id))
        .filter(Vendor.is_active.is_(True))
        .scalar()
        or 0
    )
    waste = _month_waste_value(db, today)
    return [
        _kpi(
            "low-stock",
            "Low stock lines",
            low_stock,
            _count(low_stock),
            detail="Below minimum stock",
            tone=_tone(low_stock, watch=3, alert=8),
            target="0",
            owner=_head_name(db, "supply"),
            href="/inventory",
        ),
        _kpi(
            "open-pos",
            "Open purchase orders",
            open_pos,
            _count(open_pos),
            detail="Draft or sent, not received",
            tone="neutral",
            href="/purchase-orders",
        ),
        _kpi(
            "active-vendors",
            "Active vendors",
            vendors,
            _count(vendors),
            detail="Approved supplier list",
            tone="neutral",
            cadence="monthly",
            href="/vendors",
        ),
        _kpi(
            "waste-month",
            "Waste exposure",
            waste,
            _money(waste),
            detail="This month's estimated cost",
            tone="neutral",
            cadence="monthly",
            href="/waste",
        ),
    ]


def _quality_kpis(db: Session, today: date) -> list[dict]:
    avg_rating = _scalar(db, db.query(func.avg(OrderFeedback.rating)))
    feedback_count = int(db.query(func.count(OrderFeedback.id)).scalar() or 0)
    promoters = int(
        db.query(func.count(OrderFeedback.id))
        .filter(OrderFeedback.nps >= 9)
        .scalar()
        or 0
    )
    detractors = int(
        db.query(func.count(OrderFeedback.id))
        .filter(OrderFeedback.nps <= 6)
        .scalar()
        or 0
    )
    nps = ((promoters - detractors) / feedback_count * 100) if feedback_count else 0
    open_tickets = _open_ticket_count(db)
    failures = int(
        db.query(func.count(OperationalAuditEvent.id))
        .filter(
            OperationalAuditEvent.status == "fail",
            OperationalAuditEvent.created_at >= datetime.utcnow() - timedelta(days=7),
        )
        .scalar()
        or 0
    )
    return [
        _kpi(
            "guest-rating",
            "Guest rating",
            round(avg_rating, 2),
            f"{avg_rating:.1f} / 5" if feedback_count else "No data",
            detail=f"{feedback_count} feedback responses",
            tone=_tone(avg_rating, watch=4.0, alert=3.0, higher_is_better=True),
            cadence="weekly",
            owner=_head_name(db, "quality"),
            href="/feedback",
        ),
        _kpi(
            "nps",
            "Net promoter score",
            round(nps, 1),
            f"{nps:+.0f}",
            detail=f"{promoters} promoters · {detractors} detractors",
            tone=_tone(nps, watch=20, alert=0, higher_is_better=True),
            cadence="weekly",
            href="/feedback",
        ),
        _kpi(
            "open-tickets",
            "Open guest issues",
            open_tickets,
            _count(open_tickets),
            detail="Support tickets not resolved",
            tone=_tone(open_tickets, watch=3, alert=8),
            target="0",
            href="/support-inbox",
        ),
        _kpi(
            "failed-audits",
            "Failed checks (7d)",
            failures,
            _count(failures),
            detail="Operational audit failures",
            tone=_tone(failures, watch=1, alert=3),
            target="0",
            cadence="weekly",
            href="/reports",
        ),
    ]


def _finance_kpis(db: Session, today: date) -> list[dict]:
    month_start = date(today.year, today.month, 1)
    today_sales = _scalar(
        db,
        db.query(func.sum(DailySales.total_sale)).filter(
            DailySales.date == today
        ),
    )
    month_expenses = _scalar(
        db,
        db.query(func.sum(Expense.amount)).filter(Expense.date >= month_start),
    )
    unpaid_orders = int(
        db.query(func.count(RestaurantOrder.id))
        .filter(
            RestaurantOrder.date >= month_start,
            RestaurantOrder.status == "closed",
            RestaurantOrder.payment_status != "paid",
        )
        .scalar()
        or 0
    )
    tax_today = _scalar(
        db,
        db.query(func.sum(RestaurantOrder.tax_amount)).filter(
            RestaurantOrder.date == today
        ),
    )
    return [
        _kpi(
            "today-sales",
            "Sales today",
            today_sales,
            _money(today_sales),
            detail="Daily sales ledger",
            tone="neutral",
            owner=_head_name(db, "finance"),
            href="/daily",
        ),
        _kpi(
            "month-expenses",
            "Expenses this month",
            month_expenses,
            _money(month_expenses),
            detail="All expense categories",
            tone="neutral",
            cadence="monthly",
            href="/expenses",
        ),
        _kpi(
            "unpaid-orders",
            "Unpaid closed orders",
            unpaid_orders,
            _count(unpaid_orders),
            detail="This month, payment not settled",
            tone=_tone(unpaid_orders, watch=1, alert=5),
            target="0",
            href="/sales",
        ),
        _kpi(
            "tax-today",
            "Tax collected today",
            tax_today,
            _money(tax_today),
            detail="GST on today's orders",
            tone="neutral",
            href="/accounting",
        ),
    ]


def _hr_kpis(db: Session, today: date) -> list[dict]:
    headcount = int(
        db.query(func.count(HREmployee.id))
        .filter(HREmployee.status == "active")
        .scalar()
        or 0
    )
    pending_leave = int(
        db.query(func.count(HRLeaveRequest.id))
        .filter(HRLeaveRequest.status == "pending")
        .scalar()
        or 0
    )
    exceptions = int(
        db.query(func.count(HRAttendance.id))
        .filter(
            HRAttendance.date == today,
            HRAttendance.status.in_(["absent", "half_day", "leave"]),
        )
        .scalar()
        or 0
    )
    from app.models.domain import RecruitmentApplication

    open_applicants = int(
        db.query(func.count(RecruitmentApplication.id))
        .filter(
            ~RecruitmentApplication.stage.in_(
                ["hired", "rejected", "withdrawn"]
            )
        )
        .scalar()
        or 0
    )
    return [
        _kpi(
            "headcount",
            "Active headcount",
            headcount,
            _count(headcount),
            detail="Active employees",
            tone="neutral",
            cadence="monthly",
            owner=_head_name(db, "hr"),
            href="/departments/hr/people",
        ),
        _kpi(
            "pending-leave",
            "Leave approvals",
            pending_leave,
            _count(pending_leave),
            detail="Requests waiting for a decision",
            tone=_tone(pending_leave, watch=3, alert=8),
            target="0",
            href="/departments/hr/leave",
        ),
        _kpi(
            "attendance-exceptions",
            "Attendance exceptions",
            exceptions,
            _count(exceptions),
            detail="Absent, half day or leave today",
            tone=_tone(exceptions, watch=3, alert=8),
            href="/departments/hr/attendance",
        ),
        _kpi(
            "open-applicants",
            "Open applicants",
            open_applicants,
            _count(open_applicants),
            detail="In the recruitment pipeline",
            tone="neutral",
            cadence="weekly",
            href="/departments/hr/recruitment",
        ),
    ]


def _marketing_kpis(db: Session, today: date) -> list[dict]:
    active_promotions = int(
        db.query(func.count(Promotion.id))
        .filter(
            Promotion.status == "active",
            Promotion.start_date <= today,
            Promotion.end_date >= today,
        )
        .scalar()
        or 0
    )
    sent = int(
        db.query(func.count(CampaignDelivery.id))
        .filter(CampaignDelivery.status == "sent")
        .scalar()
        or 0
    )
    pending_social = int(
        db.query(func.count(SocialPost.id))
        .filter(SocialPost.approval_status == "pending")
        .scalar()
        or 0
    )
    launched_ads = int(
        db.query(func.count(AdCampaign.id))
        .filter(AdCampaign.status == "launched")
        .scalar()
        or 0
    )
    ad_spend = _scalar(
        db,
        db.query(func.sum(AdCampaign.spend)).filter(
            AdCampaign.status == "launched"
        ),
    )
    return [
        _kpi(
            "active-promotions",
            "Active offers",
            active_promotions,
            _count(active_promotions),
            detail="Live today",
            tone="neutral",
            owner=_head_name(db, "marketing"),
            href="/promotions",
        ),
        _kpi(
            "messages-sent",
            "Campaign messages",
            sent,
            _count(sent),
            detail="Delivered by the messaging provider",
            tone="neutral",
            cadence="weekly",
            href="/communications",
        ),
        _kpi(
            "pending-social",
            "Posts awaiting approval",
            pending_social,
            _count(pending_social),
            detail="In the social approval queue",
            tone=_tone(pending_social, watch=2, alert=5),
            target="0",
            href="/social",
        ),
        _kpi(
            "ad-spend",
            "Live ad spend",
            ad_spend,
            _money(ad_spend),
            detail=f"{launched_ads} campaigns launched",
            tone="neutral",
            cadence="weekly",
            href="/ads",
        ),
    ]


def _revenue_kpis(db: Session, today: date) -> list[dict]:
    month_start = date(today.year, today.month, 1)
    customers = int(db.query(func.count(Customer.id)).scalar() or 0)
    new_customers = int(
        db.query(func.count(Customer.id))
        .filter(Customer.first_seen_at >= datetime.combine(month_start, datetime.min.time()))
        .scalar()
        or 0
    )
    repeat_customers = int(
        db.query(func.count(Customer.id))
        .filter(Customer.total_orders > 1)
        .scalar()
        or 0
    )
    loyalty_members = int(db.query(func.count(LoyaltyAccount.id)).scalar() or 0)
    return [
        _kpi(
            "customers",
            "Customers",
            customers,
            _count(customers),
            detail="Total customer profiles",
            tone="neutral",
            owner=_head_name(db, "revenue"),
            href="/customers",
        ),
        _kpi(
            "new-customers",
            "New this month",
            new_customers,
            _count(new_customers),
            detail="First seen this month",
            tone="neutral",
            cadence="monthly",
            href="/customers",
        ),
        _kpi(
            "repeat-customers",
            "Repeat customers",
            repeat_customers,
            _count(repeat_customers),
            detail="More than one order",
            tone="neutral",
            cadence="monthly",
            href="/customers",
        ),
        _kpi(
            "loyalty-members",
            "Loyalty members",
            loyalty_members,
            _count(loyalty_members),
            detail="Enrolled accounts",
            tone="neutral",
            cadence="monthly",
            href="/customers",
        ),
    ]


def _technology_kpis(db: Session, today: date) -> list[dict]:
    errors_24h = int(
        db.query(func.count(ClientErrorReport.id))
        .filter(
            ClientErrorReport.created_at
            >= datetime.utcnow() - timedelta(hours=24)
        )
        .scalar()
        or 0
    )
    enabled_providers = 0
    if ProviderSetting is not None:
        enabled_providers = int(
            db.query(func.count(ProviderSetting.id))
            .filter(ProviderSetting.enabled.is_(True))
            .scalar()
            or 0
        )
    active_integrations = int(
        db.query(func.count(AggregatorIntegration.id))
        .filter(AggregatorIntegration.is_active.is_(True))
        .scalar()
        or 0
    )
    failed_events = int(
        db.query(func.count(OperationalAuditEvent.id))
        .filter(
            OperationalAuditEvent.status.in_(["fail", "failed", "error"]),
            OperationalAuditEvent.created_at
            >= datetime.utcnow() - timedelta(days=7),
        )
        .scalar()
        or 0
    )
    return [
        _kpi(
            "client-errors",
            "Client errors (24h)",
            errors_24h,
            _count(errors_24h),
            detail="Reported by the portal",
            tone=_tone(errors_24h, watch=1, alert=10),
            target="0",
            owner=_head_name(db, "technology"),
            href="/ops",
        ),
        _kpi(
            "providers",
            "Providers enabled",
            enabled_providers,
            _count(enabled_providers),
            detail="Saved provider credentials",
            tone="neutral",
            cadence="monthly",
            href="/settings/providers",
        ),
        _kpi(
            "integrations",
            "Active integrations",
            active_integrations,
            _count(active_integrations),
            detail="Aggregator and channel connections",
            tone="neutral",
            cadence="monthly",
            href="/settings/integrations",
        ),
        _kpi(
            "failed-events",
            "Failed events (7d)",
            failed_events,
            _count(failed_events),
            detail="Audit events with a failure status",
            tone=_tone(failed_events, watch=1, alert=5),
            target="0",
            cadence="weekly",
            href="/reports",
        ),
    ]


def _company_kpis(db: Session, today: date) -> list[dict]:
    from app.models.domain import Approval, WorkItem

    departments = int(
        db.query(func.count(BusinessDepartment.id))
        .filter(BusinessDepartment.status == "active")
        .scalar()
        or 0
    )
    staff = int(db.query(func.count(StaffCredential.id)).scalar() or 0)
    pending_approvals = int(
        db.query(func.count(Approval.id))
        .filter(Approval.status == "pending")
        .scalar()
        or 0
    )
    open_work = int(
        db.query(func.count(WorkItem.id))
        .filter(WorkItem.status.in_(["open", "in_progress", "waiting"]))
        .scalar()
        or 0
    )
    return [
        _kpi(
            "departments",
            "Active departments",
            departments,
            _count(departments),
            detail="Operating units in the registry",
            tone="neutral",
            cadence="monthly",
            href="/departments",
        ),
        _kpi(
            "staff",
            "Portal staff",
            staff,
            _count(staff),
            detail="Staff credentials",
            tone="neutral",
            cadence="monthly",
            href="/settings",
        ),
        _kpi(
            "approvals",
            "Pending approvals",
            pending_approvals,
            _count(pending_approvals),
            detail="Across every department",
            tone=_tone(pending_approvals, watch=3, alert=10),
            target="0",
            href="/work",
        ),
        _kpi(
            "work-items",
            "Open work items",
            open_work,
            _count(open_work),
            detail="Tasks and requests in flight",
            tone="neutral",
            href="/work",
        ),
    ]


PROVIDERS = {
    "executive": _executive_kpis,
    "operations": _operations_kpis,
    "guest-experience": _operations_kpis,
    "facilities": _operations_kpis,
    "kitchen": _kitchen_kpis,
    "supply": _supply_kpis,
    "quality": _quality_kpis,
    "legal": _quality_kpis,
    "finance": _finance_kpis,
    "hr": _hr_kpis,
    "training": _hr_kpis,
    "marketing": _marketing_kpis,
    "revenue": _revenue_kpis,
    "technology": _technology_kpis,
    "company": _company_kpis,
    "franchise": _executive_kpis,
}


def kpis_for_department(db: Session, department_key: str) -> list[dict]:
    provider = PROVIDERS.get(department_key)
    if provider is None:
        return []
    try:
        return provider(db, business_today())
    except Exception:
        # A KPI must never take down a department workspace. Missing optional
        # tables degrade to an explicit empty card.
        return [
            _kpi(
                "unavailable",
                "KPIs unavailable",
                0,
                "No data",
                detail="The metric could not be read on this database.",
                tone="watch",
            )
        ]
