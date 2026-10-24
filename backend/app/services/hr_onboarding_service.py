"""HR onboarding: candidate pipeline, checklist and conversion to an employee."""

from datetime import date, datetime

from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.models.domain import (
    HREmployee,
    HROnboardingCandidate,
    HROnboardingTask,
    Store,
)
from app.services.hr_service import EMPLOYMENT_TYPES

CANDIDATE_STATUSES = {
    "documents_pending",
    "verification",
    "ready",
    "joined",
    "withdrawn",
}
TASK_STATUSES = {"pending", "done"}
DEFAULT_TASKS = [
    ("Photo ID proof collected", "documents"),
    ("Address proof collected", "documents"),
    ("Bank details verified", "bank"),
    ("Offer letter signed", "contract"),
    ("Emergency contact recorded", "profile"),
    ("Orientation scheduled", "orientation"),
]


def _clean_email(value: str | None) -> str | None:
    email = (value or "").strip().lower()
    return email or None


def _parse_date(value) -> date | None:
    if value in (None, ""):
        return None
    if isinstance(value, date):
        return value
    try:
        return date.fromisoformat(str(value)[:10])
    except ValueError as exc:
        raise ValueError("Date must be YYYY-MM-DD.") from exc


def serialize_task(row: HROnboardingTask) -> dict:
    return {
        "id": row.id,
        "title": row.title,
        "category": row.category,
        "status": row.status,
        "due_date": row.due_date.isoformat() if row.due_date else None,
        "notes": row.notes,
        "completed_at": row.completed_at.isoformat() if row.completed_at else None,
    }


def serialize_candidate(row: HROnboardingCandidate) -> dict:
    tasks = sorted(row.tasks, key=lambda task: (task.sort_order, task.id))
    done = sum(1 for task in tasks if task.status == "done")
    return {
        "id": row.id,
        "candidate_code": row.candidate_code,
        "full_name": row.full_name,
        "email": row.email,
        "phone": row.phone,
        "designation": row.designation,
        "employment_type": row.employment_type,
        "store_id": row.store_id,
        "store_name": row.store.name if row.store else None,
        "expected_joining_date": row.expected_joining_date.isoformat()
        if row.expected_joining_date
        else None,
        "status": row.status,
        "source": row.source,
        "notes": row.notes,
        "employee_id": row.employee_id,
        "task_count": len(tasks),
        "done_count": done,
        "progress": round((done / len(tasks)) * 100) if tasks else 0,
        "tasks": [serialize_task(task) for task in tasks],
        "created_at": row.created_at.isoformat() if row.created_at else None,
    }


def _validate_common(db: Session, payload: dict, current_id: int | None = None) -> None:
    employment_type = str(payload.get("employment_type") or "full_time")
    if employment_type not in EMPLOYMENT_TYPES:
        raise ValueError("Unknown employment type.")
    store_id = payload.get("store_id")
    store_id = int(store_id) if store_id not in (None, "") else None
    if store_id is not None and db.query(Store).filter(Store.id == store_id).first() is None:
        raise ValueError("Selected store does not exist.")
    email = _clean_email(payload.get("email"))
    if email:
        candidate = (
            db.query(HROnboardingCandidate)
            .filter(
                HROnboardingCandidate.email == email,
                HROnboardingCandidate.id != current_id,
            )
            .first()
        )
        if candidate is not None:
            raise ValueError("That candidate email is already in onboarding.")
        employee = db.query(HREmployee).filter(HREmployee.email == email).first()
        if employee is not None:
            raise ValueError("That email already belongs to an employee.")


def _next_code(db: Session) -> str:
    number = 1001
    while (
        db.query(HROnboardingCandidate)
        .filter(HROnboardingCandidate.candidate_code == f"CAND-{number}")
        .first()
        is not None
    ):
        number += 1
    return f"CAND-{number}"


def create_candidate(db: Session, payload: dict) -> HROnboardingCandidate:
    name = str(payload.get("full_name") or "").strip()
    if not name:
        raise ValueError("Candidate name is required.")
    _validate_common(db, payload)
    code = str(payload.get("candidate_code") or "").strip().upper() or _next_code(db)
    if (
        db.query(HROnboardingCandidate)
        .filter(HROnboardingCandidate.candidate_code == code)
        .first()
        is not None
    ):
        raise ValueError(f"Candidate code '{code}' is already in use.")
    status = str(payload.get("status") or "documents_pending")
    if status not in CANDIDATE_STATUSES:
        raise ValueError("Unknown onboarding status.")
    candidate = HROnboardingCandidate(
        candidate_code=code[:40],
        full_name=name[:160],
        email=_clean_email(payload.get("email")),
        phone=(str(payload.get("phone") or "").strip() or None),
        designation=(str(payload.get("designation") or "").strip() or None),
        employment_type=str(payload.get("employment_type") or "full_time"),
        store_id=int(payload["store_id"])
        if payload.get("store_id") not in (None, "")
        else None,
        expected_joining_date=_parse_date(payload.get("expected_joining_date")),
        status=status,
        source=(str(payload.get("source") or "").strip() or None),
        notes=(str(payload.get("notes") or "").strip() or None),
    )
    db.add(candidate)
    db.flush()
    for index, (title, category) in enumerate(DEFAULT_TASKS, start=1):
        db.add(
            HROnboardingTask(
                candidate_id=candidate.id,
                title=title,
                category=category,
                sort_order=index * 10,
            )
        )
    try:
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise ValueError("Candidate code or email is already in use.") from exc
    db.refresh(candidate)
    return candidate


def update_candidate(
    db: Session, candidate: HROnboardingCandidate, payload: dict
) -> HROnboardingCandidate:
    _validate_common(db, payload, current_id=candidate.id)
    if payload.get("full_name") is not None:
        name = str(payload["full_name"]).strip()
        if not name:
            raise ValueError("Candidate name cannot be empty.")
        candidate.full_name = name[:160]
    if payload.get("email") is not None:
        candidate.email = _clean_email(payload["email"])
    if payload.get("phone") is not None:
        candidate.phone = str(payload["phone"]).strip() or None
    if payload.get("designation") is not None:
        candidate.designation = str(payload["designation"]).strip() or None
    if payload.get("employment_type") is not None:
        candidate.employment_type = str(payload["employment_type"])
    if payload.get("store_id") is not None:
        candidate.store_id = (
            int(payload["store_id"]) if payload["store_id"] not in (None, "") else None
        )
    if payload.get("expected_joining_date") is not None:
        candidate.expected_joining_date = _parse_date(
            payload["expected_joining_date"]
        )
    if payload.get("status") is not None:
        status = str(payload["status"])
        if status not in CANDIDATE_STATUSES:
            raise ValueError("Unknown onboarding status.")
        candidate.status = status
    if payload.get("source") is not None:
        candidate.source = str(payload["source"]).strip() or None
    if payload.get("notes") is not None:
        candidate.notes = str(payload["notes"]).strip() or None
    db.commit()
    db.refresh(candidate)
    return candidate


def update_task(
    db: Session, task_id: int, status: str, notes: str | None = None
) -> HROnboardingTask:
    task = db.query(HROnboardingTask).filter(HROnboardingTask.id == task_id).first()
    if task is None:
        raise ValueError("Onboarding task not found.")
    status = status.strip().lower()
    if status not in TASK_STATUSES:
        raise ValueError("Task status must be pending or done.")
    task.status = status
    task.completed_at = datetime.utcnow() if status == "done" else None
    if notes is not None:
        task.notes = notes.strip() or None
    db.commit()
    db.refresh(task)
    return task


def add_task(
    db: Session, candidate: HROnboardingCandidate, payload: dict
) -> HROnboardingTask:
    title = str(payload.get("title") or "").strip()
    if not title:
        raise ValueError("Task title is required.")
    task = HROnboardingTask(
        candidate_id=candidate.id,
        title=title[:160],
        category=str(payload.get("category") or "documents")[:40],
        due_date=_parse_date(payload.get("due_date")),
        notes=(str(payload.get("notes") or "").strip() or None),
        sort_order=1000,
    )
    db.add(task)
    db.commit()
    db.refresh(task)
    return task


def _next_employee_code(db: Session) -> str:
    number = 1001
    while (
        db.query(HREmployee)
        .filter(HREmployee.employee_code == f"EMP-{number}")
        .first()
        is not None
    ):
        number += 1
    return f"EMP-{number}"


def convert_candidate(
    db: Session, candidate: HROnboardingCandidate, payload: dict
) -> tuple[HREmployee, HROnboardingCandidate]:
    if candidate.employee_id:
        raise ValueError("This candidate has already been converted.")
    if candidate.status == "withdrawn":
        raise ValueError("A withdrawn candidate cannot be converted.")
    pending = [task for task in candidate.tasks if task.status != "done"]
    force = bool(payload.get("force"))
    if pending and not force:
        raise ValueError(
            f"Complete {len(pending)} remaining onboarding task(s) before conversion."
        )
    employee_code = str(payload.get("employee_code") or "").strip().upper()
    employee_code = employee_code or _next_employee_code(db)
    if (
        db.query(HREmployee)
        .filter(HREmployee.employee_code == employee_code)
        .first()
        is not None
    ):
        raise ValueError(f"Employee code '{employee_code}' is already in use.")
    if candidate.email:
        existing = db.query(HREmployee).filter(HREmployee.email == candidate.email).first()
        if existing is not None:
            raise ValueError("That email already belongs to an employee.")
    joining_date = _parse_date(payload.get("joining_date")) or candidate.expected_joining_date or date.today()
    employee = HREmployee(
        employee_code=employee_code[:40],
        full_name=candidate.full_name,
        email=candidate.email,
        phone=candidate.phone,
        designation=candidate.designation,
        employment_type=candidate.employment_type,
        status="active",
        joining_date=joining_date,
        store_id=candidate.store_id,
        notes=f"Converted from onboarding {candidate.candidate_code}",
    )
    db.add(employee)
    db.flush()
    candidate.employee_id = employee.id
    candidate.status = "joined"
    candidate.expected_joining_date = joining_date
    try:
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise ValueError("Candidate could not be converted.") from exc
    db.refresh(employee)
    db.refresh(candidate)
    return employee, candidate


def list_candidates(db: Session, status: str = "") -> list[HROnboardingCandidate]:
    query = db.query(HROnboardingCandidate)
    if status:
        query = query.filter(HROnboardingCandidate.status == status)
    return query.order_by(
        HROnboardingCandidate.created_at.desc(), HROnboardingCandidate.id.desc()
    ).all()


def summary(db: Session) -> dict:
    rows = db.query(HROnboardingCandidate).all()
    counts = {status: 0 for status in CANDIDATE_STATUSES}
    for row in rows:
        counts[row.status] = counts.get(row.status, 0) + 1
    return {
        "total": len(rows),
        "documents_pending": counts.get("documents_pending", 0),
        "verification": counts.get("verification", 0),
        "ready": counts.get("ready", 0),
        "joined": counts.get("joined", 0),
        "withdrawn": counts.get("withdrawn", 0),
    }
