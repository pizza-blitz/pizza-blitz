from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from app.api.deps import get_db
from app.models.domain import Vendor, VendorPriceHistory
from pydantic import BaseModel
from typing import Optional

router = APIRouter()

class PriceEntry(BaseModel):
    vendor_id: int
    item_name: str
    price_per_unit: float
    unit: str
    notes: Optional[str] = None

def _vendor_dict(vendor: Vendor) -> dict:
    return {
        "id": vendor.id,
        "name": vendor.name,
        "contact_person": vendor.contact_person,
        "phone": vendor.phone,
        "whatsapp": vendor.whatsapp,
        "category": vendor.category,
        "is_active": vendor.is_active,
        "created_at": vendor.created_at.isoformat() if vendor.created_at else None,
    }

def _history_dict(history: VendorPriceHistory, vendor_name: str | None = None) -> dict:
    return {
        "id": history.id,
        "vendor_id": history.vendor_id,
        "vendor_name": vendor_name or (history.vendor.name if history.vendor else None),
        "item_name": history.item_name,
        "price_per_unit": history.price_per_unit,
        "unit": history.unit,
        "notes": history.notes,
        "recorded_date": history.recorded_date.isoformat() if history.recorded_date else None,
    }

@router.get("/")
def get_vendors(db: Session = Depends(get_db)):
    vendors = db.query(Vendor).order_by(Vendor.name.asc()).all()
    return [_vendor_dict(vendor) for vendor in vendors]

@router.post("/prices")
def log_price(entry: PriceEntry, db: Session = Depends(get_db)):
    vendor = db.get(Vendor, entry.vendor_id)
    if not vendor:
        raise HTTPException(status_code=404, detail="Vendor not found")

    history = VendorPriceHistory(
        vendor_id=entry.vendor_id,
        item_name=entry.item_name,
        price_per_unit=entry.price_per_unit,
        unit=entry.unit,
        notes=entry.notes,
    )
    db.add(history)
    db.commit()
    db.refresh(history)
    return {"status": "price logged", "item": entry.item_name, "price": _history_dict(history, vendor.name)}

@router.get("/prices/history/{item_name}")
def item_price_history(item_name: str, db: Session = Depends(get_db)):
    history = (
        db.query(VendorPriceHistory)
        .join(Vendor)
        .filter(VendorPriceHistory.item_name == item_name)
        .order_by(VendorPriceHistory.recorded_date.desc(), VendorPriceHistory.id.desc())
        .all()
    )
    return [_history_dict(row) for row in history]

@router.get("/prices/alerts/increases")
def price_increase_alerts(db: Session = Depends(get_db)):
    history = (
        db.query(VendorPriceHistory)
        .join(Vendor)
        .order_by(
            VendorPriceHistory.item_name.asc(),
            VendorPriceHistory.vendor_id.asc(),
            VendorPriceHistory.recorded_date.asc(),
        )
        .all()
    )

    grouped: dict[tuple[str, int], list[VendorPriceHistory]] = {}
    for row in history:
        grouped.setdefault((row.item_name, row.vendor_id), []).append(row)

    alerts = []
    for rows in grouped.values():
        for previous, current in zip(rows, rows[1:], strict=False):
            if previous.price_per_unit and current.price_per_unit / previous.price_per_unit > 1.05:
                alert = _history_dict(current)
                alert["prev_price"] = previous.price_per_unit
                alert["pct_increase"] = (
                    (current.price_per_unit - previous.price_per_unit)
                    / previous.price_per_unit
                    * 100
                )
                alerts.append(alert)

    return sorted(alerts, key=lambda row: row["recorded_date"] or "", reverse=True)

@router.get("/prices/recent")
def recent_vendor_prices(limit: int = 20, db: Session = Depends(get_db)):
    capped_limit = min(max(limit, 1), 50)
    rows = (
        db.query(VendorPriceHistory)
        .join(Vendor)
        .order_by(
            VendorPriceHistory.recorded_date.desc(),
            VendorPriceHistory.id.desc(),
        )
        .limit(capped_limit)
        .all()
    )
    return [_history_dict(row) for row in rows]

@router.get("/intelligence/cheapest/{item_name}")
def find_cheapest_vendor(item_name: str, db: Session = Depends(get_db)):
    rows = (
        db.query(VendorPriceHistory)
        .join(Vendor)
        .filter(VendorPriceHistory.item_name == item_name)
        .order_by(VendorPriceHistory.recorded_date.desc(), VendorPriceHistory.id.desc())
        .all()
    )

    latest_by_vendor: dict[int, VendorPriceHistory] = {}
    for row in rows:
        latest_by_vendor.setdefault(row.vendor_id, row)

    return sorted(
        [_history_dict(row) for row in latest_by_vendor.values()],
        key=lambda row: row["price_per_unit"],
    )
