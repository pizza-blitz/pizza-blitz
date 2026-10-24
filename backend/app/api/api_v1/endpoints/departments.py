from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.api.deps import get_db, require_hr_permission, require_roles
from app.models.domain import BusinessDepartment, StaffCredential
from app.services.department_service import (
    MODULE_BY_KEY,
    add_member,
    catalog_payload,
    create_department,
    delete_department,
    get_department,
    remove_member,
    serialize_department,
    update_department,
)

router = APIRouter()


class DepartmentCreate(BaseModel):
    name: str = Field(min_length=2, max_length=120)
    key: Optional[str] = Field(default=None, max_length=60)
    description: Optional[str] = Field(default=None, max_length=500)
    color: str = Field(default="#f97316", max_length=20)
    icon: str = Field(default="building", max_length=40)
    modules: list[str] = Field(default_factory=lambda: ["overview"])
    external_system: Optional[str] = Field(default=None, max_length=80)
    external_url: Optional[str] = Field(default=None, max_length=500)
    integration_status: str = Field(default="not_connected", max_length=30)


class DepartmentUpdate(BaseModel):
    name: Optional[str] = Field(default=None, min_length=2, max_length=120)
    description: Optional[str] = Field(default=None, max_length=500)
    color: Optional[str] = Field(default=None, max_length=20)
    icon: Optional[str] = Field(default=None, max_length=40)
    status: Optional[str] = Field(default=None, max_length=20)
    modules: Optional[list[str]] = None
    external_system: Optional[str] = Field(default=None, max_length=80)
    external_url: Optional[str] = Field(default=None, max_length=500)
    integration_status: Optional[str] = Field(default=None, max_length=30)


class MemberCreate(BaseModel):
    staff_id: str = Field(min_length=1, max_length=120)
    role: str = Field(default="member", max_length=20)


def _staff_map(db: Session) -> dict[str, StaffCredential]:
    return {
        staff.staff_id: staff for staff in db.query(StaffCredential).all()
    }


def _department_or_404(db: Session, key_or_id: str) -> BusinessDepartment:
    department = get_department(db, key_or_id)
    if department is None:
        raise HTTPException(status_code=404, detail="Department not found.")
    return department


@router.get("/catalog")
def department_module_catalog(
    _: dict = Depends(require_roles("admin")),
):
    return {"modules": catalog_payload()}


@router.get("/staff-catalog")
def department_staff_catalog(
    db: Session = Depends(get_db),
    _: dict = Depends(require_roles("admin")),
):
    return {
        "staff": [
            {
                "staff_id": staff.staff_id,
                "display_name": staff.display_name,
                "is_active": bool(staff.is_active),
            }
            for staff in db.query(StaffCredential)
            .order_by(StaffCredential.display_name.asc())
            .all()
        ]
    }


@router.get("/")
def list_departments(
    db: Session = Depends(get_db),
    session: dict = Depends(require_hr_permission("hr.view")),
):
    staff = _staff_map(db)
    rows = (
        db.query(BusinessDepartment)
        .order_by(BusinessDepartment.sort_order.asc(), BusinessDepartment.id.asc())
        .all()
    )
    if session.get("role") != "admin":
        rows = [row for row in rows if row.key == "hr"]
    return {
        "departments": [
            serialize_department(row, staff_by_id=staff) for row in rows
        ],
        "catalog": catalog_payload(),
    }


@router.post("/", status_code=201)
def create_department_endpoint(
    payload: DepartmentCreate,
    db: Session = Depends(get_db),
    _: dict = Depends(require_roles("admin")),
):
    unknown = [key for key in payload.modules if key not in MODULE_BY_KEY]
    if unknown:
        raise HTTPException(
            status_code=422,
            detail=f"Unknown department modules: {', '.join(unknown)}.",
        )
    try:
        department = create_department(db, payload.model_dump())
    except ValueError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    return serialize_department(
        department, staff_by_id=_staff_map(db), include_detail=True
    )


@router.get("/{key_or_id}")
def get_department_endpoint(
    key_or_id: str,
    db: Session = Depends(get_db),
    session: dict = Depends(require_hr_permission("hr.view")),
):
    department = _department_or_404(db, key_or_id)
    if session.get("role") != "admin" and department.key != "hr":
        raise HTTPException(status_code=403, detail="HR members can only open the HR department.")
    return serialize_department(
        department, staff_by_id=_staff_map(db), include_detail=True
    )


@router.patch("/{department_id}")
def update_department_endpoint(
    department_id: int,
    payload: DepartmentUpdate,
    db: Session = Depends(get_db),
    _: dict = Depends(require_roles("admin")),
):
    department = _department_or_404(db, str(department_id))
    try:
        department = update_department(
            db, department, payload.model_dump(exclude_none=True)
        )
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    return serialize_department(
        department, staff_by_id=_staff_map(db), include_detail=True
    )


@router.delete("/{department_id}", status_code=204)
def delete_department_endpoint(
    department_id: int,
    db: Session = Depends(get_db),
    _: dict = Depends(require_roles("admin")),
):
    department = _department_or_404(db, str(department_id))
    try:
        delete_department(db, department)
    except ValueError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    return None


@router.post("/{department_id}/members", status_code=201)
def add_department_member(
    department_id: int,
    payload: MemberCreate,
    db: Session = Depends(get_db),
    _: dict = Depends(require_roles("admin")),
):
    department = _department_or_404(db, str(department_id))
    try:
        add_member(db, department, payload.staff_id, payload.role)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    db.refresh(department)
    return serialize_department(
        department, staff_by_id=_staff_map(db), include_detail=True
    )


@router.delete("/{department_id}/members/{staff_id}", status_code=204)
def remove_department_member(
    department_id: int,
    staff_id: str,
    db: Session = Depends(get_db),
    _: dict = Depends(require_roles("admin")),
):
    department = _department_or_404(db, str(department_id))
    if not remove_member(db, department, staff_id):
        raise HTTPException(status_code=404, detail="Department member not found.")
    return None
