"""Recruitment pipeline: jobs, applications, interviews and onboarding handoff."""

from datetime import date, datetime

from sqlalchemy.orm import Session

from app.models.domain import (
    RecruitmentApplication,
    RecruitmentInterview,
    RecruitmentJob,
    RecruitmentStageEvent,
)
from app.services.hr_onboarding_service import create_candidate
from app.services.resume_service import delete_resume, save_resume

JOB_STATUSES = {"draft", "open", "paused", "closed"}
STAGES = ("applied", "screening", "interview", "offer", "hired", "rejected", "withdrawn")
TRANSITIONS = {
    "applied": {"screening", "rejected", "withdrawn"},
    "screening": {"interview", "rejected", "withdrawn"},
    "interview": {"offer", "rejected", "withdrawn"},
    "offer": {"hired", "rejected", "withdrawn"},
    "hired": set(),
    "rejected": {"applied"},
    "withdrawn": {"applied"},
}


def serialize_job(row: RecruitmentJob) -> dict:
    applications = row.applications or []
    return {
        "id": row.id,
        "title": row.title,
        "department": row.department,
        "location": row.location,
        "employment_type": row.employment_type,
        "description": row.description,
        "requirements": row.requirements,
        "salary_min": row.salary_min,
        "salary_max": row.salary_max,
        "openings": row.openings,
        "status": row.status,
        "application_count": len(applications),
        "hired_count": sum(1 for item in applications if item.stage == "hired"),
        "created_at": row.created_at.isoformat() if row.created_at else None,
    }


def serialize_interview(row: RecruitmentInterview) -> dict:
    return {
        "id": row.id,
        "application_id": row.application_id,
        "scheduled_at": row.scheduled_at.isoformat() if row.scheduled_at else None,
        "mode": row.mode,
        "interviewer": row.interviewer,
        "notes": row.notes,
        "status": row.status,
        "score": row.score,
        "recommendation": row.recommendation,
        "scored_at": row.scored_at.isoformat() if row.scored_at else None,
    }


def serialize_application(row: RecruitmentApplication, *, detail: bool = False) -> dict:
    data = {
        "id": row.id,
        "job_id": row.job_id,
        "job_title": row.job.title if row.job else None,
        "candidate_name": row.candidate_name,
        "email": row.email,
        "phone": row.phone,
        "source": row.source,
        "stage": row.stage,
        "rating": row.rating,
        "notes": row.notes,
        "rejection_reason": row.rejection_reason,
        "expected_salary": row.expected_salary,
        "offered_salary": row.offered_salary,
        "joining_date": row.joining_date.isoformat() if row.joining_date else None,
        "onboarding_candidate_id": row.onboarding_candidate_id,
        "resume": {
            "file_name": row.resume_original_name or row.resume_file_name,
            "mime_type": row.resume_mime_type,
            "uploaded_at": row.resume_uploaded_at.isoformat()
            if row.resume_uploaded_at
            else None,
            "parsed": row.resume_parsed or {},
            "text_excerpt": (row.resume_text or "")[:1200] or None,
            "download_url": f"/restaurant/hr/recruitment/applications/{row.id}/resume"
            if row.resume_file_name
            else None,
        },
        "applied_at": row.applied_at.isoformat() if row.applied_at else None,
        "stage_changed_at": row.stage_changed_at.isoformat() if row.stage_changed_at else None,
        "hired_at": row.hired_at.isoformat() if row.hired_at else None,
    }
    if detail:
        data["interviews"] = [
            serialize_interview(item)
            for item in sorted(row.interviews, key=lambda item: item.scheduled_at)
        ]
        data["stage_history"] = [
            {
                "id": event.id,
                "from_stage": event.from_stage,
                "to_stage": event.to_stage,
                "actor": event.actor,
                "note": event.note,
                "created_at": event.created_at.isoformat() if event.created_at else None,
            }
            for event in sorted(row.stage_events, key=lambda item: item.id)
        ]
    return data


def list_jobs(db: Session, status: str | None = None) -> list[dict]:
    query = db.query(RecruitmentJob)
    if status:
        query = query.filter(RecruitmentJob.status == status)
    return [serialize_job(row) for row in query.order_by(RecruitmentJob.created_at.desc()).all()]


def get_job(db: Session, job_id: int) -> RecruitmentJob | None:
    return db.query(RecruitmentJob).filter(RecruitmentJob.id == job_id).first()


def create_job(db: Session, payload: dict) -> dict:
    status = str(payload.get("status") or "draft")
    if status not in JOB_STATUSES:
        raise ValueError("Job status must be draft, open, paused or closed.")
    row = RecruitmentJob(
        title=str(payload.get("title") or "").strip()[:160],
        department=(str(payload.get("department") or "").strip()[:120] or None),
        location=(str(payload.get("location") or "").strip()[:160] or None),
        employment_type=str(payload.get("employment_type") or "full_time")[:30],
        description=(str(payload.get("description") or "").strip() or None),
        requirements=(str(payload.get("requirements") or "").strip() or None),
        salary_min=payload.get("salary_min"),
        salary_max=payload.get("salary_max"),
        openings=max(1, int(payload.get("openings") or 1)),
        status=status,
    )
    if not row.title:
        raise ValueError("Job title is required.")
    if row.salary_min is not None and row.salary_max is not None and row.salary_min > row.salary_max:
        raise ValueError("Minimum salary cannot exceed maximum salary.")
    db.add(row)
    db.commit()
    db.refresh(row)
    return serialize_job(row)


def update_job(db: Session, row: RecruitmentJob, payload: dict) -> dict:
    if "status" in payload:
        status = str(payload["status"])
        if status not in JOB_STATUSES:
            raise ValueError("Job status must be draft, open, paused or closed.")
        row.status = status
    for field in ("title", "department", "location", "employment_type", "description", "requirements"):
        if field in payload:
            value = str(payload[field] or "").strip()
            setattr(row, field, value or None)
    for field in ("salary_min", "salary_max"):
        if field in payload:
            setattr(row, field, payload[field])
    if "openings" in payload:
        row.openings = max(1, int(payload["openings"] or 1))
    db.commit()
    db.refresh(row)
    return serialize_job(row)


def get_application(db: Session, application_id: int) -> RecruitmentApplication | None:
    return (
        db.query(RecruitmentApplication)
        .filter(RecruitmentApplication.id == application_id)
        .first()
    )


def list_applications(db: Session, job_id: int | None = None) -> list[dict]:
    query = db.query(RecruitmentApplication)
    if job_id is not None:
        query = query.filter(RecruitmentApplication.job_id == job_id)
    rows = query.order_by(RecruitmentApplication.applied_at.desc()).all()
    return [serialize_application(row) for row in rows]


def create_application(db: Session, payload: dict) -> dict:
    job = get_job(db, int(payload["job_id"]))
    if job is None:
        raise ValueError("Job not found.")
    if job.status == "closed":
        raise ValueError("This job is closed.")
    name = str(payload.get("candidate_name") or "").strip()
    if not name:
        raise ValueError("Candidate name is required.")
    email = str(payload.get("email") or "").strip().lower() or None
    if email:
        existing = (
            db.query(RecruitmentApplication)
            .filter(
                RecruitmentApplication.job_id == job.id,
                RecruitmentApplication.email == email,
            )
            .first()
        )
        if existing is not None:
            raise ValueError("This candidate already applied to this job.")
    row = RecruitmentApplication(
        job_id=job.id,
        candidate_name=name[:160],
        email=email[:200] if email else None,
        phone=str(payload.get("phone") or "").strip()[:30] or None,
        source=str(payload.get("source") or "").strip()[:80] or None,
        stage="applied",
        rating=payload.get("rating"),
        notes=str(payload.get("notes") or "").strip() or None,
        expected_salary=payload.get("expected_salary"),
        applied_at=datetime.utcnow(),
        stage_changed_at=datetime.utcnow(),
    )
    db.add(row)
    db.flush()
    db.add(
        RecruitmentStageEvent(
            application_id=row.id,
            from_stage=None,
            to_stage="applied",
            actor=str(payload.get("actor") or "admin")[:120],
            note="Application received.",
        )
    )
    db.commit()
    db.refresh(row)
    return serialize_application(row, detail=True)


def move_application(
    db: Session,
    row: RecruitmentApplication,
    *,
    stage: str,
    actor: str = "",
    note: str = "",
    rejection_reason: str = "",
    offered_salary: float | None = None,
    joining_date: date | None = None,
) -> dict:
    if stage not in STAGES:
        raise ValueError("Unknown recruitment stage.")
    if stage == row.stage:
        return serialize_application(row, detail=True)
    if stage not in TRANSITIONS.get(row.stage, set()):
        raise ValueError(f"Cannot move from {row.stage} to {stage}.")
    if stage == "rejected" and not (rejection_reason or note).strip():
        raise ValueError("A rejection reason is required.")
    if stage == "hired" and row.stage != "offer":
        raise ValueError("Only an offer can be marked hired.")
    previous = row.stage
    row.stage = stage
    row.stage_changed_at = datetime.utcnow()
    if stage == "rejected":
        row.rejection_reason = (rejection_reason or note).strip()[:500]
    if offered_salary is not None:
        row.offered_salary = offered_salary
    if joining_date is not None:
        row.joining_date = joining_date
    if stage == "hired":
        row.hired_at = datetime.utcnow()
        row.rejection_reason = None
        if row.onboarding_candidate_id is None:
            candidate = create_candidate(
                db,
                {
                    "full_name": row.candidate_name,
                    "email": row.email,
                    "phone": row.phone,
                    "designation": row.job.title if row.job else None,
                    "employment_type": row.job.employment_type if row.job else "full_time",
                    "expected_joining_date": row.joining_date,
                    "status": "documents_pending",
                    "source": f"Recruitment: {row.job.title}" if row.job else "Recruitment",
                    "notes": f"Hired from recruitment application #{row.id}.",
                },
            )
            row.onboarding_candidate_id = candidate.id
    db.add(
        RecruitmentStageEvent(
            application_id=row.id,
            from_stage=previous,
            to_stage=stage,
            actor=actor[:120] or "admin",
            note=(note or rejection_reason or "").strip()[:500] or None,
        )
    )
    db.commit()
    db.refresh(row)
    return serialize_application(row, detail=True)


def add_interview(db: Session, application: RecruitmentApplication, payload: dict) -> dict:
    scheduled_at = payload.get("scheduled_at")
    if not scheduled_at:
        raise ValueError("Interview date/time is required.")
    try:
        when = datetime.fromisoformat(str(scheduled_at).replace("Z", "+00:00")).replace(tzinfo=None)
    except ValueError as exc:
        raise ValueError("Interview date/time must be ISO-8601.") from exc
    row = RecruitmentInterview(
        application_id=application.id,
        scheduled_at=when,
        mode=str(payload.get("mode") or "in_person")[:30],
        interviewer=str(payload.get("interviewer") or "").strip()[:160] or None,
        notes=str(payload.get("notes") or "").strip() or None,
        status="scheduled",
    )
    db.add(row)
    if application.stage in {"applied", "screening"}:
        previous = application.stage
        application.stage = "interview"
        application.stage_changed_at = datetime.utcnow()
        db.add(
            RecruitmentStageEvent(
                application_id=application.id,
                from_stage=previous,
                to_stage="interview",
                actor="admin",
                note="Interview scheduled.",
            )
        )
    db.commit()
    db.refresh(row)
    return serialize_interview(row)


def update_interview(db: Session, row: RecruitmentInterview, payload: dict) -> dict:
    if "status" in payload:
        status = str(payload["status"])
        if status not in {"scheduled", "completed", "cancelled", "no_show"}:
            raise ValueError("Unknown interview status.")
        row.status = status
    if "notes" in payload:
        row.notes = str(payload["notes"] or "").strip() or None
    if "interviewer" in payload:
        row.interviewer = str(payload["interviewer"] or "").strip()[:160] or None
    if "score" in payload:
        score = payload["score"]
        if score is not None and not 1 <= int(score) <= 5:
            raise ValueError("Interview score must be between 1 and 5.")
        row.score = int(score) if score is not None else None
    if "recommendation" in payload:
        recommendation = str(payload["recommendation"] or "").strip().lower() or None
        if recommendation not in {None, "strong_yes", "yes", "no", "strong_no"}:
            raise ValueError("Unknown interview recommendation.")
        row.recommendation = recommendation
    if row.score is not None or row.recommendation is not None:
        row.scored_at = datetime.utcnow()
    db.commit()
    db.refresh(row)
    return serialize_interview(row)


def attach_resume(
    db: Session,
    application: RecruitmentApplication,
    *,
    data: bytes,
    original_name: str,
) -> dict:
    saved = save_resume(application.id, data, original_name)
    previous = application.resume_file_name
    application.resume_file_name = saved["storage_name"]
    application.resume_original_name = saved["file_name"]
    application.resume_mime_type = saved["mime_type"]
    application.resume_text = saved["text"] or None
    application.resume_parsed = saved["parsed"]
    application.resume_uploaded_at = datetime.utcnow()
    parsed = saved["parsed"]
    if not application.email and parsed.get("email"):
        application.email = parsed["email"][:200]
    if not application.phone and parsed.get("phone"):
        application.phone = parsed["phone"][:30]
    db.commit()
    db.refresh(application)
    if previous and previous != saved["storage_name"]:
        delete_resume(previous)
    return serialize_application(application, detail=True)


def pipeline(db: Session, job_id: int | None = None) -> dict:
    applications = list_applications(db, job_id)
    columns = {stage: [] for stage in STAGES}
    for row in applications:
        columns.setdefault(row["stage"], []).append(row)
    return {"columns": columns, "applications": applications}


def summary(db: Session) -> dict:
    jobs = db.query(RecruitmentJob).all()
    applications = db.query(RecruitmentApplication).all()
    upcoming = (
        db.query(RecruitmentInterview)
        .filter(
            RecruitmentInterview.status == "scheduled",
            RecruitmentInterview.scheduled_at >= datetime.utcnow(),
        )
        .count()
    )
    return {
        "open_jobs": sum(1 for row in jobs if row.status == "open"),
        "draft_jobs": sum(1 for row in jobs if row.status == "draft"),
        "applications": len(applications),
        "active_applications": sum(
            1 for row in applications if row.stage in {"applied", "screening", "interview", "offer"}
        ),
        "hires": sum(1 for row in applications if row.stage == "hired"),
        "offer_count": sum(1 for row in applications if row.stage == "offer"),
        "upcoming_interviews": upcoming,
        "stage_counts": {
            stage: sum(1 for row in applications if row.stage == stage) for stage in STAGES
        },
    }
