from datetime import date
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.api.deps import get_db, require_hr_permission
from app.services.recruitment_service import (
    add_interview,
    create_application,
    create_job,
    get_application,
    get_job,
    list_applications,
    list_jobs,
    move_application,
    pipeline,
    serialize_application,
    serialize_job,
    summary,
    update_interview,
    update_job,
)

router = APIRouter()


class JobCreate(BaseModel):
    title: str = Field(min_length=2, max_length=160)
    department: Optional[str] = Field(default=None, max_length=120)
    location: Optional[str] = Field(default=None, max_length=160)
    employment_type: str = Field(default="full_time", max_length=30)
    description: Optional[str] = Field(default=None, max_length=4000)
    requirements: Optional[str] = Field(default=None, max_length=4000)
    salary_min: Optional[float] = Field(default=None, ge=0)
    salary_max: Optional[float] = Field(default=None, ge=0)
    openings: int = Field(default=1, ge=1, le=100)
    status: str = Field(default="draft", max_length=20)


class JobUpdate(BaseModel):
    title: Optional[str] = Field(default=None, min_length=2, max_length=160)
    department: Optional[str] = Field(default=None, max_length=120)
    location: Optional[str] = Field(default=None, max_length=160)
    employment_type: Optional[str] = Field(default=None, max_length=30)
    description: Optional[str] = Field(default=None, max_length=4000)
    requirements: Optional[str] = Field(default=None, max_length=4000)
    salary_min: Optional[float] = Field(default=None, ge=0)
    salary_max: Optional[float] = Field(default=None, ge=0)
    openings: Optional[int] = Field(default=None, ge=1, le=100)
    status: Optional[str] = Field(default=None, max_length=20)


class ApplicationCreate(BaseModel):
    job_id: int
    candidate_name: str = Field(min_length=2, max_length=160)
    email: Optional[str] = Field(default=None, max_length=200)
    phone: Optional[str] = Field(default=None, max_length=30)
    source: Optional[str] = Field(default=None, max_length=80)
    rating: Optional[int] = Field(default=None, ge=1, le=5)
    notes: Optional[str] = Field(default=None, max_length=2000)
    expected_salary: Optional[float] = Field(default=None, ge=0)


class StageUpdate(BaseModel):
    stage: str = Field(min_length=3, max_length=30)
    note: str = Field(default="", max_length=500)
    rejection_reason: str = Field(default="", max_length=500)
    offered_salary: Optional[float] = Field(default=None, ge=0)
    joining_date: Optional[date] = None


class InterviewCreate(BaseModel):
    scheduled_at: str = Field(min_length=10, max_length=40)
    mode: str = Field(default="in_person", max_length=30)
    interviewer: Optional[str] = Field(default=None, max_length=160)
    notes: Optional[str] = Field(default=None, max_length=2000)


class InterviewUpdate(BaseModel):
    status: Optional[str] = Field(default=None, max_length=30)
    notes: Optional[str] = Field(default=None, max_length=2000)
    interviewer: Optional[str] = Field(default=None, max_length=160)


def _job_or_404(db: Session, job_id: int):
    job = get_job(db, job_id)
    if job is None:
        raise HTTPException(status_code=404, detail="Job not found.")
    return job


def _application_or_404(db: Session, application_id: int):
    row = get_application(db, application_id)
    if row is None:
        raise HTTPException(status_code=404, detail="Application not found.")
    return row


@router.get("/summary")
def recruitment_summary(
    db: Session = Depends(get_db),
    _: dict = Depends(require_hr_permission("hr.recruitment")),
):
    return summary(db)


@router.get("/jobs")
def jobs(
    status: Optional[str] = None,
    db: Session = Depends(get_db),
    _: dict = Depends(require_hr_permission("hr.recruitment")),
):
    return {"jobs": list_jobs(db, status)}


@router.post("/jobs", status_code=201)
def save_job(
    payload: JobCreate,
    db: Session = Depends(get_db),
    _: dict = Depends(require_hr_permission("hr.recruitment")),
):
    try:
        return {"job": create_job(db, payload.model_dump())}
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


@router.get("/jobs/{job_id}")
def job_detail(
    job_id: int,
    db: Session = Depends(get_db),
    _: dict = Depends(require_hr_permission("hr.recruitment")),
):
    job = _job_or_404(db, job_id)
    return {
        "job": serialize_job(job),
        "pipeline": pipeline(db, job.id),
    }


@router.patch("/jobs/{job_id}")
def edit_job(
    job_id: int,
    payload: JobUpdate,
    db: Session = Depends(get_db),
    _: dict = Depends(require_hr_permission("hr.recruitment")),
):
    job = _job_or_404(db, job_id)
    try:
        return {"job": update_job(db, job, payload.model_dump(exclude_unset=True))}
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


@router.get("/applications")
def applications(
    job_id: Optional[int] = None,
    db: Session = Depends(get_db),
    _: dict = Depends(require_hr_permission("hr.recruitment")),
):
    return {"applications": list_applications(db, job_id)}


@router.post("/applications", status_code=201)
def add_application(
    payload: ApplicationCreate,
    db: Session = Depends(get_db),
    _: dict = Depends(require_hr_permission("hr.recruitment")),
):
    try:
        return {"application": create_application(db, payload.model_dump())}
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


@router.get("/applications/{application_id}")
def application_detail(
    application_id: int,
    db: Session = Depends(get_db),
    _: dict = Depends(require_hr_permission("hr.recruitment")),
):
    row = _application_or_404(db, application_id)
    return {"application": serialize_application(row, detail=True)}


@router.patch("/applications/{application_id}/stage")
def move_stage(
    application_id: int,
    payload: StageUpdate,
    db: Session = Depends(get_db),
    session: dict = Depends(require_hr_permission("hr.recruitment")),
):
    row = _application_or_404(db, application_id)
    try:
        return {
            "application": move_application(
                db,
                row,
                stage=payload.stage,
                actor=str(session.get("subject") or "admin"),
                note=payload.note,
                rejection_reason=payload.rejection_reason,
                offered_salary=payload.offered_salary,
                joining_date=payload.joining_date,
            )
        }
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


@router.get("/pipeline")
def recruitment_pipeline(
    job_id: Optional[int] = None,
    db: Session = Depends(get_db),
    _: dict = Depends(require_hr_permission("hr.recruitment")),
):
    return pipeline(db, job_id)


@router.post("/applications/{application_id}/interviews", status_code=201)
def schedule_interview(
    application_id: int,
    payload: InterviewCreate,
    db: Session = Depends(get_db),
    _: dict = Depends(require_hr_permission("hr.recruitment")),
):
    row = _application_or_404(db, application_id)
    try:
        return {"interview": add_interview(db, row, payload.model_dump())}
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


@router.patch("/interviews/{interview_id}")
def edit_interview(
    interview_id: int,
    payload: InterviewUpdate,
    db: Session = Depends(get_db),
    _: dict = Depends(require_hr_permission("hr.recruitment")),
):
    from app.models.domain import RecruitmentInterview

    row = db.query(RecruitmentInterview).filter(RecruitmentInterview.id == interview_id).first()
    if row is None:
        raise HTTPException(status_code=404, detail="Interview not found.")
    try:
        return {"interview": update_interview(db, row, payload.model_dump(exclude_unset=True))}
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
