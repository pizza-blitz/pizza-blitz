from datetime import date, timedelta
from typing import Literal, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from pydantic import BaseModel
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.core.clock import business_today
from app.api.deps import get_db, require_roles
from app.models.domain import (
    DailySales,
    RestaurantOrder,
    ScheduledShift,
    ShiftLog,
    StaffLeaveRequest,
)
from app.services.operational_audit_service import record_operational_audit_event

router = APIRouter()

LEAVE_ALLOWANCES = {
    "CL": 12,
    "PL": 12,
    "SL": 6,
}

ROLE_REQUIREMENTS = [
    {
        "key": "counter",
        "label": "Counter / POS",
        "required": 1,
        "expected_start": "11:00",
        "keywords": ["counter", "pos", "cashier", "front"],
    },
    {
        "key": "kitchen",
        "label": "Kitchen / Oven",
        "required": 1,
        "expected_start": "10:30",
        "keywords": ["chef", "kitchen", "oven", "cook"],
    },
    {
        "key": "prep",
        "label": "Prep / Packing",
        "required": 1,
        "expected_start": "11:00",
        "keywords": ["prep", "packing", "pack", "helper"],
    },
    {
        "key": "delivery",
        "label": "Delivery Rider",
        "required": 1,
        "expected_start": "12:00",
        "keywords": ["delivery", "rider", "driver"],
    },
]


class ShiftEntry(BaseModel):
    date: str
    staff_name: str
    role: Optional[str] = None
    shift_start: Optional[str] = None
    shift_end: Optional[str] = None
    notes: Optional[str] = None


class LeaveEntry(BaseModel):
    staff_name: str
    leave_type: Literal["CL", "PL", "SL", "LOP"] = "CL"
    start_date: str
    end_date: Optional[str] = None
    status: Literal["planned", "approved", "rejected", "cancelled"] = "approved"
    reason: Optional[str] = None


class LeaveStatusUpdate(BaseModel):
    status: Literal["planned", "approved", "rejected", "cancelled"]
    reason: Optional[str] = None


def _parse_date(value: str) -> date:
    try:
        return date.fromisoformat(value)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=f"Invalid date: {value}") from exc


def _parse_minutes(value: Optional[str]) -> Optional[int]:
    if not value:
        return None
    try:
        hour, minute = value.split(":", 1)
        return int(hour) * 60 + int(minute[:2])
    except (ValueError, TypeError):
        return None


def _shift_hours(shift: ShiftLog) -> float:
    start = _parse_minutes(shift.shift_start)
    end = _parse_minutes(shift.shift_end)
    if start is None or end is None:
        return 0.0
    if end < start:
        end += 24 * 60
    return round(max(end - start, 0) / 60, 2)


def _scheduled_hours(start_time: str, end_time: str) -> float:
    start = _parse_minutes(start_time)
    end = _parse_minutes(end_time)
    if start is None or end is None:
        return 0.0
    if end < start:
        end += 24 * 60
    return round(max(end - start, 0) / 60, 2)


def _scheduled_dict(shift: ScheduledShift) -> dict:
    hours = _scheduled_hours(shift.start_time, shift.end_time)
    return {
        "id": shift.id,
        "staff_name": shift.staff_name,
        "role": shift.role,
        "date": shift.date.isoformat(),
        "start_time": shift.start_time,
        "end_time": shift.end_time,
        "hours": hours,
        "hourly_rate": round(float(shift.hourly_rate or 0), 2),
        "labour_cost": round(hours * float(shift.hourly_rate or 0), 2),
        "status": shift.status,
        "notes": shift.notes,
        "created_at": shift.created_at.isoformat() if shift.created_at else None,
    }


def _role_key(role: Optional[str]) -> str:
    normalized = (role or "").lower()
    for requirement in ROLE_REQUIREMENTS:
        if any(keyword in normalized for keyword in requirement["keywords"]):
            return requirement["key"]
    return "general"


def _role_label(role_key: str) -> str:
    for requirement in ROLE_REQUIREMENTS:
        if requirement["key"] == role_key:
            return requirement["label"]
    return "General Floor"


def _shift_dict(shift: ShiftLog) -> dict:
    role_key = _role_key(shift.role)
    return {
        "id": shift.id,
        "date": shift.date.isoformat(),
        "staff_name": shift.staff_name,
        "role": shift.role,
        "role_key": role_key,
        "role_label": _role_label(role_key),
        "shift_start": shift.shift_start,
        "shift_end": shift.shift_end,
        "hours": _shift_hours(shift),
        "notes": shift.notes,
        "created_at": shift.created_at.isoformat() if shift.created_at else None,
    }


def _leave_days(start_date: date, end_date: date) -> float:
    return float((end_date - start_date).days + 1)


def _date_range_days(start_date: date, end_date: date) -> int:
    return (end_date - start_date).days + 1


def _overlap_days(
    start_date: date,
    end_date: date,
    period_start: date,
    period_end: date,
) -> float:
    overlap_start = max(start_date, period_start)
    overlap_end = min(end_date, period_end)
    if overlap_end < overlap_start:
        return 0.0
    return float(_date_range_days(overlap_start, overlap_end))


def _slug(value: str) -> str:
    return "-".join((value or "staff").strip().lower().split()) or "staff"


def _leave_dict(leave: StaffLeaveRequest) -> dict:
    return {
        "id": leave.id,
        "staff_name": leave.staff_name,
        "leave_type": leave.leave_type,
        "start_date": leave.start_date.isoformat(),
        "end_date": leave.end_date.isoformat(),
        "days": float(leave.days or 0),
        "status": leave.status,
        "reason": leave.reason,
        "created_at": leave.created_at.isoformat() if leave.created_at else None,
    }


@router.post("/")
def log_shift(
    entry: ShiftEntry,
    request: Request,
    db: Session = Depends(get_db),
    session: dict = Depends(require_roles("admin", "staff")),
):
    shift = ShiftLog(
        date=_parse_date(entry.date),
        staff_name=entry.staff_name,
        role=entry.role,
        shift_start=entry.shift_start,
        shift_end=entry.shift_end,
        notes=entry.notes,
    )
    db.add(shift)
    db.commit()
    db.refresh(shift)
    record_operational_audit_event(
        db,
        session=session,
        request=request,
        event_type="employee",
        action="shift_log_create",
        resource_type="shift_log",
        resource_id=shift.id,
        detail=f"Shift logged for {shift.staff_name} on {shift.date.isoformat()}.",
        metadata={
            "staff_name": shift.staff_name,
            "role": shift.role,
            "hours": _shift_hours(shift),
        },
    )
    return {"status": "logged", "shift": _shift_dict(shift), "staff": entry.staff_name}


@router.get("/")
def get_shifts(
    db: Session = Depends(get_db),
    session: dict = Depends(require_roles("admin", "staff")),
):
    del session
    shifts = (
        db.query(ShiftLog)
        .order_by(ShiftLog.date.desc(), ShiftLog.shift_start.asc())
        .limit(100)
        .all()
    )
    return [_shift_dict(shift) for shift in shifts]


@router.post("/leave")
def log_leave(
    entry: LeaveEntry,
    request: Request,
    db: Session = Depends(get_db),
    session: dict = Depends(require_roles("admin", "staff")),
):
    start_date = _parse_date(entry.start_date)
    end_date = _parse_date(entry.end_date or entry.start_date)
    if end_date < start_date:
        raise HTTPException(status_code=422, detail="Leave end date cannot be before start date.")

    leave = StaffLeaveRequest(
        staff_name=entry.staff_name,
        leave_type=entry.leave_type,
        start_date=start_date,
        end_date=end_date,
        days=_leave_days(start_date, end_date),
        status=entry.status,
        reason=entry.reason,
    )
    db.add(leave)
    db.commit()
    db.refresh(leave)
    record_operational_audit_event(
        db,
        session=session,
        request=request,
        event_type="employee",
        action="leave_request_log",
        resource_type="staff_leave_request",
        resource_id=leave.id,
        status=leave.status,
        detail=f"{leave.leave_type} leave logged for {leave.staff_name}.",
        metadata={
            "staff_name": leave.staff_name,
            "leave_type": leave.leave_type,
            "days": float(leave.days or 0),
            "start_date": leave.start_date.isoformat(),
            "end_date": leave.end_date.isoformat(),
        },
    )
    return {"status": "logged", "leave": _leave_dict(leave)}


@router.get("/leave")
def get_leave(
    db: Session = Depends(get_db),
    session: dict = Depends(require_roles("admin", "staff")),
):
    del session
    leaves = (
        db.query(StaffLeaveRequest)
        .order_by(StaffLeaveRequest.start_date.desc(), StaffLeaveRequest.id.desc())
        .limit(100)
        .all()
    )
    return [_leave_dict(leave) for leave in leaves]


@router.patch("/leave/{leave_id}/status")
def update_leave_status(
    leave_id: int,
    payload: LeaveStatusUpdate,
    request: Request,
    db: Session = Depends(get_db),
    session: dict = Depends(require_roles("admin")),
):
    leave = db.query(StaffLeaveRequest).filter(StaffLeaveRequest.id == leave_id).first()
    if leave is None:
        raise HTTPException(status_code=404, detail="Leave request not found.")

    previous_status = leave.status
    leave.status = payload.status
    if payload.reason is not None:
        leave.reason = payload.reason.strip() or leave.reason
    db.commit()
    db.refresh(leave)
    record_operational_audit_event(
        db,
        session=session,
        request=request,
        event_type="employee",
        action="leave_status_update",
        resource_type="staff_leave_request",
        resource_id=leave.id,
        status=leave.status,
        detail=f"{leave.leave_type} leave for {leave.staff_name} moved from {previous_status} to {leave.status}.",
        metadata={
            "staff_name": leave.staff_name,
            "leave_type": leave.leave_type,
            "previous_status": previous_status,
            "new_status": leave.status,
            "days": float(leave.days or 0),
        },
    )
    return {"status": "updated", "leave": _leave_dict(leave)}


@router.get("/attendance-command")
def attendance_command(
    target_date: Optional[str] = Query(None),
    db: Session = Depends(get_db),
    session: dict = Depends(require_roles("admin", "staff")),
):
    del session
    working_date = _parse_date(target_date) if target_date else business_today()
    shifts = (
        db.query(ShiftLog)
        .filter(ShiftLog.date == working_date)
        .order_by(ShiftLog.shift_start.asc(), ShiftLog.id.asc())
        .all()
    )
    active_leaves = (
        db.query(StaffLeaveRequest)
        .filter(
            StaffLeaveRequest.start_date <= working_date,
            StaffLeaveRequest.end_date >= working_date,
            StaffLeaveRequest.status.in_(["planned", "approved"]),
        )
        .order_by(StaffLeaveRequest.staff_name.asc())
        .all()
    )
    recent_leaves = (
        db.query(StaffLeaveRequest)
        .filter(StaffLeaveRequest.status.in_(["planned", "approved"]))
        .order_by(StaffLeaveRequest.start_date.desc(), StaffLeaveRequest.id.desc())
        .limit(80)
        .all()
    )

    present_staff = {_shift.staff_name.strip().lower() for _shift in shifts if _shift.staff_name}
    leave_staff = {leave.staff_name.strip().lower() for leave in active_leaves if leave.staff_name}
    duplicate_staff = sorted(
        staff
        for staff in present_staff.intersection(leave_staff)
        if staff
    )

    role_counts: dict[str, int] = {}
    for shift in shifts:
        role_counts[_role_key(shift.role)] = role_counts.get(_role_key(shift.role), 0) + 1

    coverage = []
    for requirement in ROLE_REQUIREMENTS:
        present = role_counts.get(requirement["key"], 0)
        coverage.append(
            {
                "key": requirement["key"],
                "label": requirement["label"],
                "required": requirement["required"],
                "present": present,
                "missing": max(requirement["required"] - present, 0),
                "status": "pass" if present >= requirement["required"] else "fail",
                "expected_start": requirement["expected_start"],
            }
        )

    attendance_flags = []
    for shift in shifts:
        role_key = _role_key(shift.role)
        requirement = next((item for item in ROLE_REQUIREMENTS if item["key"] == role_key), None)
        expected = _parse_minutes(requirement["expected_start"]) if requirement else None
        actual = _parse_minutes(shift.shift_start)
        hours = _shift_hours(shift)
        if expected is not None and actual is not None and actual > expected + 15:
            attendance_flags.append(
                {
                    "staff_name": shift.staff_name,
                    "type": "late_start",
                    "status": "warn",
                    "detail": f"Started at {shift.shift_start}; expected {requirement['expected_start']}.",
                }
            )
        if hours and hours < 6:
            attendance_flags.append(
                {
                    "staff_name": shift.staff_name,
                    "type": "short_shift",
                    "status": "warn",
                    "detail": f"Logged {hours}h, below the 6h floor.",
                }
            )

    for staff in duplicate_staff:
        attendance_flags.append(
            {
                "staff_name": staff.title(),
                "type": "present_and_on_leave",
                "status": "fail",
                "detail": "Staff appears in both shift roster and active leave for the day.",
            }
        )

    used_by_staff: dict[str, dict[str, float]] = {}
    for leave in recent_leaves:
        if leave.status not in {"planned", "approved"}:
            continue
        staff = leave.staff_name
        used_by_staff.setdefault(staff, {key: 0.0 for key in LEAVE_ALLOWANCES})
        if leave.leave_type in LEAVE_ALLOWANCES:
            used_by_staff[staff][leave.leave_type] += float(leave.days or 0)

    leave_balances = []
    for staff_name in sorted({shift.staff_name for shift in shifts}.union(used_by_staff.keys())):
        used = used_by_staff.get(staff_name, {key: 0.0 for key in LEAVE_ALLOWANCES})
        leave_balances.append(
            {
                "staff_name": staff_name,
                "cl_used": used.get("CL", 0.0),
                "pl_used": used.get("PL", 0.0),
                "sl_used": used.get("SL", 0.0),
                "cl_remaining": max(LEAVE_ALLOWANCES["CL"] - used.get("CL", 0.0), 0),
                "pl_remaining": max(LEAVE_ALLOWANCES["PL"] - used.get("PL", 0.0), 0),
                "sl_remaining": max(LEAVE_ALLOWANCES["SL"] - used.get("SL", 0.0), 0),
            }
        )

    missing_roles = [item["label"] for item in coverage if item["missing"] > 0]
    coverage_score = round(
        100 * sum(1 for item in coverage if item["status"] == "pass") / len(coverage)
    )
    readiness_score = max(
        0,
        min(
            100,
            round(
                coverage_score * 0.65
                + (20 if shifts else 0)
                + (10 if leave_balances else 0)
                - (10 if any(flag["status"] == "fail" for flag in attendance_flags) else 0)
                - min(sum(1 for flag in attendance_flags if flag["status"] == "warn") * 3, 15)
            ),
        ),
    )
    overall = "pass" if readiness_score >= 85 else "warn" if readiness_score >= 55 else "fail"

    return {
        "date": working_date.isoformat(),
        "overall": overall,
        "readiness_score": readiness_score,
        "summary": {
            "present_count": len(present_staff),
            "leave_count": len(active_leaves),
            "role_requirements": len(ROLE_REQUIREMENTS),
            "roles_covered": sum(1 for item in coverage if item["status"] == "pass"),
            "missing_role_count": len(missing_roles),
            "attendance_flag_count": len(attendance_flags),
        },
        "coverage": coverage,
        "missing_roles": missing_roles,
        "shifts": [_shift_dict(shift) for shift in shifts],
        "active_leave": [_leave_dict(leave) for leave in active_leaves],
        "leave_balances": leave_balances,
        "attendance_flags": attendance_flags,
        "next_actions": (
            [f"Assign coverage for {role}." for role in missing_roles]
            + ["Resolve present/on-leave conflicts before payroll."] * bool(duplicate_staff)
            + ["Log staff roster, CL/PL leave and station coverage before opening."] * (not shifts)
        )[:5],
    }


@router.get("/performance")
def shift_performance(
    db: Session = Depends(get_db),
    session: dict = Depends(require_roles("admin", "staff")),
):
    del session
    shifts = db.query(ShiftLog).all()
    if not shifts:
        return []

    shift_dates = {shift.date for shift in shifts}
    sales_rows = db.query(DailySales).filter(DailySales.date.in_(shift_dates)).all()
    sales_by_date = {row.date: float(row.total_sale or 0) for row in sales_rows}

    dates_by_staff: dict[str, set[date]] = {}
    for shift in shifts:
        dates_by_staff.setdefault(shift.staff_name, set()).add(shift.date)

    performance = []
    for staff_name, worked_dates in dates_by_staff.items():
        revenue_values = [sales_by_date.get(worked_date, 0.0) for worked_date in worked_dates]
        avg_revenue = sum(revenue_values) / len(revenue_values) if revenue_values else 0.0
        performance.append({
            "staff_name": staff_name,
            "days_worked": len(worked_dates),
            "avg_revenue_on_shift_days": avg_revenue,
            "best_day_revenue": max(revenue_values) if revenue_values else 0.0,
            "worst_day_revenue": min(revenue_values) if revenue_values else 0.0,
        })

    return sorted(performance, key=lambda row: row["avg_revenue_on_shift_days"], reverse=True)


@router.get("/payroll-preview")
def payroll_preview(
    start_date: Optional[str] = Query(None),
    end_date: Optional[str] = Query(None),
    db: Session = Depends(get_db),
    session: dict = Depends(require_roles("admin")),
):
    del session
    today = business_today()
    period_start = _parse_date(start_date) if start_date else today.replace(day=1)
    period_end = _parse_date(end_date) if end_date else today
    if period_end < period_start:
        raise HTTPException(status_code=422, detail="Payroll end date cannot be before start date.")
    if _date_range_days(period_start, period_end) > 62:
        raise HTTPException(status_code=422, detail="Payroll preview can cover a maximum of 62 days.")

    shifts = (
        db.query(ShiftLog)
        .filter(ShiftLog.date >= period_start, ShiftLog.date <= period_end)
        .order_by(ShiftLog.staff_name.asc(), ShiftLog.date.asc(), ShiftLog.shift_start.asc())
        .all()
    )
    leaves = (
        db.query(StaffLeaveRequest)
        .filter(
            StaffLeaveRequest.end_date >= period_start,
            StaffLeaveRequest.start_date <= period_end,
            StaffLeaveRequest.status.in_(["planned", "approved"]),
        )
        .order_by(StaffLeaveRequest.staff_name.asc(), StaffLeaveRequest.start_date.asc())
        .all()
    )

    rows: dict[str, dict] = {}

    def staff_row(staff_name: str) -> dict:
        clean_name = staff_name.strip() if staff_name and staff_name.strip() else "Unnamed Staff"
        if clean_name not in rows:
            rows[clean_name] = {
                "staff_name": clean_name,
                "staff_key": _slug(clean_name),
                "roles": set(),
                "present_dates": set(),
                "total_hours": 0.0,
                "paid_leave_days": 0.0,
                "lop_days": 0.0,
                "cl_days": 0.0,
                "pl_days": 0.0,
                "sl_days": 0.0,
                "short_shift_count": 0,
                "late_start_count": 0,
                "present_leave_conflict_count": 0,
            }
        return rows[clean_name]

    leave_dates_by_staff: dict[str, set[date]] = {}
    for leave in leaves:
        row = staff_row(leave.staff_name)
        leave_days = _overlap_days(leave.start_date, leave.end_date, period_start, period_end)
        leave_type = (leave.leave_type or "").upper()
        if leave_type == "CL":
            row["cl_days"] += leave_days
            row["paid_leave_days"] += leave_days
        elif leave_type == "PL":
            row["pl_days"] += leave_days
            row["paid_leave_days"] += leave_days
        elif leave_type == "SL":
            row["sl_days"] += leave_days
            row["paid_leave_days"] += leave_days
        elif leave_type == "LOP":
            row["lop_days"] += leave_days

        active_dates = leave_dates_by_staff.setdefault(row["staff_name"], set())
        start = max(leave.start_date, period_start)
        end = min(leave.end_date, period_end)
        for offset in range(_date_range_days(start, end)):
            active_dates.add(start + timedelta(days=offset))

    for shift in shifts:
        row = staff_row(shift.staff_name)
        role_key = _role_key(shift.role)
        row["roles"].add(_role_label(role_key))
        row["present_dates"].add(shift.date)
        hours = _shift_hours(shift)
        row["total_hours"] += hours
        if hours and hours < 6:
            row["short_shift_count"] += 1

        requirement = next((item for item in ROLE_REQUIREMENTS if item["key"] == role_key), None)
        expected = _parse_minutes(requirement["expected_start"]) if requirement else None
        actual = _parse_minutes(shift.shift_start)
        if expected is not None and actual is not None and actual > expected + 15:
            row["late_start_count"] += 1

        if shift.date in leave_dates_by_staff.get(row["staff_name"], set()):
            row["present_leave_conflict_count"] += 1

    staff_rows = []
    for row in rows.values():
        present_days = float(len(row["present_dates"]))
        payable_days = present_days + row["paid_leave_days"]
        exception_count = (
            row["short_shift_count"]
            + row["late_start_count"]
            + row["present_leave_conflict_count"]
            + (1 if row["lop_days"] else 0)
        )
        staff_rows.append(
            {
                "staff_name": row["staff_name"],
                "staff_key": row["staff_key"],
                "roles": sorted(row["roles"]),
                "present_days": present_days,
                "total_hours": round(row["total_hours"], 2),
                "paid_leave_days": round(row["paid_leave_days"], 2),
                "lop_days": round(row["lop_days"], 2),
                "cl_days": round(row["cl_days"], 2),
                "pl_days": round(row["pl_days"], 2),
                "sl_days": round(row["sl_days"], 2),
                "payable_days": round(payable_days, 2),
                "unpaid_days": round(row["lop_days"], 2),
                "short_shift_count": row["short_shift_count"],
                "late_start_count": row["late_start_count"],
                "present_leave_conflict_count": row["present_leave_conflict_count"],
                "exception_count": exception_count,
            }
        )

    staff_rows.sort(
        key=lambda item: (
            -item["exception_count"],
            item["staff_name"].lower(),
        )
    )
    exception_count = sum(row["exception_count"] for row in staff_rows)
    summary = {
        "staff_count": len(staff_rows),
        "total_present_days": round(sum(row["present_days"] for row in staff_rows), 2),
        "total_paid_leave_days": round(sum(row["paid_leave_days"] for row in staff_rows), 2),
        "total_lop_days": round(sum(row["lop_days"] for row in staff_rows), 2),
        "total_payable_days": round(sum(row["payable_days"] for row in staff_rows), 2),
        "total_hours": round(sum(row["total_hours"] for row in staff_rows), 2),
        "exception_count": exception_count,
    }
    next_actions = []
    if not staff_rows:
        next_actions.append("Log shifts and CL/PL leave before running salary settlement.")
    if summary["total_lop_days"]:
        next_actions.append("Review unpaid LOP days before payroll approval.")
    if any(row["present_leave_conflict_count"] for row in staff_rows):
        next_actions.append("Resolve staff marked present and on leave for the same day.")
    if any(row["short_shift_count"] or row["late_start_count"] for row in staff_rows):
        next_actions.append("Confirm short shifts and late starts with the floor manager.")
    if not next_actions:
        next_actions.append("Payroll preview is ready for owner review.")

    return {
        "start_date": period_start.isoformat(),
        "end_date": period_end.isoformat(),
        "summary": summary,
        "staff": staff_rows,
        "next_actions": next_actions[:5],
    }


@router.get("/by-date/{target_date}")
def shifts_by_date(
    target_date: str,
    db: Session = Depends(get_db),
    session: dict = Depends(require_roles("admin", "staff")),
):
    del session
    parsed_date = _parse_date(target_date)
    shifts = (
        db.query(ShiftLog)
        .filter(ShiftLog.date == parsed_date)
        .order_by(ShiftLog.shift_start.asc())
        .all()
    )
    sales = db.query(DailySales).filter(DailySales.date == parsed_date).first()
    active_leaves = (
        db.query(StaffLeaveRequest)
        .filter(
            StaffLeaveRequest.start_date <= parsed_date,
            StaffLeaveRequest.end_date >= parsed_date,
            StaffLeaveRequest.status.in_(["planned", "approved"]),
        )
        .all()
    )
    return {
        "date": parsed_date.isoformat(),
        "staff": [_shift_dict(shift) for shift in shifts],
        "leave": [_leave_dict(leave) for leave in active_leaves],
        "total_sale": float(sales.total_sale) if sales else 0,
        "profit": float(sales.profit) if sales else 0
    }


class ScheduledShiftCreate(BaseModel):
    staff_name: str
    role: Optional[str] = None
    date: date
    start_time: str
    end_time: str
    hourly_rate: float = 0
    status: Literal["scheduled", "confirmed", "cancelled"] = "scheduled"
    notes: Optional[str] = None


class ScheduledShiftUpdate(BaseModel):
    staff_name: Optional[str] = None
    role: Optional[str] = None
    date: Optional[date] = None
    start_time: Optional[str] = None
    end_time: Optional[str] = None
    hourly_rate: Optional[float] = None
    status: Optional[Literal["scheduled", "confirmed", "cancelled"]] = None
    notes: Optional[str] = None


def _validate_shift_times(start_time: str, end_time: str) -> None:
    if _parse_minutes(start_time) is None or _parse_minutes(end_time) is None:
        raise HTTPException(status_code=422, detail="Use HH:MM for shift times.")
    if _parse_minutes(start_time) == _parse_minutes(end_time):
        raise HTTPException(status_code=422, detail="Shift start and end must differ.")


def _scheduled_range(
    db: Session, start_date: date, end_date: date, include_cancelled: bool = False
) -> list[ScheduledShift]:
    query = db.query(ScheduledShift).filter(
        ScheduledShift.date >= start_date,
        ScheduledShift.date <= end_date,
    )
    if not include_cancelled:
        query = query.filter(ScheduledShift.status != "cancelled")
    return query.order_by(ScheduledShift.date.asc(), ScheduledShift.start_time.asc()).all()


@router.get("/schedule")
def get_schedule(
    start_date: Optional[date] = None,
    end_date: Optional[date] = None,
    db: Session = Depends(get_db),
    _: dict = Depends(require_roles("admin")),
):
    if start_date is None:
        today = business_today()
        start_date = today - timedelta(days=today.weekday())
    if end_date is None:
        end_date = start_date + timedelta(days=6)
    if end_date < start_date:
        raise HTTPException(status_code=422, detail="End date must be on or after start.")
    shifts = _scheduled_range(db, start_date, end_date, include_cancelled=True)
    rows = [_scheduled_dict(shift) for shift in shifts]
    active = [row for row in rows if row["status"] != "cancelled"]
    return {
        "start_date": start_date.isoformat(),
        "end_date": end_date.isoformat(),
        "shifts": rows,
        "summary": {
            "shift_count": len(active),
            "hours": round(sum(row["hours"] for row in active), 2),
            "labour_cost": round(sum(row["labour_cost"] for row in active), 2),
        },
    }


@router.post("/schedule")
def create_scheduled_shift(
    payload: ScheduledShiftCreate,
    db: Session = Depends(get_db),
    _: dict = Depends(require_roles("admin")),
):
    _validate_shift_times(payload.start_time, payload.end_time)
    if not payload.staff_name.strip():
        raise HTTPException(status_code=422, detail="Staff name is required.")
    shift = ScheduledShift(
        staff_name=payload.staff_name.strip(),
        role=(payload.role or "").strip() or None,
        date=payload.date,
        start_time=payload.start_time,
        end_time=payload.end_time,
        hourly_rate=max(float(payload.hourly_rate or 0), 0),
        status=payload.status,
        notes=(payload.notes or "").strip() or None,
    )
    db.add(shift)
    db.commit()
    db.refresh(shift)
    return _scheduled_dict(shift)


@router.patch("/schedule/{shift_id}")
def update_scheduled_shift(
    shift_id: int,
    payload: ScheduledShiftUpdate,
    db: Session = Depends(get_db),
    _: dict = Depends(require_roles("admin")),
):
    shift = db.query(ScheduledShift).filter(ScheduledShift.id == shift_id).first()
    if shift is None:
        raise HTTPException(status_code=404, detail="Scheduled shift not found.")
    start_time = payload.start_time if payload.start_time is not None else shift.start_time
    end_time = payload.end_time if payload.end_time is not None else shift.end_time
    _validate_shift_times(start_time, end_time)
    if payload.staff_name is not None:
        shift.staff_name = payload.staff_name.strip()
    if payload.role is not None:
        shift.role = payload.role.strip() or None
    if payload.date is not None:
        shift.date = payload.date
    shift.start_time = start_time
    shift.end_time = end_time
    if payload.hourly_rate is not None:
        shift.hourly_rate = max(float(payload.hourly_rate), 0)
    if payload.status is not None:
        shift.status = payload.status
    if payload.notes is not None:
        shift.notes = payload.notes.strip() or None
    db.commit()
    db.refresh(shift)
    return _scheduled_dict(shift)


@router.delete("/schedule/{shift_id}")
def delete_scheduled_shift(
    shift_id: int,
    db: Session = Depends(get_db),
    _: dict = Depends(require_roles("admin")),
):
    shift = db.query(ScheduledShift).filter(ScheduledShift.id == shift_id).first()
    if shift is None:
        raise HTTPException(status_code=404, detail="Scheduled shift not found.")
    db.delete(shift)
    db.commit()
    return {"status": "deleted", "id": shift_id}


@router.get("/labour-summary")
def labour_summary(
    start_date: Optional[date] = None,
    end_date: Optional[date] = None,
    db: Session = Depends(get_db),
    _: dict = Depends(require_roles("admin")),
):
    if start_date is None:
        today = business_today()
        start_date = today - timedelta(days=today.weekday())
    if end_date is None:
        end_date = start_date + timedelta(days=6)
    if end_date < start_date:
        raise HTTPException(status_code=422, detail="End date must be on or after start.")
    shifts = _scheduled_range(db, start_date, end_date)
    sales_rows = (
        db.query(RestaurantOrder.date, func.coalesce(func.sum(RestaurantOrder.total_amount), 0.0))
        .filter(
            RestaurantOrder.date >= start_date,
            RestaurantOrder.date <= end_date,
            RestaurantOrder.status != "cancelled",
        )
        .group_by(RestaurantOrder.date)
        .all()
    )
    sales_by_date = {row[0]: round(float(row[1] or 0), 2) for row in sales_rows}

    days: dict[date, dict] = {}
    for shift in shifts:
        row = days.setdefault(
            shift.date,
            {
                "date": shift.date.isoformat(),
                "scheduled_hours": 0.0,
                "labour_cost": 0.0,
                "sales": sales_by_date.get(shift.date, 0.0),
            },
        )
        row["scheduled_hours"] = round(
            row["scheduled_hours"] + _scheduled_hours(shift.start_time, shift.end_time), 2
        )
        row["labour_cost"] = round(
            row["labour_cost"]
            + _scheduled_hours(shift.start_time, shift.end_time)
            * float(shift.hourly_rate or 0),
            2,
        )
    for sale_date, sales in sales_by_date.items():
        if sale_date not in days:
            days[sale_date] = {
                "date": sale_date.isoformat(),
                "scheduled_hours": 0.0,
                "labour_cost": 0.0,
                "sales": sales,
            }
    day_rows = []
    for row in sorted(days.values(), key=lambda item: item["date"]):
        row["labour_percent"] = (
            round((row["labour_cost"] / row["sales"]) * 100, 1) if row["sales"] else 0.0
        )
        day_rows.append(row)

    total_hours = round(sum(row["hours"] for row in [_scheduled_dict(s) for s in shifts]), 2)
    total_cost = round(
        sum(
            _scheduled_hours(shift.start_time, shift.end_time)
            * float(shift.hourly_rate or 0)
            for shift in shifts
        ),
        2,
    )
    total_sales = round(sum(row["sales"] for row in day_rows), 2)
    roles: dict[str, dict] = {}
    for shift in shifts:
        key = _role_key(shift.role)
        bucket = roles.setdefault(
            key, {"role": _role_label(key), "hours": 0.0, "labour_cost": 0.0}
        )
        hours = _scheduled_hours(shift.start_time, shift.end_time)
        bucket["hours"] = round(bucket["hours"] + hours, 2)
        bucket["labour_cost"] = round(
            bucket["labour_cost"] + hours * float(shift.hourly_rate or 0), 2
        )
    return {
        "start_date": start_date.isoformat(),
        "end_date": end_date.isoformat(),
        "totals": {
            "scheduled_hours": total_hours,
            "labour_cost": total_cost,
            "sales": total_sales,
            "labour_percent": round((total_cost / total_sales) * 100, 1)
            if total_sales
            else 0.0,
            "shift_count": len(shifts),
        },
        "days": day_rows,
        "roles": sorted(roles.values(), key=lambda item: item["role"]),
    }
