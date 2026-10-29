"""Generic work items, approvals and staff notifications.

Phases 1 consumers: leave requests, social posts, expenses and purchase orders.
Domain screens remain authoritative; the generic approval is kept in sync both
ways so a head can clear work from the department inbox or the original screen.
"""

from __future__ import annotations

from datetime import datetime
from typing import Any

from sqlalchemy import or_
from sqlalchemy.orm import Session

from app.models.domain import (
    Approval,
    ApprovalStep,
    BusinessDepartment,
    SocialPost,
    StaffCredential,
    StaffNotification,
    WorkItem,
    WorkItemComment,
)
from app.services.department_service import (
    department_permissions,
    get_department,
    is_admin_session,
    my_departments,
)
from app.services.operational_audit_service import record_operational_audit_event


WORK_ITEM_STATUSES = {"open", "in_progress", "waiting", "done", "cancelled"}
WORK_ITEM_KINDS = {"task", "request", "checklist", "incident", "handoff"}
WORK_ITEM_PRIORITIES = {"low", "normal", "high", "urgent"}
APPROVAL_STATUSES = {"pending", "approved", "rejected", "cancelled"}
APPROVAL_KINDS = {
    "expense",
    "purchase_order",
    "leave",
    "social_post",
    "discount",
    "refund",
    "capex",
    "manual",
}

OPEN_WORK_ITEM_STATUSES = {"open", "in_progress", "waiting"}
PRIORITY_RANK = {"urgent": 0, "high": 1, "normal": 2, "low": 3}


def _actor(session: dict | None) -> str:
    session = session or {}
    return str(session.get("subject") or "system")[:160]


def _actor_name(session: dict | None) -> str | None:
    session = session or {}
    value = session.get("display_name") or session.get("name")
    return str(value)[:160] if value else None


def _staff_id(session: dict | None) -> str:
    subject = str((session or {}).get("subject") or "")
    if subject.startswith("staff:"):
        return subject.split("staff:", 1)[1].strip()
    return ""


def _needs_attention(status: str, priority: str, due_at: datetime | None) -> bool:
    if status not in OPEN_WORK_ITEM_STATUSES:
        return False
    if priority in {"high", "urgent"}:
        return True
    if due_at is not None and due_at < datetime.utcnow():
        return True
    return False


def serialize_work_item(
    item: WorkItem,
    *,
    staff_by_id: dict[str, StaffCredential] | None = None,
    department: BusinessDepartment | None = None,
) -> dict:
    staff = (staff_by_id or {}).get(item.owner_staff_id or "")
    return {
        "id": item.id,
        "department_id": item.department_id,
        "department_key": department.key if department else None,
        "department_name": department.name if department else None,
        "title": item.title,
        "description": item.description,
        "kind": item.kind,
        "status": item.status,
        "priority": item.priority,
        "owner_staff_id": item.owner_staff_id,
        "owner_display_name": staff.display_name if staff else item.owner_staff_id,
        "created_by": item.created_by,
        "due_at": item.due_at.isoformat() if item.due_at else None,
        "source_type": item.source_type,
        "source_id": item.source_id,
        "store_id": item.store_id,
        "metadata": item.metadata_json or {},
        "comment_count": len(item.comments or []),
        "needs_attention": _needs_attention(
            item.status, item.priority, item.due_at
        ),
        "completed_at": item.completed_at.isoformat()
        if item.completed_at
        else None,
        "created_at": item.created_at.isoformat() if item.created_at else None,
        "updated_at": item.updated_at.isoformat() if item.updated_at else None,
    }


def serialize_comment(comment: WorkItemComment) -> dict:
    return {
        "id": comment.id,
        "work_item_id": comment.work_item_id,
        "author_staff_id": comment.author_staff_id,
        "author_name": comment.author_name,
        "body": comment.body,
        "created_at": comment.created_at.isoformat()
        if comment.created_at
        else None,
    }


def serialize_approval(
    approval: Approval,
    *,
    department: BusinessDepartment | None = None,
) -> dict:
    return {
        "id": approval.id,
        "department_id": approval.department_id,
        "department_key": department.key if department else None,
        "department_name": department.name if department else None,
        "kind": approval.kind,
        "title": approval.title,
        "amount": approval.amount,
        "currency": approval.currency,
        "status": approval.status,
        "requested_by": approval.requested_by,
        "decided_by": approval.decided_by,
        "decided_at": approval.decided_at.isoformat()
        if approval.decided_at
        else None,
        "note": approval.note,
        "source_type": approval.source_type,
        "source_id": approval.source_id,
        "store_id": approval.store_id,
        "metadata": approval.metadata_json or {},
        "needs_attention": approval.status == "pending",
        "steps": [
            {
                "id": step.id,
                "step_order": step.step_order,
                "approver_department_id": step.approver_department_id,
                "approver_staff_id": step.approver_staff_id,
                "status": step.status,
                "decided_at": step.decided_at.isoformat()
                if step.decided_at
                else None,
                "note": step.note,
            }
            for step in sorted(approval.steps or [], key=lambda row: row.step_order)
        ],
        "created_at": approval.created_at.isoformat()
        if approval.created_at
        else None,
        "updated_at": approval.updated_at.isoformat()
        if approval.updated_at
        else None,
    }


def _staff_map(db: Session) -> dict[str, StaffCredential]:
    return {
        staff.staff_id: staff for staff in db.query(StaffCredential).all()
    }


def _department_map(db: Session) -> dict[int, BusinessDepartment]:
    return {
        row.id: row for row in db.query(BusinessDepartment).all()
    }


def work_items_for_department(
    db: Session,
    session: dict,
    department: BusinessDepartment,
    *,
    status: str | None = "open",
    limit: int = 50,
) -> list[dict]:
    query = db.query(WorkItem).filter(
        WorkItem.department_id == department.id,
        WorkItem.status != "cancelled",
    )
    if status:
        if status == "open":
            query = query.filter(WorkItem.status.in_(OPEN_WORK_ITEM_STATUSES))
        else:
            query = query.filter(WorkItem.status == status)
    items = (
        query.order_by(
            WorkItem.priority.asc(),
            WorkItem.due_at.asc(),
            WorkItem.created_at.desc(),
        )
        .limit(max(1, min(limit, 200)))
        .all()
    )
    staff = _staff_map(db)
    return [
        serialize_work_item(item, staff_by_id=staff, department=department)
        for item in items
    ]


def _visible_departments(db: Session, session: dict) -> dict[int, BusinessDepartment]:
    return {row.id: row for row in my_departments(db, session)}


def work_items_for_staff(
    db: Session,
    session: dict,
    *,
    status: str = "open",
    limit: int = 100,
) -> list[dict]:
    departments = _visible_departments(db, session)
    query = db.query(WorkItem).filter(
        WorkItem.department_id.in_(list(departments.keys()) or [-1]),
        WorkItem.status != "cancelled",
    )
    if status == "open":
        query = query.filter(WorkItem.status.in_(OPEN_WORK_ITEM_STATUSES))
    elif status:
        query = query.filter(WorkItem.status == status)
    if not is_admin_session(session):
        staff_id = _staff_id(session)
        managed_ids = [
            department_id
            for department_id, department in departments.items()
            if department.head_staff_id == staff_id
            or _member_can_appoint(db, session, department)
        ]
        query = query.filter(
            or_(
                WorkItem.owner_staff_id == staff_id,
                WorkItem.owner_staff_id.is_(None)
                & WorkItem.department_id.in_(managed_ids or [-1]),
            )
        )
    items = (
        query.order_by(
            WorkItem.priority.asc(),
            WorkItem.due_at.asc(),
            WorkItem.created_at.desc(),
        )
        .limit(max(1, min(limit, 300)))
        .all()
    )
    staff = _staff_map(db)
    return [
        serialize_work_item(
            item, staff_by_id=staff, department=departments.get(item.department_id)
        )
        for item in items
    ]


def _member_can_appoint(
    db: Session, session: dict, department: BusinessDepartment
) -> bool:
    permissions = department_permissions(db, session, department)
    return (
        f"{department.key}.approve" in permissions
        or f"{department.key}.manage_team" in permissions
    )


def create_work_item(
    db: Session,
    session: dict,
    department: BusinessDepartment,
    payload: dict,
) -> WorkItem:
    title = str(payload.get("title") or "").strip()
    if not title:
        raise ValueError("Work item title is required.")
    kind = str(payload.get("kind") or "task").strip().lower()
    if kind not in WORK_ITEM_KINDS:
        raise ValueError("Unknown work item kind.")
    priority = str(payload.get("priority") or "normal").strip().lower()
    if priority not in WORK_ITEM_PRIORITIES:
        raise ValueError("Priority must be low, normal, high or urgent.")
    status = str(payload.get("status") or "open").strip().lower()
    if status not in WORK_ITEM_STATUSES:
        raise ValueError("Unknown work item status.")
    owner = (str(payload.get("owner_staff_id") or "").strip() or None)
    if owner is None and not is_admin_session(session):
        # A staff member creating a task without naming an owner keeps it in
        # their own queue; admins create department-owned work instead.
        owner = _staff_id(session) or None
    if owner is not None:
        exists = (
            db.query(StaffCredential)
            .filter(StaffCredential.staff_id == owner)
            .first()
        )
        if exists is None:
            raise ValueError("Owner staff credential does not exist.")
    item = WorkItem(
        department_id=department.id,
        title=title[:200],
        description=(str(payload.get("description") or "").strip() or None),
        kind=kind,
        status=status,
        priority=priority,
        owner_staff_id=owner,
        created_by=_actor(session),
        due_at=payload.get("due_at"),
        source_type=(str(payload.get("source_type") or "").strip() or None),
        source_id=(str(payload.get("source_id") or "").strip() or None),
        store_id=payload.get("store_id"),
        metadata_json=payload.get("metadata") or {},
        completed_at=datetime.utcnow() if status == "done" else None,
    )
    db.add(item)
    db.flush()
    record_operational_audit_event(
        db,
        session=session,
        event_type="department",
        action="work_item_created",
        resource_type="work_item",
        resource_id=item.id,
        status="success",
        metadata={"title": item.title, "department": department.key},
        department_id=department.id,
        store_id=item.store_id,
    )
    db.commit()
    db.refresh(item)
    return item


def update_work_item(
    db: Session,
    session: dict,
    department: BusinessDepartment,
    item: WorkItem,
    payload: dict,
) -> WorkItem:
    if payload.get("title") is not None:
        title = str(payload["title"]).strip()
        if not title:
            raise ValueError("Work item title cannot be empty.")
        item.title = title[:200]
    if payload.get("description") is not None:
        item.description = str(payload["description"]).strip() or None
    if payload.get("status") is not None:
        status = str(payload["status"]).strip().lower()
        if status not in WORK_ITEM_STATUSES:
            raise ValueError("Unknown work item status.")
        item.status = status
        item.completed_at = datetime.utcnow() if status == "done" else None
    if payload.get("priority") is not None:
        priority = str(payload["priority"]).strip().lower()
        if priority not in WORK_ITEM_PRIORITIES:
            raise ValueError("Priority must be low, normal, high or urgent.")
        item.priority = priority
    if payload.get("owner_staff_id") is not None:
        owner = str(payload["owner_staff_id"]).strip() or None
        if owner is not None:
            exists = (
                db.query(StaffCredential)
                .filter(StaffCredential.staff_id == owner)
                .first()
            )
            if exists is None:
                raise ValueError("Owner staff credential does not exist.")
        item.owner_staff_id = owner
    if payload.get("due_at") is not None:
        item.due_at = payload["due_at"]
    record_operational_audit_event(
        db,
        session=session,
        event_type="department",
        action="work_item_updated",
        resource_type="work_item",
        resource_id=item.id,
        status="success",
        metadata={"status": item.status, "department": department.key},
        department_id=department.id,
        store_id=item.store_id,
    )
    db.commit()
    db.refresh(item)
    return item


def add_work_item_comment(
    db: Session,
    session: dict,
    item: WorkItem,
    body: str,
) -> WorkItemComment:
    text = str(body or "").strip()
    if not text:
        raise ValueError("Comment cannot be empty.")
    comment = WorkItemComment(
        work_item_id=item.id,
        author_staff_id=_staff_id(session) or None,
        author_name=_actor_name(session) or _actor(session),
        body=text[:4000],
    )
    db.add(comment)
    db.commit()
    db.refresh(comment)
    return comment


def approvals_for_department(
    db: Session,
    session: dict,
    department: BusinessDepartment,
    *,
    status: str | None = "pending",
    limit: int = 50,
) -> list[dict]:
    query = db.query(Approval).filter(Approval.department_id == department.id)
    if status and status != "all":
        query = query.filter(Approval.status == status)
    rows = (
        query.order_by(Approval.created_at.desc(), Approval.id.desc())
        .limit(max(1, min(limit, 200)))
        .all()
    )
    return [
        serialize_approval(row, department=department) for row in rows
    ]


def approvals_for_staff(
    db: Session,
    session: dict,
    *,
    status: str = "pending",
    limit: int = 100,
) -> list[dict]:
    departments = _visible_departments(db, session)
    query = db.query(Approval).filter(
        Approval.department_id.in_(list(departments.keys()) or [-1])
    )
    if status and status != "all":
        query = query.filter(Approval.status == status)
    if not is_admin_session(session):
        staff_id = _staff_id(session)
        manageable = [
            department.id
            for department in departments.values()
            if _member_can_appoint(db, session, department)
        ]
        query = query.filter(
            or_(
                Approval.requested_by == _actor(session),
                Approval.requested_by == f"staff:{staff_id}",
                Approval.department_id.in_(manageable or [-1]),
            )
        )
    rows = (
        query.order_by(Approval.created_at.desc(), Approval.id.desc())
        .limit(max(1, min(limit, 300)))
        .all()
    )
    return [
        serialize_approval(row, department=departments.get(row.department_id))
        for row in rows
    ]


def ensure_approval_for_source(
    db: Session,
    *,
    department_key: str,
    kind: str,
    title: str,
    source_type: str,
    source_id: str | int,
    amount: float | None = None,
    requested_by: str | None = None,
    note: str | None = None,
    store_id: int | None = None,
    metadata: dict[str, Any] | None = None,
    status: str = "pending",
    decided_by: str | None = None,
    reopen: bool = False,
) -> Approval | None:
    """Idempotently mirror a domain request into the approvals inbox.

    ``status`` lets a caller record a domain action that was already completed
    (for example an admin-entered expense) without leaving a phantom pending
    approval. ``reopen`` resets a decided mirror when the source is resubmitted.
    """
    department = get_department(db, department_key)
    if department is None:
        return None
    kind = kind.strip().lower()
    if kind not in APPROVAL_KINDS:
        return None
    normalized = status.strip().lower()
    if normalized not in APPROVAL_STATUSES:
        return None
    source = str(source_id)
    existing = (
        db.query(Approval)
        .filter(
            Approval.source_type == source_type,
            Approval.source_id == source,
        )
        .order_by(Approval.id.desc())
        .first()
    )
    if existing is not None:
        if reopen and existing.status != "pending":
            existing.status = "pending"
            existing.decided_by = None
            existing.decided_at = None
            existing.note = (note or "").strip() or None
            for step in existing.steps:
                step.status = "pending"
                step.decided_at = None
                step.note = None
            db.commit()
            db.refresh(existing)
        return existing
    decided_at = datetime.utcnow() if normalized != "pending" else None
    approval = Approval(
        department_id=department.id,
        kind=kind,
        title=title[:200],
        amount=amount,
        status=normalized,
        requested_by=(requested_by or "system")[:160],
        decided_by=(decided_by or "system")[:160] if decided_at else None,
        decided_at=decided_at,
        note=(note or "").strip() or None,
        source_type=source_type,
        source_id=source,
        store_id=store_id,
        metadata_json=metadata or {},
    )
    db.add(approval)
    db.flush()
    db.add(
        ApprovalStep(
            approval_id=approval.id,
            step_order=1,
            approver_department_id=department.id,
            status=normalized,
            decided_at=decided_at,
            note=(note or "").strip() or None,
        )
    )
    db.commit()
    db.refresh(approval)
    return approval


def sync_source_approval(
    db: Session,
    *,
    source_type: str,
    source_id: str | int,
    status: str,
    decided_by: str | None = None,
    note: str | None = None,
) -> Approval | None:
    """Update the mirrored approval after a domain screen decides."""
    approval = (
        db.query(Approval)
        .filter(
            Approval.source_type == source_type,
            Approval.source_id == str(source_id),
        )
        .order_by(Approval.id.desc())
        .first()
    )
    if approval is None:
        return None
    if approval.status != "pending":
        return approval
    normalized = status.strip().lower()
    if normalized not in APPROVAL_STATUSES:
        return approval
    approval.status = normalized
    approval.decided_by = (decided_by or "system")[:160]
    approval.decided_at = datetime.utcnow()
    approval.note = (note or "").strip() or approval.note
    for step in approval.steps:
        if step.status == "pending":
            step.status = normalized
            step.decided_at = approval.decided_at
            step.note = approval.note
    db.commit()
    db.refresh(approval)
    return approval


def create_approval(
    db: Session,
    session: dict,
    department: BusinessDepartment,
    payload: dict,
) -> Approval:
    title = str(payload.get("title") or "").strip()
    if not title:
        raise ValueError("Approval title is required.")
    kind = str(payload.get("kind") or "manual").strip().lower()
    if kind not in APPROVAL_KINDS:
        raise ValueError("Unknown approval kind.")
    amount = payload.get("amount")
    if amount is not None:
        try:
            amount = float(amount)
        except (TypeError, ValueError) as exc:
            raise ValueError("Amount must be a number.") from exc
        if amount < 0:
            raise ValueError("Amount cannot be negative.")
    approval = Approval(
        department_id=department.id,
        kind=kind,
        title=title[:200],
        amount=amount,
        status="pending",
        requested_by=_actor(session),
        note=(str(payload.get("note") or "").strip() or None),
        store_id=payload.get("store_id"),
        metadata_json=payload.get("metadata") or {},
    )
    db.add(approval)
    db.flush()
    db.add(
        ApprovalStep(
            approval_id=approval.id,
            step_order=1,
            approver_department_id=department.id,
            approver_staff_id=(
                str(payload.get("approver_staff_id") or "").strip() or None
            ),
            status="pending",
        )
    )
    record_operational_audit_event(
        db,
        session=session,
        event_type="department",
        action="approval_requested",
        resource_type="approval",
        resource_id=approval.id,
        status="success",
        metadata={"kind": kind, "amount": amount, "department": department.key},
        department_id=department.id,
        store_id=approval.store_id,
    )
    db.commit()
    db.refresh(approval)
    return approval


def decide_approval(
    db: Session,
    session: dict,
    department: BusinessDepartment,
    approval: Approval,
    decision: str,
    note: str | None = None,
) -> Approval:
    if approval.status != "pending":
        raise ValueError("Only pending approvals can be decided.")
    normalized = str(decision or "").strip().lower()
    if normalized not in {"approved", "rejected"}:
        raise ValueError("Decision must be approved or rejected.")
    if normalized == "rejected" and not str(note or "").strip():
        raise ValueError("Add a rejection note.")
    actor = _actor(session)
    if (
        approval.source_type == "hr_leave_request"
        and normalized == "approved"
    ):
        # Leave decisions must consume balances through the HR service.
        from app.services.hr_leave_service import decide_request

        try:
            decide_request(
                db,
                int(approval.source_id or 0),
                normalized,
                actor,
                note,
            )
        except ValueError:
            raise
    elif approval.source_type == "social_post":
        post = db.get(SocialPost, int(approval.source_id or 0))
        if post is not None and post.approval_status == "pending":
            post.approval_status = normalized
            post.approval_note = (note or "").strip()[:1000] or post.approval_note
            post.approved_by = actor[:120]
            post.approved_at = datetime.utcnow()
    approval.status = normalized
    approval.decided_by = actor
    approval.decided_at = datetime.utcnow()
    approval.note = (str(note or "").strip() or approval.note)
    for step in approval.steps:
        if step.status == "pending":
            step.status = normalized
            step.decided_at = approval.decided_at
            step.note = approval.note
    record_operational_audit_event(
        db,
        session=session,
        event_type="department",
        action=f"approval_{normalized}",
        resource_type="approval",
        resource_id=approval.id,
        status="success",
        metadata={"kind": approval.kind, "department": department.key},
        department_id=department.id,
        store_id=approval.store_id,
    )
    db.commit()
    db.refresh(approval)
    return approval


def notifications_for_staff(
    db: Session, session: dict, *, unread_only: bool = False, limit: int = 50
) -> list[dict]:
    staff_id = _staff_id(session)
    if not staff_id:
        return []
    query = db.query(StaffNotification).filter(
        StaffNotification.staff_id == staff_id
    )
    if unread_only:
        query = query.filter(StaffNotification.read_at.is_(None))
    rows = (
        query.order_by(StaffNotification.created_at.desc())
        .limit(max(1, min(limit, 200)))
        .all()
    )
    return [
        {
            "id": row.id,
            "kind": row.kind,
            "title": row.title,
            "body": row.body,
            "link": row.link,
            "department_id": row.department_id,
            "read_at": row.read_at.isoformat() if row.read_at else None,
            "created_at": row.created_at.isoformat() if row.created_at else None,
        }
        for row in rows
    ]


def mark_notification_read(
    db: Session, session: dict, notification_id: int
) -> bool:
    staff_id = _staff_id(session)
    row = (
        db.query(StaffNotification)
        .filter(
            StaffNotification.id == notification_id,
            StaffNotification.staff_id == staff_id,
        )
        .first()
    )
    if row is None:
        return False
    row.read_at = datetime.utcnow()
    db.commit()
    return True


def notify_staff(
    db: Session,
    staff_id: str,
    *,
    title: str,
    body: str | None = None,
    link: str | None = None,
    kind: str = "info",
    department_id: int | None = None,
) -> StaffNotification:
    row = StaffNotification(
        staff_id=staff_id,
        department_id=department_id,
        kind=kind,
        title=title[:200],
        body=body,
        link=link,
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return row
