from datetime import date
from typing import Literal, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.api.deps import get_db
from app.models.domain import DailySales, ShiftLog, StaffLeaveRequest

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
def log_shift(entry: ShiftEntry, db: Session = Depends(get_db)):
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
    return {"status": "logged", "shift": _shift_dict(shift), "staff": entry.staff_name}


@router.get("/")
def get_shifts(db: Session = Depends(get_db)):
    shifts = (
        db.query(ShiftLog)
        .order_by(ShiftLog.date.desc(), ShiftLog.shift_start.asc())
        .limit(100)
        .all()
    )
    return [_shift_dict(shift) for shift in shifts]


@router.post("/leave")
def log_leave(entry: LeaveEntry, db: Session = Depends(get_db)):
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
    return {"status": "logged", "leave": _leave_dict(leave)}


@router.get("/leave")
def get_leave(db: Session = Depends(get_db)):
    leaves = (
        db.query(StaffLeaveRequest)
        .order_by(StaffLeaveRequest.start_date.desc(), StaffLeaveRequest.id.desc())
        .limit(100)
        .all()
    )
    return [_leave_dict(leave) for leave in leaves]


@router.get("/attendance-command")
def attendance_command(
    target_date: Optional[str] = Query(None),
    db: Session = Depends(get_db),
):
    working_date = _parse_date(target_date) if target_date else date.today()
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
def shift_performance(db: Session = Depends(get_db)):
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


@router.get("/by-date/{target_date}")
def shifts_by_date(target_date: str, db: Session = Depends(get_db)):
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
