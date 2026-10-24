"""HR exits: resignation/termination, clearance and final-settlement estimate."""

import calendar
from datetime import date, datetime

from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.models.domain import (
    HREmployee,
    HRExit,
    HRExitClearance,
    HRLeaveType,
    HRSalaryStructure,
    StaffCredential,
)
from app.services.hr_leave_service import get_balance

EXIT_TYPES = {"resignation", "termination", "absconding", "retirement"}
EXIT_STATUSES = {"initiated", "notice", "clearance", "settled", "cancelled"}
DEFAULT_CLEARANCE = [
    ("Kitchen equipment & keys returned", "Operations"),
    ("Uniform & locker cleared", "Operations"),
    ("POS and system access revoked", "IT"),
    ("Company documents returned", "HR"),
    ("Advances / dues settled", "Finance"),
    ("Exit interview completed", "HR"),
]


def round2(value: float) -> float:
    return round(float(value or 0), 2)


def serialize_task(row: HRExitClearance) -> dict:
    return {
        "id": row.id,
        "title": row.title,
        "department": row.department,
        "status": row.status,
        "notes": row.notes,
        "cleared_at": row.cleared_at.isoformat() if row.cleared_at else None,
    }


def serialize_exit(row: HRExit) -> dict:
    tasks = sorted(row.clearance_tasks, key=lambda task: (task.sort_order, task.id))
    cleared = sum(1 for task in tasks if task.status == "cleared")
    return {
        "id": row.id,
        "employee_id": row.employee_id,
        "employee_code": row.employee.employee_code if row.employee else None,
        "employee_name": row.employee.full_name if row.employee else None,
        "designation": row.employee.designation if row.employee else None,
        "exit_type": row.exit_type,
        "status": row.status,
        "resignation_date": row.resignation_date.isoformat(),
        "last_working_date": row.last_working_date.isoformat(),
        "notice_days": row.notice_days,
        "reason": row.reason,
        "settlement": row.settlement or {},
        "settled_at": row.settled_at.isoformat() if row.settled_at else None,
        "clearance_total": len(tasks),
        "clearance_done": cleared,
        "clearance": [serialize_task(task) for task in tasks],
        "created_at": row.created_at.isoformat() if row.created_at else None,
    }


def _parse_date(value, label: str) -> date:
    try:
        return date.fromisoformat(str(value)[:10])
    except (ValueError, TypeError) as exc:
        raise ValueError(f"{label} must be YYYY-MM-DD.") from exc


def create_exit(db: Session, payload: dict) -> HRExit:
    employee = (
        db.query(HREmployee)
        .filter(HREmployee.id == int(payload.get("employee_id") or 0))
        .first()
    )
    if employee is None:
        raise ValueError("Employee not found.")
    if employee.status == "exited":
        raise ValueError("Employee is already exited.")
    if db.query(HRExit).filter(HRExit.employee_id == employee.id).first() is not None:
        raise ValueError("An exit record already exists for this employee.")
    exit_type = str(payload.get("exit_type") or "resignation")
    if exit_type not in EXIT_TYPES:
        raise ValueError("Unknown exit type.")
    resignation = _parse_date(payload.get("resignation_date"), "Resignation date")
    last_working = _parse_date(payload.get("last_working_date"), "Last working date")
    if last_working < resignation:
        raise ValueError("Last working date cannot be before the resignation date.")
    notice_days = int(payload.get("notice_days") or 30)
    if notice_days < 0 or notice_days > 180:
        raise ValueError("Notice days must be between 0 and 180.")
    status = "clearance" if last_working <= date.today() else "notice"
    row = HRExit(
        employee_id=employee.id,
        exit_type=exit_type,
        status=status,
        resignation_date=resignation,
        last_working_date=last_working,
        notice_days=notice_days,
        reason=(str(payload.get("reason") or "").strip() or None),
    )
    db.add(row)
    db.flush()
    for index, (title, department) in enumerate(DEFAULT_CLEARANCE, start=1):
        db.add(
            HRExitClearance(
                exit_id=row.id,
                title=title,
                department=department,
                sort_order=index * 10,
            )
        )
    try:
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise ValueError("An exit record already exists for this employee.") from exc
    db.refresh(row)
    return row


def update_exit(db: Session, row: HRExit, payload: dict) -> HRExit:
    if row.status == "settled":
        raise ValueError("Settled exits cannot be edited.")
    if payload.get("status") is not None:
        status = str(payload["status"])
        if status not in EXIT_STATUSES:
            raise ValueError("Unknown exit status.")
        row.status = status
    if payload.get("last_working_date") is not None:
        lwd = _parse_date(payload["last_working_date"], "Last working date")
        if lwd < row.resignation_date:
            raise ValueError("Last working date cannot be before the resignation date.")
        row.last_working_date = lwd
    if payload.get("notice_days") is not None:
        days = int(payload["notice_days"])
        if days < 0 or days > 180:
            raise ValueError("Notice days must be between 0 and 180.")
        row.notice_days = days
    if payload.get("reason") is not None:
        row.reason = str(payload["reason"]).strip() or None
    db.commit()
    db.refresh(row)
    return row


def update_clearance(
    db: Session, task_id: int, status: str, notes: str | None = None
) -> HRExitClearance:
    task = db.query(HRExitClearance).filter(HRExitClearance.id == task_id).first()
    if task is None:
        raise ValueError("Clearance task not found.")
    if status not in {"pending", "cleared"}:
        raise ValueError("Clearance status must be pending or cleared.")
    if task.exit.status in {"settled", "cancelled"}:
        raise ValueError("This exit is closed.")
    task.status = status
    task.cleared_at = datetime.utcnow() if status == "cleared" else None
    if notes is not None:
        task.notes = notes.strip() or None
    db.commit()
    db.refresh(task)
    return task


def _months_between(start: date, end: date) -> float:
    return max(0.0, (end - start).days / 365.25)


def calculate_settlement(db: Session, row: HRExit) -> dict:
    employee = row.employee
    salary = (
        db.query(HRSalaryStructure)
        .filter(HRSalaryStructure.employee_id == employee.id)
        .first()
    )
    gross = round2(
        (salary.basic + salary.hra + salary.allowances) if salary else 0
    )
    lwd = row.last_working_date
    days_in_month = calendar.monthrange(lwd.year, lwd.month)[1]
    days_worked = lwd.day
    pending_salary = round2(gross * days_worked / days_in_month) if gross else 0.0

    leave_days = 0.0
    leave_encashment = 0.0
    if salary:
        earned = (
            db.query(HRLeaveType)
            .filter(HRLeaveType.code == "earned")
            .first()
        )
        if earned is not None:
            balance = get_balance(db, employee.id, earned, lwd.year)
            leave_days = max(0.0, balance.entitled + balance.adjusted - balance.used)
            leave_encashment = round2(leave_days * (salary.basic / 30))

    service_years = (
        _months_between(employee.joining_date, lwd) if employee.joining_date else 0.0
    )
    gratuity = 0.0
    if salary and service_years >= 5:
        gratuity = round2(salary.basic * (15 / 26) * service_years)

    served_days = max(0, (lwd - row.resignation_date).days)
    notice_shortfall = max(0, row.notice_days - served_days)
    notice_recovery = (
        round2((gross / 30) * notice_shortfall) if gross and notice_shortfall else 0.0
    )

    total = round2(
        pending_salary + leave_encashment + gratuity - notice_recovery
    )
    notes = [
        "Estimate only; final settlement is subject to payroll and statutory review.",
        "Pending salary uses the current monthly gross and days up to the last working date.",
        "Leave encashment uses remaining earned leave at basic / 30.",
        f"Gratuity applies only at 5+ years of service (calculated {round(service_years, 2)} years).",
        f"Notice served {served_days} day(s) against {row.notice_days} required.",
    ]
    return {
        "as_of": lwd.isoformat(),
        "monthly_gross": gross,
        "days_in_month": days_in_month,
        "days_worked": days_worked,
        "pending_salary": pending_salary,
        "earned_leave_days": round(leave_days, 2),
        "leave_encashment": leave_encashment,
        "service_years": round(service_years, 2),
        "gratuity": gratuity,
        "notice_days_served": served_days,
        "notice_shortfall_days": notice_shortfall,
        "notice_recovery": notice_recovery,
        "net_settlement": total,
        "notes": notes,
    }


def settle_exit(db: Session, row: HRExit, force: bool = False) -> HRExit:
    if row.status == "settled":
        raise ValueError("Exit is already settled.")
    if row.status == "cancelled":
        raise ValueError("Cancelled exits cannot be settled.")
    pending = [task for task in row.clearance_tasks if task.status != "cleared"]
    if pending and not force:
        raise ValueError(
            f"Complete {len(pending)} clearance task(s) before settlement."
        )
    settlement = calculate_settlement(db, row)
    row.settlement = settlement
    row.status = "settled"
    row.settled_at = datetime.utcnow()
    row.employee.status = "exited"
    if row.employee.staff_id:
        credential = (
            db.query(StaffCredential)
            .filter(StaffCredential.staff_id == row.employee.staff_id)
            .first()
        )
        if credential is not None:
            credential.is_active = False
    db.commit()
    db.refresh(row)
    return row


def cancel_exit(db: Session, row: HRExit) -> HRExit:
    if row.status == "settled":
        raise ValueError("Settled exits cannot be cancelled.")
    row.status = "cancelled"
    db.commit()
    db.refresh(row)
    return row


def list_exits(db: Session, status: str = "") -> list[HRExit]:
    query = db.query(HRExit)
    if status:
        query = query.filter(HRExit.status == status)
    return query.order_by(HRExit.created_at.desc()).all()


def summary(db: Session) -> dict:
    rows = db.query(HRExit).all()
    counts: dict[str, int] = {}
    for row in rows:
        counts[row.status] = counts.get(row.status, 0) + 1
    return {
        "total": len(rows),
        "notice": counts.get("notice", 0),
        "clearance": counts.get("clearance", 0),
        "settled": counts.get("settled", 0),
        "cancelled": counts.get("cancelled", 0),
    }
