"""Work queue and approvals inbox for the company operating system."""

from datetime import datetime
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.api.deps import get_current_session, get_db
from app.models.domain import Approval, BusinessDepartment, WorkItem
from app.services.company_work_service import (
    add_work_item_comment,
    approvals_for_department,
    approvals_for_staff,
    create_approval,
    create_work_item,
    decide_approval,
    mark_notification_read,
    notifications_for_staff,
    serialize_approval,
    serialize_comment,
    serialize_work_item,
    update_work_item,
    work_items_for_department,
    work_items_for_staff,
)
from app.services.department_service import (
    access_state,
    department_permissions,
    get_department,
    is_admin_session,
    member_has_permission,
    my_departments,
    visible_department,
)

router = APIRouter()


class WorkItemCreate(BaseModel):
    department_key: str = Field(min_length=1, max_length=60)
    title: str = Field(min_length=2, max_length=200)
    description: Optional[str] = None
    kind: str = Field(default="task", max_length=30)
    status: str = Field(default="open", max_length=30)
    priority: str = Field(default="normal", max_length=20)
    owner_staff_id: Optional[str] = Field(default=None, max_length=120)
    due_at: Optional[datetime] = None
    store_id: Optional[int] = None
    metadata: dict = Field(default_factory=dict)


class WorkItemUpdate(BaseModel):
    title: Optional[str] = Field(default=None, min_length=2, max_length=200)
    description: Optional[str] = None
    status: Optional[str] = Field(default=None, max_length=30)
    priority: Optional[str] = Field(default=None, max_length=20)
    owner_staff_id: Optional[str] = Field(default=None, max_length=120)
    due_at: Optional[datetime] = None


class WorkItemCommentCreate(BaseModel):
    body: str = Field(min_length=1, max_length=4000)


class ApprovalCreate(BaseModel):
    department_key: str = Field(min_length=1, max_length=60)
    title: str = Field(min_length=2, max_length=200)
    kind: str = Field(default="manual", max_length=40)
    amount: Optional[float] = None
    note: Optional[str] = None
    approver_staff_id: Optional[str] = Field(default=None, max_length=120)
    store_id: Optional[int] = None
    metadata: dict = Field(default_factory=dict)


class ApprovalDecision(BaseModel):
    decision: str = Field(max_length=20)
    note: Optional[str] = None


def _require_portal(session: dict) -> dict:
    if session.get("role") not in {"admin", "staff"}:
        raise HTTPException(status_code=403, detail="Staff access is required.")
    return session


def _visible_department(
    db: Session, session: dict, key_or_id: str
) -> BusinessDepartment:
    department = get_department(db, key_or_id)
    if department is None:
        raise HTTPException(status_code=404, detail="Department not found.")
    if is_admin_session(session):
        return department
    visible = visible_department(db, session, key_or_id)
    if visible is None:
        raise HTTPException(
            status_code=403,
            detail="You are not a member of that department.",
        )
    return department


def _require_view(
    db: Session, session: dict, department: BusinessDepartment
) -> None:
    if is_admin_session(session):
        return
    if not member_has_permission(
        db, session, department, f"{department.key}.view"
    ):
        raise HTTPException(
            status_code=403,
            detail=f"This account lacks the {department.key}.view permission.",
        )


def _can_manage(
    db: Session, session: dict, department: BusinessDepartment
) -> bool:
    if is_admin_session(session):
        return True
    permissions = department_permissions(db, session, department)
    return bool(
        {f"{department.key}.approve", f"{department.key}.manage_team"}
        & permissions
    )


def _work_item_or_404(
    db: Session, session: dict, item_id: int
) -> tuple[WorkItem, BusinessDepartment]:
    item = db.get(WorkItem, item_id)
    if item is None:
        raise HTTPException(status_code=404, detail="Work item not found.")
    department = _visible_department(db, session, str(item.department_id))
    _require_view(db, session, department)
    return item, department


@router.get("")
def work_home(
    db: Session = Depends(get_db),
    session: dict = Depends(get_current_session),
):
    _require_portal(session)
    access = access_state(db, session)
    items = work_items_for_staff(db, session, status="open", limit=100)
    approvals = approvals_for_staff(db, session, status="pending", limit=100)
    notifications = notifications_for_staff(
        db, session, unread_only=True, limit=20
    )
    return {
        "departments": access["departments"],
        "is_admin": access["is_admin"],
        "work_items": items,
        "approvals": approvals,
        "notifications": notifications,
        "counts": {
            "work_items": len(items),
            "approvals": len(approvals),
            "unread_notifications": len(notifications),
            "attention": len(
                [item for item in items if item.get("needs_attention")]
            ),
        },
    }


@router.get("/items")
def list_work_items(
    department_key: Optional[str] = None,
    status: str = "open",
    limit: int = 50,
    db: Session = Depends(get_db),
    session: dict = Depends(get_current_session),
):
    _require_portal(session)
    if department_key:
        department = _visible_department(db, session, department_key)
        _require_view(db, session, department)
        return {
            "work_items": work_items_for_department(
                db, session, department, status=status, limit=limit
            )
        }
    return {
        "work_items": work_items_for_staff(
            db, session, status=status, limit=limit
        )
    }


@router.post("/items", status_code=201)
def create_work_item_endpoint(
    payload: WorkItemCreate,
    db: Session = Depends(get_db),
    session: dict = Depends(get_current_session),
):
    _require_portal(session)
    department = _visible_department(db, session, payload.department_key)
    _require_view(db, session, department)
    try:
        item = create_work_item(
            db, session, department, payload.model_dump(exclude={"department_key"})
        )
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    return {
        "work_item": serialize_work_item(item, department=department)
    }


@router.get("/items/{item_id}")
def get_work_item(
    item_id: int,
    db: Session = Depends(get_db),
    session: dict = Depends(get_current_session),
):
    _require_portal(session)
    item, department = _work_item_or_404(db, session, item_id)
    return {
        "work_item": serialize_work_item(item, department=department),
        "comments": [
            serialize_comment(row)
            for row in sorted(item.comments, key=lambda row: row.id)
        ],
    }


@router.patch("/items/{item_id}")
def patch_work_item(
    item_id: int,
    payload: WorkItemUpdate,
    db: Session = Depends(get_db),
    session: dict = Depends(get_current_session),
):
    _require_portal(session)
    item, department = _work_item_or_404(db, session, item_id)
    staff_id = str(session.get("subject") or "").replace("staff:", "")
    if not (
        is_admin_session(session)
        or item.owner_staff_id == staff_id
        or _can_manage(db, session, department)
    ):
        raise HTTPException(
            status_code=403,
            detail="Only the owner or a department manager can update this task.",
        )
    try:
        item = update_work_item(
            db, session, department, item, payload.model_dump(exclude_none=True)
        )
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    return {"work_item": serialize_work_item(item, department=department)}


@router.post("/items/{item_id}/comments", status_code=201)
def add_comment(
    item_id: int,
    payload: WorkItemCommentCreate,
    db: Session = Depends(get_db),
    session: dict = Depends(get_current_session),
):
    _require_portal(session)
    item, _department = _work_item_or_404(db, session, item_id)
    try:
        comment = add_work_item_comment(db, session, item, payload.body)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    return {"comment": serialize_comment(comment)}


@router.get("/approvals")
def list_approvals(
    department_key: Optional[str] = None,
    status: str = "pending",
    limit: int = 50,
    db: Session = Depends(get_db),
    session: dict = Depends(get_current_session),
):
    _require_portal(session)
    if department_key:
        department = _visible_department(db, session, department_key)
        _require_view(db, session, department)
        return {
            "approvals": approvals_for_department(
                db, session, department, status=status, limit=limit
            )
        }
    return {
        "approvals": approvals_for_staff(
            db, session, status=status, limit=limit
        )
    }


@router.post("/approvals", status_code=201)
def create_approval_endpoint(
    payload: ApprovalCreate,
    db: Session = Depends(get_db),
    session: dict = Depends(get_current_session),
):
    _require_portal(session)
    department = _visible_department(db, session, payload.department_key)
    _require_view(db, session, department)
    try:
        approval = create_approval(
            db, session, department, payload.model_dump(exclude={"department_key"})
        )
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    return {"approval": serialize_approval(approval, department=department)}


@router.post("/approvals/{approval_id}/decision")
def decide_approval_endpoint(
    approval_id: int,
    payload: ApprovalDecision,
    db: Session = Depends(get_db),
    session: dict = Depends(get_current_session),
):
    _require_portal(session)
    approval = db.get(Approval, approval_id)
    if approval is None:
        raise HTTPException(status_code=404, detail="Approval not found.")
    department = _visible_department(db, session, str(approval.department_id))
    if not _can_manage(db, session, department):
        raise HTTPException(
            status_code=403,
            detail=(
                "This account lacks the "
                f"{department.key}.approve permission."
            ),
        )
    try:
        approval = decide_approval(
            db, session, department, approval, payload.decision, payload.note
        )
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    return {"approval": serialize_approval(approval, department=department)}


@router.get("/notifications")
def list_notifications(
    unread_only: bool = False,
    limit: int = 50,
    db: Session = Depends(get_db),
    session: dict = Depends(get_current_session),
):
    _require_portal(session)
    return {
        "notifications": notifications_for_staff(
            db, session, unread_only=unread_only, limit=limit
        )
    }


@router.post("/notifications/{notification_id}/read")
def read_notification(
    notification_id: int,
    db: Session = Depends(get_db),
    session: dict = Depends(get_current_session),
):
    _require_portal(session)
    if not mark_notification_read(db, session, notification_id):
        raise HTTPException(status_code=404, detail="Notification not found.")
    return {"read": True}


@router.get("/departments")
def work_departments(
    db: Session = Depends(get_db),
    session: dict = Depends(get_current_session),
):
    _require_portal(session)
    rows = my_departments(db, session)
    return {
        "departments": [
            {
                "key": row.key,
                "name": row.name,
                "color": row.color,
                "icon": row.icon,
                "kind": row.kind,
            }
            for row in rows
        ]
    }
