"""Operations and facilities workspaces: checklists, assets and work orders."""

from datetime import date, datetime, timedelta
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy import case, func
from sqlalchemy.orm import Session

from app.api.deps import get_db, require_department_permission
from app.core.clock import business_today
from app.models.domain import (
    MaintenanceAsset,
    MaintenanceWorkOrder,
    OpsChecklistRun,
    OpsChecklistTemplate,
)

router = APIRouter()

CHECKLIST_DEPENDENCY = require_department_permission(
    "operations",
    "operations.checklists",
    "operations.view",
)
FACILITIES_DEPENDENCY = require_department_permission(
    "facilities",
    "operations.facilities",
    "facilities.view",
)

CHECKLIST_RUN_STATUSES = {"in_progress", "completed", "cancelled"}
ASSET_STATUSES = {"operational", "under_maintenance", "out_of_service"}
ASSET_CRITICALITIES = {"low", "normal", "high", "critical"}
WORK_ORDER_STATUSES = {"open", "in_progress", "completed", "cancelled"}
WORK_ORDER_PRIORITIES = {"low", "normal", "high", "urgent"}

DEFAULT_TEMPLATES = [
    {
        "name": "Opening checklist",
        "description": "Everything the opening team signs off before doors open.",
        "kind": "opening",
        "items": [
            {"label": "Unlock front and back doors and disarm the alarm", "required": True},
            {"label": "Switch on ovens and verify temperature reaches 250C", "required": True},
            {"label": "Check walk-in fridge and freezer temperatures", "required": True},
            {"label": "Count drawer float and record opening cash", "required": True},
            {"label": "Check online ordering is live on every aggregator", "required": True},
            {"label": "Inspect prep stations and sanitise all surfaces", "required": True},
            {"label": "Review today's reservations and large orders", "required": False},
            {"label": "Brief the opening team on specials and 86'd items", "required": False},
        ],
    },
    {
        "name": "Closing checklist",
        "description": "Cash, food safety and security steps for closing the store.",
        "kind": "closing",
        "items": [
            {"label": "Cash up tills and reconcile the drawer against sales", "required": True},
            {"label": "Record wastage and close out the waste log", "required": True},
            {"label": "Clean ovens, prep surfaces and pizza screens", "required": True},
            {"label": "Switch off ovens and fryers and confirm gas valves are closed", "required": True},
            {"label": "Restock packaging and takeaway supplies for tomorrow", "required": False},
            {"label": "Set the alarm, lock up and confirm the safe is secured", "required": True},
        ],
    },
    {
        "name": "Weekly deep clean",
        "description": "Recurring deep-clean tasks for the kitchen and front of house.",
        "kind": "weekly",
        "items": [
            {"label": "Deep clean the walk-in fridges and shelving", "required": True},
            {"label": "Degrease the extraction hood and replace filters", "required": True},
            {"label": "Descale the dishwashing machine and coffee equipment", "required": True},
            {"label": "Sanitise drains and floor gullies across the kitchen", "required": True},
            {"label": "Check pest control stations and log any activity", "required": False},
        ],
    },
]


class ChecklistItemInput(BaseModel):
    label: str = Field(min_length=1, max_length=200)
    required: bool = False


class ChecklistTemplateCreate(BaseModel):
    name: str = Field(min_length=2, max_length=160)
    description: Optional[str] = Field(default=None, max_length=500)
    kind: str = Field(default="daily", min_length=1, max_length=30)
    items: list[ChecklistItemInput] = Field(min_length=1)
    department_key: str = Field(default="operations", min_length=1, max_length=60)


class ChecklistTemplateUpdate(BaseModel):
    name: Optional[str] = Field(default=None, min_length=2, max_length=160)
    description: Optional[str] = Field(default=None, max_length=500)
    kind: Optional[str] = Field(default=None, min_length=1, max_length=30)
    items: Optional[list[ChecklistItemInput]] = None
    active: Optional[bool] = None


class ChecklistRunCreate(BaseModel):
    template_id: int
    store_id: int = 1
    run_date: Optional[date] = None


class RunItemUpdate(BaseModel):
    label: str = Field(min_length=1, max_length=200)
    done: bool
    note: Optional[str] = Field(default=None, max_length=500)
    completed_by: Optional[str] = Field(default=None, max_length=120)


class ChecklistRunUpdate(BaseModel):
    items: Optional[list[RunItemUpdate]] = None
    status: Optional[str] = Field(default=None, max_length=20)
    notes: Optional[str] = Field(default=None, max_length=1000)
    completed_by: Optional[str] = Field(default=None, max_length=120)


class AssetCreate(BaseModel):
    name: str = Field(min_length=2, max_length=160)
    category: str = Field(default="kitchen", min_length=1, max_length=60)
    location: Optional[str] = Field(default=None, max_length=120)
    serial_number: Optional[str] = Field(default=None, max_length=120)
    status: str = Field(default="operational", max_length=30)
    criticality: str = Field(default="normal", max_length=20)
    purchase_date: Optional[date] = None
    warranty_until: Optional[date] = None
    next_service_due: Optional[date] = None
    notes: Optional[str] = Field(default=None, max_length=1000)


class AssetUpdate(BaseModel):
    name: Optional[str] = Field(default=None, min_length=2, max_length=160)
    category: Optional[str] = Field(default=None, min_length=1, max_length=60)
    location: Optional[str] = Field(default=None, max_length=120)
    serial_number: Optional[str] = Field(default=None, max_length=120)
    status: Optional[str] = Field(default=None, max_length=30)
    criticality: Optional[str] = Field(default=None, max_length=20)
    purchase_date: Optional[date] = None
    warranty_until: Optional[date] = None
    next_service_due: Optional[date] = None
    notes: Optional[str] = Field(default=None, max_length=1000)


class WorkOrderCreate(BaseModel):
    title: str = Field(min_length=2, max_length=200)
    asset_id: Optional[int] = None
    store_id: int = 1
    description: Optional[str] = None
    priority: str = Field(default="normal", max_length=20)
    assigned_to: Optional[str] = Field(default=None, max_length=120)
    due_at: Optional[datetime] = None
    reported_by: Optional[str] = Field(default=None, max_length=120)


class WorkOrderUpdate(BaseModel):
    status: Optional[str] = Field(default=None, max_length=30)
    priority: Optional[str] = Field(default=None, max_length=20)
    assigned_to: Optional[str] = Field(default=None, max_length=120)
    due_at: Optional[datetime] = None
    cost: Optional[float] = Field(default=None, ge=0)
    description: Optional[str] = None
    title: Optional[str] = Field(default=None, min_length=2, max_length=200)


def _iso(value) -> Optional[str]:
    if value is None:
        return None
    if isinstance(value, (datetime, date)):
        return value.isoformat()
    return str(value)


def _money(value) -> float:
    return round(float(value or 0), 2)


def _actor(session: dict) -> str:
    return (
        str(session.get("display_name") or "").strip()
        or str(session.get("staff_id") or "").strip()
        or "admin"
    )


def _clean_label(label: str) -> str:
    cleaned = str(label or "").strip()
    if not cleaned:
        raise HTTPException(status_code=422, detail="Checklist item labels cannot be empty.")
    return cleaned


def _normalize_items(items: list) -> list[dict]:
    normalized: list[dict] = []
    for item in items:
        if isinstance(item, dict):
            label = _clean_label(item.get("label", ""))
            required = bool(item.get("required", False))
        else:
            label = _clean_label(getattr(item, "label", ""))
            required = bool(getattr(item, "required", False))
        normalized.append({"label": label, "required": required})
    if not normalized:
        raise HTTPException(status_code=422, detail="Add at least one checklist item.")
    return normalized


def _seed_templates(db: Session) -> None:
    if db.query(OpsChecklistTemplate).count() > 0:
        return
    for template in DEFAULT_TEMPLATES:
        db.add(
            OpsChecklistTemplate(
                department_key="operations",
                name=template["name"],
                description=template["description"],
                kind=template["kind"],
                items=[dict(item) for item in template["items"]],
                active=True,
            )
        )
    db.commit()


def _template_dict(template: OpsChecklistTemplate) -> dict:
    items = template.items if isinstance(template.items, list) else []
    normalized = [
        {
            "label": str(item.get("label", "")),
            "required": bool(item.get("required", False)),
        }
        for item in items
        if isinstance(item, dict)
    ]
    return {
        "id": template.id,
        "name": template.name,
        "description": template.description,
        "kind": template.kind,
        "active": bool(template.active),
        "item_count": len(normalized),
        "items": normalized,
    }


def _run_items(run: OpsChecklistRun) -> list[dict]:
    raw = run.items if isinstance(run.items, list) else []
    return [dict(item) for item in raw if isinstance(item, dict)]


def _run_dict(run: OpsChecklistRun) -> dict:
    items = _run_items(run)
    done_count = sum(1 for item in items if item.get("done"))
    required_remaining = sum(
        1 for item in items if item.get("required") and not item.get("done")
    )
    return {
        "id": run.id,
        "template_id": run.template_id,
        "template_name": run.template.name if run.template else None,
        "run_date": _iso(run.run_date),
        "status": run.status,
        "items": [
            {
                "label": item.get("label", ""),
                "done": bool(item.get("done", False)),
                "note": item.get("note") or "",
                "completed_at": _iso(item.get("completed_at")),
                "completed_by": item.get("completed_by"),
            }
            for item in items
        ],
        "done_count": done_count,
        "total_count": len(items),
        "required_remaining": required_remaining,
        "started_by": run.started_by,
        "completed_by": run.completed_by,
        "completed_at": _iso(run.completed_at),
        "notes": run.notes,
        "created_at": _iso(run.created_at),
    }


def _required_at_least_one_complete(items: list[dict]) -> bool:
    required = [item for item in items if item.get("required")]
    pool = required or items
    return bool(pool) and all(item.get("done") for item in pool)


@router.get("/checklists")
def list_checklists(
    run_date: Optional[date] = None,
    limit: int = Query(default=30, ge=1, le=200),
    db: Session = Depends(get_db),
    session: dict = Depends(CHECKLIST_DEPENDENCY),
):
    del session
    _seed_templates(db)
    today = business_today()
    templates = (
        db.query(OpsChecklistTemplate)
        .order_by(OpsChecklistTemplate.kind.asc(), OpsChecklistTemplate.name.asc())
        .all()
    )
    query = db.query(OpsChecklistRun)
    if run_date is not None:
        query = query.filter(OpsChecklistRun.run_date == run_date)
    runs = (
        query.order_by(
            OpsChecklistRun.run_date.desc(),
            OpsChecklistRun.created_at.desc(),
            OpsChecklistRun.id.desc(),
        )
        .limit(limit)
        .all()
    )
    serialized_runs = [_run_dict(run) for run in runs]

    runs_today = db.query(OpsChecklistRun).filter(OpsChecklistRun.run_date == today)
    total_today = runs_today.count()
    completed_today = runs_today.filter(OpsChecklistRun.status == "completed").count()
    open_today = runs_today.filter(OpsChecklistRun.status == "in_progress").count()
    completion_rate = (
        int(round(completed_today * 100 / total_today)) if total_today else 0
    )
    summary = {
        "templates": len(templates),
        "active_templates": sum(1 for template in templates if template.active),
        "runs_today": total_today,
        "completed_today": completed_today,
        "open_runs": open_today,
        "completion_rate": completion_rate,
    }
    serialized_templates = [_template_dict(template) for template in templates]
    return {
        "items": serialized_runs,
        "runs": serialized_runs,
        "templates": serialized_templates,
        "summary": summary,
    }


@router.post("/checklists/templates")
def create_checklist_template(
    payload: ChecklistTemplateCreate,
    db: Session = Depends(get_db),
    session: dict = Depends(CHECKLIST_DEPENDENCY),
):
    del session
    items = _normalize_items(payload.items)
    name = payload.name.strip()
    if len(name) < 2:
        raise HTTPException(status_code=422, detail="Template name is too short.")
    template = OpsChecklistTemplate(
        department_key=payload.department_key.strip() or "operations",
        name=name,
        description=(payload.description or "").strip() or None,
        kind=payload.kind.strip() or "daily",
        items=items,
        active=True,
    )
    db.add(template)
    db.commit()
    db.refresh(template)
    return _template_dict(template)


@router.patch("/checklists/templates/{template_id}")
def update_checklist_template(
    template_id: int,
    payload: ChecklistTemplateUpdate,
    db: Session = Depends(get_db),
    session: dict = Depends(CHECKLIST_DEPENDENCY),
):
    del session
    template = (
        db.query(OpsChecklistTemplate)
        .filter(OpsChecklistTemplate.id == template_id)
        .first()
    )
    if template is None:
        raise HTTPException(status_code=404, detail="Checklist template not found.")
    provided = payload.model_fields_set
    if "name" in provided:
        name = (payload.name or "").strip()
        if len(name) < 2:
            raise HTTPException(status_code=422, detail="Template name is too short.")
        template.name = name
    if "description" in provided:
        template.description = (payload.description or "").strip() or None
    if "kind" in provided:
        kind = (payload.kind or "").strip()
        if not kind:
            raise HTTPException(status_code=422, detail="Template kind is required.")
        template.kind = kind
    if "items" in provided:
        if payload.items is None:
            raise HTTPException(status_code=422, detail="Add at least one checklist item.")
        template.items = _normalize_items(payload.items)
    if "active" in provided:
        if payload.active is None:
            raise HTTPException(status_code=422, detail="Active must be true or false.")
        template.active = bool(payload.active)
    db.commit()
    db.refresh(template)
    return _template_dict(template)


@router.post("/checklists/runs")
def create_checklist_run(
    payload: ChecklistRunCreate,
    db: Session = Depends(get_db),
    session: dict = Depends(CHECKLIST_DEPENDENCY),
):
    template = (
        db.query(OpsChecklistTemplate)
        .filter(OpsChecklistTemplate.id == payload.template_id)
        .first()
    )
    if template is None:
        raise HTTPException(status_code=404, detail="Checklist template not found.")
    if not template.active:
        raise HTTPException(status_code=422, detail="This checklist template is inactive.")
    run_date = payload.run_date or business_today()
    existing = (
        db.query(OpsChecklistRun)
        .filter(
            OpsChecklistRun.template_id == payload.template_id,
            OpsChecklistRun.store_id == payload.store_id,
            OpsChecklistRun.run_date == run_date,
        )
        .first()
    )
    if existing is not None:
        return _run_dict(existing)

    template_items = template.items if isinstance(template.items, list) else []
    run = OpsChecklistRun(
        template_id=template.id,
        store_id=payload.store_id,
        run_date=run_date,
        status="in_progress",
        items=[
            {
                "label": str(item.get("label", "")),
                "required": bool(item.get("required", False)),
                "done": False,
                "note": "",
                "completed_at": None,
                "completed_by": None,
            }
            for item in template_items
            if isinstance(item, dict)
        ],
        started_by=_actor(session),
    )
    db.add(run)
    db.commit()
    db.refresh(run)
    return _run_dict(run)


@router.patch("/checklists/runs/{run_id}")
def update_checklist_run(
    run_id: int,
    payload: ChecklistRunUpdate,
    db: Session = Depends(get_db),
    session: dict = Depends(CHECKLIST_DEPENDENCY),
):
    run = db.query(OpsChecklistRun).filter(OpsChecklistRun.id == run_id).first()
    if run is None:
        raise HTTPException(status_code=404, detail="Checklist run not found.")
    provided = payload.model_fields_set
    if "status" in provided and (
        payload.status is None or payload.status not in CHECKLIST_RUN_STATUSES
    ):
        raise HTTPException(
            status_code=422,
            detail="Status must be in_progress, completed or cancelled.",
        )
    now_iso = datetime.utcnow().isoformat()
    actor = _actor(session)
    items = _run_items(run)

    if payload.items is not None:
        for index, incoming in enumerate(payload.items):
            target = next(
                (item for item in items if item.get("label") == incoming.label),
                None,
            )
            if target is None and index < len(items):
                target = items[index]
                if target.get("label") != incoming.label:
                    target["required"] = False
            if target is None:
                target = {
                    "label": incoming.label,
                    "required": False,
                    "done": False,
                    "note": "",
                    "completed_at": None,
                    "completed_by": None,
                }
                items.append(target)
            target["label"] = incoming.label
            target["done"] = bool(incoming.done)
            if incoming.note is not None:
                target["note"] = incoming.note
            if target["done"]:
                if not target.get("completed_at"):
                    target["completed_at"] = now_iso
                if incoming.completed_by is not None:
                    target["completed_by"] = incoming.completed_by
                elif not target.get("completed_by"):
                    target["completed_by"] = actor
            else:
                target["completed_at"] = None
                target["completed_by"] = None
        run.items = items

    required_done = _required_at_least_one_complete(items)
    if payload.status is not None:
        run.status = payload.status
        if payload.status == "completed":
            if run.completed_at is None:
                run.completed_at = datetime.utcnow()
            if not run.completed_by:
                run.completed_by = actor
        elif payload.status == "in_progress":
            run.completed_at = None
            run.completed_by = None
    elif run.status == "in_progress" and required_done:
        run.status = "completed"
        run.completed_at = datetime.utcnow()
        if not run.completed_by:
            run.completed_by = actor

    if "notes" in provided:
        run.notes = payload.notes
    if "completed_by" in provided:
        run.completed_by = payload.completed_by
    db.commit()
    db.refresh(run)
    return _run_dict(run)


def _open_work_order_counts(db: Session) -> dict:
    rows = (
        db.query(MaintenanceWorkOrder.asset_id, func.count(MaintenanceWorkOrder.id))
        .filter(
            MaintenanceWorkOrder.asset_id.isnot(None),
            MaintenanceWorkOrder.status.in_(["open", "in_progress"]),
        )
        .group_by(MaintenanceWorkOrder.asset_id)
        .all()
    )
    return {asset_id: int(count) for asset_id, count in rows}


def _asset_dict(asset: MaintenanceAsset, open_work_orders: int) -> dict:
    today = business_today()
    service_due = (
        asset.next_service_due is not None
        and asset.next_service_due <= today + timedelta(days=14)
    )
    return {
        "id": asset.id,
        "name": asset.name,
        "category": asset.category,
        "location": asset.location,
        "serial_number": asset.serial_number,
        "status": asset.status,
        "criticality": asset.criticality,
        "purchase_date": _iso(asset.purchase_date),
        "warranty_until": _iso(asset.warranty_until),
        "next_service_due": _iso(asset.next_service_due),
        "service_due": bool(service_due),
        "open_work_orders": int(open_work_orders),
        "notes": asset.notes,
        "created_at": _iso(asset.created_at),
        "updated_at": _iso(asset.updated_at),
    }


@router.get("/assets")
def list_assets(
    category: Optional[str] = None,
    status: Optional[str] = None,
    query: Optional[str] = None,
    db: Session = Depends(get_db),
    session: dict = Depends(FACILITIES_DEPENDENCY),
):
    del session
    q = db.query(MaintenanceAsset)
    if category:
        q = q.filter(MaintenanceAsset.category == category)
    if status:
        q = q.filter(MaintenanceAsset.status == status)
    if query:
        like = f"%{query.strip()}%"
        q = q.filter(
            MaintenanceAsset.name.ilike(like)
            | MaintenanceAsset.location.ilike(like)
            | MaintenanceAsset.serial_number.ilike(like)
        )
    assets = (
        q.order_by(
            MaintenanceAsset.next_service_due.is_(None),
            MaintenanceAsset.next_service_due.asc(),
            MaintenanceAsset.name.asc(),
        )
        .all()
    )
    counts = _open_work_order_counts(db)
    items = [_asset_dict(asset, counts.get(asset.id, 0)) for asset in assets]
    summary = {
        "total": len(items),
        "operational": sum(1 for row in items if row["status"] == "operational"),
        "under_maintenance": sum(
            1 for row in items if row["status"] == "under_maintenance"
        ),
        "out_of_service": sum(1 for row in items if row["status"] == "out_of_service"),
        "due_service": sum(1 for row in items if row["service_due"]),
        "open_work_orders": sum(row["open_work_orders"] for row in items),
    }
    return {"items": items, "summary": summary}


@router.post("/assets")
def create_asset(
    payload: AssetCreate,
    db: Session = Depends(get_db),
    session: dict = Depends(FACILITIES_DEPENDENCY),
):
    del session
    if payload.status not in ASSET_STATUSES:
        raise HTTPException(
            status_code=422,
            detail="Status must be operational, under_maintenance or out_of_service.",
        )
    if payload.criticality not in ASSET_CRITICALITIES:
        raise HTTPException(
            status_code=422, detail="Criticality must be low, normal, high or critical."
        )
    asset = MaintenanceAsset(
        name=payload.name.strip(),
        category=payload.category.strip() or "kitchen",
        location=(payload.location or "").strip() or None,
        serial_number=(payload.serial_number or "").strip() or None,
        status=payload.status,
        criticality=payload.criticality,
        purchase_date=payload.purchase_date,
        warranty_until=payload.warranty_until,
        next_service_due=payload.next_service_due,
        notes=(payload.notes or "").strip() or None,
    )
    db.add(asset)
    db.commit()
    db.refresh(asset)
    return _asset_dict(asset, 0)


@router.patch("/assets/{asset_id}")
def update_asset(
    asset_id: int,
    payload: AssetUpdate,
    db: Session = Depends(get_db),
    session: dict = Depends(FACILITIES_DEPENDENCY),
):
    del session
    asset = db.query(MaintenanceAsset).filter(MaintenanceAsset.id == asset_id).first()
    if asset is None:
        raise HTTPException(status_code=404, detail="Asset not found.")
    provided = payload.model_fields_set
    if "status" in provided and payload.status not in ASSET_STATUSES:
        raise HTTPException(
            status_code=422,
            detail="Status must be operational, under_maintenance or out_of_service.",
        )
    if "criticality" in provided and payload.criticality not in ASSET_CRITICALITIES:
        raise HTTPException(
            status_code=422, detail="Criticality must be low, normal, high or critical."
        )
    if "name" in provided:
        name = (payload.name or "").strip()
        if len(name) < 2:
            raise HTTPException(status_code=422, detail="Asset name is too short.")
        asset.name = name
    if "category" in provided:
        category = (payload.category or "").strip()
        if not category:
            raise HTTPException(status_code=422, detail="Asset category is required.")
        asset.category = category
    if "location" in provided:
        asset.location = (payload.location or "").strip() or None
    if "serial_number" in provided:
        asset.serial_number = (payload.serial_number or "").strip() or None
    if "status" in provided:
        asset.status = payload.status
    if "criticality" in provided:
        asset.criticality = payload.criticality
    if "purchase_date" in provided:
        asset.purchase_date = payload.purchase_date
    if "warranty_until" in provided:
        asset.warranty_until = payload.warranty_until
    if "next_service_due" in provided:
        asset.next_service_due = payload.next_service_due
    if "notes" in provided:
        asset.notes = (payload.notes or "").strip() or None
    db.commit()
    db.refresh(asset)
    counts = _open_work_order_counts(db)
    return _asset_dict(asset, counts.get(asset.id, 0))


def _work_order_dict(wo: MaintenanceWorkOrder, now: datetime) -> dict:
    overdue = (
        wo.due_at is not None
        and wo.due_at < now
        and wo.status in {"open", "in_progress"}
    )
    return {
        "id": wo.id,
        "asset_id": wo.asset_id,
        "asset_name": wo.asset.name if wo.asset else None,
        "title": wo.title,
        "description": wo.description,
        "priority": wo.priority,
        "status": wo.status,
        "reported_by": wo.reported_by,
        "assigned_to": wo.assigned_to,
        "due_at": _iso(wo.due_at),
        "completed_at": _iso(wo.completed_at),
        "cost": _money(wo.cost),
        "overdue": bool(overdue),
        "created_at": _iso(wo.created_at),
        "updated_at": _iso(wo.updated_at),
    }


@router.get("/work-orders")
def list_work_orders(
    status: Optional[str] = None,
    priority: Optional[str] = None,
    asset_id: Optional[int] = None,
    db: Session = Depends(get_db),
    session: dict = Depends(FACILITIES_DEPENDENCY),
):
    del session
    q = db.query(MaintenanceWorkOrder)
    if status:
        q = q.filter(MaintenanceWorkOrder.status == status)
    if priority:
        q = q.filter(MaintenanceWorkOrder.priority == priority)
    if asset_id is not None:
        q = q.filter(MaintenanceWorkOrder.asset_id == asset_id)
    status_rank = case(
        {"open": 0, "in_progress": 1},
        value=MaintenanceWorkOrder.status,
        else_=2,
    )
    priority_rank = case(
        {"urgent": 0, "high": 1, "normal": 2, "low": 3},
        value=MaintenanceWorkOrder.priority,
        else_=4,
    )
    work_orders = (
        q.order_by(
            status_rank.asc(),
            priority_rank.asc(),
            MaintenanceWorkOrder.due_at.is_(None),
            MaintenanceWorkOrder.due_at.asc(),
            MaintenanceWorkOrder.id.asc(),
        )
        .all()
    )
    now = datetime.utcnow()
    items = [_work_order_dict(wo, now) for wo in work_orders]
    summary = {
        "open": sum(1 for row in items if row["status"] == "open"),
        "in_progress": sum(1 for row in items if row["status"] == "in_progress"),
        "completed": sum(1 for row in items if row["status"] == "completed"),
        "overdue": sum(1 for row in items if row["overdue"]),
    }
    return {"items": items, "summary": summary}


@router.post("/work-orders")
def create_work_order(
    payload: WorkOrderCreate,
    db: Session = Depends(get_db),
    session: dict = Depends(FACILITIES_DEPENDENCY),
):
    if payload.priority not in WORK_ORDER_PRIORITIES:
        raise HTTPException(
            status_code=422, detail="Priority must be low, normal, high or urgent."
        )
    asset = None
    if payload.asset_id is not None:
        asset = (
            db.query(MaintenanceAsset)
            .filter(MaintenanceAsset.id == payload.asset_id)
            .first()
        )
        if asset is None:
            raise HTTPException(status_code=404, detail="Asset not found.")
    reported_by = (payload.reported_by or "").strip() or _actor(session)
    work_order = MaintenanceWorkOrder(
        asset_id=payload.asset_id,
        store_id=payload.store_id,
        title=payload.title.strip(),
        description=(payload.description or "").strip() or None,
        priority=payload.priority,
        status="open",
        reported_by=reported_by,
        assigned_to=(payload.assigned_to or "").strip() or None,
        due_at=payload.due_at,
        cost=0,
    )
    db.add(work_order)
    if asset is not None and (
        payload.priority in {"high", "urgent"} or asset.status == "operational"
    ):
        asset.status = "under_maintenance"
    db.commit()
    db.refresh(work_order)
    return _work_order_dict(work_order, datetime.utcnow())


@router.patch("/work-orders/{wo_id}")
def update_work_order(
    wo_id: int,
    payload: WorkOrderUpdate,
    db: Session = Depends(get_db),
    session: dict = Depends(FACILITIES_DEPENDENCY),
):
    del session
    work_order = (
        db.query(MaintenanceWorkOrder)
        .filter(MaintenanceWorkOrder.id == wo_id)
        .first()
    )
    if work_order is None:
        raise HTTPException(status_code=404, detail="Work order not found.")
    provided = payload.model_fields_set
    if "status" in provided and payload.status not in WORK_ORDER_STATUSES:
        raise HTTPException(
            status_code=422,
            detail="Status must be open, in_progress, completed or cancelled.",
        )
    if "priority" in provided and payload.priority not in WORK_ORDER_PRIORITIES:
        raise HTTPException(
            status_code=422, detail="Priority must be low, normal, high or urgent."
        )
    if "title" in provided:
        title = (payload.title or "").strip()
        if len(title) < 2:
            raise HTTPException(status_code=422, detail="Work order title is too short.")
        work_order.title = title
    if "description" in provided:
        work_order.description = (payload.description or "").strip() or None
    if "priority" in provided:
        work_order.priority = payload.priority
    if "assigned_to" in provided:
        work_order.assigned_to = (payload.assigned_to or "").strip() or None
    if "due_at" in provided:
        work_order.due_at = payload.due_at
    if "cost" in provided and payload.cost is not None:
        work_order.cost = round(float(payload.cost), 2)
    if "status" in provided:
        work_order.status = payload.status
        if payload.status == "completed" and work_order.completed_at is None:
            work_order.completed_at = datetime.utcnow()
    db.flush()

    if payload.status in {"completed", "cancelled"} and work_order.asset_id:
        asset = (
            db.query(MaintenanceAsset)
            .filter(MaintenanceAsset.id == work_order.asset_id)
            .first()
        )
        if asset is not None and asset.status != "out_of_service":
            other_open = (
                db.query(MaintenanceWorkOrder)
                .filter(
                    MaintenanceWorkOrder.asset_id == asset.id,
                    MaintenanceWorkOrder.id != work_order.id,
                    MaintenanceWorkOrder.status.in_(["open", "in_progress"]),
                )
                .count()
            )
            if other_open == 0:
                asset.status = "operational"

    db.commit()
    db.refresh(work_order)
    return _work_order_dict(work_order, datetime.utcnow())
