from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from typing import List, Any
from app.core.clock import business_today
from app.api.deps import get_current_session, get_db
from app.models.domain import (
    DailySales,
    Expense,
    ExpenseCategory,
    InventoryItem,
    InventoryTransaction,
    PurchaseOrder,
    Vendor,
    VendorPriceHistory,
)
from app.services.company_work_service import (
    ensure_approval_for_source,
    sync_source_approval,
)
from app.services.store_service import resolve_store
from pydantic import BaseModel
from datetime import datetime, time

router = APIRouter()

class PurchaseOrderCreate(BaseModel):
    supplier_name: str
    supplier_whatsapp: str
    items: List[Any]
    total_amount: float
    status: str = "draft"
    store_id: int | None = None


class PurchaseOrderStatusUpdate(BaseModel):
    status: str


class PurchaseOrderItemsUpdate(BaseModel):
    items: List[Any]


def _serialize_purchase_order(order: PurchaseOrder) -> dict:
    return {
        "id": order.id,
        "store_id": order.store_id,
        "store": order.store.name if order.store else None,
        "supplier_name": order.supplier_name,
        "supplier_whatsapp": order.supplier_whatsapp,
        "items": order.items or [],
        "total_amount": round(float(order.total_amount or 0), 2),
        "status": order.status,
        "whatsapp_sent_at": (
            order.whatsapp_sent_at.isoformat()
            if order.whatsapp_sent_at
            else None
        ),
        "received_at": (
            order.received_at.isoformat() if order.received_at else None
        ),
        "created_at": order.created_at.isoformat() if order.created_at else None,
    }


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


def _ensure_inventory_expense_category(db: Session) -> ExpenseCategory:
    category = (
        db.query(ExpenseCategory)
        .filter(ExpenseCategory.name == "Inventory Purchase")
        .first()
    )
    if category:
        if not category.is_active:
            category.is_active = True
        return category

    category = ExpenseCategory(name="Inventory Purchase", is_active=True)
    db.add(category)
    db.flush()
    return category


def _post_purchase_order_expense(order: PurchaseOrder, db: Session) -> Expense | None:
    amount = round(float(order.total_amount or 0), 2)
    if amount <= 0:
        return None

    description = f"Purchase order #{order.id} received from {order.supplier_name}"
    existing_expense = (
        db.query(Expense)
        .filter(Expense.description == description)
        .first()
    )
    if existing_expense:
        return existing_expense

    category = _ensure_inventory_expense_category(db)
    today = business_today()
    expense = Expense(
        store_id=order.store_id,
        date=datetime.combine(today, time.min),
        category_id=category.id,
        amount=amount,
        description=description,
    )
    db.add(expense)

    daily = (
        db.query(DailySales)
        .filter(
            DailySales.store_id == order.store_id,
            DailySales.date == today,
        )
        .first()
    )
    if daily:
        daily.total_expense = round(float(daily.total_expense or 0) + amount, 2)
        daily.profit = round(float(daily.total_sale or 0) - float(daily.total_expense or 0), 2)
    else:
        db.add(DailySales(
            store_id=order.store_id,
            date=today,
            cash_collected=0,
            total_sale=0,
            total_expense=amount,
            profit=round(-amount, 2),
            payment_method="mixed",
            notes=f"Auto expense from PO-{order.id}",
        ))

    return expense


def _find_or_create_vendor_for_order(order: PurchaseOrder, db: Session) -> Vendor:
    vendor_name = (order.supplier_name or "Default Supplier").strip() or "Default Supplier"
    vendor = db.query(Vendor).filter(Vendor.name == vendor_name).first()
    if vendor:
        if order.supplier_whatsapp and not vendor.whatsapp:
            vendor.whatsapp = order.supplier_whatsapp
        return vendor

    vendor = Vendor(
        name=vendor_name,
        contact_person="Procurement Desk",
        phone=order.supplier_whatsapp or None,
        whatsapp=order.supplier_whatsapp or None,
        category="Inventory",
        is_active=True,
    )
    db.add(vendor)
    db.flush()
    return vendor


def _post_vendor_price_history(order: PurchaseOrder, db: Session) -> list[dict]:
    vendor = _find_or_create_vendor_for_order(order, db)
    logged_prices = []

    for line in order.items or []:
        if not isinstance(line, dict):
            continue

        item_name = _line_name(line)
        unit_cost = _line_number(
            line,
            ["unit_cost", "price_per_unit", "cost_per_unit"],
            0.0,
        )
        if not item_name or unit_cost <= 0:
            continue

        history = VendorPriceHistory(
            vendor_id=vendor.id,
            item_name=item_name,
            price_per_unit=unit_cost,
            unit=line.get("unit") or "unit",
            notes=f"Purchase order #{order.id} received",
        )
        db.add(history)
        logged_prices.append({
            "vendor_id": vendor.id,
            "vendor_name": vendor.name,
            "item_name": item_name,
            "price_per_unit": unit_cost,
            "unit": line.get("unit") or "unit",
        })

    return logged_prices


@router.get("/")
def get_purchase_orders(
    store_id: int | None = None,
    db: Session = Depends(get_db),
):
    query = db.query(PurchaseOrder)
    if store_id is not None:
        query = query.filter(PurchaseOrder.store_id == store_id)
    return [
        _serialize_purchase_order(order)
        for order in query.order_by(PurchaseOrder.id.desc()).all()
    ]


def _mirror_purchase_order_approval(
    db: Session,
    order: PurchaseOrder,
    session: dict,
    *,
    status: str = "pending",
    note: str | None = None,
):
    return ensure_approval_for_source(
        db,
        department_key="supply",
        kind="purchase_order",
        title=(
            f"Purchase order · {order.supplier_name} · "
            f"Rs {float(order.total_amount or 0):,.0f}"
        ),
        source_type="purchase_order",
        source_id=order.id,
        amount=float(order.total_amount or 0),
        requested_by=str(session.get("subject") or "admin"),
        note=note,
        store_id=order.store_id,
        metadata={
            "supplier_name": order.supplier_name,
            "status": order.status,
            "line_count": len(order.items or []),
            "store_id": order.store_id,
            "store": order.store.name if order.store else None,
        },
        status=status,
        decided_by=(
            str(session.get("subject") or "admin")
            if status != "pending"
            else None
        ),
    )


@router.post("/")
def create_purchase_order(
    obj_in: PurchaseOrderCreate,
    db: Session = Depends(get_db),
    session: dict = Depends(get_current_session),
):
    try:
        store = resolve_store(db, obj_in.store_id)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc

    db_obj = PurchaseOrder(
        store_id=store.id,
        supplier_name=obj_in.supplier_name,
        supplier_whatsapp=obj_in.supplier_whatsapp,
        items=obj_in.items,
        total_amount=obj_in.total_amount,
        status=obj_in.status
    )
    db.add(db_obj)
    db.commit()
    db.refresh(db_obj)
    _mirror_purchase_order_approval(db, db_obj, session)
    return _serialize_purchase_order(db_obj)

@router.post("/from-low-stock")
def create_purchase_orders_from_low_stock(
    store_id: int | None = None,
    db: Session = Depends(get_db),
    session: dict = Depends(get_current_session),
):
    try:
        store = resolve_store(db, store_id)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc

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
            store_id=store.id,
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
        _mirror_purchase_order_approval(db, purchase_order, session)

    return {
        "created": len(created_orders),
        "purchase_orders": [
            _serialize_purchase_order(order)
            for order in created_orders
        ],
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
        "purchase_order": _serialize_purchase_order(order),
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
    return {
        "status": order.status,
        "purchase_order": _serialize_purchase_order(order),
    }


@router.patch("/{order_id}/receive")
def receive_purchase_order(
    order_id: int,
    db: Session = Depends(get_db),
    session: dict = Depends(get_current_session),
):
    order = _get_purchase_order_or_404(order_id, db)
    if order.status == "received":
        return {
            "status": order.status,
            "purchase_order": _serialize_purchase_order(order),
            "inventory_updates": [],
            "skipped_items": [],
            "vendor_prices": [],
            "message": "Purchase order was already received.",
        }

    inventory_updates, skipped_items = _receive_inventory(order, db)
    order.status = "received"
    order.received_at = order.received_at or datetime.utcnow()
    expense = _post_purchase_order_expense(order, db)
    vendor_prices = _post_vendor_price_history(order, db)
    db.commit()
    db.refresh(order)
    if expense:
        db.refresh(expense)
    sync_source_approval(
        db,
        source_type="purchase_order",
        source_id=order.id,
        status="approved",
        decided_by=str(session.get("subject") or "admin"),
        note="Purchase order received into inventory.",
    )
    db.refresh(order)
    if expense:
        db.refresh(expense)

    return {
        "status": order.status,
        "purchase_order": _serialize_purchase_order(order),
        "inventory_updates": inventory_updates,
        "skipped_items": skipped_items,
        "expense": expense,
        "vendor_prices": vendor_prices,
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
    return {
        "status": order.status,
        "purchase_order": _serialize_purchase_order(order),
    }


@router.get("/{order_id}")
def get_purchase_order(order_id: int, db: Session = Depends(get_db)):
    return _serialize_purchase_order(_get_purchase_order_or_404(order_id, db))
