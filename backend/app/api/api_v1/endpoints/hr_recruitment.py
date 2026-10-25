from datetime import date
from typing import Optional

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.api.deps import get_db, require_hr_permission
from app.services.recruitment_service import (
    add_interview,
    attach_resume,
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
from app.services.resume_service import resume_path
from app.services.offer_service import (
    countersign_offer,
    create_offer_template,
    delete_offer_template,
    generate_offer,
    list_offer_templates,
    offer_path,
    run_offer_reminders,
    send_offer_notification,
    update_offer_template,
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


class OfferCreate(BaseModel):
    expires_in_days: int = Field(default=7, ge=1, le=30)
    offered_salary: Optional[float] = Field(default=None, ge=0)
    joining_date: Optional[date] = None
    template_id: Optional[int] = Field(default=None, ge=1)


class OfferTemplateCreate(BaseModel):
    name: str = Field(min_length=2, max_length=160)
    body: str = Field(min_length=20, max_length=4000)
    is_default: bool = False


class OfferTemplateUpdate(BaseModel):
    name: Optional[str] = Field(default=None, min_length=2, max_length=160)
    body: Optional[str] = Field(default=None, min_length=20, max_length=4000)
    is_default: Optional[bool] = None


class OfferCountersign(BaseModel):
    signed_by: str = Field(min_length=2, max_length=160)


class InterviewUpdate(BaseModel):
    status: Optional[str] = Field(default=None, max_length=30)
    notes: Optional[str] = Field(default=None, max_length=2000)
    interviewer: Optional[str] = Field(default=None, max_length=160)
    score: Optional[int] = Field(default=None, ge=1, le=5)
    recommendation: Optional[str] = Field(default=None, max_length=30)


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


@router.post("/applications/{application_id}/resume", status_code=201)
async def upload_application_resume(
    application_id: int,
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    _: dict = Depends(require_hr_permission("hr.recruitment")),
):
    row = _application_or_404(db, application_id)
    data = await file.read()
    try:
        return {
            "application": attach_resume(
                db,
                row,
                data=data,
                original_name=file.filename or "resume.pdf",
            )
        }
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


@router.get("/applications/{application_id}/resume")
def download_application_resume(
    application_id: int,
    db: Session = Depends(get_db),
    _: dict = Depends(require_hr_permission("hr.recruitment")),
):
    row = _application_or_404(db, application_id)
    target = resume_path(row.resume_file_name or "")
    if target is None:
        raise HTTPException(status_code=404, detail="Resume not found.")
    return FileResponse(
        path=target,
        media_type=row.resume_mime_type or "application/octet-stream",
        filename=row.resume_original_name or target.name,
    )


@router.post("/applications/{application_id}/offer", status_code=201)
def create_offer_letter(
    application_id: int,
    payload: OfferCreate,
    db: Session = Depends(get_db),
    _: dict = Depends(require_hr_permission("hr.recruitment")),
):
    row = _application_or_404(db, application_id)
    try:
        return {
            "application": generate_offer(
                db,
                row,
                expires_in_days=payload.expires_in_days,
                offered_salary=payload.offered_salary,
                joining_date=payload.joining_date,
                template_id=payload.template_id,
            )
        }
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


@router.get("/applications/{application_id}/offer/pdf")
def download_offer_letter(
    application_id: int,
    db: Session = Depends(get_db),
    _: dict = Depends(require_hr_permission("hr.recruitment")),
):
    row = _application_or_404(db, application_id)
    target = offer_path(row)
    if target is None:
        raise HTTPException(status_code=404, detail="Offer letter not found.")
    return FileResponse(
        path=target,
        media_type="application/pdf",
        filename=f"offer-{row.candidate_name.replace(' ', '-').lower()}.pdf",
    )


@router.post("/applications/{application_id}/offer/send")
def send_offer(
    application_id: int,
    db: Session = Depends(get_db),
    _: dict = Depends(require_hr_permission("hr.recruitment")),
):
    row = _application_or_404(db, application_id)
    try:
        return send_offer_notification(db, row)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


@router.post("/applications/{application_id}/offer/countersign")
def countersign(
    application_id: int,
    payload: OfferCountersign,
    db: Session = Depends(get_db),
    _: dict = Depends(require_hr_permission("hr.recruitment")),
):
    row = _application_or_404(db, application_id)
    try:
        return {"application": countersign_offer(db, row, signed_by=payload.signed_by)}
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


@router.get("/offer-templates")
def offer_templates(
    db: Session = Depends(get_db),
    _: dict = Depends(require_hr_permission("hr.recruitment")),
):
    return {"templates": list_offer_templates(db)}


@router.post("/offer-templates", status_code=201)
def add_offer_template(
    payload: OfferTemplateCreate,
    db: Session = Depends(get_db),
    _: dict = Depends(require_hr_permission("hr.recruitment")),
):
    try:
        return {
            "template": create_offer_template(
                db,
                name=payload.name,
                body=payload.body,
                is_default=payload.is_default,
            )
        }
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


@router.patch("/offer-templates/{template_id}")
def edit_offer_template(
    template_id: int,
    payload: OfferTemplateUpdate,
    db: Session = Depends(get_db),
    _: dict = Depends(require_hr_permission("hr.recruitment")),
):
    from app.models.domain import OfferTemplate

    row = db.query(OfferTemplate).filter(OfferTemplate.id == template_id).first()
    if row is None:
        raise HTTPException(status_code=404, detail="Offer template not found.")
    try:
        return {
            "template": update_offer_template(
                db,
                row,
                name=payload.name,
                body=payload.body,
                is_default=payload.is_default,
            )
        }
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


@router.delete("/offer-templates/{template_id}", status_code=204)
def remove_offer_template(
    template_id: int,
    db: Session = Depends(get_db),
    _: dict = Depends(require_hr_permission("hr.recruitment")),
):
    from app.models.domain import OfferTemplate

    row = db.query(OfferTemplate).filter(OfferTemplate.id == template_id).first()
    if row is None:
        raise HTTPException(status_code=404, detail="Offer template not found.")
    delete_offer_template(db, row)


@router.post("/offers/run-reminders")
def offer_reminders(
    db: Session = Depends(get_db),
    _: dict = Depends(require_hr_permission("hr.recruitment")),
):
    return run_offer_reminders(db)


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
