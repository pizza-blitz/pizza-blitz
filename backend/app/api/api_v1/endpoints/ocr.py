from fastapi import APIRouter, Depends, File, UploadFile
from sqlalchemy.orm import Session
from app.api.deps import get_db
from app.models.domain import InventoryItem, InventoryTransaction
from app.services.gemini_service import bytes_part, generate_text, parse_json_response

router = APIRouter()

def _to_float(value, default: float = 0.0) -> float:
    try:
        return float(value)
    except (TypeError, ValueError):
        return default

@router.post("/scan-bill")
async def scan_bill(file: UploadFile = File(...), db: Session = Depends(get_db)):
    image_bytes = await file.read()
    image_part = bytes_part(image_bytes, file.content_type or "image/jpeg")
    
    prompt = """Extract all inventory items from this bill or photo.
    Return ONLY a JSON array like this:
    [{"item_name":"cheese","quantity":10,"unit":"kg","price_per_unit":500,"total_price":5000}]
    If any field is unclear use null. Return only the JSON array, nothing else."""
    
    raw = generate_text(model="gemini-1.5-flash", contents=[prompt, image_part])
    items = parse_json_response(raw)
    
    updated = []
    for item in items:
        if item.get("item_name") and item.get("quantity"):
            name = str(item["item_name"]).strip()
            quantity = _to_float(item.get("quantity"))
            unit = item.get("unit") or "units"
            unit_cost = _to_float(item.get("price_per_unit"))
            total_cost = _to_float(item.get("total_price"), quantity * unit_cost)

            inventory_item = db.query(InventoryItem).filter(InventoryItem.name == name).first()
            if inventory_item is None:
                inventory_item = InventoryItem(
                    name=name,
                    category="Imported",
                    unit=unit,
                    current_stock=0.0,
                    minimum_stock=0.0,
                    cost_per_unit=unit_cost,
                )
                db.add(inventory_item)
                db.flush()

            inventory_item.current_stock = (inventory_item.current_stock or 0.0) + quantity
            inventory_item.unit = unit
            inventory_item.cost_per_unit = unit_cost

            db.add(InventoryTransaction(
                item_id=inventory_item.id,
                transaction_type="purchase",
                quantity=quantity,
                unit_cost=unit_cost,
                total_cost=total_cost,
                notes="Imported from scanned bill",
            ))
            updated.append(name)
    db.commit()
    
    return {
        "extracted_items": items,
        "updated_inventory": updated,
        "total_items_found": len(items)
    }
