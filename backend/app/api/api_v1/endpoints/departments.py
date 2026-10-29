from datetime import date
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.api.deps import get_current_session, get_db, require_roles
from app.models.domain import (
    BusinessDepartment,
    DepartmentRole,
    StaffCredential,
)
from app.services.company_catalog import MODULE_BY_KEY
from app.services.department_service import (
    access_state,
    add_member,
    catalog_payload,
    create_department,
    create_role,
    delete_department,
    delete_role,
    department_workspace,
    get_department,
    is_admin_session,
    member_has_permission,
    my_departments,
    navigation_payload,
    remove_member,
    scorecard,
    serialize_department,
    update_department,
    update_member,
    update_role,
    visible_department,
)

router = APIRouter()


class DepartmentCreate(BaseModel):
    name: str = Field(min_length=2, max_length=120)
    key: Optional[str] = Field(default=None, max_length=60)
    description: Optional[str] = Field(default=None, max_length=500)
    color: str = Field(default="#f97316", max_length=20)
    icon: str = Field(default="building", max_length=40)
    modules: list[str] = Field(default_factory=lambda: ["overview"])
    parent_key: Optional[str] = Field(default=None, max_length=60)
    head_staff_id: Optional[str] = Field(default=None, max_length=120)
    kind: str = Field(default="functional", max_length=20)
    store_id: Optional[int] = None
    cost_center: Optional[str] = Field(default=None, max_length=60)
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
    parent_key: Optional[str] = Field(default=None, max_length=60)
    head_staff_id: Optional[str] = Field(default=None, max_length=120)
    kind: Optional[str] = Field(default=None, max_length=20)
    store_id: Optional[int] = None
    cost_center: Optional[str] = Field(default=None, max_length=60)
    external_system: Optional[str] = Field(default=None, max_length=80)
    external_url: Optional[str] = Field(default=None, max_length=500)
    integration_status: Optional[str] = Field(default=None, max_length=30)


class MemberCreate(BaseModel):
    staff_id: str = Field(min_length=1, max_length=120)
    role: str = Field(default="member", max_length=20)
    title: Optional[str] = Field(default=None, max_length=120)
    reports_to_staff_id: Optional[str] = Field(default=None, max_length=120)
    department_role_id: Optional[int] = None
    store_id: Optional[int] = None
    effective_from: Optional[date] = None
    effective_to: Optional[date] = None


class MemberUpdate(BaseModel):
    role: Optional[str] = Field(default=None, max_length=20)
    title: Optional[str] = Field(default=None, max_length=120)
    reports_to_staff_id: Optional[str] = Field(default=None, max_length=120)
    department_role_id: Optional[int] = None
    store_id: Optional[int] = None
    effective_from: Optional[date] = None
    effective_to: Optional[date] = None


class RoleCreate(BaseModel):
    name: str = Field(min_length=2, max_length=80)
    key: Optional[str] = Field(default=None, max_length=40)
    description: Optional[str] = Field(default=None, max_length=240)
    level: str = Field(default="member", max_length=20)
    permissions: list[str] = Field(default_factory=list)


class RoleUpdate(BaseModel):
    name: Optional[str] = Field(default=None, min_length=2, max_length=80)
    description: Optional[str] = Field(default=None, max_length=240)
    level: Optional[str] = Field(default=None, max_length=20)
    permissions: Optional[list[str]] = None


def _staff_map(db: Session) -> dict[str, StaffCredential]:
    return {
        staff.staff_id: staff for staff in db.query(StaffCredential).all()
    }


def _department_or_404(db: Session, key_or_id: str) -> BusinessDepartment:
    department = get_department(db, key_or_id)
    if department is None:
        raise HTTPException(status_code=404, detail="Department not found.")
    return department


def _require_portal(session: dict) -> dict:
    if session.get("role") not in {"admin", "staff"}:
        raise HTTPException(
            status_code=403, detail="Staff access is required."
        )
    return session


def _require_department_view(
    db: Session, session: dict, key_or_id: str
) -> BusinessDepartment:
    department = _department_or_404(db, key_or_id)
    if is_admin_session(session):
        return department
    visible = visible_department(db, session, key_or_id)
    if visible is None:
        raise HTTPException(
            status_code=403,
            detail="You are not a member of that department.",
        )
    if not member_has_permission(
        db, session, department, f"{department.key}.view"
    ):
        raise HTTPException(
            status_code=403,
            detail=f"This account lacks the {department.key}.view permission.",
        )
    return department


def _require_manage(
    db: Session, session: dict, department: BusinessDepartment, permission: str
) -> None:
    if is_admin_session(session):
        return
    if not member_has_permission(db, session, department, permission):
        raise HTTPException(
            status_code=403,
            detail=f"This account lacks the {permission} permission.",
        )


def _detail(
    db: Session, session: dict, department: BusinessDepartment
) -> dict:
    return department_workspace(db, session, department)


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


@router.get("/navigation")
def department_navigation(
    db: Session = Depends(get_db),
    session: dict = Depends(get_current_session),
):
    return navigation_payload(db, _require_portal(session))


@router.get("/access")
def department_access(
    db: Session = Depends(get_db),
    session: dict = Depends(get_current_session),
):
    return access_state(db, _require_portal(session))


@router.get("/scorecard")
def department_scorecard(
    db: Session = Depends(get_db),
    session: dict = Depends(get_current_session),
):
    _require_portal(session)
    if is_admin_session(session):
        return scorecard(db)
    allowed = {row.key for row in my_departments(db, session)}
    return scorecard(db, allowed)


@router.get("/")
def list_departments(
    db: Session = Depends(get_db),
    session: dict = Depends(get_current_session),
):
    _require_portal(session)
    staff = _staff_map(db)
    rows = my_departments(db, session)
    if not rows and not is_admin_session(session):
        raise HTTPException(
            status_code=403,
            detail="You are not a member of any department.",
        )
    access = access_state(db, session)
    by_key = {row["key"]: row for row in access["departments"]}
    return {
        "departments": [
            serialize_department(
                row,
                staff_by_id=staff,
                permissions=set(
                    by_key.get(row.key, {}).get("permissions") or []
                ),
                is_admin=is_admin_session(session),
                session=session,
                db=db,
            )
            for row in rows
        ],
        "catalog": catalog_payload(),
        "is_admin": is_admin_session(session),
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
    session: dict = Depends(get_current_session),
):
    _require_portal(session)
    department = _require_department_view(db, session, key_or_id)
    return _detail(db, session, department)


@router.patch("/{department_id}")
def update_department_endpoint(
    department_id: int,
    payload: DepartmentUpdate,
    db: Session = Depends(get_db),
    session: dict = Depends(get_current_session),
):
    _require_portal(session)
    department = _department_or_404(db, str(department_id))
    _require_manage(
        db, session, department, f"{department.key}.manage_modules"
    )
    try:
        department = update_department(
            db, department, payload.model_dump(exclude_none=True)
        )
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    return _detail(db, session, department)


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
    session: dict = Depends(get_current_session),
):
    _require_portal(session)
    department = _department_or_404(db, str(department_id))
    _require_manage(db, session, department, f"{department.key}.manage_team")
    try:
        add_member(
            db,
            department,
            payload.staff_id,
            payload.role,
            title=payload.title,
            reports_to_staff_id=payload.reports_to_staff_id,
            department_role_id=payload.department_role_id,
            store_id=payload.store_id,
            effective_from=payload.effective_from,
            effective_to=payload.effective_to,
        )
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    db.refresh(department)
    return _detail(db, session, department)


@router.patch("/{department_id}/members/{staff_id}")
def update_department_member(
    department_id: int,
    staff_id: str,
    payload: MemberUpdate,
    db: Session = Depends(get_db),
    session: dict = Depends(get_current_session),
):
    _require_portal(session)
    department = _department_or_404(db, str(department_id))
    _require_manage(db, session, department, f"{department.key}.manage_team")
    try:
        update_member(
            db, department, staff_id, payload.model_dump(exclude_none=True)
        )
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    db.refresh(department)
    return _detail(db, session, department)


@router.delete("/{department_id}/members/{staff_id}", status_code=204)
def remove_department_member(
    department_id: int,
    staff_id: str,
    db: Session = Depends(get_db),
    session: dict = Depends(get_current_session),
):
    _require_portal(session)
    department = _department_or_404(db, str(department_id))
    _require_manage(db, session, department, f"{department.key}.manage_team")
    if not remove_member(db, department, staff_id):
        raise HTTPException(status_code=404, detail="Department member not found.")
    return None


@router.get("/{department_id}/roles")
def list_department_roles(
    department_id: int,
    db: Session = Depends(get_db),
    session: dict = Depends(get_current_session),
):
    _require_portal(session)
    department = _require_department_view(db, session, str(department_id))
    return {
        "roles": [
            {
                "id": role.id,
                "key": role.key,
                "name": role.name,
                "description": role.description,
                "level": role.level,
                "is_default": bool(role.is_default),
                "permissions": sorted(
                    row.permission_key
                    for row in role.permissions
                    if row.enabled
                ),
            }
            for role in sorted(department.roles, key=lambda row: row.id)
        ]
    }


@router.post("/{department_id}/roles", status_code=201)
def create_department_role(
    department_id: int,
    payload: RoleCreate,
    db: Session = Depends(get_db),
    session: dict = Depends(get_current_session),
):
    _require_portal(session)
    department = _department_or_404(db, str(department_id))
    _require_manage(db, session, department, f"{department.key}.manage_team")
    try:
        create_role(db, department, payload.model_dump())
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    db.refresh(department)
    return _detail(db, session, department)


@router.patch("/{department_id}/roles/{role_id}")
def update_department_role(
    department_id: int,
    role_id: int,
    payload: RoleUpdate,
    db: Session = Depends(get_db),
    session: dict = Depends(get_current_session),
):
    _require_portal(session)
    department = _department_or_404(db, str(department_id))
    _require_manage(db, session, department, f"{department.key}.manage_team")
    role = (
        db.query(DepartmentRole)
        .filter(
            DepartmentRole.id == role_id,
            DepartmentRole.department_id == department.id,
        )
        .first()
    )
    if role is None:
        raise HTTPException(status_code=404, detail="Department role not found.")
    try:
        update_role(db, department, role, payload.model_dump(exclude_none=True))
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    db.refresh(department)
    return _detail(db, session, department)


@router.delete("/{department_id}/roles/{role_id}", status_code=204)
def delete_department_role(
    department_id: int,
    role_id: int,
    db: Session = Depends(get_db),
    session: dict = Depends(get_current_session),
):
    _require_portal(session)
    department = _department_or_404(db, str(department_id))
    _require_manage(db, session, department, f"{department.key}.manage_team")
    role = (
        db.query(DepartmentRole)
        .filter(
            DepartmentRole.id == role_id,
            DepartmentRole.department_id == department.id,
        )
        .first()
    )
    if role is None:
        raise HTTPException(status_code=404, detail="Department role not found.")
    try:
        delete_role(db, department, role)
    except ValueError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    return None
