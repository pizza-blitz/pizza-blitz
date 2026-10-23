from datetime import date
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.api.deps import get_db, require_roles
from app.models.domain import Store
from app.services.store_service import (
    consolidated_report,
    default_range,
    serialize_store,
    store_summaries,
)

router = APIRouter()


class StoreCreate(BaseModel):
    name: str = Field(min_length=2, max_length=120)
    code: str = Field(min_length=2, max_length=40, pattern="^[A-Za-z0-9_-]+$")
    address_line: Optional[str] = Field(default=None, max_length=255)
    phone: Optional[str] = Field(default=None, max_length=40)
    timezone: str = Field(default="Asia/Kolkata", max_length=60)


class StoreUpdate(BaseModel):
    name: Optional[str] = Field(default=None, min_length=2, max_length=120)
    address_line: Optional[str] = Field(default=None, max_length=255)
    phone: Optional[str] = Field(default=None, max_length=40)
    timezone: Optional[str] = Field(default=None, max_length=60)
    is_active: Optional[bool] = None


@router.get("/")
def list_stores(
    days: int = Query(default=30, ge=1, le=365),
    db: Session = Depends(get_db),
    session: dict = Depends(require_roles("admin", "staff")),
):
    del session
    start_date, end_date = default_range(days)
    return {
        "start_date": start_date.isoformat(),
        "end_date": end_date.isoformat(),
        "stores": store_summaries(db, start_date, end_date),
    }


@router.get("/consolidated")
def get_consolidated_report(
    start_date: Optional[date] = None,
    end_date: Optional[date] = None,
    days: int = Query(default=30, ge=1, le=365),
    db: Session = Depends(get_db),
    session: dict = Depends(require_roles("admin")),
):
    del session
    if start_date is None or end_date is None:
        start_date, end_date = default_range(days)
    if end_date < start_date:
        raise HTTPException(
            status_code=422, detail="End date must be on or after the start date."
        )
    if (end_date - start_date).days > 366:
        raise HTTPException(
            status_code=422, detail="Choose a range of 366 days or less."
        )
    return consolidated_report(db, start_date, end_date)


@router.post("/")
def create_store(
    payload: StoreCreate,
    db: Session = Depends(get_db),
    _: dict = Depends(require_roles("admin")),
):
    code = payload.code.strip().upper()
    existing = db.query(Store).filter(Store.code == code).first()
    if existing is not None:
        raise HTTPException(status_code=409, detail="That store code is already used.")
    store = Store(
        name=payload.name.strip(),
        code=code,
        address_line=(payload.address_line or "").strip() or None,
        phone=(payload.phone or "").strip() or None,
        timezone=payload.timezone.strip() or "Asia/Kolkata",
        is_active=True,
    )
    db.add(store)
    db.commit()
    db.refresh(store)
    return serialize_store(
        store,
        {
            "orders": 0,
            "revenue": 0.0,
            "avg_order_value": 0.0,
            "tips": 0.0,
            "refunds": 0.0,
        },
    )


@router.patch("/{store_id}")
def update_store(
    store_id: int,
    payload: StoreUpdate,
    db: Session = Depends(get_db),
    _: dict = Depends(require_roles("admin")),
):
    store = db.query(Store).filter(Store.id == store_id).first()
    if store is None:
        raise HTTPException(status_code=404, detail="Store not found.")
    if payload.is_active is False:
        active_count = db.query(Store).filter(Store.is_active.is_(True)).count()
        if active_count <= 1 and store.is_active:
            raise HTTPException(
                status_code=409,
                detail="At least one store must stay active.",
            )
    if payload.name is not None:
        store.name = payload.name.strip()
    if payload.address_line is not None:
        store.address_line = payload.address_line.strip() or None
    if payload.phone is not None:
        store.phone = payload.phone.strip() or None
    if payload.timezone is not None:
        store.timezone = payload.timezone.strip() or "Asia/Kolkata"
    if payload.is_active is not None:
        store.is_active = payload.is_active
    db.commit()
    db.refresh(store)
    return serialize_store(store)
