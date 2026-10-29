"""Kitchen workspace API: menu engineering for the current sales window."""

from datetime import timedelta
from statistics import median
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from app.api.deps import get_db, require_department_permission
from app.core.clock import business_today
from app.models.domain import MenuItem, RestaurantOrder, Store

router = APIRouter()

CLASSIFICATION_ACTIONS = {
    "star": "Protect: keep it prominent and avoid discounting.",
    "plough_horse": "Renegotiate cost or reprice; it drives volume.",
    "puzzle": "Promote with staff suggestions and bundles.",
    "dog": "Remove or rework the recipe.",
}


def _round(value: float) -> float:
    return round(float(value or 0), 2)


def _percentage(part: float, whole: float) -> float:
    if whole <= 0:
        return 0.0
    return _round(part / whole * 100)


@router.get("/menu-engineering")
def menu_engineering(
    days: int = Query(default=30, ge=1, le=365),
    store_id: Optional[int] = None,
    db: Session = Depends(get_db),
    session: dict = Depends(
        require_department_permission(
            "kitchen",
            "kitchen.engineering",
            "kitchen.menu",
            "kitchen.view",
        )
    ),
):
    del session
    if store_id is not None:
        store = db.query(Store.id).filter(Store.id == store_id).first()
        if store is None:
            raise HTTPException(status_code=404, detail="Store not found.")

    start_date = business_today() - timedelta(days=days)
    query = db.query(RestaurantOrder).filter(
        RestaurantOrder.status != "cancelled",
        RestaurantOrder.date >= start_date,
    )
    if store_id is not None:
        query = query.filter(RestaurantOrder.store_id == store_id)
    orders = query.all()

    menu_items = db.query(MenuItem).all()
    cost_by_id = {item.id: float(item.cost_price or 0) for item in menu_items}
    menu_item_by_id = {item.id: item for item in menu_items}
    cost_by_name = {
        (item.name or "").strip().lower(): float(item.cost_price or 0)
        for item in menu_items
        if item.name
    }
    category_by_name = {
        (item.name or "").strip().lower(): item.category
        for item in menu_items
        if item.name
    }

    aggregated: dict[str, dict] = {}
    for order in orders:
        for raw_item in order.items or []:
            if not isinstance(raw_item, dict):
                continue
            quantity = int(float(raw_item.get("quantity") or 0))
            if quantity <= 0:
                continue
            price = float(raw_item.get("price") or 0)
            name = str(raw_item.get("name") or "").strip()
            menu_item_id = raw_item.get("menu_item_id")
            if not menu_item_id and not name:
                continue
            # Deleted menu items leave historical order lines behind, and
            # SQLite can reuse their integer IDs for new items. If the stored
            # ID now points at a differently named item, the line is stale:
            # group it by name instead of merging it into the new item.
            current_item = (
                menu_item_by_id.get(int(menu_item_id)) if menu_item_id else None
            )
            stale_id = (
                current_item is not None
                and name
                and (current_item.name or "").strip().lower() != name.lower()
            )
            if menu_item_id and not stale_id:
                key = f"id:{menu_item_id}"
            else:
                key = f"name:{name.lower()}"
            if key not in aggregated:
                cost_price = 0.0
                if menu_item_id:
                    cost_price = cost_by_id.get(int(menu_item_id), 0.0)
                if not cost_price and name:
                    cost_price = cost_by_name.get(name.lower(), 0.0)
                category = raw_item.get("category")
                if not category and name:
                    category = category_by_name.get(name.lower())
                aggregated[key] = {
                    "menu_item_id": int(menu_item_id) if menu_item_id else None,
                    "name": name or "Unnamed item",
                    "category": category or "Uncategorised",
                    "units": 0,
                    "revenue": 0.0,
                    "cost": 0.0,
                    "cost_price": cost_price,
                }
            row = aggregated[key]
            row["units"] += quantity
            row["revenue"] += price * quantity
            row["cost"] += row["cost_price"] * quantity

    sold = [row for row in aggregated.values() if row["units"] > 0]
    total_units = sum(row["units"] for row in sold)
    total_revenue = sum(row["revenue"] for row in sold)
    total_cost = sum(row["cost"] for row in sold)

    for row in sold:
        row["margin"] = row["revenue"] - row["cost"]
        row["margin_per_unit"] = row["margin"] / row["units"]

    median_units = median([row["units"] for row in sold]) if sold else 0
    median_margin = (
        median([row["margin_per_unit"] for row in sold]) if sold else 0
    )

    counts = {"star": 0, "plough_horse": 0, "puzzle": 0, "dog": 0}
    items = []
    for row in sold:
        high_volume = row["units"] >= median_units
        high_margin = row["margin_per_unit"] >= median_margin
        if high_volume and high_margin:
            classification = "star"
        elif high_volume and not high_margin:
            classification = "plough_horse"
        elif not high_volume and high_margin:
            classification = "puzzle"
        else:
            classification = "dog"
        counts[classification] += 1
        items.append(
            {
                "menu_item_id": row["menu_item_id"],
                "name": row["name"],
                "category": row["category"],
                "units": row["units"],
                "revenue": _round(row["revenue"]),
                "cost": _round(row["cost"]),
                "margin": _round(row["margin"]),
                "margin_per_unit": _round(row["margin_per_unit"]),
                "margin_pct": _percentage(row["margin"], row["revenue"]),
                "popularity_share": _percentage(row["units"], total_units),
                "classification": classification,
                "action": CLASSIFICATION_ACTIONS[classification],
            }
        )
    items.sort(key=lambda row: (-row["revenue"], row["name"].lower()))

    categories: dict[str, dict] = {}
    for row in sold:
        category = categories.setdefault(
            row["category"],
            {
                "category": row["category"],
                "item_count": 0,
                "units": 0,
                "revenue": 0.0,
                "margin": 0.0,
            },
        )
        category["item_count"] += 1
        category["units"] += row["units"]
        category["revenue"] += row["revenue"]
        category["margin"] += row["margin"]
    category_rows = [
        {
            "category": row["category"],
            "item_count": row["item_count"],
            "units": row["units"],
            "revenue": _round(row["revenue"]),
            "margin": _round(row["margin"]),
            "margin_pct": _percentage(row["margin"], row["revenue"]),
        }
        for row in categories.values()
    ]
    category_rows.sort(key=lambda row: -row["revenue"])

    total_margin = total_revenue - total_cost
    return {
        "items": items,
        "categories": category_rows,
        "summary": {
            "days": days,
            "store_id": store_id,
            "orders_counted": len(orders),
            "items_sold": total_units,
            "revenue": _round(total_revenue),
            "cost": _round(total_cost),
            "margin": _round(total_margin),
            "margin_pct": _percentage(total_margin, total_revenue),
            "stars": counts["star"],
            "plough_horses": counts["plough_horse"],
            "puzzles": counts["puzzle"],
            "dogs": counts["dog"],
            "median_units": _round(median_units),
            "median_margin": _round(median_margin),
            "basis": (
                "Revenue uses the order line price; cost uses the menu item's "
                "base recipe cost, so customization and add-on margin may be "
                "understated."
            ),
        },
    }
