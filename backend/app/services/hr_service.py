"""Local HR employee mirror for the People & HR department.

This is deliberately a mirror, not a second payroll system. It holds the fields
the portal needs to show a directory and will carry the external HRMS id when the
Euron pilot is connected.
"""

from datetime import date

from sqlalchemy import or_
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.models.domain import HREmployee, StaffCredential, Store

EMPLOYMENT_TYPES = {"full_time", "part_time", "contract", "intern"}
STATUSES = {"active", "onboarding", "notice", "exited"}


def _clean_email(value: str | None) -> str | None:
    email = (value or "").strip().lower()
    return email or None


def serialize_employee(employee: HREmployee) -> dict:
    return {
        "id": employee.id,
        "employee_code": employee.employee_code,
        "full_name": employee.full_name,
        "email": employee.email,
        "phone": employee.phone,
        "designation": employee.designation,
        "employment_type": employee.employment_type,
        "status": employee.status,
        "joining_date": employee.joining_date.isoformat()
        if employee.joining_date
        else None,
        "store_id": employee.store_id,
        "store_name": employee.store.name if employee.store else None,
        "staff_id": employee.staff_id,
        "reports_to": employee.reports_to,
        "notes": employee.notes,
        "external_system": employee.external_system,
        "external_id": employee.external_id,
        "created_at": employee.created_at.isoformat()
        if employee.created_at
        else None,
        "updated_at": employee.updated_at.isoformat()
        if employee.updated_at
        else None,
    }


def list_employees(
    db: Session,
    q: str = "",
    status: str = "",
    employment_type: str = "",
    store_id: int | None = None,
) -> list[HREmployee]:
    query = db.query(HREmployee)
    if status:
        query = query.filter(HREmployee.status == status)
    if employment_type:
        query = query.filter(HREmployee.employment_type == employment_type)
    if store_id:
        query = query.filter(HREmployee.store_id == store_id)
    term = q.strip()
    if term:
        like = f"%{term}%"
        query = query.filter(
            or_(
                HREmployee.full_name.ilike(like),
                HREmployee.employee_code.ilike(like),
                HREmployee.email.ilike(like),
                HREmployee.designation.ilike(like),
            )
        )
    return query.order_by(HREmployee.full_name.asc(), HREmployee.id.asc()).all()


def employee_summary(db: Session) -> dict:
    rows = db.query(HREmployee).all()
    by_status: dict[str, int] = {}
    by_type: dict[str, int] = {}
    for row in rows:
        by_status[row.status] = by_status.get(row.status, 0) + 1
        by_type[row.employment_type] = by_type.get(row.employment_type, 0) + 1
    active = sum(
        amount
        for status, amount in by_status.items()
        if status in {"active", "onboarding", "notice"}
    )
    return {
        "total": len(rows),
        "active": active,
        "onboarding": by_status.get("onboarding", 0),
        "notice": by_status.get("notice", 0),
        "exited": by_status.get("exited", 0),
        "by_status": by_status,
        "by_employment_type": by_type,
        "linked_pos_staff": sum(1 for row in rows if row.staff_id),
    }


def _validate_store(db: Session, store_id: int | None) -> None:
    if store_id is None:
        return
    if db.query(Store).filter(Store.id == store_id).first() is None:
        raise ValueError("Selected store does not exist.")


def _validate_staff(db: Session, staff_id: str | None, current_id: int | None = None) -> None:
    if not staff_id:
        return
    staff = (
        db.query(StaffCredential)
        .filter(StaffCredential.staff_id == staff_id)
        .first()
    )
    if staff is None:
        raise ValueError(f"POS staff credential '{staff_id}' does not exist.")
    existing = (
        db.query(HREmployee)
        .filter(HREmployee.staff_id == staff_id)
        .first()
    )
    if existing is not None and existing.id != current_id:
        raise ValueError("That POS staff credential is already linked to another employee.")


def _next_code(db: Session) -> str:
    number = 1001
    while (
        db.query(HREmployee)
        .filter(HREmployee.employee_code == f"EMP-{number}")
        .first()
        is not None
    ):
        number += 1
    return f"EMP-{number}"


def _parse_date(value) -> date | None:
    if value in (None, ""):
        return None
    if isinstance(value, date):
        return value
    try:
        return date.fromisoformat(str(value)[:10])
    except ValueError as exc:
        raise ValueError("Joining date must be YYYY-MM-DD.") from exc


def create_employee(db: Session, payload: dict) -> HREmployee:
    full_name = str(payload.get("full_name") or "").strip()
    if not full_name:
        raise ValueError("Full name is required.")
    employment_type = str(payload.get("employment_type") or "full_time").strip()
    if employment_type not in EMPLOYMENT_TYPES:
        raise ValueError("Unknown employment type.")
    status = str(payload.get("status") or "active").strip()
    if status not in STATUSES:
        raise ValueError("Unknown employee status.")
    code = str(payload.get("employee_code") or "").strip().upper() or _next_code(db)
    if (
        db.query(HREmployee)
        .filter(HREmployee.employee_code == code)
        .first()
        is not None
    ):
        raise ValueError(f"Employee code '{code}' is already in use.")
    email = _clean_email(payload.get("email"))
    if email and (
        db.query(HREmployee).filter(HREmployee.email == email).first() is not None
    ):
        raise ValueError(f"Email '{email}' is already in use.")
    store_id = payload.get("store_id")
    store_id = int(store_id) if store_id not in (None, "") else None
    _validate_store(db, store_id)
    staff_id = (str(payload.get("staff_id") or "").strip() or None)
    _validate_staff(db, staff_id)

    employee = HREmployee(
        employee_code=code[:40],
        full_name=full_name[:160],
        email=email,
        phone=(str(payload.get("phone") or "").strip() or None),
        designation=(str(payload.get("designation") or "").strip() or None),
        employment_type=employment_type,
        status=status,
        joining_date=_parse_date(payload.get("joining_date")),
        store_id=store_id,
        staff_id=staff_id,
        reports_to=(str(payload.get("reports_to") or "").strip() or None),
        notes=(str(payload.get("notes") or "").strip() or None),
        external_system=(str(payload.get("external_system") or "").strip() or None),
        external_id=(str(payload.get("external_id") or "").strip() or None),
    )
    db.add(employee)
    try:
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise ValueError("Employee code, email or staff link is already in use.") from exc
    db.refresh(employee)
    return employee


def update_employee(db: Session, employee: HREmployee, payload: dict) -> HREmployee:
    if payload.get("full_name") is not None:
        name = str(payload["full_name"]).strip()
        if not name:
            raise ValueError("Full name cannot be empty.")
        employee.full_name = name[:160]
    if payload.get("employee_code") is not None:
        code = str(payload["employee_code"]).strip().upper()
        if not code:
            raise ValueError("Employee code cannot be empty.")
        clash = (
            db.query(HREmployee)
            .filter(
                HREmployee.employee_code == code,
                HREmployee.id != employee.id,
            )
            .first()
        )
        if clash is not None:
            raise ValueError(f"Employee code '{code}' is already in use.")
        employee.employee_code = code[:40]
    if payload.get("email") is not None:
        email = _clean_email(payload["email"])
        if email and (
            db.query(HREmployee)
            .filter(HREmployee.email == email, HREmployee.id != employee.id)
            .first()
            is not None
        ):
            raise ValueError(f"Email '{email}' is already in use.")
        employee.email = email
    if payload.get("phone") is not None:
        employee.phone = str(payload["phone"]).strip() or None
    if payload.get("designation") is not None:
        employee.designation = str(payload["designation"]).strip() or None
    if payload.get("employment_type") is not None:
        employment_type = str(payload["employment_type"]).strip()
        if employment_type not in EMPLOYMENT_TYPES:
            raise ValueError("Unknown employment type.")
        employee.employment_type = employment_type
    if payload.get("status") is not None:
        status = str(payload["status"]).strip()
        if status not in STATUSES:
            raise ValueError("Unknown employee status.")
        employee.status = status
    if payload.get("joining_date") is not None:
        employee.joining_date = _parse_date(payload["joining_date"])
    if payload.get("store_id") is not None:
        store_id = payload["store_id"]
        store_id = int(store_id) if store_id not in (None, "") else None
        _validate_store(db, store_id)
        employee.store_id = store_id
    if payload.get("staff_id") is not None:
        staff_id = str(payload["staff_id"]).strip() or None
        _validate_staff(db, staff_id, current_id=employee.id)
        employee.staff_id = staff_id
    if payload.get("reports_to") is not None:
        employee.reports_to = str(payload["reports_to"]).strip() or None
    if payload.get("notes") is not None:
        employee.notes = str(payload["notes"]).strip() or None
    if payload.get("external_system") is not None:
        employee.external_system = str(payload["external_system"]).strip() or None
    if payload.get("external_id") is not None:
        employee.external_id = str(payload["external_id"]).strip() or None
    try:
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise ValueError("Employee code, email or staff link is already in use.") from exc
    db.refresh(employee)
    return employee
