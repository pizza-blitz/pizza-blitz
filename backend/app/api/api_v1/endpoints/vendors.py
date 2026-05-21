from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session
from sqlalchemy import text
from app.api.deps import get_db
from pydantic import BaseModel
from typing import Optional, List

router = APIRouter()

class PriceEntry(BaseModel):
    vendor_id: int
    item_name: str
    price_per_unit: float
    unit: str
    notes: Optional[str] = None

@router.get("/")
def get_vendors(db: Session = Depends(get_db)):
    result = db.execute(text("SELECT * FROM vendors ORDER BY name")).fetchall()
    return [dict(r._mapping) for r in result]

@router.post("/prices")
def log_price(entry: PriceEntry, db: Session = Depends(get_db)):
    db.execute(text("""
        INSERT INTO vendor_price_history (vendor_id, item_name, price_per_unit, unit, notes)
        VALUES (:vid, :item, :price, :unit, :notes)
    """), {"vid": entry.vendor_id, "item": entry.item_name,
           "price": entry.price_per_unit, "unit": entry.unit, "notes": entry.notes})
    db.commit()
    return {"status": "price logged", "item": entry.item_name}

@router.get("/prices/history/{item_name}")
def item_price_history(item_name: str, db: Session = Depends(get_db)):
    result = db.execute(text("""
        SELECT h.*, v.name as vendor_name
        FROM vendor_price_history h
        JOIN vendors v ON v.id = h.vendor_id
        WHERE h.item_name = :item
        ORDER BY h.recorded_date DESC
    """), {"item": item_name}).fetchall()
    return [dict(r._mapping) for r in result]

@router.get("/prices/alerts/increases")
def price_increase_alerts(db: Session = Depends(get_db)):
    # Find items where latest price is > 5% higher than previous price
    result = db.execute(text("""
        WITH ranked_prices AS (
            SELECT item_name, vendor_id, price_per_unit, recorded_date,
                   LAG(price_per_unit) OVER (PARTITION BY item_name, vendor_id ORDER BY recorded_date) as prev_price
            FROM vendor_price_history
        )
        SELECT r.*, v.name as vendor_name,
               ((price_per_unit - prev_price) / prev_price * 100) as pct_increase
        FROM ranked_prices r
        JOIN vendors v ON v.id = r.vendor_id
        WHERE prev_price IS NOT NULL AND (price_per_unit / prev_price) > 1.05
        ORDER BY recorded_date DESC
    """)).fetchall()
    return [dict(r._mapping) for r in result]

@router.get("/intelligence/cheapest/{item_name}")
def find_cheapest_vendor(item_name: str, db: Session = Depends(get_db)):
    result = db.execute(text("""
        SELECT DISTINCT ON (vendor_id) vendor_id, price_per_unit, unit, recorded_date, v.name as vendor_name
        FROM vendor_price_history h
        JOIN vendors v ON v.id = h.vendor_id
        WHERE item_name = :item
        ORDER BY vendor_id, recorded_date DESC
    """), {"item": item_name}).fetchall()
    sorted_res = sorted([dict(r._mapping) for r in result], key=lambda x: x['price_per_unit'])
    return sorted_res
