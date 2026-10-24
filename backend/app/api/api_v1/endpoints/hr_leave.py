from datetime import date
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.api.deps import get_db, require_roles
from app.models.domain import HRHoliday, HRLeaveType
from app.services.hr_leave_service import (
    balances_overview,
    cancel_request,
    create_holiday,
    create_leave_type,
    create_request,
    decide_request,
    leave_summary,
    list_requests,
    serialize_holiday,
    serialize_request,
    serialize_type,
)

router = APIRouter()


class LeaveTypeCreate(BaseModel):
    code: str = Field(min_length=2, max_length=30)
    name: str = Field(min_length=2, max_length=80)
    paid: bool = True
    annual_quota: float = Field(default=0, ge=0, le=365)
    carry_forward: bool = False
    max_carry_forward: float = Field(default=0, ge=0, le=365)
    color: str = Field(default="#0f766e", max_length=20)


class LeaveRequestCreate(BaseModel):
    employee_id: int
    leave_type_id: int
    start_date: date
    end_date: date
    reason: Optional[str] = Field(default=None, max_length=500)


class LeaveDecision(BaseModel):
    decision: str = Field(pattern="^(approved|rejected)$")
    note: Optional[str] = Field(default=None, max_length=500)


class LeaveCancel(BaseModel):
    note: Optional[str] = Field(default=None, max_length=500)


class HolidayCreate(BaseModel):
    name: str = Field(min_length=2, max_length=120)
    date: date
    store_id: Optional[int] = None
    notes: Optional[str] = Field(default=None, max_length=255)


@router.get("/leave/types")
def list_leave_types(
    db: Session = Depends(get_db),
    _: dict = Depends(require_roles("admin")),
):
    return {
        "types": [
            serialize_type(row)
            for row in db.query(HRLeaveType)
            .order_by(HRLeaveType.id.asc())
            .all()
        ]
    }


@router.post("/leave/types", status_code=201)
def create_leave_type_endpoint(
    payload: LeaveTypeCreate,
    db: Session = Depends(get_db),
    _: dict = Depends(require_roles("admin")),
):
    try:
        row = create_leave_type(db, payload.model_dump())
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    return serialize_type(row)


@router.get("/leave/requests")
def list_leave_requests(
    status: str = Query(default="", max_length=20),
    employee_id: Optional[int] = Query(default=None),
    db: Session = Depends(get_db),
    _: dict = Depends(require_roles("admin")),
):
    return {
        "requests": [
            serialize_request(row)
            for row in list_requests(db, status, employee_id)
        ]
    }


@router.post("/leave/requests", status_code=201)
def create_leave_request(
    payload: LeaveRequestCreate,
    db: Session = Depends(get_db),
    _: dict = Depends(require_roles("admin")),
):
    try:
        row = create_request(db, payload.model_dump())
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    return serialize_request(row)


@router.patch("/leave/requests/{request_id}/decision")
def decide_leave_request(
    request_id: int,
    payload: LeaveDecision,
    db: Session = Depends(get_db),
    session: dict = Depends(require_roles("admin")),
):
    try:
        row = decide_request(
            db,
            request_id,
            payload.decision,
            str(session.get("sub") or "admin"),
            payload.note,
        )
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    return serialize_request(row)


@router.patch("/leave/requests/{request_id}/cancel")
def cancel_leave_request(
    request_id: int,
    payload: LeaveCancel,
    db: Session = Depends(get_db),
    _: dict = Depends(require_roles("admin")),
):
    try:
        row = cancel_request(db, request_id, payload.note)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    return serialize_request(row)


@router.get("/leave/balances")
def leave_balances(
    year: int = Query(default_factory=lambda: date.today().year),
    db: Session = Depends(get_db),
    _: dict = Depends(require_roles("admin")),
):
    return {"year": year, "employees": balances_overview(db, year)}


@router.get("/leave/summary")
def leave_summary_endpoint(
    year: int = Query(default_factory=lambda: date.today().year),
    db: Session = Depends(get_db),
    _: dict = Depends(require_roles("admin")),
):
    return leave_summary(db, year)


@router.get("/leave/holidays")
def list_holidays(
    db: Session = Depends(get_db),
    _: dict = Depends(require_roles("admin")),
):
    return {
        "holidays": [
            serialize_holiday(row)
            for row in db.query(HRHoliday)
            .order_by(HRHoliday.date.asc())
            .all()
        ]
    }


@router.post("/leave/holidays", status_code=201)
def add_holiday(
    payload: HolidayCreate,
    db: Session = Depends(get_db),
    _: dict = Depends(require_roles("admin")),
):
    try:
        row = create_holiday(db, payload.model_dump())
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    return serialize_holiday(row)


@router.delete("/leave/holidays/{holiday_id}", status_code=204)
def delete_holiday(
    holiday_id: int,
    db: Session = Depends(get_db),
    _: dict = Depends(require_roles("admin")),
):
    row = db.query(HRHoliday).filter(HRHoliday.id == holiday_id).first()
    if row is None:
        raise HTTPException(status_code=404, detail="Holiday not found.")
    db.delete(row)
    db.commit()
    return None
