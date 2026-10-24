"""HR attendance: daily records, clock-in/out, leave-aware roster and regularisation."""

from datetime import date, datetime

from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.clock import business_today
from app.models.domain import HRAttendance, HREmployee, HRLeaveRequest, Store

VALID_STATUSES = {"present", "remote", "half_day", "leave", "absent", "holiday"}


def serialize(row: HRAttendance) -> dict:
    return {
        "id": row.id,
        "employee_id": row.employee_id,
        "date": row.date.isoformat(),
        "status": row.status,
        "check_in_at": row.check_in_at.isoformat() if row.check_in_at else None,
        "check_out_at": row.check_out_at.isoformat() if row.check_out_at else None,
        "worked_minutes": row.worked_minutes,
        "source": row.source,
        "note": row.note,
    }


def _parse_day(value: str | None) -> date:
    if not value:
        return business_today()
    try:
        return date.fromisoformat(str(value)[:10])
    except ValueError as exc:
        raise ValueError("Date must be YYYY-MM-DD.") from exc


def _parse_datetime(value) -> datetime | None:
    if value in (None, ""):
        return None
    if isinstance(value, datetime):
        return value
    text = str(value).strip()
    if not text:
        return None
    try:
        parsed = datetime.fromisoformat(text.replace("Z", "+00:00"))
    except ValueError as exc:
        raise ValueError("Times must be ISO date-time values.") from exc
    return parsed.replace(tzinfo=None)


def _approved_leave_employee_ids(db: Session, day: date) -> set[int]:
    rows = (
        db.query(HRLeaveRequest)
        .filter(
            HRLeaveRequest.status == "approved",
            HRLeaveRequest.start_date <= day,
            HRLeaveRequest.end_date >= day,
        )
        .all()
    )
    return {row.employee_id for row in rows}


def day_roster(db: Session, day_param: str | None, store_id: int | None = None) -> dict:
    day = _parse_day(day_param)
    employees = (
        db.query(HREmployee)
        .filter(HREmployee.status != "exited")
        .order_by(HREmployee.full_name.asc())
        .all()
    )
    if store_id:
        employees = [row for row in employees if row.store_id == store_id]
    records = {
        row.employee_id: row
        for row in db.query(HRAttendance).filter(HRAttendance.date == day).all()
    }
    on_leave = _approved_leave_employee_ids(db, day)
    rows = []
    for employee in employees:
        record = records.get(employee.id)
        if employee.id in on_leave and (
            record is None or record.status in {"absent", "leave", "holiday"}
        ):
            status = "on_leave"
        elif record is not None:
            status = record.status
        else:
            status = "not_marked"
        rows.append(
            {
                "employee_id": employee.id,
                "employee_code": employee.employee_code,
                "full_name": employee.full_name,
                "designation": employee.designation,
                "store_id": employee.store_id,
                "store_name": employee.store.name if employee.store else None,
                "status": status,
                "check_in_at": record.check_in_at.isoformat()
                if record and record.check_in_at
                else None,
                "check_out_at": record.check_out_at.isoformat()
                if record and record.check_out_at
                else None,
                "worked_minutes": record.worked_minutes if record else 0,
                "note": record.note if record else None,
                "record_id": record.id if record else None,
            }
        )
    present_statuses = {"present", "remote", "half_day"}
    statuses = [row["status"] for row in rows]
    return {
        "date": day.isoformat(),
        "rows": rows,
        "summary": {
            "total": len(rows),
            "present": sum(1 for status in statuses if status in present_statuses),
            "on_leave": sum(1 for status in statuses if status in {"on_leave", "leave"}),
            "absent": statuses.count("absent"),
            "not_marked": statuses.count("not_marked"),
            "total_hours": round(
                sum(row["worked_minutes"] for row in rows) / 60, 2
            ),
        },
    }


def _employee(db: Session, employee_id: int) -> HREmployee:
    employee = (
        db.query(HREmployee).filter(HREmployee.id == int(employee_id)).first()
    )
    if employee is None:
        raise ValueError("Employee not found.")
    if employee.status == "exited":
        raise ValueError("Exited employees cannot clock attendance.")
    return employee


def clock_in(db: Session, employee_id: int, note: str | None = None) -> HRAttendance:
    employee = _employee(db, employee_id)
    day = business_today()
    if employee.id in _approved_leave_employee_ids(db, day):
        raise ValueError("Employee is on approved leave today.")
    record = (
        db.query(HRAttendance)
        .filter(HRAttendance.employee_id == employee.id, HRAttendance.date == day)
        .first()
    )
    if record is not None and record.check_in_at is not None:
        raise ValueError("Employee has already clocked in today.")
    if record is None:
        record = HRAttendance(
            employee_id=employee.id,
            date=day,
            status="present",
            source="kiosk",
        )
        db.add(record)
    record.check_in_at = datetime.utcnow()
    record.status = "present"
    record.note = (note or "").strip() or record.note
    try:
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise ValueError("Attendance for today already exists.") from exc
    db.refresh(record)
    return record


def clock_out(db: Session, employee_id: int, note: str | None = None) -> HRAttendance:
    employee = _employee(db, employee_id)
    day = business_today()
    record = (
        db.query(HRAttendance)
        .filter(HRAttendance.employee_id == employee.id, HRAttendance.date == day)
        .first()
    )
    if record is None or record.check_in_at is None:
        raise ValueError("Clock in before clocking out.")
    if record.check_out_at is not None:
        raise ValueError("Employee has already clocked out today.")
    record.check_out_at = datetime.utcnow()
    record.worked_minutes = max(
        0, int((record.check_out_at - record.check_in_at).total_seconds() // 60)
    )
    if 0 < record.worked_minutes < 240:
        record.status = "half_day"
    record.note = (note or "").strip() or record.note
    db.commit()
    db.refresh(record)
    return record


def regularize(
    db: Session, employee_id: int, payload: dict
) -> HRAttendance:
    employee = _employee(db, employee_id)
    day = _parse_day(payload.get("date"))
    status = str(payload.get("status") or "present").strip()
    if status not in VALID_STATUSES:
        raise ValueError("Unknown attendance status.")
    check_in = _parse_datetime(payload.get("check_in_at"))
    check_out = _parse_datetime(payload.get("check_out_at"))
    if status in {"absent", "leave", "holiday"}:
        check_in = None
        check_out = None
    if check_in and check_out and check_out <= check_in:
        raise ValueError("Check-out must be after check-in.")
    record = (
        db.query(HRAttendance)
        .filter(HRAttendance.employee_id == employee.id, HRAttendance.date == day)
        .first()
    )
    if record is None:
        record = HRAttendance(
            employee_id=employee.id, date=day, source="hr-regularized"
        )
        db.add(record)
    record.status = status
    record.check_in_at = check_in
    record.check_out_at = check_out
    record.worked_minutes = (
        max(0, int((check_out - check_in).total_seconds() // 60))
        if check_in and check_out
        else 0
    )
    record.source = "hr-regularized"
    if payload.get("note") is not None:
        record.note = str(payload["note"]).strip() or None
    try:
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise ValueError("Attendance for that day already exists.") from exc
    db.refresh(record)
    return record


def history(
    db: Session, employee_id: int, month: str | None = None
) -> list[dict]:
    employee = _employee(db, employee_id)
    wanted = month or business_today().isoformat()[:7]
    rows = (
        db.query(HRAttendance)
        .filter(
            HRAttendance.employee_id == employee.id,
            HRAttendance.date >= date.fromisoformat(f"{wanted}-01"),
        )
        .order_by(HRAttendance.date.desc())
        .all()
    )
    return [serialize(row) for row in rows]


def store_catalog(db: Session) -> list[dict]:
    return [
        {"id": row.id, "name": row.name}
        for row in db.query(Store).filter(Store.is_active.is_(True)).all()
    ]
