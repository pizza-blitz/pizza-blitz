from datetime import date
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.api.deps import get_db, require_roles
from app.models.domain import DailySales, SavedReport
from app.services.report_builder_service import (
    ReportValidationError,
    build_report,
    next_run_at,
    parse_recipients,
    report_csv,
    run_saved_report,
    validate_config,
    validate_schedule,
)

router = APIRouter()


class ReportSummary(BaseModel):
    total_sales: float
    total_expense: float
    net_profit: float
    order_count: int  # Using daily entries count for now
    avg_per_day: float


class DailyRecord(BaseModel):
    date: date
    sale: float
    expense: float
    profit: float


class CustomReportRequest(BaseModel):
    start_date: date
    end_date: date
    metrics: list[str]
    dimensions: list[str] = Field(default_factory=list)
    filters: dict[str, str] = Field(default_factory=dict)


class SavedReportCreate(BaseModel):
    name: str = Field(min_length=2, max_length=120)
    metrics: list[str]
    dimensions: list[str] = Field(default_factory=list)
    range_days: int = Field(default=30, ge=1, le=365)
    filters: dict[str, str] = Field(default_factory=dict)
    schedule: str = "none"
    recipients: Optional[str] = Field(default=None, max_length=500)


class SavedReportUpdate(BaseModel):
    name: Optional[str] = Field(default=None, min_length=2, max_length=120)
    metrics: Optional[list[str]] = None
    dimensions: Optional[list[str]] = None
    range_days: Optional[int] = Field(default=None, ge=1, le=365)
    filters: Optional[dict[str, str]] = None
    schedule: Optional[str] = None
    recipients: Optional[str] = Field(default=None, max_length=500)
    status: Optional[str] = Field(default=None, pattern="^(active|paused)$")


def serialize_saved_report(saved: SavedReport) -> dict:
    return {
        "id": saved.id,
        "name": saved.name,
        "metrics": list(saved.metrics or []),
        "dimensions": list(saved.dimensions or []),
        "range_days": saved.range_days,
        "filters": dict(saved.filters or {}),
        "schedule": saved.schedule,
        "recipients": saved.recipients,
        "status": saved.status,
        "created_by": saved.created_by,
        "last_run_at": saved.last_run_at.isoformat() if saved.last_run_at else None,
        "last_delivery_status": saved.last_delivery_status,
        "last_delivery_error": saved.last_delivery_error,
        "next_run_at": saved.next_run_at.isoformat() if saved.next_run_at else None,
        "created_at": saved.created_at.isoformat() if saved.created_at else None,
    }


@router.get("/reports")
def get_reports_data(
    start_date: Optional[date] = None,
    end_date: Optional[date] = None,
    db: Session = Depends(get_db),
):
    query = db.query(DailySales)
    if start_date:
        query = query.filter(DailySales.date >= start_date)
    if end_date:
        query = query.filter(DailySales.date <= end_date)

    records = query.order_by(DailySales.date.desc()).all()

    total_sale = sum(float(r.total_sale) for r in records)
    total_expense = sum(float(r.total_expense) for r in records)

    return {
        "summary": {
            "total_sales": total_sale,
            "total_expense": total_expense,
            "net_profit": total_sale - total_expense,
            "days_count": len(records),
            "avg_sale": total_sale / len(records) if records else 0,
        },
        "records": [
            {
                "date": r.date,
                "sale": float(r.total_sale),
                "expense": float(r.total_expense),
                "profit": float(r.total_sale - r.total_expense),
            }
            for r in records
        ],
    }


@router.post("/custom")
def run_custom_report(
    payload: CustomReportRequest,
    db: Session = Depends(get_db),
    session: dict = Depends(require_roles("admin", "staff")),
):
    del session
    try:
        return build_report(
            db,
            start_date=payload.start_date,
            end_date=payload.end_date,
            metrics=payload.metrics,
            dimensions=payload.dimensions,
            filters=payload.filters,
        )
    except ReportValidationError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


@router.get("/saved")
def list_saved_reports(
    db: Session = Depends(get_db),
    session: dict = Depends(require_roles("admin", "staff")),
):
    del session
    saved = (
        db.query(SavedReport)
        .order_by(SavedReport.created_at.desc(), SavedReport.id.desc())
        .all()
    )
    return [serialize_saved_report(row) for row in saved]


@router.post("/saved")
def create_saved_report(
    payload: SavedReportCreate,
    db: Session = Depends(get_db),
    session: dict = Depends(require_roles("admin", "staff")),
):
    try:
        validate_config(payload.metrics, payload.dimensions)
        schedule = validate_schedule(payload.schedule, payload.recipients)
        if schedule != "none":
            parse_recipients(payload.recipients)
    except ReportValidationError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    saved = SavedReport(
        name=payload.name.strip(),
        metrics=list(dict.fromkeys(payload.metrics)),
        dimensions=list(dict.fromkeys(payload.dimensions)),
        range_days=payload.range_days,
        filters=payload.filters,
        schedule=schedule,
        recipients=(payload.recipients or "").strip() or None,
        status="active",
        created_by=session.get("display_name") or session.get("subject") or "Admin",
        next_run_at=next_run_at(schedule),
    )
    db.add(saved)
    db.commit()
    db.refresh(saved)
    return serialize_saved_report(saved)


@router.patch("/saved/{report_id}")
def update_saved_report(
    report_id: int,
    payload: SavedReportUpdate,
    db: Session = Depends(get_db),
    session: dict = Depends(require_roles("admin", "staff")),
):
    del session
    saved = db.query(SavedReport).filter(SavedReport.id == report_id).first()
    if saved is None:
        raise HTTPException(status_code=404, detail="Saved report not found.")
    metrics = payload.metrics if payload.metrics is not None else list(saved.metrics or [])
    dimensions = (
        payload.dimensions
        if payload.dimensions is not None
        else list(saved.dimensions or [])
    )
    schedule = (
        payload.schedule if payload.schedule is not None else saved.schedule
    )
    recipients = (
        payload.recipients if payload.recipients is not None else saved.recipients
    )
    try:
        validate_config(metrics, dimensions)
        schedule = validate_schedule(schedule, recipients)
    except ReportValidationError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    if payload.name is not None:
        saved.name = payload.name.strip()
    saved.metrics = list(dict.fromkeys(metrics))
    saved.dimensions = list(dict.fromkeys(dimensions))
    if payload.range_days is not None:
        saved.range_days = payload.range_days
    if payload.filters is not None:
        saved.filters = payload.filters
    saved.schedule = schedule
    saved.recipients = (recipients or "").strip() or None
    if payload.status is not None:
        saved.status = payload.status
    saved.next_run_at = next_run_at(schedule)
    db.commit()
    db.refresh(saved)
    return serialize_saved_report(saved)


@router.delete("/saved/{report_id}")
def delete_saved_report(
    report_id: int,
    db: Session = Depends(get_db),
    session: dict = Depends(require_roles("admin", "staff")),
):
    del session
    saved = db.query(SavedReport).filter(SavedReport.id == report_id).first()
    if saved is None:
        raise HTTPException(status_code=404, detail="Saved report not found.")
    db.delete(saved)
    db.commit()
    return {"status": "deleted", "id": report_id}


@router.post("/saved/{report_id}/run")
def run_saved(
    report_id: int,
    db: Session = Depends(get_db),
    session: dict = Depends(require_roles("admin", "staff")),
):
    del session
    saved = db.query(SavedReport).filter(SavedReport.id == report_id).first()
    if saved is None:
        raise HTTPException(status_code=404, detail="Saved report not found.")
    try:
        report = run_saved_report(db, saved)
    except ReportValidationError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    return {**report, "saved_report": serialize_saved_report(saved)}


@router.post("/saved/{report_id}/deliver")
def deliver_saved(
    report_id: int,
    db: Session = Depends(get_db),
    session: dict = Depends(require_roles("admin", "staff")),
):
    del session
    saved = db.query(SavedReport).filter(SavedReport.id == report_id).first()
    if saved is None:
        raise HTTPException(status_code=404, detail="Saved report not found.")
    if not parse_recipients(saved.recipients):
        raise HTTPException(status_code=422, detail="Add at least one recipient.")
    report = run_saved_report(db, saved, deliver=True)
    db.refresh(saved)
    return {
        **report,
        "saved_report": serialize_saved_report(saved),
        "delivery_status": saved.last_delivery_status,
        "delivery_error": saved.last_delivery_error,
    }


@router.get("/saved/{report_id}/export")
def export_saved(
    report_id: int,
    db: Session = Depends(get_db),
    session: dict = Depends(require_roles("admin", "staff")),
):
    del session
    saved = db.query(SavedReport).filter(SavedReport.id == report_id).first()
    if saved is None:
        raise HTTPException(status_code=404, detail="Saved report not found.")
    report = run_saved_report(db, saved)
    filename = "".join(
        character if character.isalnum() else "-"
        for character in saved.name.lower()
    ).strip("-") or f"report-{saved.id}"
    return StreamingResponse(
        iter([report_csv(report)]),
        media_type="text/csv",
        headers={"Content-Disposition": f'attachment; filename="{filename}.csv"'},
    )

