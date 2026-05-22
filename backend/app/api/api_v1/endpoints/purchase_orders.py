from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from typing import List, Any
from app.api.deps import get_db
from app.models.domain import InventoryItem, PurchaseOrder
from pydantic import BaseModel
from datetime import datetime

router = APIRouter()

class PurchaseOrderCreate(BaseModel):
    supplier_name: str
    supplier_whatsapp: str
    items: List[Any]
    total_amount: float
    status: str = "draft"


def _reorder_quantity(item: InventoryItem) -> float:
    current_stock = float(item.current_stock or 0)
    minimum_stock = float(item.minimum_stock or 0)
    target_stock = minimum_stock * 2
    return round(max(target_stock - current_stock, minimum_stock - current_stock, 0), 4)


def _purchase_order_item(item: InventoryItem) -> dict:
    quantity = _reorder_quantity(item)
    unit_cost = float(item.cost_per_unit or 0)
    return {
        "inventory_item_id": item.id,
        "name": item.name,
        "quantity": quantity,
        "needed": quantity,
        "unit": item.unit,
        "unit_cost": unit_cost,
        "estimated_cost": round(quantity * unit_cost, 2),
        "current_stock": float(item.current_stock or 0),
        "minimum_stock": float(item.minimum_stock or 0),
    }

@router.get("/", response_model=List[Any])
def get_purchase_orders(db: Session = Depends(get_db)):
    return db.query(PurchaseOrder).all()

@router.post("/")
def create_purchase_order(obj_in: PurchaseOrderCreate, db: Session = Depends(get_db)):
    db_obj = PurchaseOrder(
        supplier_name=obj_in.supplier_name,
        supplier_whatsapp=obj_in.supplier_whatsapp,
        items=obj_in.items,
        total_amount=obj_in.total_amount,
        status=obj_in.status
    )
    db.add(db_obj)
    db.commit()
    db.refresh(db_obj)
    return db_obj

@router.post("/from-low-stock")
def create_purchase_orders_from_low_stock(db: Session = Depends(get_db)):
    low_items = (
        db.query(InventoryItem)
        .filter(InventoryItem.current_stock < InventoryItem.minimum_stock)
        .order_by(InventoryItem.name.asc())
        .all()
    )
    if not low_items:
        return {"created": 0, "purchase_orders": []}

    grouped = {}
    for item in low_items:
        supplier_name = item.supplier_name or "Default Supplier"
        supplier_whatsapp = item.supplier_whatsapp or ""
        key = (supplier_name, supplier_whatsapp)
        if key not in grouped:
            grouped[key] = []
        grouped[key].append(_purchase_order_item(item))

    created_orders = []
    for (supplier_name, supplier_whatsapp), items in grouped.items():
        purchase_order = PurchaseOrder(
            supplier_name=supplier_name,
            supplier_whatsapp=supplier_whatsapp,
            items=items,
            total_amount=round(
                sum(float(item["estimated_cost"] or 0) for item in items),
                2,
            ),
            status="draft",
        )
        db.add(purchase_order)
        created_orders.append(purchase_order)

    db.commit()
    for purchase_order in created_orders:
        db.refresh(purchase_order)

    return {
        "created": len(created_orders),
        "purchase_orders": created_orders,
    }

@router.get("/{order_id}")
def get_purchase_order(order_id: int, db: Session = Depends(get_db)):
    order = db.query(PurchaseOrder).filter(PurchaseOrder.id == order_id).first()
    if not order:
        raise HTTPException(status_code=404, detail="Order not found")
    return order
