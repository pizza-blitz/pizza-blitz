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
from app.models.domain import RecruitmentApplication
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
) -> dict:
    if row.stage != "offer":
        raise ValueError("Move the candidate to the offer stage first.")
    if offered_salary is not None:
        row.offered_salary = offered_salary
    if joining_date is not None:
        row.joining_date = joining_date
    if row.offered_salary is None:
        raise ValueError("Add the offered salary before generating a letter.")
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
