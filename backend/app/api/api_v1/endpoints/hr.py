from datetime import date
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.api.deps import get_db, require_roles
from app.models.domain import HREmployee
from app.services.hr_service import (
    create_employee,
    employee_summary,
    list_employees,
    serialize_employee,
    update_employee,
)

router = APIRouter()


class HREmployeeCreate(BaseModel):
    employee_code: Optional[str] = Field(default=None, max_length=40)
    full_name: str = Field(min_length=2, max_length=160)
    email: Optional[str] = Field(default=None, max_length=200)
    phone: Optional[str] = Field(default=None, max_length=30)
    designation: Optional[str] = Field(default=None, max_length=120)
    employment_type: str = Field(default="full_time", max_length=30)
    status: str = Field(default="active", max_length=30)
    joining_date: Optional[date] = None
    store_id: Optional[int] = None
    staff_id: Optional[str] = Field(default=None, max_length=120)
    reports_to: Optional[str] = Field(default=None, max_length=160)
    notes: Optional[str] = Field(default=None, max_length=1000)
    external_system: Optional[str] = Field(default=None, max_length=80)
    external_id: Optional[str] = Field(default=None, max_length=120)


class HREmployeeUpdate(BaseModel):
    employee_code: Optional[str] = Field(default=None, max_length=40)
    full_name: Optional[str] = Field(default=None, min_length=2, max_length=160)
    email: Optional[str] = Field(default=None, max_length=200)
    phone: Optional[str] = Field(default=None, max_length=30)
    designation: Optional[str] = Field(default=None, max_length=120)
    employment_type: Optional[str] = Field(default=None, max_length=30)
    status: Optional[str] = Field(default=None, max_length=30)
    joining_date: Optional[date] = None
    store_id: Optional[int] = None
    staff_id: Optional[str] = Field(default=None, max_length=120)
    reports_to: Optional[str] = Field(default=None, max_length=160)
    notes: Optional[str] = Field(default=None, max_length=1000)
    external_system: Optional[str] = Field(default=None, max_length=80)
    external_id: Optional[str] = Field(default=None, max_length=120)


def _employee_or_404(db: Session, employee_id: int) -> HREmployee:
    employee = db.query(HREmployee).filter(HREmployee.id == employee_id).first()
    if employee is None:
        raise HTTPException(status_code=404, detail="HR employee not found.")
    return employee


@router.get("/employees")
def list_hr_employees(
    q: str = Query(default="", max_length=120),
    status: str = Query(default="", max_length=30),
    employment_type: str = Query(default="", max_length=30),
    store_id: Optional[int] = Query(default=None),
    db: Session = Depends(get_db),
    _: dict = Depends(require_roles("admin")),
):
    rows = list_employees(db, q, status, employment_type, store_id)
    return {"employees": [serialize_employee(row) for row in rows]}


@router.get("/summary")
def hr_employee_summary(
    db: Session = Depends(get_db),
    _: dict = Depends(require_roles("admin")),
):
    return employee_summary(db)


@router.post("/employees", status_code=201)
def create_hr_employee(
    payload: HREmployeeCreate,
    db: Session = Depends(get_db),
    _: dict = Depends(require_roles("admin")),
):
    try:
        employee = create_employee(db, payload.model_dump())
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    return serialize_employee(employee)


@router.get("/employees/{employee_id}")
def get_hr_employee(
    employee_id: int,
    db: Session = Depends(get_db),
    _: dict = Depends(require_roles("admin")),
):
    return serialize_employee(_employee_or_404(db, employee_id))


@router.patch("/employees/{employee_id}")
def update_hr_employee(
    employee_id: int,
    payload: HREmployeeUpdate,
    db: Session = Depends(get_db),
    _: dict = Depends(require_roles("admin")),
):
    employee = _employee_or_404(db, employee_id)
    try:
        employee = update_employee(
            db, employee, payload.model_dump(exclude_unset=True)
        )
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    return serialize_employee(employee)
