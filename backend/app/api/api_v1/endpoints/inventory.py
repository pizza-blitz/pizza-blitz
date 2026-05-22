from fastapi import APIRouter, UploadFile, File, HTTPException, Depends
from sqlalchemy.orm import Session
import json
from typing import List, Optional
from pydantic import BaseModel
from app.api.deps import get_db
from app.models.domain import InventoryItem, InventoryTransaction
from app.services.gemini_service import bytes_part, generate_text

router = APIRouter()

class InventoryItemSchema(BaseModel):
    id: Optional[int] = None
    name: str
    category: str
    unit: str
    current_stock: float
    minimum_stock: float
    cost_per_unit: float
    supplier_name: Optional[str] = None
    supplier_whatsapp: Optional[str] = None

    class Config:
        from_attributes = True

class TransactionRequest(BaseModel):
    item_id: int
    transaction_type: str # purchase, usage, wastage
    quantity: float
    unit_cost: Optional[float] = None
    notes: Optional[str] = None


def _reorder_quantity(item: InventoryItem) -> float:
    current_stock = float(item.current_stock or 0)
    minimum_stock = float(item.minimum_stock or 0)
    target_stock = minimum_stock * 2
    return round(max(target_stock - current_stock, minimum_stock - current_stock, 0), 4)


def _low_stock_item_dict(item: InventoryItem) -> dict:
    reorder_quantity = _reorder_quantity(item)
    unit_cost = float(item.cost_per_unit or 0)
    return {
        "id": item.id,
        "name": item.name,
        "category": item.category,
        "unit": item.unit,
        "current_stock": float(item.current_stock or 0),
        "minimum_stock": float(item.minimum_stock or 0),
        "reorder_quantity": reorder_quantity,
        "estimated_cost": round(reorder_quantity * unit_cost, 2),
        "cost_per_unit": unit_cost,
        "supplier_name": item.supplier_name or "Default Supplier",
        "supplier_whatsapp": item.supplier_whatsapp or "",
    }

@router.get("/items", response_model=List[InventoryItemSchema])
def get_inventory_items(db: Session = Depends(get_db)):
    return db.query(InventoryItem).all()

@router.get("/low-stock")
def low_stock_summary(db: Session = Depends(get_db)):
    items = (
        db.query(InventoryItem)
        .filter(InventoryItem.current_stock < InventoryItem.minimum_stock)
        .order_by(InventoryItem.name.asc())
        .all()
    )
    suggestions = [_low_stock_item_dict(item) for item in items]
    grouped = {}
    for item in suggestions:
        key = item["supplier_whatsapp"] or item["supplier_name"]
        if key not in grouped:
            grouped[key] = {
                "supplier_name": item["supplier_name"],
                "supplier_whatsapp": item["supplier_whatsapp"],
                "items": [],
                "total_amount": 0.0,
            }
        grouped[key]["items"].append(item)
        grouped[key]["total_amount"] = round(
            grouped[key]["total_amount"] + item["estimated_cost"],
            2,
        )

    return {
        "count": len(suggestions),
        "items": suggestions,
        "groups": list(grouped.values()),
        "total_estimated_cost": round(
            sum(item["estimated_cost"] for item in suggestions),
            2,
        ),
    }

@router.post("/items", response_model=InventoryItemSchema)
def update_or_create_item(item: InventoryItemSchema, db: Session = Depends(get_db)):
    if item.id:
        db_item = db.query(InventoryItem).filter(InventoryItem.id == item.id).first()
        if not db_item: raise HTTPException(status_code=404, detail="Item not found")
        for key, value in item.model_dump().items():
            setattr(db_item, key, value)
    else:
        db_item = InventoryItem(**item.model_dump(exclude={"id"}))
        db.add(db_item)
    
    db.commit()
    db.refresh(db_item)
    return db_item

@router.post("/transaction")
def record_transaction(req: TransactionRequest, db: Session = Depends(get_db)):
    item = db.query(InventoryItem).filter(InventoryItem.id == req.item_id).first()
    if not item: raise HTTPException(status_code=404, detail="Item not found")
    
    # Update stock
    if req.transaction_type == "purchase":
        item.current_stock += req.quantity
        if req.unit_cost: item.cost_per_unit = req.unit_cost
    elif req.transaction_type in ["usage", "wastage"]:
        item.current_stock -= req.quantity
    
    transaction = InventoryTransaction(
        item_id=req.item_id,
        transaction_type=req.transaction_type,
        quantity=req.quantity,
        unit_cost=req.unit_cost or item.cost_per_unit,
        total_cost=req.quantity * (req.unit_cost or item.cost_per_unit),
        notes=req.notes
    )
    db.add(transaction)
    db.commit()
    return {"status": "success", "new_stock": item.current_stock}

@router.post("/extract-invoice")
async def extract_invoice(file: UploadFile = File(...)):
    try:
        contents = await file.read()
        invoice_part = bytes_part(
            contents,
            file.content_type or "application/octet-stream",
        )
        prompt = """
        Analyze this restaurant supplier invoice.
        Return only a JSON array of line items with:
        item_name, quantity, unit, price_per_unit, total_price.
        If a field is unclear, use null. Do not include markdown.
        """
        text = generate_text(model="gemini-1.5-flash", contents=[prompt, invoice_part])
        text = text.replace('```json', '').replace('```', '').strip()
        try:
            items = json.loads(text)
            return {"status": "success", "extracted_items": items}
        except json.JSONDecodeError:
            return {"status": "error", "message": "Failed to parse JSON from AI response", "raw_response": text}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
