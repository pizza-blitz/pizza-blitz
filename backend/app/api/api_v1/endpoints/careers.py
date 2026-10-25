from typing import Optional

from fastapi import APIRouter, Depends, File, Form, HTTPException, Request, UploadFile
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.api.deps import get_db
from app.core.rate_limit import enforce_rate_limit
from app.models.domain import RecruitmentJob
from app.services.recruitment_service import attach_resume, create_application, get_job
from app.services.resume_service import inspect_resume

router = APIRouter()


class PublicApplicationCreate(BaseModel):
    candidate_name: str = Field(min_length=2, max_length=160)
    email: Optional[str] = Field(default=None, max_length=200)
    phone: Optional[str] = Field(default=None, max_length=30)
    expected_salary: Optional[float] = Field(default=None, ge=0)
    notes: Optional[str] = Field(default=None, max_length=2000)


def _open_job(db: Session, job_id: int):
    job = get_job(db, job_id)
    if job is None or job.status != "open":
        raise HTTPException(status_code=404, detail="This role is not open.")
    return job


def _public_job(job) -> dict:
    return {
        "id": job.id,
        "title": job.title,
        "department": job.department,
        "location": job.location,
        "employment_type": job.employment_type,
        "description": job.description,
        "requirements": job.requirements,
        "salary_min": job.salary_min,
        "salary_max": job.salary_max,
        "openings": job.openings,
    }


@router.get("/jobs")
def public_jobs(db: Session = Depends(get_db)):
    rows = (
        db.query(RecruitmentJob)
        .filter(RecruitmentJob.status == "open")
        .order_by(RecruitmentJob.created_at.desc())
        .all()
    )
    return {"jobs": [_public_job(job) for job in rows]}


@router.get("/jobs/{job_id}")
def public_job_detail(job_id: int, db: Session = Depends(get_db)):
    return {"job": _public_job(_open_job(db, job_id))}


@router.post("/jobs/{job_id}/apply", status_code=201)
def public_apply(
    job_id: int,
    payload: PublicApplicationCreate,
    request: Request,
    db: Session = Depends(get_db),
):
    enforce_rate_limit(request, "careers-apply", 12)
    if not payload.email and not payload.phone:
        raise HTTPException(
            status_code=422, detail="Add an email address or phone number."
        )
    _open_job(db, job_id)
    try:
        application = create_application(
            db,
            {
                "job_id": job_id,
                "candidate_name": payload.candidate_name,
                "email": payload.email,
                "phone": payload.phone,
                "source": "Careers page",
                "expected_salary": payload.expected_salary,
                "notes": payload.notes,
            },
        )
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    return {
        "ok": True,
        "application_id": application["id"],
        "message": "Application received. Our team will contact you.",
    }


@router.post("/jobs/{job_id}/apply-resume", status_code=201)
async def public_apply_with_resume(
    job_id: int,
    request: Request,
    candidate_name: str = Form(..., min_length=2, max_length=160),
    email: Optional[str] = Form(default=None, max_length=200),
    phone: Optional[str] = Form(default=None, max_length=30),
    expected_salary: Optional[float] = Form(default=None, ge=0),
    notes: Optional[str] = Form(default=None, max_length=2000),
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
):
    enforce_rate_limit(request, "careers-apply-resume", 8)
    job = _open_job(db, job_id)
    data = await file.read()
    try:
        inspected = inspect_resume(data, file.filename or "resume.pdf")
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    parsed = inspected["parsed"]
    resolved_email = (email or "").strip() or parsed.get("email")
    resolved_phone = (phone or "").strip() or parsed.get("phone")
    if not resolved_email and not resolved_phone:
        raise HTTPException(
            status_code=422,
            detail="Add an email/phone in the form or include one in the resume.",
        )
    try:
        application = create_application(
            db,
            {
                "job_id": job.id,
                "candidate_name": candidate_name,
                "email": resolved_email,
                "phone": resolved_phone,
                "source": "Careers page",
                "expected_salary": expected_salary,
                "notes": notes,
            },
        )
        from app.services.recruitment_service import get_application

        row = get_application(db, application["id"])
        attach_resume(
            db,
            row,
            data=data,
            original_name=file.filename or "resume.pdf",
        )
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    return {
        "ok": True,
        "application_id": application["id"],
        "resume_parsed": parsed,
        "message": "Application and resume received. Our team will contact you.",
    }
