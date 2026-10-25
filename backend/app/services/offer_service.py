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
from app.services.media_service import media_root


def offer_dir() -> Path:
    target = media_root() / "offers"
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
        Spacer(1, 12 * mm),
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
    }


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
