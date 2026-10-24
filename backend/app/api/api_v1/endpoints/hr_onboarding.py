from datetime import date
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.api.deps import get_db, require_hr_permission
from app.models.domain import HROnboardingCandidate
from app.services.hr_onboarding_service import (
    CANDIDATE_STATUSES,
    add_task,
    convert_candidate,
    create_candidate,
    list_candidates,
    serialize_candidate,
    serialize_task,
    summary,
    update_candidate,
    update_task,
)

router = APIRouter()


class CandidateCreate(BaseModel):
    candidate_code: Optional[str] = Field(default=None, max_length=40)
    full_name: str = Field(min_length=2, max_length=160)
    email: Optional[str] = Field(default=None, max_length=200)
    phone: Optional[str] = Field(default=None, max_length=30)
    designation: Optional[str] = Field(default=None, max_length=120)
    employment_type: str = Field(default="full_time", max_length=30)
    store_id: Optional[int] = None
    expected_joining_date: Optional[date] = None
    status: str = Field(default="documents_pending", max_length=30)
    source: Optional[str] = Field(default=None, max_length=80)
    notes: Optional[str] = Field(default=None, max_length=1000)


class CandidateUpdate(BaseModel):
    full_name: Optional[str] = Field(default=None, min_length=2, max_length=160)
    email: Optional[str] = Field(default=None, max_length=200)
    phone: Optional[str] = Field(default=None, max_length=30)
    designation: Optional[str] = Field(default=None, max_length=120)
    employment_type: Optional[str] = Field(default=None, max_length=30)
    store_id: Optional[int] = None
    expected_joining_date: Optional[date] = None
    status: Optional[str] = Field(default=None, max_length=30)
    source: Optional[str] = Field(default=None, max_length=80)
    notes: Optional[str] = Field(default=None, max_length=1000)


class TaskUpdate(BaseModel):
    status: str = Field(pattern="^(pending|done)$")
    notes: Optional[str] = Field(default=None, max_length=500)


class TaskCreate(BaseModel):
    title: str = Field(min_length=2, max_length=160)
    category: str = Field(default="documents", max_length=40)
    due_date: Optional[date] = None
    notes: Optional[str] = Field(default=None, max_length=500)


class ConvertPayload(BaseModel):
    employee_code: Optional[str] = Field(default=None, max_length=40)
    joining_date: Optional[date] = None
    force: bool = False


def _candidate_or_404(db: Session, candidate_id: int) -> HROnboardingCandidate:
    row = (
        db.query(HROnboardingCandidate)
        .filter(HROnboardingCandidate.id == candidate_id)
        .first()
    )
    if row is None:
        raise HTTPException(status_code=404, detail="Onboarding candidate not found.")
    return row


@router.get("/onboarding/summary")
def onboarding_summary(
    db: Session = Depends(get_db),
    _: dict = Depends(require_hr_permission("hr.onboarding")),
):
    return summary(db)


@router.get("/onboarding/candidates")
def onboarding_candidates(
    status: str = "",
    db: Session = Depends(get_db),
    _: dict = Depends(require_hr_permission("hr.onboarding")),
):
    return {
        "candidates": [
            serialize_candidate(row) for row in list_candidates(db, status)
        ]
    }


@router.post("/onboarding/candidates", status_code=201)
def create_onboarding_candidate(
    payload: CandidateCreate,
    db: Session = Depends(get_db),
    _: dict = Depends(require_hr_permission("hr.onboarding")),
):
    if payload.status not in CANDIDATE_STATUSES:
        raise HTTPException(status_code=422, detail="Unknown onboarding status.")
    try:
        row = create_candidate(db, payload.model_dump())
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    return serialize_candidate(row)


@router.get("/onboarding/candidates/{candidate_id}")
def onboarding_candidate_detail(
    candidate_id: int,
    db: Session = Depends(get_db),
    _: dict = Depends(require_hr_permission("hr.onboarding")),
):
    return serialize_candidate(_candidate_or_404(db, candidate_id))


@router.patch("/onboarding/candidates/{candidate_id}")
def update_onboarding_candidate(
    candidate_id: int,
    payload: CandidateUpdate,
    db: Session = Depends(get_db),
    _: dict = Depends(require_hr_permission("hr.onboarding")),
):
    row = _candidate_or_404(db, candidate_id)
    try:
        row = update_candidate(db, row, payload.model_dump(exclude_unset=True))
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    return serialize_candidate(row)


@router.patch("/onboarding/tasks/{task_id}")
def update_onboarding_task(
    task_id: int,
    payload: TaskUpdate,
    db: Session = Depends(get_db),
    _: dict = Depends(require_hr_permission("hr.onboarding")),
):
    try:
        task = update_task(db, task_id, payload.status, payload.notes)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    return serialize_task(task)


@router.post("/onboarding/candidates/{candidate_id}/tasks", status_code=201)
def create_onboarding_task(
    candidate_id: int,
    payload: TaskCreate,
    db: Session = Depends(get_db),
    _: dict = Depends(require_hr_permission("hr.onboarding")),
):
    candidate = _candidate_or_404(db, candidate_id)
    try:
        task = add_task(db, candidate, payload.model_dump())
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    return serialize_task(task)


@router.post("/onboarding/candidates/{candidate_id}/convert", status_code=201)
def convert_onboarding_candidate(
    candidate_id: int,
    payload: ConvertPayload,
    db: Session = Depends(get_db),
    _: dict = Depends(require_hr_permission("hr.onboarding")),
):
    candidate = _candidate_or_404(db, candidate_id)
    try:
        employee, candidate = convert_candidate(db, candidate, payload.model_dump())
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    return {
        "employee": {
            "id": employee.id,
            "employee_code": employee.employee_code,
            "full_name": employee.full_name,
            "status": employee.status,
        },
        "candidate": serialize_candidate(candidate),
    }
