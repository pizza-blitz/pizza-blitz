from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.api.deps import get_db, require_roles
from app.services.hr_attendance_service import (
    clock_in,
    clock_out,
    day_roster,
    history,
    regularize,
    serialize,
)

router = APIRouter()


class ClockAction(BaseModel):
    employee_id: int
    note: Optional[str] = Field(default=None, max_length=500)


class RegularizePayload(BaseModel):
    date: str
    status: str = Field(default="present", max_length=20)
    check_in_at: Optional[str] = None
    check_out_at: Optional[str] = None
    note: Optional[str] = Field(default=None, max_length=500)


@router.get("/attendance/day")
def attendance_day(
    date: Optional[str] = Query(default=None),
    store_id: Optional[int] = Query(default=None),
    db: Session = Depends(get_db),
    _: dict = Depends(require_roles("admin")),
):
    try:
        return day_roster(db, date, store_id)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


@router.post("/attendance/clock-in")
def attendance_clock_in(
    payload: ClockAction,
    db: Session = Depends(get_db),
    _: dict = Depends(require_roles("admin")),
):
    try:
        return serialize(clock_in(db, payload.employee_id, payload.note))
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


@router.post("/attendance/clock-out")
def attendance_clock_out(
    payload: ClockAction,
    db: Session = Depends(get_db),
    _: dict = Depends(require_roles("admin")),
):
    try:
        return serialize(clock_out(db, payload.employee_id, payload.note))
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


@router.patch("/attendance/{employee_id}")
def attendance_regularize(
    employee_id: int,
    payload: RegularizePayload,
    db: Session = Depends(get_db),
    _: dict = Depends(require_roles("admin")),
):
    try:
        return serialize(regularize(db, employee_id, payload.model_dump()))
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


@router.get("/attendance/history")
def attendance_history(
    employee_id: int,
    month: Optional[str] = Query(default=None, max_length=7),
    db: Session = Depends(get_db),
    _: dict = Depends(require_roles("admin")),
):
    try:
        return {"records": history(db, employee_id, month)}
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
