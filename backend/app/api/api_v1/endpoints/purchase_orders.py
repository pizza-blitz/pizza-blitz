from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from typing import List, Any
from app.api.deps import get_db
from app.models.domain import InventoryItem, InventoryTransaction, PurchaseOrder
from pydantic import BaseModel
from datetime import datetime

router = APIRouter()

class PurchaseOrderCreate(BaseModel):
    supplier_name: str
    supplier_whatsapp: str
    items: List[Any]
    total_amount: float
    status: str = "draft"


class PurchaseOrderStatusUpdate(BaseModel):
    status: str


class PurchaseOrderItemsUpdate(BaseModel):
    items: List[Any]


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


def _line_number(line: dict, keys: List[str], default: float = 0.0) -> float:
    for key in keys:
        try:
            value = line.get(key)
            if value is not None and value != "":
                return float(value)
        except (TypeError, ValueError):
            continue
    return default


def _line_name(line: dict) -> str:
    return str(line.get("name") or line.get("item_name") or "").strip()


def _normalize_purchase_order_line(line: dict) -> dict:
    if not isinstance(line, dict):
        raise HTTPException(status_code=422, detail="Each purchase order item must be an object")

    name = _line_name(line)
    if not name:
        raise HTTPException(status_code=422, detail="Each purchase order item needs a name")

    quantity = _line_number(line, ["quantity", "reorder_quantity", "needed"], 0.0)
    received_quantity = _line_number(line, ["received_quantity"], quantity)
    if quantity <= 0 < received_quantity:
        quantity = received_quantity

    unit_cost = _line_number(
        line,
        ["unit_cost", "price_per_unit", "cost_per_unit"],
        0.0,
    )
    if quantity < 0 or received_quantity < 0 or unit_cost < 0:
        raise HTTPException(
            status_code=422,
            detail="Quantities and unit cost cannot be negative",
        )

    normalized = dict(line)
    normalized["name"] = name
    normalized["unit"] = str(line.get("unit") or "unit")
    normalized["quantity"] = round(quantity, 4)
    normalized["needed"] = round(quantity, 4)
    normalized["received_quantity"] = round(received_quantity, 4)
    normalized["unit_cost"] = round(unit_cost, 4)
    normalized["estimated_cost"] = round(received_quantity * unit_cost, 2)
    if "inventory_item_id" not in normalized and line.get("item_id"):
        normalized["inventory_item_id"] = line["item_id"]
    return normalized


def _find_or_create_inventory_item(db: Session, line: dict) -> InventoryItem | None:
    item_id = line.get("inventory_item_id") or line.get("item_id")
    inventory_item = None
    if item_id:
        inventory_item = (
            db.query(InventoryItem)
            .filter(InventoryItem.id == item_id)
            .first()
        )
    if inventory_item:
        return inventory_item

    name = _line_name(line)
    if not name:
        return None

    inventory_item = (
        db.query(InventoryItem)
        .filter(InventoryItem.name == name)
        .first()
    )
    if inventory_item:
        return inventory_item

    inventory_item = InventoryItem(
        name=name,
        category=line.get("category") or "Purchased",
        unit=line.get("unit") or "unit",
        current_stock=0.0,
        minimum_stock=0.0,
        cost_per_unit=_line_number(
            line,
            ["unit_cost", "price_per_unit", "cost_per_unit"],
            0.0,
        ),
        supplier_name=line.get("supplier_name"),
        supplier_whatsapp=line.get("supplier_whatsapp"),
    )
    db.add(inventory_item)
    db.flush()
    return inventory_item


def _get_purchase_order_or_404(order_id: int, db: Session) -> PurchaseOrder:
    order = db.query(PurchaseOrder).filter(PurchaseOrder.id == order_id).first()
    if not order:
        raise HTTPException(status_code=404, detail="Order not found")
    return order


def _receive_inventory(order: PurchaseOrder, db: Session) -> tuple[list[dict], list[dict]]:
    inventory_updates = []
    skipped_items = []

    for line in order.items or []:
        if not isinstance(line, dict):
            skipped_items.append({"reason": "Invalid line item", "item": line})
            continue

        quantity = _line_number(
            line,
            ["received_quantity", "quantity", "reorder_quantity", "needed"],
            0.0,
        )
        if quantity <= 0:
            skipped_items.append({
                "name": _line_name(line) or "Unknown item",
                "reason": "Quantity must be greater than zero",
            })
            continue

        inventory_item = _find_or_create_inventory_item(db, line)
        if not inventory_item:
            skipped_items.append({
                "name": _line_name(line) or "Unknown item",
                "reason": "Inventory item could not be resolved",
            })
            continue

        unit_cost = _line_number(
            line,
            ["unit_cost", "price_per_unit", "cost_per_unit"],
            float(inventory_item.cost_per_unit or 0),
        )
        previous_stock = float(inventory_item.current_stock or 0)
        inventory_item.current_stock = round(previous_stock + quantity, 4)
        if unit_cost > 0:
            inventory_item.cost_per_unit = unit_cost

        total_cost = round(quantity * unit_cost, 2)
        db.add(InventoryTransaction(
            item_id=inventory_item.id,
            transaction_type="purchase",
            quantity=quantity,
            unit_cost=unit_cost,
            total_cost=total_cost,
            notes=f"Purchase order #{order.id} received from {order.supplier_name}",
        ))
        inventory_updates.append({
            "inventory_item_id": inventory_item.id,
            "name": inventory_item.name,
            "quantity": quantity,
            "unit": inventory_item.unit,
            "previous_stock": previous_stock,
            "new_stock": inventory_item.current_stock,
            "unit_cost": unit_cost,
            "total_cost": total_cost,
        })

    return inventory_updates, skipped_items


def _purchase_order_total(items: List[dict]) -> float:
    return round(sum(float(item.get("estimated_cost") or 0) for item in items), 2)


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

@router.patch("/{order_id}/items")
def reconcile_purchase_order_items(
    order_id: int,
    obj_in: PurchaseOrderItemsUpdate,
    db: Session = Depends(get_db),
):
    order = _get_purchase_order_or_404(order_id, db)
    if order.status == "received":
        raise HTTPException(status_code=409, detail="Received purchase orders cannot be edited")
    if not obj_in.items:
        raise HTTPException(status_code=422, detail="Purchase order needs at least one item")

    items = [_normalize_purchase_order_line(item) for item in obj_in.items]
    order.items = items
    order.total_amount = _purchase_order_total(items)
    db.commit()
    db.refresh(order)
    return {
        "purchase_order": order,
        "items": order.items,
        "total_amount": order.total_amount,
    }


@router.patch("/{order_id}/sent")
def mark_purchase_order_sent(order_id: int, db: Session = Depends(get_db)):
    order = _get_purchase_order_or_404(order_id, db)
    if order.status == "received":
        raise HTTPException(status_code=409, detail="Received purchase orders cannot be marked sent")

    order.status = "sent"
    order.whatsapp_sent_at = order.whatsapp_sent_at or datetime.utcnow()
    db.commit()
    db.refresh(order)
    return {"status": order.status, "purchase_order": order}


@router.patch("/{order_id}/receive")
def receive_purchase_order(order_id: int, db: Session = Depends(get_db)):
    order = _get_purchase_order_or_404(order_id, db)
    if order.status == "received":
        return {
            "status": order.status,
            "purchase_order": order,
            "inventory_updates": [],
            "skipped_items": [],
            "message": "Purchase order was already received.",
        }

    inventory_updates, skipped_items = _receive_inventory(order, db)
    order.status = "received"
    db.commit()
    db.refresh(order)

    return {
        "status": order.status,
        "purchase_order": order,
        "inventory_updates": inventory_updates,
        "skipped_items": skipped_items,
    }


@router.patch("/{order_id}/status")
def update_purchase_order_status(
    order_id: int,
    obj_in: PurchaseOrderStatusUpdate,
    db: Session = Depends(get_db),
):
    requested_status = obj_in.status.strip().lower()
    if requested_status == "sent":
        return mark_purchase_order_sent(order_id, db)
    if requested_status == "received":
        return receive_purchase_order(order_id, db)
    if requested_status != "draft":
        raise HTTPException(status_code=422, detail="Status must be draft, sent, or received")

    order = _get_purchase_order_or_404(order_id, db)
    if order.status == "received":
        raise HTTPException(status_code=409, detail="Received purchase orders cannot be changed to draft")

    order.status = "draft"
    db.commit()
    db.refresh(order)
    return {"status": order.status, "purchase_order": order}


@router.get("/{order_id}")
def get_purchase_order(order_id: int, db: Session = Depends(get_db)):
    return _get_purchase_order_or_404(order_id, db)
