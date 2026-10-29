"""Finance workspace APIs: outlet P&L and cost controls."""

from datetime import date
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from app.api.deps import get_db, require_department_permission
from app.models.domain import Store
from app.services.finance_service import outlet_pnl
from app.services.store_service import default_range

router = APIRouter()


@router.get("/outlet-pnl")
def get_outlet_pnl(
    start_date: Optional[date] = None,
    end_date: Optional[date] = None,
    days: int = Query(default=30, ge=1, le=366),
    store_id: Optional[int] = None,
    db: Session = Depends(get_db),
    session: dict = Depends(
        require_department_permission(
            "finance",
            "finance.budgets",
            "finance.accounting",
            "finance.view",
        )
    ),
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
    if store_id is not None:
        store = db.query(Store).filter(Store.id == store_id).first()
        if store is None:
            raise HTTPException(status_code=404, detail="Store not found.")
    return outlet_pnl(db, start_date, end_date, store_id=store_id)
