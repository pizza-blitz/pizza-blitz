"""Supply workspace: physical stocktakes against inventory items."""

from datetime import datetime
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy import case, func
from sqlalchemy.orm import Session

from app.api.deps import get_db, require_department_permission
from app.core.clock import business_today
from app.models.domain import (
    InventoryItem,
    InventoryTransaction,
    StocktakeLine,
    StocktakeSession,
)

router = APIRouter()

STOCKTAKE_DEPENDENCY = require_department_permission(
    "supply",
    "supply.stocktake",
    "supply.inventory",
    "supply.view",
)

STOCKTAKE_STATUSES = {"draft", "counting", "completed", "cancelled"}
CLOSED_STATUSES = {"completed", "cancelled"}


class StocktakeCreate(BaseModel):
    title: Optional[str] = Field(default=None, min_length=2, max_length=200)
    store_id: int = 1
    item_ids: Optional[list[int]] = None


class StocktakeUpdate(BaseModel):
    title: Optional[str] = Field(default=None, min_length=2, max_length=200)
    status: Optional[str] = Field(default=None, max_length=30)
    counted_by: Optional[str] = Field(default=None, max_length=120)
    notes: Optional[str] = Field(default=None, max_length=1000)


class StocktakeLineUpdate(BaseModel):
    counted_qty: float = Field(ge=0)
    note: Optional[str] = Field(default=None, max_length=500)


class StocktakeComplete(BaseModel):
    apply_adjustments: bool = True


def _iso(value) -> Optional[str]:
    if value is None:
        return None
    if isinstance(value, (datetime,)):
        return value.isoformat()
    if hasattr(value, "isoformat"):
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


def _line_dict(line: StocktakeLine) -> dict:
    return {
        "id": line.id,
        "item_id": line.item_id,
        "item_name": line.item_name,
        "unit": line.unit,
        "expected_qty": round(float(line.expected_qty or 0), 4),
        "counted_qty": round(float(line.counted_qty or 0), 4),
        "variance_qty": round(float(line.variance_qty or 0), 4),
        "unit_cost": _money(line.unit_cost),
        "variance_value": _money(line.variance_value),
        "note": line.note,
    }


def _session_dict(
    session: StocktakeSession,
    line_count: int = 0,
    counted_lines: int = 0,
) -> dict:
    return {
        "id": session.id,
        "store_id": session.store_id,
        "title": session.title,
        "status": session.status,
        "counted_by": session.counted_by,
        "started_at": _iso(session.started_at),
        "completed_at": _iso(session.completed_at),
        "variance_value": _money(session.variance_value),
        "line_count": int(line_count),
        "counted_lines": int(counted_lines),
        "created_at": _iso(session.created_at),
        "updated_at": _iso(session.updated_at),
    }


def _line_stats(db: Session, session_ids: Optional[list[int]] = None) -> dict:
    query = db.query(
        StocktakeLine.session_id,
        func.count(StocktakeLine.id),
        func.sum(
            case(
                (StocktakeLine.counted_qty != StocktakeLine.expected_qty, 1),
                else_=0,
            )
        ),
    )
    if session_ids is not None:
        if not session_ids:
            return {}
        query = query.filter(StocktakeLine.session_id.in_(session_ids))
    rows = query.group_by(StocktakeLine.session_id).all()
    return {
        session_id: (int(line_count or 0), int(counted or 0))
        for session_id, line_count, counted in rows
    }


def _load_session(db: Session, session_id: int) -> StocktakeSession:
    session = (
        db.query(StocktakeSession).filter(StocktakeSession.id == session_id).first()
    )
    if session is None:
        raise HTTPException(status_code=404, detail="Stocktake not found.")
    return session


def _detail(db: Session, session: StocktakeSession) -> dict:
    lines = (
        db.query(StocktakeLine)
        .filter(StocktakeLine.session_id == session.id)
        .order_by(StocktakeLine.item_name.asc(), StocktakeLine.id.asc())
        .all()
    )
    serialized = [_line_dict(line) for line in lines]
    variance_lines = [
        line for line in serialized if abs(line["variance_qty"]) > 0.000001
    ]
    expected_value = sum(line["expected_qty"] * line["unit_cost"] for line in serialized)
    counted_value = sum(line["counted_qty"] * line["unit_cost"] for line in serialized)
    summary = {
        "line_count": len(serialized),
        "counted_lines": len(variance_lines),
        "variance_lines": len(variance_lines),
        "variance_value": _money(session.variance_value),
        "expected_value": _money(expected_value),
        "counted_value": _money(counted_value),
    }
    detail = _session_dict(session, len(serialized), len(variance_lines))
    detail["notes"] = session.notes
    return {"session": detail, "lines": serialized, "summary": summary}


@router.get("/stocktakes")
def list_stocktakes(
    limit: int = Query(default=50, ge=1, le=200),
    db: Session = Depends(get_db),
    session: dict = Depends(STOCKTAKE_DEPENDENCY),
):
    del session
    sessions = (
        db.query(StocktakeSession)
        .order_by(
            StocktakeSession.created_at.desc(),
            StocktakeSession.id.desc(),
        )
        .limit(limit)
        .all()
    )
    stats = _line_stats(db, [row.id for row in sessions])
    items = []
    for row in sessions:
        line_count, counted_lines = stats.get(row.id, (0, 0))
        items.append(_session_dict(row, line_count, counted_lines))

    total = db.query(StocktakeSession).count()
    draft = db.query(StocktakeSession).filter(StocktakeSession.status == "draft").count()
    counting = (
        db.query(StocktakeSession)
        .filter(StocktakeSession.status == "counting")
        .count()
    )
    completed = (
        db.query(StocktakeSession)
        .filter(StocktakeSession.status == "completed")
        .count()
    )
    last_completed_at = (
        db.query(func.max(StocktakeSession.completed_at))
        .filter(StocktakeSession.status == "completed")
        .scalar()
    )
    total_variance = (
        db.query(func.sum(StocktakeSession.variance_value)).scalar() or 0
    )
    summary = {
        "total": total,
        "draft": draft,
        "counting": counting,
        "completed": completed,
        "last_completed_at": _iso(last_completed_at),
        "total_variance_value": _money(total_variance),
    }
    return {"items": items, "summary": summary}


@router.post("/stocktakes")
def create_stocktake(
    payload: StocktakeCreate,
    db: Session = Depends(get_db),
    session: dict = Depends(STOCKTAKE_DEPENDENCY),
):
    del session
    if payload.item_ids is not None:
        item_ids = list(dict.fromkeys(payload.item_ids))
        items = (
            db.query(InventoryItem).filter(InventoryItem.id.in_(item_ids)).all()
            if item_ids
            else []
        )
        found = {item.id for item in items}
        missing = [item_id for item_id in item_ids if item_id not in found]
        if missing:
            raise HTTPException(
                status_code=404,
                detail=f"Inventory items not found: {', '.join(str(i) for i in missing)}.",
            )
    else:
        items = db.query(InventoryItem).order_by(InventoryItem.name.asc()).all()

    if not items:
        raise HTTPException(
            status_code=422,
            detail="Add inventory items before starting a stocktake.",
        )

    title = (payload.title or "").strip() or f"Stocktake {business_today().isoformat()}"
    stocktake = StocktakeSession(
        store_id=payload.store_id,
        title=title,
        status="counting",
        started_at=datetime.utcnow(),
        variance_value=0,
    )
    db.add(stocktake)
    db.flush()

    for item in items:
        expected = float(item.current_stock or 0)
        unit_cost = float(item.cost_per_unit or 0)
        db.add(
            StocktakeLine(
                session_id=stocktake.id,
                item_id=item.id,
                item_name=item.name,
                unit=item.unit,
                expected_qty=expected,
                counted_qty=expected,
                variance_qty=0,
                unit_cost=unit_cost,
                variance_value=0,
            )
        )
    db.commit()
    db.refresh(stocktake)
    return _detail(db, stocktake)


@router.get("/stocktakes/{session_id}")
def get_stocktake(
    session_id: int,
    db: Session = Depends(get_db),
    session: dict = Depends(STOCKTAKE_DEPENDENCY),
):
    del session
    return _detail(db, _load_session(db, session_id))


@router.patch("/stocktakes/{session_id}")
def update_stocktake(
    session_id: int,
    payload: StocktakeUpdate,
    db: Session = Depends(get_db),
    session: dict = Depends(STOCKTAKE_DEPENDENCY),
):
    stocktake = _load_session(db, session_id)
    provided = payload.model_fields_set
    if "status" in provided and payload.status not in STOCKTAKE_STATUSES:
        raise HTTPException(
            status_code=422,
            detail="Status must be draft, counting, completed or cancelled.",
        )
    if stocktake.status == "completed":
        changed = [
            name
            for name in ("title", "status", "counted_by")
            if name in provided
        ]
        if changed:
            raise HTTPException(
                status_code=422,
                detail="Completed stocktakes can only be updated with notes.",
            )
    if "title" in provided:
        title = (payload.title or "").strip()
        if len(title) < 2:
            raise HTTPException(status_code=422, detail="Stocktake title is too short.")
        stocktake.title = title
    if "counted_by" in provided:
        stocktake.counted_by = (payload.counted_by or "").strip() or None
    if "status" in provided:
        stocktake.status = payload.status
        if payload.status == "completed":
            if stocktake.completed_at is None:
                stocktake.completed_at = datetime.utcnow()
            if not stocktake.counted_by:
                stocktake.counted_by = _actor(session)
    if "notes" in provided:
        stocktake.notes = payload.notes
    db.commit()
    db.refresh(stocktake)
    return _detail(db, stocktake)


@router.patch("/stocktakes/{session_id}/lines/{line_id}")
def update_stocktake_line(
    session_id: int,
    line_id: int,
    payload: StocktakeLineUpdate,
    db: Session = Depends(get_db),
    session: dict = Depends(STOCKTAKE_DEPENDENCY),
):
    del session
    stocktake = _load_session(db, session_id)
    if stocktake.status in CLOSED_STATUSES:
        raise HTTPException(
            status_code=422,
            detail="Completed or cancelled stocktakes cannot be edited.",
        )
    line = (
        db.query(StocktakeLine)
        .filter(
            StocktakeLine.id == line_id,
            StocktakeLine.session_id == stocktake.id,
        )
        .first()
    )
    if line is None:
        raise HTTPException(status_code=404, detail="Stocktake line not found.")

    counted = round(float(payload.counted_qty), 4)
    unit_cost = float(line.unit_cost or 0)
    variance_qty = round(counted - float(line.expected_qty or 0), 4)
    line.counted_qty = counted
    line.variance_qty = variance_qty
    line.variance_value = round(variance_qty * unit_cost, 2)
    if "note" in payload.model_fields_set:
        line.note = payload.note
    db.flush()

    total_variance = (
        db.query(func.sum(StocktakeLine.variance_value))
        .filter(StocktakeLine.session_id == stocktake.id)
        .scalar()
        or 0
    )
    stocktake.variance_value = round(float(total_variance), 2)
    db.commit()
    db.refresh(line)
    db.refresh(stocktake)
    return {
        "line": _line_dict(line),
        "session": _session_dict(
            stocktake,
            db.query(StocktakeLine)
            .filter(StocktakeLine.session_id == stocktake.id)
            .count(),
            db.query(StocktakeLine)
            .filter(
                StocktakeLine.session_id == stocktake.id,
                StocktakeLine.counted_qty != StocktakeLine.expected_qty,
            )
            .count(),
        ),
    }


@router.post("/stocktakes/{session_id}/complete")
def complete_stocktake(
    session_id: int,
    payload: StocktakeComplete,
    db: Session = Depends(get_db),
    session: dict = Depends(STOCKTAKE_DEPENDENCY),
):
    stocktake = _load_session(db, session_id)
    if stocktake.status in CLOSED_STATUSES:
        raise HTTPException(
            status_code=422,
            detail="This stocktake is already completed or cancelled.",
        )
    lines = (
        db.query(StocktakeLine)
        .filter(StocktakeLine.session_id == stocktake.id)
        .all()
    )
    if payload.apply_adjustments:
        for line in lines:
            variance_qty = float(line.variance_qty or 0)
            if abs(variance_qty) <= 0.000001:
                continue
            item = (
                db.query(InventoryItem)
                .filter(InventoryItem.id == line.item_id)
                .first()
            )
            if item is None:
                continue
            item.current_stock = round(max(0.0, float(line.counted_qty or 0)), 4)
            db.add(
                InventoryTransaction(
                    item_id=item.id,
                    transaction_type="adjustment",
                    quantity=variance_qty,
                    unit_cost=float(line.unit_cost or 0),
                    total_cost=round(float(line.variance_value or 0), 2),
                    notes=f"Stocktake #{stocktake.id}: {stocktake.title}",
                )
            )
    stocktake.status = "completed"
    stocktake.completed_at = datetime.utcnow()
    if not stocktake.counted_by:
        stocktake.counted_by = _actor(session)
    db.commit()
    db.refresh(stocktake)
    return _detail(db, stocktake)
