"""Quality and legal workspace: audits, temperature checks and licences."""

from datetime import date, datetime, timedelta
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.api.deps import get_db, require_department_permission
from app.core.clock import business_today
from app.models.domain import ComplianceLicence, QualityAudit, TemperatureLog

router = APIRouter()

AUDIT_DEPENDENCY = require_department_permission(
    "quality",
    "quality.audits",
    "quality.view",
)
LICENCE_DEPENDENCY = require_department_permission(
    "legal",
    "quality.licences",
    "legal.view",
)

AUDIT_STATUSES = {"scheduled", "in_progress", "completed", "cancelled"}
FINDING_SEVERITIES = {"low", "medium", "high", "critical"}
FINDING_STATUSES = {"open", "closed"}
TEMPERATURE_UNITS = {"fridge", "freezer", "hot_holding"}
ATTENTION_SEVERITY_RANK = {"critical": 0, "high": 1, "medium": 2, "low": 3}


class AuditCreate(BaseModel):
    title: str = Field(min_length=2, max_length=200)
    audit_type: str = Field(default="hygiene", min_length=1, max_length=40)
    scheduled_for: Optional[date] = None
    auditor: Optional[str] = Field(default=None, max_length=120)
    max_score: float = Field(default=100, gt=0)
    notes: Optional[str] = None


class AuditUpdate(BaseModel):
    title: Optional[str] = Field(default=None, min_length=2, max_length=200)
    audit_type: Optional[str] = Field(default=None, min_length=1, max_length=40)
    auditor: Optional[str] = Field(default=None, max_length=120)
    status: Optional[str] = Field(default=None, max_length=30)
    score: Optional[float] = None
    findings: Optional[list] = None
    notes: Optional[str] = None
    scheduled_for: Optional[date] = None


class TemperatureCreate(BaseModel):
    unit_name: str = Field(min_length=1, max_length=120)
    unit_type: str = Field(default="fridge", max_length=40)
    temperature_c: float
    recorded_by: Optional[str] = Field(default=None, max_length=120)
    notes: Optional[str] = Field(default=None, max_length=500)


class LicenceCreate(BaseModel):
    name: str = Field(min_length=2, max_length=200)
    category: str = Field(default="fssai", min_length=1, max_length=60)
    licence_number: Optional[str] = Field(default=None, max_length=120)
    issuing_authority: Optional[str] = Field(default=None, max_length=200)
    issued_on: Optional[date] = None
    expires_on: Optional[date] = None
    document_url: Optional[str] = Field(default=None, max_length=500)
    owner_staff_id: Optional[str] = Field(default=None, max_length=120)
    notes: Optional[str] = Field(default=None, max_length=1000)
    store_id: Optional[int] = None


class LicenceUpdate(BaseModel):
    name: Optional[str] = Field(default=None, min_length=2, max_length=200)
    category: Optional[str] = Field(default=None, min_length=1, max_length=60)
    licence_number: Optional[str] = Field(default=None, max_length=120)
    issuing_authority: Optional[str] = Field(default=None, max_length=200)
    issued_on: Optional[date] = None
    expires_on: Optional[date] = None
    status: Optional[str] = Field(default=None, max_length=30)
    document_url: Optional[str] = Field(default=None, max_length=500)
    owner_staff_id: Optional[str] = Field(default=None, max_length=120)
    notes: Optional[str] = Field(default=None, max_length=1000)
    store_id: Optional[int] = None


def _iso(value) -> Optional[str]:
    if value is None:
        return None
    if isinstance(value, (datetime, date)):
        return value.isoformat()
    if hasattr(value, "isoformat"):
        return value.isoformat()
    return str(value)


def _round1(value) -> float:
    return round(float(value or 0), 1)


def _normalize_findings(raw) -> list[dict]:
    if raw is None:
        return []
    if not isinstance(raw, list):
        raise HTTPException(status_code=422, detail="Findings must be a list.")
    normalized: list[dict] = []
    for entry in raw:
        if isinstance(entry, str):
            label = entry.strip()
            severity = "medium"
            status = "open"
            note = None
        elif isinstance(entry, dict):
            label = str(entry.get("label") or "").strip()
            severity = str(entry.get("severity") or "medium").strip().lower()
            status = str(entry.get("status") or "open").strip().lower()
            raw_note = entry.get("note")
            note = str(raw_note).strip() if raw_note is not None else None
            note = note or None
        else:
            raise HTTPException(
                status_code=422,
                detail="Each finding must be an object with a label.",
            )
        if not label:
            raise HTTPException(
                status_code=422, detail="Each finding needs a non-empty label."
            )
        if severity not in FINDING_SEVERITIES:
            raise HTTPException(
                status_code=422,
                detail="Finding severity must be low, medium, high or critical.",
            )
        if status not in FINDING_STATUSES:
            raise HTTPException(
                status_code=422,
                detail="Finding status must be open or closed.",
            )
        normalized.append(
            {
                "label": label[:200],
                "severity": severity,
                "status": status,
                "note": note,
            }
        )
    return normalized


def _audit_score_pct(audit: QualityAudit) -> Optional[float]:
    if audit.score is None:
        return None
    max_score = float(audit.max_score or 0)
    if max_score <= 0:
        return None
    return _round1(float(audit.score) / max_score * 100)


def _audit_dict(audit: QualityAudit) -> dict:
    findings = _normalize_findings(audit.findings or [])
    return {
        "id": audit.id,
        "title": audit.title,
        "audit_type": audit.audit_type,
        "auditor": audit.auditor,
        "status": audit.status,
        "score": _round1(audit.score) if audit.score is not None else None,
        "max_score": round(float(audit.max_score or 0), 2),
        "score_pct": _audit_score_pct(audit),
        "findings": findings,
        "open_findings": sum(
            1 for finding in findings if finding["status"] != "closed"
        ),
        "notes": audit.notes,
        "scheduled_for": _iso(audit.scheduled_for),
        "completed_at": _iso(audit.completed_at),
        "created_at": _iso(audit.created_at),
    }


def _audit_summary(audits: list[QualityAudit], today: date) -> dict:
    completed_scores = [
        _audit_score_pct(audit)
        for audit in audits
        if audit.status == "completed" and audit.score is not None
    ]
    completed_scores = [score for score in completed_scores if score is not None]
    overdue = sum(
        1
        for audit in audits
        if audit.status in {"scheduled", "in_progress"}
        and audit.scheduled_for is not None
        and audit.scheduled_for < today
    )
    return {
        "total": len(audits),
        "scheduled": sum(1 for audit in audits if audit.status == "scheduled"),
        "in_progress": sum(
            1 for audit in audits if audit.status == "in_progress"
        ),
        "completed": sum(1 for audit in audits if audit.status == "completed"),
        "overdue": overdue,
        "average_score": (
            _round1(sum(completed_scores) / len(completed_scores))
            if completed_scores
            else None
        ),
    }


def _temperature_status(unit_type: str, temperature_c: float) -> str:
    if unit_type == "fridge":
        if 1 <= temperature_c <= 5:
            return "ok"
        if 5 < temperature_c <= 8:
            return "warning"
        return "breach"
    if unit_type == "freezer":
        if temperature_c <= -15:
            return "ok"
        if temperature_c <= -12:
            return "warning"
        return "breach"
    if unit_type == "hot_holding":
        if temperature_c >= 63:
            return "ok"
        if temperature_c >= 60:
            return "warning"
        return "breach"
    return "breach"


def _temperature_dict(log: TemperatureLog) -> dict:
    return {
        "id": log.id,
        "unit_name": log.unit_name,
        "unit_type": log.unit_type,
        "temperature_c": _round1(log.temperature_c),
        "status": log.status,
        "recorded_by": log.recorded_by,
        "recorded_at": _iso(log.recorded_at),
        "notes": log.notes,
    }


def _licence_effective_status(licence: ComplianceLicence, today: date) -> str:
    stored = str(licence.status or "valid").strip().lower()
    if stored in {"void", "pending"}:
        return stored
    if licence.expires_on is None:
        return "valid"
    if licence.expires_on < today:
        return "expired"
    if licence.expires_on <= today + timedelta(days=30):
        return "due_soon"
    return "valid"


def _licence_dict(licence: ComplianceLicence, today: date) -> dict:
    effective = _licence_effective_status(licence, today)
    days_to_expiry = (
        (licence.expires_on - today).days
        if licence.expires_on is not None
        else None
    )
    return {
        "id": licence.id,
        "name": licence.name,
        "category": licence.category,
        "licence_number": licence.licence_number,
        "issuing_authority": licence.issuing_authority,
        "issued_on": _iso(licence.issued_on),
        "expires_on": _iso(licence.expires_on),
        "status": effective,
        "stored_status": licence.status,
        "days_to_expiry": days_to_expiry,
        "document_url": licence.document_url,
        "owner_staff_id": licence.owner_staff_id,
        "notes": licence.notes,
    }


def _attention_items(
    audits: list[QualityAudit],
    licences: list[ComplianceLicence],
    breaches_24h: int,
    today: date,
) -> list[dict]:
    due_cutoff = today + timedelta(days=7)
    attention: list[dict] = []
    for audit in audits:
        if audit.status not in {"scheduled", "in_progress"}:
            continue
        if audit.scheduled_for is None:
            continue
        if audit.scheduled_for < today:
            attention.append(
                {
                    "kind": "audit_overdue",
                    "label": f"Audit '{audit.title}' is overdue.",
                    "severity": "high",
                    "due_on": audit.scheduled_for.isoformat(),
                }
            )
        elif audit.scheduled_for <= due_cutoff:
            attention.append(
                {
                    "kind": "audit_due",
                    "label": f"Audit '{audit.title}' is due soon.",
                    "severity": "medium",
                    "due_on": audit.scheduled_for.isoformat(),
                }
            )
    if breaches_24h:
        attention.append(
            {
                "kind": "temperature_breach",
                "label": (
                    f"{breaches_24h} temperature "
                    f"{'breach' if breaches_24h == 1 else 'breaches'} "
                    "logged in the last 24 hours."
                ),
                "severity": "critical",
                "due_on": None,
            }
        )
    for licence in licences:
        effective = _licence_effective_status(licence, today)
        if effective == "expired":
            attention.append(
                {
                    "kind": "licence_expired",
                    "label": f"Licence '{licence.name}' has expired.",
                    "severity": "critical",
                    "due_on": _iso(licence.expires_on),
                }
            )
        elif effective == "due_soon":
            attention.append(
                {
                    "kind": "licence_due_soon",
                    "label": f"Licence '{licence.name}' expires within 30 days.",
                    "severity": "high",
                    "due_on": _iso(licence.expires_on),
                }
            )
    attention.sort(
        key=lambda item: (
            ATTENTION_SEVERITY_RANK.get(item["severity"], 9),
            item["due_on"] or "9999-12-31",
        )
    )
    return attention[:5]


@router.get("/overview")
def quality_overview(
    db: Session = Depends(get_db),
    session: dict = Depends(AUDIT_DEPENDENCY),
):
    del session
    today = business_today()
    now = datetime.utcnow()
    due_cutoff = today + timedelta(days=7)

    audits = db.query(QualityAudit).all()
    audits_due = [
        audit
        for audit in audits
        if audit.status in {"scheduled", "in_progress"}
        and audit.scheduled_for is not None
        and audit.scheduled_for <= due_cutoff
    ]
    completed_30d = [
        audit
        for audit in audits
        if audit.status == "completed"
        and audit.completed_at is not None
        and audit.completed_at >= now - timedelta(days=30)
    ]
    completed_scores = [
        score
        for score in (_audit_score_pct(audit) for audit in completed_30d)
        if score is not None
    ]
    open_findings = 0
    for audit in audits:
        findings = audit.findings if isinstance(audit.findings, list) else []
        open_findings += sum(
            1
            for finding in findings
            if isinstance(finding, dict) and finding.get("status") != "closed"
        )

    temperatures = (
        db.query(TemperatureLog)
        .filter(TemperatureLog.recorded_at >= now - timedelta(hours=24))
        .all()
    )
    breaches_24h = sum(1 for log in temperatures if log.status == "breach")

    licences = db.query(ComplianceLicence).all()
    effective = {
        licence.id: _licence_effective_status(licence, today)
        for licence in licences
    }
    licences_expiring = sum(
        1 for status in effective.values() if status == "due_soon"
    )
    licences_expired = sum(
        1 for status in effective.values() if status == "expired"
    )

    compliance_score = 100 - (20 * licences_expired) - (10 * breaches_24h)
    compliance_score -= 5 * len(audits_due)
    compliance_score = max(0, min(100, compliance_score))

    return {
        "audits_due": len(audits_due),
        "audits_completed_30d": len(completed_30d),
        "average_score": (
            _round1(sum(completed_scores) / len(completed_scores))
            if completed_scores
            else None
        ),
        "open_findings": open_findings,
        "temperature_checks_24h": len(temperatures),
        "temperature_breaches_24h": breaches_24h,
        "licences_expiring": licences_expiring,
        "licences_expired": licences_expired,
        "compliance_score": compliance_score,
        "attention": _attention_items(
            audits, licences, breaches_24h, today
        ),
    }


@router.get("/audits")
def list_audits(
    status: Optional[str] = None,
    limit: int = Query(default=50, ge=1, le=200),
    db: Session = Depends(get_db),
    session: dict = Depends(AUDIT_DEPENDENCY),
):
    del session
    today = business_today()
    query = db.query(QualityAudit)
    if status:
        query = query.filter(QualityAudit.status == status)
    audits = (
        query.order_by(QualityAudit.id.desc()).limit(limit).all()
    )
    return {
        "items": [_audit_dict(audit) for audit in audits],
        "summary": _audit_summary(audits, today),
    }


@router.post("/audits")
def create_audit(
    payload: AuditCreate,
    db: Session = Depends(get_db),
    session: dict = Depends(AUDIT_DEPENDENCY),
):
    del session
    audit = QualityAudit(
        title=payload.title.strip(),
        audit_type=payload.audit_type.strip() or "hygiene",
        auditor=(payload.auditor or "").strip() or None,
        status="scheduled",
        max_score=payload.max_score,
        findings=[],
        notes=(payload.notes or "").strip() or None,
        scheduled_for=payload.scheduled_for,
    )
    db.add(audit)
    db.commit()
    db.refresh(audit)
    return _audit_dict(audit)


@router.patch("/audits/{audit_id}")
def update_audit(
    audit_id: int,
    payload: AuditUpdate,
    db: Session = Depends(get_db),
    session: dict = Depends(AUDIT_DEPENDENCY),
):
    del session
    audit = db.query(QualityAudit).filter(QualityAudit.id == audit_id).first()
    if audit is None:
        raise HTTPException(status_code=404, detail="Audit not found.")
    if payload.status is not None and payload.status not in AUDIT_STATUSES:
        raise HTTPException(
            status_code=422,
            detail="Status must be scheduled, in_progress, completed or cancelled.",
        )
    if payload.score is not None:
        max_score = float(audit.max_score or 0)
        if payload.score < 0 or payload.score > max_score:
            raise HTTPException(
                status_code=422,
                detail=f"Score must be between 0 and {max_score:g}.",
            )
        audit.score = float(payload.score)
    if payload.title is not None:
        title = payload.title.strip()
        if len(title) < 2:
            raise HTTPException(status_code=422, detail="Title is too short.")
        audit.title = title
    if payload.audit_type is not None:
        audit.audit_type = payload.audit_type.strip() or audit.audit_type
    if payload.auditor is not None:
        audit.auditor = payload.auditor.strip() or None
    if payload.findings is not None:
        audit.findings = _normalize_findings(payload.findings)
    if payload.notes is not None:
        audit.notes = payload.notes.strip() or None
    if payload.scheduled_for is not None:
        audit.scheduled_for = payload.scheduled_for
    if payload.status is not None:
        audit.status = payload.status
        if payload.status == "completed" and audit.completed_at is None:
            audit.completed_at = datetime.utcnow()
    db.commit()
    db.refresh(audit)
    return _audit_dict(audit)


@router.get("/temperatures")
def list_temperatures(
    days: int = Query(default=7, ge=1, le=90),
    db: Session = Depends(get_db),
    session: dict = Depends(AUDIT_DEPENDENCY),
):
    del session
    cutoff = datetime.utcnow() - timedelta(days=days)
    logs = (
        db.query(TemperatureLog)
        .filter(TemperatureLog.recorded_at >= cutoff)
        .order_by(TemperatureLog.recorded_at.desc(), TemperatureLog.id.desc())
        .all()
    )
    items = [_temperature_dict(log) for log in logs]
    summary = {
        "checks": len(items),
        "ok": sum(1 for row in items if row["status"] == "ok"),
        "warning": sum(1 for row in items if row["status"] == "warning"),
        "breach": sum(1 for row in items if row["status"] == "breach"),
        "last_recorded_at": items[0]["recorded_at"] if items else None,
    }
    return {"items": items, "summary": summary}


@router.post("/temperatures")
def create_temperature(
    payload: TemperatureCreate,
    db: Session = Depends(get_db),
    session: dict = Depends(AUDIT_DEPENDENCY),
):
    del session
    unit_type = payload.unit_type.strip().lower()
    if unit_type not in TEMPERATURE_UNITS:
        raise HTTPException(
            status_code=422,
            detail="Unit type must be fridge, freezer or hot_holding.",
        )
    temperature = float(payload.temperature_c)
    if temperature != temperature or temperature in {float("inf"), float("-inf")}:
        raise HTTPException(
            status_code=422, detail="Temperature must be a finite number."
        )
    log = TemperatureLog(
        unit_name=payload.unit_name.strip(),
        unit_type=unit_type,
        temperature_c=temperature,
        status=_temperature_status(unit_type, temperature),
        recorded_by=(payload.recorded_by or "").strip() or None,
        recorded_at=datetime.utcnow(),
        notes=(payload.notes or "").strip() or None,
    )
    db.add(log)
    db.commit()
    db.refresh(log)
    return _temperature_dict(log)


@router.get("/licences")
def list_licences(
    category: Optional[str] = None,
    status: Optional[str] = None,
    db: Session = Depends(get_db),
    session: dict = Depends(LICENCE_DEPENDENCY),
):
    del session
    today = business_today()
    query = db.query(ComplianceLicence)
    if category:
        query = query.filter(ComplianceLicence.category == category)
    licences = query.order_by(ComplianceLicence.id.desc()).all()
    items = [_licence_dict(licence, today) for licence in licences]
    if status:
        items = [row for row in items if row["status"] == status]
    summary = {
        "total": len(items),
        "valid": sum(1 for row in items if row["status"] == "valid"),
        "due_soon": sum(1 for row in items if row["status"] == "due_soon"),
        "expired": sum(1 for row in items if row["status"] == "expired"),
        "void": sum(1 for row in items if row["status"] == "void"),
    }
    return {"items": items, "summary": summary}


@router.post("/licences")
def create_licence(
    payload: LicenceCreate,
    db: Session = Depends(get_db),
    session: dict = Depends(LICENCE_DEPENDENCY),
):
    del session
    if (
        payload.issued_on is not None
        and payload.expires_on is not None
        and payload.expires_on < payload.issued_on
    ):
        raise HTTPException(
            status_code=422,
            detail="Expiry date must be on or after the issue date.",
        )
    licence = ComplianceLicence(
        store_id=payload.store_id,
        name=payload.name.strip(),
        category=payload.category.strip() or "fssai",
        licence_number=(payload.licence_number or "").strip() or None,
        issuing_authority=(payload.issuing_authority or "").strip() or None,
        issued_on=payload.issued_on,
        expires_on=payload.expires_on,
        status="valid",
        document_url=(payload.document_url or "").strip() or None,
        owner_staff_id=(payload.owner_staff_id or "").strip() or None,
        notes=(payload.notes or "").strip() or None,
    )
    db.add(licence)
    db.commit()
    db.refresh(licence)
    return _licence_dict(licence, business_today())


@router.patch("/licences/{licence_id}")
def update_licence(
    licence_id: int,
    payload: LicenceUpdate,
    db: Session = Depends(get_db),
    session: dict = Depends(LICENCE_DEPENDENCY),
):
    del session
    licence = (
        db.query(ComplianceLicence)
        .filter(ComplianceLicence.id == licence_id)
        .first()
    )
    if licence is None:
        raise HTTPException(status_code=404, detail="Licence not found.")
    if payload.status is not None:
        status = payload.status.strip().lower()
        if not status:
            raise HTTPException(
                status_code=422, detail="Status cannot be empty."
            )
        licence.status = status
    if payload.name is not None:
        name = payload.name.strip()
        if len(name) < 2:
            raise HTTPException(status_code=422, detail="Name is too short.")
        licence.name = name
    if payload.category is not None:
        licence.category = payload.category.strip() or licence.category
    if payload.licence_number is not None:
        licence.licence_number = payload.licence_number.strip() or None
    if payload.issuing_authority is not None:
        licence.issuing_authority = payload.issuing_authority.strip() or None
    if payload.issued_on is not None:
        licence.issued_on = payload.issued_on
    if payload.expires_on is not None:
        licence.expires_on = payload.expires_on
    if payload.document_url is not None:
        licence.document_url = payload.document_url.strip() or None
    if payload.owner_staff_id is not None:
        licence.owner_staff_id = payload.owner_staff_id.strip() or None
    if payload.notes is not None:
        licence.notes = payload.notes.strip() or None
    if payload.store_id is not None:
        licence.store_id = payload.store_id
    if (
        licence.issued_on is not None
        and licence.expires_on is not None
        and licence.expires_on < licence.issued_on
    ):
        raise HTTPException(
            status_code=422,
            detail="Expiry date must be on or after the issue date.",
        )
    db.commit()
    db.refresh(licence)
    return _licence_dict(licence, business_today())
