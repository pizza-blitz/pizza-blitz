"""Offer letter generation, secure candidate links and acceptance."""

import secrets
from datetime import datetime, timedelta
from pathlib import Path
from xml.sax.saxutils import escape

from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.platypus import Paragraph, SimpleDocTemplate, Spacer
from sqlalchemy.orm import Session

from app.core.config import settings
from app.models.domain import OfferApproval, OfferTemplate, RecruitmentApplication
from app.services.campaign_dispatch_service import send_campaign_message
from app.services.private_storage import private_root


def offer_dir() -> Path:
    target = private_root() / "offers"
    target.mkdir(parents=True, exist_ok=True)
    return target


def offer_expired(row: RecruitmentApplication) -> bool:
    return bool(
        row.offer_expires_at and row.offer_expires_at <= datetime.utcnow()
    )


def effective_offer_status(row: RecruitmentApplication) -> str | None:
    if not row.offer_status:
        return None
    if row.offer_status == "sent" and offer_expired(row):
        return "expired"
    return row.offer_status


def serialize_offer_template(row: OfferTemplate) -> dict:
    return {
        "id": row.id,
        "name": row.name,
        "body": row.body,
        "is_default": bool(row.is_default),
        "created_at": row.created_at.isoformat() if row.created_at else None,
        "updated_at": row.updated_at.isoformat() if row.updated_at else None,
    }


def list_offer_templates(db: Session) -> list[dict]:
    rows = db.query(OfferTemplate).order_by(OfferTemplate.is_default.desc(), OfferTemplate.name).all()
    return [serialize_offer_template(row) for row in rows]


def _clear_default(db: Session, except_id: int | None = None) -> None:
    query = db.query(OfferTemplate).filter(OfferTemplate.is_default.is_(True))
    if except_id is not None:
        query = query.filter(OfferTemplate.id != except_id)
    for row in query.all():
        row.is_default = False


def create_offer_template(
    db: Session, *, name: str, body: str, is_default: bool = False
) -> dict:
    clean_name = name.strip()[:160]
    clean_body = body.strip()
    if len(clean_name) < 2:
        raise ValueError("Template name is too short.")
    if len(clean_body) < 20:
        raise ValueError("Template terms must be at least 20 characters.")
    if db.query(OfferTemplate).filter(OfferTemplate.name == clean_name).first():
        raise ValueError("A template with that name already exists.")
    if is_default:
        _clear_default(db)
    row = OfferTemplate(name=clean_name, body=clean_body, is_default=is_default)
    db.add(row)
    db.commit()
    db.refresh(row)
    return serialize_offer_template(row)


def update_offer_template(
    db: Session,
    row: OfferTemplate,
    *,
    name: str | None = None,
    body: str | None = None,
    is_default: bool | None = None,
) -> dict:
    if name is not None:
        clean_name = name.strip()[:160]
        if len(clean_name) < 2:
            raise ValueError("Template name is too short.")
        conflict = (
            db.query(OfferTemplate)
            .filter(OfferTemplate.name == clean_name, OfferTemplate.id != row.id)
            .first()
        )
        if conflict:
            raise ValueError("A template with that name already exists.")
        row.name = clean_name
    if body is not None:
        clean_body = body.strip()
        if len(clean_body) < 20:
            raise ValueError("Template terms must be at least 20 characters.")
        row.body = clean_body
    if is_default is not None:
        if is_default:
            _clear_default(db, except_id=row.id)
        row.is_default = is_default
    db.commit()
    db.refresh(row)
    return serialize_offer_template(row)


def delete_offer_template(db: Session, row: OfferTemplate) -> None:
    db.delete(row)
    db.commit()


def _resolve_template(
    db: Session, template_id: int | None
) -> OfferTemplate | None:
    if template_id is not None:
        row = db.query(OfferTemplate).filter(OfferTemplate.id == template_id).first()
        if row is None:
            raise ValueError("Offer template not found.")
        return row
    return (
        db.query(OfferTemplate)
        .filter(OfferTemplate.is_default.is_(True))
        .order_by(OfferTemplate.id.asc())
        .first()
    )


def serialize_offer_approval(row: OfferApproval) -> dict:
    return {
        "id": row.id,
        "step_index": row.step_index,
        "step_name": row.step_name,
        "status": row.status,
        "approver": row.approver,
        "note": row.note,
        "decided_at": row.decided_at.isoformat() if row.decided_at else None,
    }


def offer_approvals_ready(row: RecruitmentApplication) -> bool:
    if not (row.job and row.job.offer_approvals_required):
        return True
    approvals = sorted(row.offer_approvals, key=lambda item: item.step_index)
    return bool(approvals) and all(item.status == "approved" for item in approvals)


def request_offer_approvals(
    db: Session, row: RecruitmentApplication, steps: list[str]
) -> dict:
    if row.stage != "offer":
        raise ValueError("Move the candidate to the offer stage first.")
    if not (row.job and row.job.offer_approvals_required):
        raise ValueError("This job does not require offer approvals.")
    names = [
        str(name).strip()[:120]
        for name in (steps or ["People lead", "Finance lead"])
        if str(name).strip()
    ][:5]
    if not names:
        raise ValueError("Add at least one approval step.")
    for existing in list(row.offer_approvals):
        db.delete(existing)
    db.flush()
    for index, name in enumerate(names):
        db.add(
            OfferApproval(
                application_id=row.id,
                step_index=index,
                step_name=name,
                status="pending",
            )
        )
    db.commit()
    db.refresh(row)
    from app.services.recruitment_service import serialize_application

    return serialize_application(row, detail=True)


def decide_offer_approval(
    db: Session,
    row: RecruitmentApplication,
    approval_id: int,
    *,
    decision: str,
    approver: str,
    note: str = "",
) -> dict:
    approval = (
        db.query(OfferApproval)
        .filter(
            OfferApproval.id == approval_id,
            OfferApproval.application_id == row.id,
        )
        .first()
    )
    if approval is None:
        raise ValueError("Approval step not found.")
    if approval.status != "pending":
        raise ValueError("This approval step is already decided.")
    decision = decision.strip().lower()
    if decision not in {"approve", "reject"}:
        raise ValueError("Decision must be approve or reject.")
    if decision == "reject" and not note.strip():
        raise ValueError("Add a rejection note.")
    approval.status = "approved" if decision == "approve" else "rejected"
    approval.approver = approver.strip()[:120] or "admin"
    approval.note = note.strip()[:500] or None
    approval.decided_at = datetime.utcnow()
    db.commit()
    db.refresh(row)
    from app.services.recruitment_service import serialize_application

    return serialize_application(row, detail=True)


def serialize_offer(row: RecruitmentApplication) -> dict | None:
    status = effective_offer_status(row)
    if not status:
        return None
    token = row.offer_token or ""
    return {
        "status": status,
        "sent_at": row.offer_sent_at.isoformat() if row.offer_sent_at else None,
        "expires_at": row.offer_expires_at.isoformat() if row.offer_expires_at else None,
        "responded_at": row.offer_responded_at.isoformat()
        if row.offer_responded_at
        else None,
        "signed_name": row.offer_signed_name,
        "response_note": row.offer_response_note,
        "delivery": {
            "status": row.offer_delivery_status or "not_sent",
            "error": row.offer_delivery_error,
            "last_sent_at": row.offer_last_sent_at.isoformat()
            if row.offer_last_sent_at
            else None,
            "reminder_sent_at": row.offer_reminder_sent_at.isoformat()
            if row.offer_reminder_sent_at
            else None,
            "reminder_count": row.offer_reminder_count or 0,
        },
        "countersigned": {
            "by": row.offer_countersigned_by,
            "at": row.offer_countersigned_at.isoformat()
            if row.offer_countersigned_at
            else None,
        },
        "template": {
            "id": row.offer_template_id,
            "name": row.offer_template_name,
            "terms": row.offer_terms,
        },
        "public_url": f"{settings.PIZZA_BLITZ_PUBLIC_URL.rstrip('/')}/offer/{token}"
        if token
        else None,
        "pdf_url": f"/api/v1/restaurant/careers/offers/{token}/pdf" if token else None,
    }


def _pdf(
    row: RecruitmentApplication, token: str, expires_at: datetime
) -> str:
    filename = f"offer-{row.id}-{token[:10]}.pdf"
    target = offer_dir() / filename
    job = row.job
    salary = (
        f"Rs {float(row.offered_salary):,.2f} per month"
        if row.offered_salary is not None
        else "As discussed"
    )
    joining = row.joining_date.strftime("%d %B %Y") if row.joining_date else "To be confirmed"
    styles = getSampleStyleSheet()
    body = ParagraphStyle(
        "OfferBody", parent=styles["BodyText"], fontSize=10.5, leading=16
    )
    small = ParagraphStyle("OfferSmall", parent=body, fontSize=8.5, leading=12)
    doc = SimpleDocTemplate(
        str(target),
        pagesize=A4,
        leftMargin=22 * mm,
        rightMargin=22 * mm,
        topMargin=20 * mm,
        bottomMargin=20 * mm,
        title=f"Offer letter - {row.candidate_name}",
        author="Pizza Blitz",
    )
    story = [
        Paragraph("<b>PIZZA BLITZ</b>", styles["Title"]),
        Paragraph("Kitchen &amp; Hospitality · Kolkata", small),
        Spacer(1, 10 * mm),
        Paragraph("<b>Offer of employment</b>", styles["Heading1"]),
        Spacer(1, 5 * mm),
        Paragraph(datetime.utcnow().strftime("%d %B %Y"), body),
        Spacer(1, 4 * mm),
        Paragraph(f"Dear {escape(row.candidate_name)},", body),
        Spacer(1, 3 * mm),
        Paragraph(
            "We are pleased to offer you the position of "
            f"<b>{escape(job.title if job else 'Team Member')}</b> at Pizza Blitz. "
            "Your experience and approach to hospitality stood out during the process, "
            "and we are excited about the possibility of you joining the team.",
            body,
        ),
        Spacer(1, 3 * mm),
        Paragraph(f"<b>Monthly gross salary:</b> {escape(salary)}", body),
        Paragraph(f"<b>Expected joining date:</b> {escape(joining)}", body),
        Paragraph(
            f"<b>Work location:</b> {escape(job.location if job and job.location else 'Kolkata')}",
            body,
        ),
        Spacer(1, 3 * mm),
        Paragraph(
            "This offer is subject to verification of your documents, right to work and "
            "completion of the onboarding formalities. Your employment terms, leave, "
            "attendance and payroll will follow the Pizza Blitz people policies shared "
            "during onboarding.",
            body,
        ),
        Spacer(1, 3 * mm),
        *(
            [
                Paragraph(
                    escape(row.offer_terms).replace("\n", "<br/>"),
                    body,
                ),
                Spacer(1, 3 * mm),
            ]
            if row.offer_terms
            else []
        ),
        Paragraph(
            "Please respond through your secure offer link by "
            f"<b>{expires_at.strftime('%d %B %Y')}</b>. Accepting online records your "
            "electronic signature and starts your onboarding handoff.",
            body,
        ),
        Spacer(1, 10 * mm),
        Paragraph("Warm regards,", body),
        Spacer(1, 8 * mm),
        Paragraph("<b>People Team</b><br/>Pizza Blitz", body),
        Spacer(1, 5 * mm),
        Paragraph(
            (
                f"Countersigned by <b>{escape(row.offer_countersigned_by)}</b> "
                f"on {row.offer_countersigned_at.strftime('%d %B %Y')}."
            )
            if row.offer_countersigned_by
            else "Company countersignature pending.",
            small,
        ),
        Spacer(1, 8 * mm),
        Paragraph(
            "Offer reference: " + escape(token[:12].upper()) + "<br/>"
            "This letter is generated electronically and is valid without a physical seal.",
            small,
        ),
    ]
    doc.build(story)
    return filename


def generate_offer(
    db: Session,
    row: RecruitmentApplication,
    *,
    expires_in_days: int = 7,
    offered_salary: float | None = None,
    joining_date=None,
    template_id: int | None = None,
) -> dict:
    if row.stage != "offer":
        raise ValueError("Move the candidate to the offer stage first.")
    if offered_salary is not None:
        row.offered_salary = offered_salary
    if joining_date is not None:
        row.joining_date = joining_date
    if row.offered_salary is None:
        raise ValueError("Add the offered salary before generating a letter.")
    if not offer_approvals_ready(row):
        raise ValueError("Complete every offer approval step before generating the letter.")
    template = _resolve_template(db, template_id)
    row.offer_template_id = template.id if template else None
    row.offer_template_name = template.name if template else None
    row.offer_terms = template.body if template else None
    days = max(1, min(int(expires_in_days), 30))
    token = secrets.token_urlsafe(32)
    expires_at = datetime.utcnow() + timedelta(days=days)
    row.offer_token = token
    row.offer_status = "sent"
    row.offer_sent_at = datetime.utcnow()
    row.offer_expires_at = expires_at
    row.offer_responded_at = None
    row.offer_signed_name = None
    row.offer_response_note = None
    row.offer_pdf_name = _pdf(row, token, expires_at)
    row.offer_delivery_status = "not_sent"
    row.offer_delivery_error = None
    row.offer_last_sent_at = None
    row.offer_reminder_sent_at = None
    row.offer_reminder_count = 0
    db.commit()
    db.refresh(row)
    from app.services.recruitment_service import serialize_application

    return serialize_application(row, detail=True)


def find_by_token(db: Session, token: str) -> RecruitmentApplication | None:
    clean = (token or "").strip()
    if not clean:
        return None
    return (
        db.query(RecruitmentApplication)
        .filter(RecruitmentApplication.offer_token == clean)
        .first()
    )


def offer_path(row: RecruitmentApplication) -> Path | None:
    name = (row.offer_pdf_name or "").strip()
    if not name or Path(name).name != name:
        return None
    target = (offer_dir() / name).resolve()
    if offer_dir().resolve() not in target.parents:
        return None
    return target if target.exists() else None


def public_offer_payload(row: RecruitmentApplication) -> dict:
    return {
        "candidate_name": row.candidate_name,
        "job_title": row.job.title if row.job else "Team Member",
        "department": row.job.department if row.job else None,
        "location": row.job.location if row.job else None,
        "employment_type": row.job.employment_type if row.job else None,
        "offered_salary": row.offered_salary,
        "joining_date": row.joining_date.isoformat() if row.joining_date else None,
        "status": effective_offer_status(row),
        "expires_at": row.offer_expires_at.isoformat() if row.offer_expires_at else None,
        "signed_name": row.offer_signed_name,
        "countersigned_by": row.offer_countersigned_by,
        "countersigned_at": row.offer_countersigned_at.isoformat()
        if row.offer_countersigned_at
        else None,
        "template_name": row.offer_template_name,
        "terms": row.offer_terms,
    }


def offer_email_content(row: RecruitmentApplication, *, reminder: bool = False) -> tuple[str, str]:
    title = row.job.title if row.job else "Team Member"
    url = f"{settings.PIZZA_BLITZ_PUBLIC_URL.rstrip('/')}/offer/{row.offer_token}"
    expiry = (
        row.offer_expires_at.strftime("%d %B %Y")
        if row.offer_expires_at
        else "the expiry date"
    )
    salary = (
        f"Rs {float(row.offered_salary):,.2f} per month"
        if row.offered_salary is not None
        else "As discussed"
    )
    subject = (
        f"Reminder: your Pizza Blitz offer for {title}"
        if reminder
        else f"Your Pizza Blitz offer for {title}"
    )
    body = (
        f"Hi {row.candidate_name},\n\n"
        + (
            "This is a reminder that your offer is still waiting for a response.\n\n"
            if reminder
            else "We are delighted to share your formal offer with you.\n\n"
        )
        + f"Role: {title}\n"
        + f"Monthly gross salary: {salary}\n"
        + f"Respond by: {expiry}\n\n"
        + f"Review, download and respond securely: {url}\n\n"
        + "If the link has expired, contact the Pizza Blitz people team for a new letter.\n\n"
        + "Warm regards,\nPeople Team, Pizza Blitz"
    )
    return subject, body


def send_offer_notification(
    db: Session, row: RecruitmentApplication, *, reminder: bool = False
) -> dict:
    if not row.offer_token or effective_offer_status(row) != "sent":
        raise ValueError("Only an open, unexpired offer can be sent.")
    destination = (row.email or "").strip()
    if not destination:
        raise ValueError("Add a candidate email before sending the offer.")
    subject, message = offer_email_content(row, reminder=reminder)
    result = send_campaign_message(
        channel="email",
        destination=destination,
        message=message,
        subject=subject,
        db=db,
    )
    row.offer_delivery_status = result.status
    row.offer_delivery_error = (result.error or "")[:2000] or None
    if result.status == "sent":
        row.offer_last_sent_at = datetime.utcnow()
        row.offer_delivery_error = None
        if reminder:
            row.offer_reminder_sent_at = datetime.utcnow()
            row.offer_reminder_count = int(row.offer_reminder_count or 0) + 1
    db.commit()
    db.refresh(row)
    from app.services.recruitment_service import serialize_application

    return {
        "application": serialize_application(row, detail=True),
        "delivery": {
            "status": result.status,
            "provider": result.provider,
            "error": result.error,
            "reminder": reminder,
        },
    }


def countersign_offer(
    db: Session, row: RecruitmentApplication, *, signed_by: str
) -> dict:
    if not row.offer_token or not row.offer_pdf_name:
        raise ValueError("Generate the offer letter before countersigning.")
    name = signed_by.strip()[:160]
    if len(name) < 2:
        raise ValueError("Enter the countersigning person's name.")
    row.offer_countersigned_by = name
    row.offer_countersigned_at = datetime.utcnow()
    row.offer_pdf_name = _pdf(row, row.offer_token, row.offer_expires_at)
    db.commit()
    db.refresh(row)
    from app.services.recruitment_service import serialize_application

    return serialize_application(row, detail=True)


def run_offer_reminders(db: Session | None = None) -> dict:
    from app.db.session import SessionLocal

    session = db or SessionLocal()
    owns_session = db is None
    try:
        now = datetime.utcnow()
        horizon = now + timedelta(days=3)
        rows = (
            session.query(RecruitmentApplication)
            .filter(
                RecruitmentApplication.offer_status == "sent",
                RecruitmentApplication.offer_expires_at.isnot(None),
                RecruitmentApplication.offer_expires_at > now,
                RecruitmentApplication.offer_expires_at <= horizon,
                RecruitmentApplication.offer_reminder_count < 2,
                RecruitmentApplication.email.isnot(None),
            )
            .all()
        )
        sent = 0
        skipped = 0
        for row in rows:
            if row.offer_reminder_sent_at and (
                now - row.offer_reminder_sent_at < timedelta(hours=24)
            ):
                skipped += 1
                continue
            try:
                result = send_offer_notification(session, row, reminder=True)
            except ValueError:
                skipped += 1
                continue
            if result["delivery"]["status"] == "sent":
                sent += 1
            else:
                skipped += 1
        return {"candidates": len(rows), "sent": sent, "skipped": skipped}
    finally:
        if owns_session:
            session.close()


def respond_to_offer(
    db: Session,
    row: RecruitmentApplication,
    *,
    decision: str,
    signed_name: str,
    note: str = "",
) -> dict:
    status = effective_offer_status(row)
    if status != "sent":
        raise ValueError(f"This offer is {status or 'not available'} and cannot be changed.")
    if decision not in {"accept", "decline"}:
        raise ValueError("Choose accept or decline.")
    if decision == "accept" and len(signed_name.strip()) < 2:
        raise ValueError("Type your full name to accept the offer.")
    row.offer_status = "accepted" if decision == "accept" else "declined"
    row.offer_responded_at = datetime.utcnow()
    row.offer_signed_name = signed_name.strip()[:160] or None
    row.offer_response_note = note.strip()[:2000] or None
    target = "hired" if decision == "accept" else "rejected"
    from app.services.recruitment_service import move_application

    serialized = move_application(
        db,
        row,
        stage=target,
        actor=f"candidate:{signed_name.strip()[:80]}",
        note=(
            "Offer accepted electronically."
            if decision == "accept"
            else "Offer declined by candidate."
        )
        + (f" Note: {note.strip()[:300]}" if note.strip() else ""),
        rejection_reason=(
            f"Candidate declined the offer. {note.strip()[:400]}"
            if decision == "decline"
            else ""
        ),
    )
    serialized["offer"] = serialize_offer(row)
    return serialized
