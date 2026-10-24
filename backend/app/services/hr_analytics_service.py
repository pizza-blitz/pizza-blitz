"""HR analytics: workforce, leave, attendance, payroll, onboarding, exits."""

from datetime import date, timedelta

from sqlalchemy.orm import Session

from app.core.clock import business_today
from app.models.domain import (
    HRDocument,
    HREmployee,
    HRExit,
    HRLeaveBalance,
    HRLeaveRequest,
    HRLeaveType,
    HRLetter,
    HROnboardingCandidate,
    HRPayRun,
    HRSalaryStructure,
)
from app.services.hr_attendance_service import day_roster


def _month_start(day: date) -> date:
    return day.replace(day=1)


def _year_start(day: date) -> date:
    return day.replace(month=1, day=1)


def overview(db: Session) -> dict:
    today = business_today()
    employees = db.query(HREmployee).all()
    active = [row for row in employees if row.status == "active"]
    onboarding = [row for row in employees if row.status == "onboarding"]
    notice = [row for row in employees if row.status == "notice"]
    exited = [row for row in employees if row.status == "exited"]
    headcount = len(active) + len(onboarding) + len(notice)

    by_type: dict[str, int] = {}
    by_store: dict[str, int] = {}
    for row in employees:
        if row.status == "exited":
            continue
        by_type[row.employment_type] = by_type.get(row.employment_type, 0) + 1
        store = row.store.name if row.store else "Unassigned"
        by_store[store] = by_store.get(store, 0) + 1

    month_start = _month_start(today)
    new_joiners = sum(
        1
        for row in employees
        if row.joining_date and row.joining_date >= month_start
    )

    approved_leave_today = (
        db.query(HRLeaveRequest)
        .filter(
            HRLeaveRequest.status == "approved",
            HRLeaveRequest.start_date <= today,
            HRLeaveRequest.end_date >= today,
        )
        .all()
    )
    on_leave_ids = {row.employee_id for row in approved_leave_today}

    leave_requests = db.query(HRLeaveRequest).all()
    pending_leave = sum(1 for row in leave_requests if row.status == "pending")
    approved_days_year = sum(
        row.days
        for row in leave_requests
        if row.status == "approved" and row.start_date >= _year_start(today)
    )

    earned_type = db.query(HRLeaveType).filter(HRLeaveType.code == "earned").first()
    balances = {
        (row.employee_id, row.leave_type_id): row
        for row in db.query(HRLeaveBalance).all()
    }
    salaries = {
        row.employee_id: row for row in db.query(HRSalaryStructure).all()
    }
    leave_liability = 0.0
    if earned_type is not None:
        for employee in active:
            balance = balances.get((employee.id, earned_type.id))
            remaining = (
                max(0.0, balance.entitled + balance.adjusted - balance.used)
                if balance
                else float(earned_type.annual_quota)
            )
            salary = salaries.get(employee.id)
            if salary and salary.basic > 0:
                leave_liability += remaining * (salary.basic / 30)
    leave_liability = round(leave_liability, 2)

    roster = day_roster(db, today.isoformat())
    attendance = roster["summary"]
    attendance_base = max(0, attendance["total"] - attendance["on_leave"])
    attendance_rate = (
        round((attendance["present"] / attendance_base) * 100, 1)
        if attendance_base
        else 0.0
    )

    finalized = (
        db.query(HRPayRun)
        .filter(HRPayRun.status == "finalized")
        .order_by(HRPayRun.year.desc(), HRPayRun.month.desc())
        .all()
    )
    latest_run = finalized[0] if finalized else None
    ytd_net = round(
        sum(
            row.net_total
            for row in finalized
            if row.year == today.year
        ),
        2,
    )
    payroll_trend = [
        {
            "label": f"{row.month:02d}/{str(row.year)[2:]}",
            "gross": row.gross_total,
            "net": row.net_total,
        }
        for row in reversed(finalized[:6])
    ]

    candidates = db.query(HROnboardingCandidate).all()
    active_candidates = [
        row for row in candidates if row.status not in {"joined", "withdrawn"}
    ]
    joined_candidates = [row for row in candidates if row.status == "joined"]
    conversion_base = max(1, len(candidates) - len([row for row in candidates if row.status == "withdrawn"]))
    onboarding_conversion = round((len(joined_candidates) / conversion_base) * 100, 1)

    exits = db.query(HRExit).all()
    settled_exits = [row for row in exits if row.status == "settled"]
    settled_last_year = [
        row for row in settled_exits if row.settled_at and row.settled_at.date() >= today - timedelta(days=365)
    ]
    attrition = (
        round((len(settled_last_year) / max(1, headcount)) * 100, 1)
        if headcount
        else 0.0
    )

    documents = db.query(HRDocument).all()
    expiring = [
        row
        for row in documents
        if row.expires_at and today <= row.expires_at <= today + timedelta(days=30)
    ]
    letters = db.query(HRLetter).count()

    return {
        "as_of": today.isoformat(),
        "workforce": {
            "headcount": headcount,
            "active": len(active),
            "onboarding": len(onboarding),
            "notice": len(notice),
            "exited": len(exited),
            "new_joiners_this_month": new_joiners,
            "by_employment_type": by_type,
            "by_store": by_store,
        },
        "leave": {
            "pending_requests": pending_leave,
            "approved_days_this_year": round(approved_days_year, 2),
            "on_leave_today": len(on_leave_ids),
            "earned_leave_liability": leave_liability,
        },
        "attendance": {
            **attendance,
            "attendance_rate": attendance_rate,
        },
        "payroll": {
            "latest_run": {
                "id": latest_run.id,
                "month": latest_run.month,
                "year": latest_run.year,
                "gross_total": latest_run.gross_total,
                "net_total": latest_run.net_total,
                "employee_count": latest_run.employee_count,
            }
            if latest_run
            else None,
            "ytd_net": ytd_net,
            "trend": payroll_trend,
        },
        "onboarding": {
            "active_candidates": len(active_candidates),
            "joined_total": len(joined_candidates),
            "conversion_rate": onboarding_conversion,
        },
        "exits": {
            "on_notice": sum(1 for row in exits if row.status == "notice"),
            "in_clearance": sum(1 for row in exits if row.status == "clearance"),
            "settled_this_year": sum(
                1
                for row in settled_exits
                if row.settled_at and row.settled_at.year == today.year
            ),
            "attrition_rate": attrition,
        },
        "documents": {
            "total": len(documents),
            "expiring_30_days": len(expiring),
            "letters_issued": letters,
        },
    }
