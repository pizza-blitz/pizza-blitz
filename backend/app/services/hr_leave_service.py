"""HR leave types, balances, requests, decisions and holidays."""

from datetime import date, datetime
from typing import Optional

from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.models.domain import (
    HREmployee,
    HRHoliday,
    HRLeaveBalance,
    HRLeaveRequest,
    HRLeaveType,
    Store,
)

DEFAULT_LEAVE_TYPES = [
    {
        "code": "casual",
        "name": "Casual leave",
        "paid": True,
        "annual_quota": 12,
        "carry_forward": False,
        "color": "#0f766e",
    },
    {
        "code": "sick",
        "name": "Sick leave",
        "paid": True,
        "annual_quota": 8,
        "carry_forward": False,
        "color": "#2563eb",
    },
    {
        "code": "earned",
        "name": "Earned leave",
        "paid": True,
        "annual_quota": 15,
        "carry_forward": True,
        "max_carry_forward": 5,
        "color": "#7c3aed",
    },
    {
        "code": "unpaid",
        "name": "Leave without pay",
        "paid": False,
        "annual_quota": 0,
        "carry_forward": False,
        "color": "#64748b",
    },
]
STATUSES = {"pending", "approved", "rejected", "cancelled"}


def ensure_leave_types(db: Session) -> None:
    existing = {
        row.code for row in db.query(HRLeaveType).all()
    }
    for spec in DEFAULT_LEAVE_TYPES:
        if spec["code"] in existing:
            continue
        db.add(HRLeaveType(**spec))
    try:
        db.commit()
    except IntegrityError:
        db.rollback()


def serialize_type(row: HRLeaveType) -> dict:
    return {
        "id": row.id,
        "code": row.code,
        "name": row.name,
        "paid": bool(row.paid),
        "annual_quota": row.annual_quota,
        "carry_forward": bool(row.carry_forward),
        "max_carry_forward": row.max_carry_forward,
        "color": row.color,
        "is_active": bool(row.is_active),
    }


def serialize_holiday(row: HRHoliday) -> dict:
    return {
        "id": row.id,
        "name": row.name,
        "date": row.date.isoformat(),
        "store_id": row.store_id,
        "store_name": row.store.name if row.store else None,
        "notes": row.notes,
    }


def serialize_request(row: HRLeaveRequest) -> dict:
    return {
        "id": row.id,
        "employee_id": row.employee_id,
        "employee_name": row.employee.full_name if row.employee else None,
        "employee_code": row.employee.employee_code if row.employee else None,
        "leave_type": serialize_type(row.leave_type) if row.leave_type else None,
        "start_date": row.start_date.isoformat(),
        "end_date": row.end_date.isoformat(),
        "days": row.days,
        "reason": row.reason,
        "status": row.status,
        "decided_by": row.decided_by,
        "decided_at": row.decided_at.isoformat() if row.decided_at else None,
        "decision_note": row.decision_note,
        "created_at": row.created_at.isoformat() if row.created_at else None,
    }


def _prior_carry(db: Session, employee_id: int, leave_type: HRLeaveType, year: int) -> float:
    if not leave_type.carry_forward or leave_type.max_carry_forward <= 0:
        return 0.0
    prior = (
        db.query(HRLeaveBalance)
        .filter(
            HRLeaveBalance.employee_id == employee_id,
            HRLeaveBalance.leave_type_id == leave_type.id,
            HRLeaveBalance.year == year - 1,
        )
        .first()
    )
    if prior is None:
        return 0.0
    remaining = max(0.0, prior.entitled + prior.adjusted - prior.used)
    return min(remaining, leave_type.max_carry_forward)


def get_balance(
    db: Session, employee_id: int, leave_type: HRLeaveType, year: int
) -> HRLeaveBalance:
    balance = (
        db.query(HRLeaveBalance)
        .filter(
            HRLeaveBalance.employee_id == employee_id,
            HRLeaveBalance.leave_type_id == leave_type.id,
            HRLeaveBalance.year == year,
        )
        .first()
    )
    if balance is not None:
        return balance
    carry = _prior_carry(db, employee_id, leave_type, year)
    balance = HRLeaveBalance(
        employee_id=employee_id,
        leave_type_id=leave_type.id,
        year=year,
        entitled=float(leave_type.annual_quota) + carry,
        used=0.0,
        adjusted=0.0,
    )
    db.add(balance)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        balance = (
            db.query(HRLeaveBalance)
            .filter(
                HRLeaveBalance.employee_id == employee_id,
                HRLeaveBalance.leave_type_id == leave_type.id,
                HRLeaveBalance.year == year,
            )
            .first()
        )
        if balance is None:
            raise
        return balance
    db.refresh(balance)
    return balance


def balance_payload(balance: HRLeaveBalance) -> dict:
    remaining = balance.entitled + balance.adjusted - balance.used
    return {
        "leave_type": serialize_type(balance.leave_type),
        "year": balance.year,
        "entitled": round(balance.entitled, 2),
        "used": round(balance.used, 2),
        "adjusted": round(balance.adjusted, 2),
        "remaining": round(remaining, 2),
    }


def employee_balances(db: Session, employee: HREmployee, year: int) -> list[dict]:
    types = (
        db.query(HRLeaveType)
        .filter(HRLeaveType.is_active.is_(True))
        .order_by(HRLeaveType.id.asc())
        .all()
    )
    return [
        balance_payload(get_balance(db, employee.id, leave_type, year))
        for leave_type in types
    ]


def balances_overview(db: Session, year: int) -> list[dict]:
    employees = (
        db.query(HREmployee)
        .filter(HREmployee.status != "exited")
        .order_by(HREmployee.full_name.asc())
        .all()
    )
    return [
        {
            "employee_id": employee.id,
            "employee_code": employee.employee_code,
            "full_name": employee.full_name,
            "designation": employee.designation,
            "balances": employee_balances(db, employee, year),
        }
        for employee in employees
    ]


def _parse_dates(payload: dict) -> tuple[date, date]:
    try:
        start = date.fromisoformat(str(payload.get("start_date"))[:10])
        end = date.fromisoformat(str(payload.get("end_date"))[:10])
    except ValueError as exc:
        raise ValueError("Leave dates must be YYYY-MM-DD.") from exc
    if end < start:
        raise ValueError("End date cannot be before the start date.")
    return start, end


def create_request(db: Session, payload: dict) -> HRLeaveRequest:
    employee = (
        db.query(HREmployee)
        .filter(HREmployee.id == int(payload.get("employee_id") or 0))
        .first()
    )
    if employee is None:
        raise ValueError("Employee not found.")
    if employee.status == "exited":
        raise ValueError("Exited employees cannot request leave.")
    leave_type = (
        db.query(HRLeaveType)
        .filter(HRLeaveType.id == int(payload.get("leave_type_id") or 0))
        .first()
    )
    if leave_type is None or not leave_type.is_active:
        raise ValueError("Leave type not found.")
    start, end = _parse_dates(payload)
    days = float((end - start).days + 1)
    if days > 60:
        raise ValueError("A single leave request cannot exceed 60 days.")
    overlap = (
        db.query(HRLeaveRequest)
        .filter(
            HRLeaveRequest.employee_id == employee.id,
            HRLeaveRequest.status.in_(["pending", "approved"]),
            HRLeaveRequest.start_date <= end,
            HRLeaveRequest.end_date >= start,
        )
        .first()
    )
    if overlap is not None:
        raise ValueError("This leave overlaps an existing pending or approved request.")
    if leave_type.paid and leave_type.annual_quota > 0:
        balance = get_balance(db, employee.id, leave_type, start.year)
        remaining = balance.entitled + balance.adjusted - balance.used
        if days > remaining:
            raise ValueError(
                f"Only {round(remaining, 2)} day(s) of {leave_type.name} remain."
            )
    request = HRLeaveRequest(
        employee_id=employee.id,
        leave_type_id=leave_type.id,
        start_date=start,
        end_date=end,
        days=days,
        reason=(str(payload.get("reason") or "").strip() or None),
        status="pending",
    )
    db.add(request)
    db.commit()
    db.refresh(request)
    return request


def decide_request(
    db: Session,
    request_id: int,
    decision: str,
    decided_by: str,
    note: str | None = None,
) -> HRLeaveRequest:
    request = (
        db.query(HRLeaveRequest)
        .filter(HRLeaveRequest.id == request_id)
        .first()
    )
    if request is None:
        raise ValueError("Leave request not found.")
    if request.status != "pending":
        raise ValueError("Only pending requests can be decided.")
    decision = decision.strip().lower()
    if decision not in {"approved", "rejected"}:
        raise ValueError("Decision must be approved or rejected.")
    if decision == "approved" and request.leave_type.paid:
        balance = get_balance(
            db, request.employee_id, request.leave_type, request.start_date.year
        )
        remaining = balance.entitled + balance.adjusted - balance.used
        if request.days > remaining:
            raise ValueError(
                f"Only {round(remaining, 2)} day(s) remain; the request cannot be approved."
            )
        balance.used += request.days
    request.status = decision
    request.decided_by = decided_by
    request.decided_at = datetime.utcnow()
    request.decision_note = (note or "").strip() or None
    db.commit()
    db.refresh(request)
    return request


def cancel_request(db: Session, request_id: int, note: str | None = None) -> HRLeaveRequest:
    request = (
        db.query(HRLeaveRequest)
        .filter(HRLeaveRequest.id == request_id)
        .first()
    )
    if request is None:
        raise ValueError("Leave request not found.")
    if request.status not in {"pending", "approved"}:
        raise ValueError("Only pending or approved requests can be cancelled.")
    if request.status == "approved" and request.leave_type.paid:
        balance = get_balance(
            db, request.employee_id, request.leave_type, request.start_date.year
        )
        balance.used = max(0.0, balance.used - request.days)
    request.status = "cancelled"
    request.decision_note = (note or "").strip() or None
    request.decided_at = datetime.utcnow()
    db.commit()
    db.refresh(request)
    return request


def list_requests(
    db: Session, status: str = "", employee_id: Optional[int] = None
) -> list[HRLeaveRequest]:
    query = db.query(HRLeaveRequest)
    if status:
        query = query.filter(HRLeaveRequest.status == status)
    if employee_id:
        query = query.filter(HRLeaveRequest.employee_id == employee_id)
    return query.order_by(
        HRLeaveRequest.created_at.desc(), HRLeaveRequest.id.desc()
    ).all()


def leave_summary(db: Session, year: int) -> dict:
    requests = db.query(HRLeaveRequest).all()
    pending = sum(1 for row in requests if row.status == "pending")
    approved_days = sum(
        row.days
        for row in requests
        if row.status == "approved" and row.start_date.year == year
    )
    today = date.today()
    on_leave = sum(
        1
        for row in requests
        if row.status == "approved" and row.start_date <= today <= row.end_date
    )
    return {
        "year": year,
        "pending_requests": pending,
        "approved_days": round(approved_days, 2),
        "on_leave_today": on_leave,
        "total_requests": len(requests),
    }


def create_leave_type(db: Session, payload: dict) -> HRLeaveType:
    code = str(payload.get("code") or "").strip().lower().replace(" ", "_")
    name = str(payload.get("name") or "").strip()
    if not code or not name:
        raise ValueError("Leave type code and name are required.")
    if (
        db.query(HRLeaveType).filter(HRLeaveType.code == code).first()
        is not None
    ):
        raise ValueError(f"Leave type code '{code}' already exists.")
    quota = float(payload.get("annual_quota") or 0)
    if quota < 0 or quota > 365:
        raise ValueError("Annual quota must be between 0 and 365.")
    row = HRLeaveType(
        code=code[:30],
        name=name[:80],
        paid=bool(payload.get("paid", True)),
        annual_quota=quota,
        carry_forward=bool(payload.get("carry_forward", False)),
        max_carry_forward=float(payload.get("max_carry_forward") or 0),
        color=str(payload.get("color") or "#0f766e")[:20],
        is_active=True,
    )
    db.add(row)
    try:
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise ValueError("Leave type code already exists.") from exc
    db.refresh(row)
    return row


def create_holiday(db: Session, payload: dict) -> HRHoliday:
    name = str(payload.get("name") or "").strip()
    if not name:
        raise ValueError("Holiday name is required.")
    try:
        holiday_date = date.fromisoformat(str(payload.get("date"))[:10])
    except ValueError as exc:
        raise ValueError("Holiday date must be YYYY-MM-DD.") from exc
    store_id = payload.get("store_id")
    store_id = int(store_id) if store_id not in (None, "") else None
    if store_id is not None and db.query(Store).filter(Store.id == store_id).first() is None:
        raise ValueError("Store not found.")
    row = HRHoliday(
        name=name[:120],
        date=holiday_date,
        store_id=store_id,
        notes=(str(payload.get("notes") or "").strip() or None),
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return row
