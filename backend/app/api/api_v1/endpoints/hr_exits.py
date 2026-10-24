from datetime import date
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.api.deps import get_db, require_hr_permission
from app.models.domain import HRExit
from app.services.hr_exits_service import (
    EXIT_STATUSES,
    EXIT_TYPES,
    calculate_settlement,
    cancel_exit,
    create_exit,
    list_exits,
    serialize_exit,
    serialize_task,
    settle_exit,
    summary,
    update_clearance,
    update_exit,
)

router = APIRouter()


class ExitCreate(BaseModel):
    employee_id: int
    exit_type: str = Field(default="resignation", max_length=30)
    resignation_date: date
    last_working_date: date
    notice_days: int = Field(default=30, ge=0, le=180)
    reason: Optional[str] = Field(default=None, max_length=500)


class ExitUpdate(BaseModel):
    status: Optional[str] = Field(default=None, max_length=30)
    last_working_date: Optional[date] = None
    notice_days: Optional[int] = Field(default=None, ge=0, le=180)
    reason: Optional[str] = Field(default=None, max_length=500)


class ClearanceUpdate(BaseModel):
    status: str = Field(pattern="^(pending|cleared)$")
    notes: Optional[str] = Field(default=None, max_length=500)


class SettlePayload(BaseModel):
    force: bool = False


def _exit_or_404(db: Session, exit_id: int) -> HRExit:
    row = db.query(HRExit).filter(HRExit.id == exit_id).first()
    if row is None:
        raise HTTPException(status_code=404, detail="Exit record not found.")
    return row


@router.get("/exits/summary")
def exit_summary(
    db: Session = Depends(get_db),
    _: dict = Depends(require_hr_permission("hr.exits")),
):
    return summary(db)


@router.get("/exits")
def list_hr_exits(
    status: str = "",
    db: Session = Depends(get_db),
    _: dict = Depends(require_hr_permission("hr.exits")),
):
    return {
        "exits": [serialize_exit(row) for row in list_exits(db, status)],
        "exit_types": sorted(EXIT_TYPES),
        "statuses": sorted(EXIT_STATUSES),
    }


@router.post("/exits", status_code=201)
def create_hr_exit(
    payload: ExitCreate,
    db: Session = Depends(get_db),
    _: dict = Depends(require_hr_permission("hr.exits")),
):
    try:
        row = create_exit(db, payload.model_dump())
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    return serialize_exit(row)


@router.get("/exits/{exit_id}")
def get_hr_exit(
    exit_id: int,
    db: Session = Depends(get_db),
    _: dict = Depends(require_hr_permission("hr.exits")),
):
    row = _exit_or_404(db, exit_id)
    return {**serialize_exit(row), "preview": calculate_settlement(db, row)}


@router.patch("/exits/{exit_id}")
def update_hr_exit(
    exit_id: int,
    payload: ExitUpdate,
    db: Session = Depends(get_db),
    _: dict = Depends(require_hr_permission("hr.exits")),
):
    row = _exit_or_404(db, exit_id)
    try:
        row = update_exit(db, row, payload.model_dump(exclude_unset=True))
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    return serialize_exit(row)


@router.patch("/exits/clearance/{task_id}")
def update_hr_clearance(
    task_id: int,
    payload: ClearanceUpdate,
    db: Session = Depends(get_db),
    _: dict = Depends(require_hr_permission("hr.exits")),
):
    try:
        task = update_clearance(db, task_id, payload.status, payload.notes)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    return serialize_task(task)


@router.post("/exits/{exit_id}/settle")
def settle_hr_exit(
    exit_id: int,
    payload: SettlePayload,
    db: Session = Depends(get_db),
    _: dict = Depends(require_hr_permission("hr.exits")),
):
    row = _exit_or_404(db, exit_id)
    try:
        row = settle_exit(db, row, force=payload.force)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    return serialize_exit(row)


@router.post("/exits/{exit_id}/cancel")
def cancel_hr_exit(
    exit_id: int,
    db: Session = Depends(get_db),
    _: dict = Depends(require_hr_permission("hr.exits")),
):
    row = _exit_or_404(db, exit_id)
    try:
        row = cancel_exit(db, row)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    return serialize_exit(row)
