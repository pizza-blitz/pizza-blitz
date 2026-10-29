"""Technology workspace API: platform overview, data quality and CSV exports."""

import csv
import io
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import StreamingResponse
from sqlalchemy import func, or_
from sqlalchemy.orm import Session

from app.api.deps import get_db, require_department_permission
from app.core.clock import business_now, business_today
from app.db.base import Base
from app.models.domain import (
    BusinessDepartment,
    Customer,
    DeliveryAssignment,
    GiftCard,
    InventoryItem,
    MediaAsset,
    MenuItem,
    RestaurantOrder,
    SupportTicket,
)

router = APIRouter()

technology_access = require_department_permission(
    "technology",
    "technology.data",
    "technology.view",
)

EXPORT_MODELS = {
    "orders": RestaurantOrder,
    "customers": Customer,
    "menu": MenuItem,
    "inventory": InventoryItem,
}

EXPORT_DATASETS = {
    "orders": {
        "label": "Orders",
        "columns": [
            "id",
            "date",
            "store_id",
            "order_type",
            "status",
            "payment_status",
            "payment_method",
            "subtotal",
            "discount_amount",
            "tax_amount",
            "total_amount",
            "customer_name",
            "customer_phone",
            "created_at",
        ],
    },
    "customers": {
        "label": "Customers",
        "columns": [
            "id",
            "name",
            "phone",
            "email",
            "total_orders",
            "total_spend",
            "created_at",
        ],
    },
    "menu": {
        "label": "Menu items",
        "columns": [
            "id",
            "name",
            "category",
            "selling_price",
            "cost_price",
            "is_available",
        ],
    },
    "inventory": {
        "label": "Inventory items",
        "columns": [
            "id",
            "name",
            "category",
            "unit",
            "current_stock",
            "minimum_stock",
            "cost_per_unit",
            "supplier_name",
        ],
    },
}


def _round(value: float) -> float:
    return round(float(value or 0), 2)


def _iso(value) -> Optional[str]:
    return value.isoformat() if value is not None else None


def _count(db: Session, model) -> int:
    return int(db.query(func.count(model.id)).scalar() or 0)


def _latest(db: Session, column):
    return db.query(func.max(column)).scalar()


def _check(key: str, label: str, count: int, detail: str, breach: bool) -> dict:
    if count <= 0:
        status = "ok"
    elif breach:
        status = "breach"
    else:
        status = "warning"
    return {
        "key": key,
        "label": label,
        "status": status,
        "count": count,
        "detail": detail,
    }


def _checks(db: Session) -> list[dict]:
    missing_store = int(
        db.query(func.count(RestaurantOrder.id))
        .filter(RestaurantOrder.store_id.is_(None))
        .scalar()
        or 0
    )
    zero_value = int(
        db.query(func.count(RestaurantOrder.id))
        .filter(
            RestaurantOrder.status != "cancelled",
            or_(
                RestaurantOrder.total_amount.is_(None),
                RestaurantOrder.total_amount <= 0,
            ),
        )
        .scalar()
        or 0
    )
    menu_missing_cost = int(
        db.query(func.count(MenuItem.id))
        .filter(
            or_(MenuItem.cost_price.is_(None), MenuItem.cost_price <= 0),
        )
        .scalar()
        or 0
    )
    negative_stock = int(
        db.query(func.count(InventoryItem.id))
        .filter(InventoryItem.current_stock < 0)
        .scalar()
        or 0
    )
    missing_phone = int(
        db.query(func.count(Customer.id))
        .filter(or_(Customer.phone.is_(None), Customer.phone == ""))
        .scalar()
        or 0
    )
    duplicate_names = int(
        len(
            db.query(MenuItem.name)
            .filter(MenuItem.name.is_not(None))
            .group_by(MenuItem.name)
            .having(func.count(MenuItem.id) > 1)
            .all()
        )
    )
    unassigned_delivery = int(
        db.query(func.count(RestaurantOrder.id))
        .outerjoin(DeliveryAssignment)
        .filter(
            RestaurantOrder.order_type == "delivery",
            RestaurantOrder.status.in_(("open", "preparing", "ready")),
            DeliveryAssignment.id.is_(None),
        )
        .scalar()
        or 0
    )
    return [
        _check(
            "orders_missing_store",
            "Orders without a store",
            missing_store,
            "Orders that are not attached to an outlet cannot be reported per store.",
            True,
        ),
        _check(
            "zero_value_orders",
            "Zero-value orders",
            zero_value,
            "Non-cancelled orders with a total of zero or less.",
            False,
        ),
        _check(
            "menu_missing_cost",
            "Menu items without cost",
            menu_missing_cost,
            "Menu items missing a positive recipe cost understate margins.",
            False,
        ),
        _check(
            "negative_stock",
            "Negative stock",
            negative_stock,
            "Inventory items with a negative on-hand quantity.",
            True,
        ),
        _check(
            "customers_missing_phone",
            "Customers without phone",
            missing_phone,
            "Customer records without a contact phone number.",
            False,
        ),
        _check(
            "duplicate_menu_names",
            "Duplicate menu names",
            duplicate_names,
            "Menu names that appear more than once.",
            True,
        ),
        _check(
            "unassigned_delivery",
            "Unassigned delivery orders",
            unassigned_delivery,
            "Delivery orders in progress without a delivery assignment.",
            False,
        ),
    ]


def _export_rows(db: Session, dataset: str) -> list[dict]:
    if dataset == "orders":
        orders = (
            db.query(RestaurantOrder)
            .order_by(RestaurantOrder.id.asc())
            .all()
        )
        return [
            {
                "id": order.id,
                "date": _iso(order.date),
                "store_id": order.store_id,
                "order_type": order.order_type,
                "status": order.status,
                "payment_status": order.payment_status,
                "payment_method": order.payment_method,
                "subtotal": order.subtotal,
                "discount_amount": order.discount_amount,
                "tax_amount": order.tax_amount,
                "total_amount": order.total_amount,
                "customer_name": order.customer_name,
                "customer_phone": order.customer_phone,
                "created_at": _iso(order.created_at),
            }
            for order in orders
        ]
    if dataset == "customers":
        customers = db.query(Customer).order_by(Customer.id.asc()).all()
        return [
            {
                "id": customer.id,
                "name": customer.name,
                "phone": customer.phone,
                "email": customer.email,
                "total_orders": customer.total_orders,
                "total_spend": customer.total_spend,
                "created_at": _iso(customer.first_seen_at),
            }
            for customer in customers
        ]
    if dataset == "menu":
        items = db.query(MenuItem).order_by(MenuItem.id.asc()).all()
        return [
            {
                "id": item.id,
                "name": item.name,
                "category": item.category,
                "selling_price": item.selling_price,
                "cost_price": item.cost_price,
                "is_available": item.is_available,
            }
            for item in items
        ]
    inventory = db.query(InventoryItem).order_by(InventoryItem.id.asc()).all()
    return [
        {
            "id": item.id,
            "name": item.name,
            "category": item.category,
            "unit": item.unit,
            "current_stock": item.current_stock,
            "minimum_stock": item.minimum_stock,
            "cost_per_unit": item.cost_per_unit,
            "supplier_name": item.supplier_name,
        }
        for item in inventory
    ]


@router.get("/overview")
def technology_overview(
    db: Session = Depends(get_db),
    session: dict = Depends(technology_access),
):
    del session
    counts = [
        {"key": "orders", "label": "Orders", "count": _count(db, RestaurantOrder)},
        {"key": "customers", "label": "Customers", "count": _count(db, Customer)},
        {"key": "menu_items", "label": "Menu items", "count": _count(db, MenuItem)},
        {
            "key": "inventory_items",
            "label": "Inventory items",
            "count": _count(db, InventoryItem),
        },
        {
            "key": "business_departments",
            "label": "Business departments",
            "count": _count(db, BusinessDepartment),
        },
        {
            "key": "media_assets",
            "label": "Media assets",
            "count": _count(db, MediaAsset),
        },
        {
            "key": "support_tickets",
            "label": "Support tickets",
            "count": _count(db, SupportTicket),
        },
        {"key": "gift_cards", "label": "Gift cards", "count": _count(db, GiftCard)},
    ]
    return {
        "database": {
            "engine": db.get_bind().dialect.name,
            "table_count": len(Base.metadata.tables),
        },
        "counts": counts,
        "freshness": {
            "latest_order_created_at": _iso(
                _latest(db, RestaurantOrder.created_at)
            ),
            "latest_customer_created_at": _iso(
                _latest(db, Customer.first_seen_at)
            ),
            "latest_menu_item_created_at": _iso(
                _latest(db, MenuItem.created_at)
            ),
            "latest_media_asset_created_at": _iso(
                _latest(db, MediaAsset.created_at)
            ),
        },
        "checks": _checks(db),
        "exports": [
            {
                "dataset": dataset,
                "label": spec["label"],
                "row_count": _count(db, EXPORT_MODELS[dataset]),
            }
            for dataset, spec in EXPORT_DATASETS.items()
        ],
        "generated_at": business_now().isoformat(),
    }


@router.get("/export")
def export_dataset(
    dataset: str = Query(...),
    db: Session = Depends(get_db),
    session: dict = Depends(technology_access),
):
    del session
    key = (dataset or "").strip().lower()
    spec = EXPORT_DATASETS.get(key)
    if spec is None:
        raise HTTPException(status_code=404, detail="Dataset not found.")
    rows = _export_rows(db, key)
    buffer = io.StringIO()
    writer = csv.DictWriter(buffer, fieldnames=spec["columns"])
    writer.writeheader()
    for row in rows:
        writer.writerow(row)
    payload = buffer.getvalue()
    filename = f"pizza-blitz-{key}-{business_today().isoformat()}.csv"
    return StreamingResponse(
        iter([payload]),
        media_type="text/csv; charset=utf-8",
        headers={
            "Content-Disposition": f'attachment; filename="{filename}"',
        },
    )
