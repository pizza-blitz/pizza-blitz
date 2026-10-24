from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.api.deps import get_db, require_roles
from app.services.journey_service import (
    create_journey,
    enroll_manual,
    get_journey,
    list_journeys,
    process_due,
    update_journey,
)

router = APIRouter()


class JourneyStep(BaseModel):
    type: str = Field(min_length=3, max_length=20)
    hours: Optional[float] = Field(default=None, ge=0, le=720)
    channel: Optional[str] = Field(default=None, max_length=30)
    subject: Optional[str] = Field(default=None, max_length=255)
    body: Optional[str] = Field(default=None, max_length=4000)
    template_id: Optional[int] = None


class JourneyCreate(BaseModel):
    name: str = Field(min_length=2, max_length=160)
    description: str = Field(default="", max_length=500)
    trigger: str = Field(min_length=3, max_length=50)
    steps: List[JourneyStep] = Field(min_length=1, max_length=20)
    status: str = Field(default="draft", max_length=20)


class JourneyUpdate(BaseModel):
    name: Optional[str] = Field(default=None, min_length=2, max_length=160)
    description: Optional[str] = Field(default=None, max_length=500)
    trigger: Optional[str] = Field(default=None, min_length=3, max_length=50)
    steps: Optional[List[JourneyStep]] = Field(default=None, max_length=20)
    status: Optional[str] = Field(default=None, max_length=20)


class ManualEnroll(BaseModel):
    destination: str = Field(min_length=2, max_length=255)
    name: str = Field(default="", max_length=160)
    email: str = Field(default="", max_length=255)


def _steps(payload: JourneyCreate | JourneyUpdate) -> list[dict] | None:
    if payload.steps is None:
        return None
    return [step.model_dump(exclude_none=True) for step in payload.steps]


@router.get("")
def journeys(
    db: Session = Depends(get_db),
    _: dict = Depends(require_roles("admin")),
):
    return {"journeys": list_journeys(db)}


@router.get("/triggers")
def journey_triggers(_: dict = Depends(require_roles("admin"))):
    from app.services.journey_service import TRIGGERS

    return {"triggers": TRIGGERS}


@router.post("/run-due")
def run_due(
    db: Session = Depends(get_db),
    _: dict = Depends(require_roles("admin")),
):
    return process_due(db)


@router.post("", status_code=201)
def save_journey(
    payload: JourneyCreate,
    db: Session = Depends(get_db),
    _: dict = Depends(require_roles("admin")),
):
    try:
        return {
            "journey": create_journey(
                db,
                name=payload.name,
                description=payload.description,
                trigger=payload.trigger,
                steps=_steps(payload) or [],
                status=payload.status,
            )
        }
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


@router.get("/{journey_id}")
def journey_detail(
    journey_id: int,
    db: Session = Depends(get_db),
    _: dict = Depends(require_roles("admin")),
):
    from app.services.journey_service import serialize_journey

    row = get_journey(db, journey_id)
    if row is None:
        raise HTTPException(status_code=404, detail="Journey not found.")
    return {"journey": serialize_journey(db, row)}


@router.patch("/{journey_id}")
def edit_journey(
    journey_id: int,
    payload: JourneyUpdate,
    db: Session = Depends(get_db),
    _: dict = Depends(require_roles("admin")),
):
    row = get_journey(db, journey_id)
    if row is None:
        raise HTTPException(status_code=404, detail="Journey not found.")
    try:
        return {
            "journey": update_journey(
                db,
                row,
                name=payload.name,
                description=payload.description,
                trigger=payload.trigger,
                steps=_steps(payload),
                status=payload.status,
            )
        }
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


@router.post("/{journey_id}/enroll", status_code=201)
def manual_enroll(
    journey_id: int,
    payload: ManualEnroll,
    db: Session = Depends(get_db),
    _: dict = Depends(require_roles("admin")),
):
    row = get_journey(db, journey_id)
    if row is None:
        raise HTTPException(status_code=404, detail="Journey not found.")
    try:
        return {
            "enrollment": enroll_manual(
                db,
                row,
                destination=payload.destination,
                name=payload.name,
                email=payload.email,
            )
        }
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
