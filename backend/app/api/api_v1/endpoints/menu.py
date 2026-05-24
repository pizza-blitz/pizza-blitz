from collections import Counter
from datetime import datetime
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.api.deps import get_db, require_roles
from app.models.domain import InventoryItem, MenuCustomizationGroup, MenuItem, Recipe, RestaurantOrder
from app.services.menu_customization_service import (
    calculate_customized_item_price,
    customized_menu_payload,
    find_menu_item_for_order,
    groups_for_menu_item,
    seed_default_customizations,
    serialize_customization_group,
)


router = APIRouter()


class MenuItemSchema(BaseModel):
    id: Optional[int] = None
    name: str
    category: str
    selling_price: float
    cost_price: float
    is_available: bool = True

    class Config:
        from_attributes = True


class CustomizationPriceRequest(BaseModel):
    menu_item_id: Optional[int] = None
    item_name: Optional[str] = None
    selected_options: List[dict] = Field(default_factory=list)


@router.get("/menu", response_model=List[MenuItemSchema])
def get_menu(db: Session = Depends(get_db)):
    return db.query(MenuItem).order_by(MenuItem.name.asc()).all()


@router.get("/customizations")
def get_menu_customizations(db: Session = Depends(get_db)):
    seed_default_customizations(db)
    db.commit()
    groups = (
        db.query(MenuCustomizationGroup)
        .filter(MenuCustomizationGroup.is_active == True)  # noqa: E712
        .order_by(MenuCustomizationGroup.sort_order.asc(), MenuCustomizationGroup.id.asc())
        .all()
    )
    return [serialize_customization_group(group) for group in groups]


@router.get("/menu-with-customizations")
def get_menu_with_customizations(db: Session = Depends(get_db)):
    return customized_menu_payload(db)


@router.get("/customizations/readiness")
def get_customization_readiness(db: Session = Depends(get_db)):
    seed_default_customizations(db)
    db.commit()
    groups = (
        db.query(MenuCustomizationGroup)
        .filter(MenuCustomizationGroup.is_active == True)  # noqa: E712
        .order_by(MenuCustomizationGroup.sort_order.asc(), MenuCustomizationGroup.id.asc())
        .all()
    )
    items = db.query(MenuItem).order_by(MenuItem.category.asc(), MenuItem.name.asc()).all()
    active_items = [item for item in items if item.is_available]
    item_groups = {item.id: groups_for_menu_item(groups, item) for item in active_items}
    customizable_items = [
        item for item in active_items if item_groups.get(item.id)
    ]

    category_names = sorted({item.category for item in active_items if item.category})
    category_coverage = []
    for category in category_names:
        category_items = [item for item in active_items if item.category == category]
        customizable_count = sum(1 for item in category_items if item_groups.get(item.id))
        category_coverage.append(
            {
                "category": category,
                "item_count": len(category_items),
                "customizable_count": customizable_count,
                "fixed_count": len(category_items) - customizable_count,
                "coverage_percent": round(
                    (customizable_count / len(category_items)) * 100
                )
                if category_items
                else 0,
            }
        )

    group_rows = []
    required_groups_without_defaults = 0
    all_option_deltas: list[float] = []
    for group in groups:
        active_options = [option for option in group.options if option.is_active]
        deltas = [float(option.price_delta or 0) for option in active_options]
        all_option_deltas.extend(deltas)
        default_count = sum(1 for option in active_options if option.is_default)
        needs_default = int(group.min_select or 0) > 0
        if needs_default and default_count == 0:
            required_groups_without_defaults += 1
        group_rows.append(
            {
                "id": group.id,
                "name": group.name,
                "categories": group.applies_to_categories or [],
                "selection_type": group.selection_type,
                "min_select": group.min_select,
                "max_select": group.max_select,
                "option_count": len(active_options),
                "default_count": default_count,
                "price_min": round(min(deltas), 2) if deltas else 0,
                "price_max": round(max(deltas), 2) if deltas else 0,
                "status": "ready"
                if active_options and (not needs_default or default_count > 0)
                else "review",
            }
        )

    option_counter: Counter[str] = Counter()
    recent_customized_lines = []
    recent_orders = (
        db.query(RestaurantOrder)
        .order_by(RestaurantOrder.created_at.desc(), RestaurantOrder.id.desc())
        .limit(50)
        .all()
    )
    for order in recent_orders:
        for item in order.items or []:
            selected_options = item.get("selected_options") or []
            if not selected_options:
                continue
            quantity = int(item.get("quantity") or 1)
            for option in selected_options:
                label = f"{option.get('group_name') or 'Option'}: {option.get('option_name')}"
                option_counter[label] += quantity
            if len(recent_customized_lines) < 8:
                recent_customized_lines.append(
                    {
                        "order_id": order.id,
                        "item": item.get("name") or "Item",
                        "quantity": quantity,
                        "unit_price": round(float(item.get("price") or 0), 2),
                        "customization_total": round(float(item.get("customization_total") or 0), 2),
                        "selected_options": selected_options,
                    }
                )

    next_actions = []
    if required_groups_without_defaults:
        next_actions.append(
            f"Add defaults to {required_groups_without_defaults} required customization group(s)."
        )
    if not any(group.name == "Combo" for group in groups):
        next_actions.append("Add combo upgrade options before launching bundle offers.")
    if active_items and not customizable_items:
        next_actions.append("Attach customization groups to at least the pizza category.")
    if not recent_customized_lines:
        next_actions.append("Run one customer customized order proof before beta demos.")
    if not next_actions:
        next_actions.append("Keep checking receipts and kitchen lines after every new option-set change.")

    return {
        "generated_at": datetime.utcnow().isoformat(),
        "summary": {
            "active_group_count": len(groups),
            "active_option_count": sum(row["option_count"] for row in group_rows),
            "customizable_item_count": len(customizable_items),
            "fixed_item_count": len(active_items) - len(customizable_items),
            "covered_category_count": sum(
                1 for row in category_coverage if row["customizable_count"] > 0
            ),
            "required_groups_without_defaults": required_groups_without_defaults,
            "max_upgrade_delta": round(max(all_option_deltas), 2) if all_option_deltas else 0,
            "average_option_delta": round(sum(all_option_deltas) / len(all_option_deltas), 2)
            if all_option_deltas
            else 0,
            "recent_customized_line_count": len(recent_customized_lines),
        },
        "groups": group_rows,
        "category_coverage": category_coverage,
        "top_options": [
            {"option": option, "quantity": quantity}
            for option, quantity in option_counter.most_common(8)
        ],
        "recent_customized_lines": recent_customized_lines,
        "next_actions": next_actions,
    }


@router.post("/customizations/price")
def price_menu_customization(
    payload: CustomizationPriceRequest,
    db: Session = Depends(get_db),
):
    menu_item = find_menu_item_for_order(
        db,
        item_name=payload.item_name or "",
        menu_item_id=payload.menu_item_id,
    )
    if not menu_item:
        raise HTTPException(status_code=404, detail="Menu item not found")
    return calculate_customized_item_price(db, menu_item, payload.selected_options)


@router.post("/menu", response_model=MenuItemSchema)
def update_or_create_menu(
    item: MenuItemSchema,
    db: Session = Depends(get_db),
    session: dict = Depends(require_roles("admin")),
):
    if item.id:
        db_item = db.query(MenuItem).filter(MenuItem.id == item.id).first()
        if not db_item:
            raise HTTPException(status_code=404, detail="Item not found")
        db_item.name = item.name
        db_item.category = item.category
        db_item.selling_price = item.selling_price
        db_item.cost_price = item.cost_price
        db_item.is_available = item.is_available
    else:
        db_item = MenuItem(
            name=item.name,
            category=item.category,
            selling_price=item.selling_price,
            cost_price=item.cost_price,
            is_available=item.is_available,
        )
        db.add(db_item)

    db.commit()
    db.refresh(db_item)
    return db_item


@router.delete("/menu/{item_id}")
def delete_menu_item(
    item_id: int,
    db: Session = Depends(get_db),
    session: dict = Depends(require_roles("admin")),
):
    db_item = db.query(MenuItem).filter(MenuItem.id == item_id).first()
    if not db_item:
        raise HTTPException(status_code=404, detail="Item not found")
    db.delete(db_item)
    db.commit()
    return {"status": "success"}


@router.get("/profitability")
def get_menu_profitability(db: Session = Depends(get_db)):
    items = db.query(MenuItem).order_by(MenuItem.name.asc()).all()
    recipes = db.query(Recipe).all()
    inventory = db.query(InventoryItem).all()

    inv_cost = {row.name.lower(): float(row.cost_per_unit or 0) for row in inventory}
    recipe_map = {row.menu_item.lower(): row for row in recipes}

    result = []
    for item in items:
        selling_price = float(item.selling_price or 0)
        recipe = recipe_map.get(item.name.lower())
        recipe_cost = 0.0
        ingredients_used = []

        if recipe:
            for ingredient in recipe.ingredients or []:
                ingredient_name = ingredient.get("name", "").strip()
                unit_cost = inv_cost.get(ingredient_name.lower(), 0)
                ingredient_quantity = float(ingredient.get("quantity") or 0)
                ingredient_cost = unit_cost * ingredient_quantity
                recipe_cost += ingredient_cost
                ingredients_used.append(
                    {
                        "name": ingredient_name,
                        "quantity": ingredient_quantity,
                        "unit": ingredient.get("unit"),
                        "unit_cost": round(unit_cost, 2),
                        "cost": round(ingredient_cost, 2),
                    }
                )

        cost_to_make = recipe_cost if recipe and recipe_cost > 0 else float(item.cost_price or 0)
        margin = selling_price - cost_to_make
        margin_pct = (margin / selling_price * 100) if selling_price > 0 else 0

        if margin_pct > 60:
            rating = "High Margin"
        elif margin_pct > 40:
            rating = "Good"
        elif margin_pct > 20:
            rating = "Low Margin"
        else:
            rating = "Review Pricing"

        result.append(
            {
                "id": item.id,
                "item": item.name,
                "category": item.category,
                "selling_price": selling_price,
                "cost_to_make": round(cost_to_make, 2),
                "margin": round(margin, 2),
                "margin_percent": round(margin_pct, 1),
                "cost_source": "recipe" if recipe and recipe_cost > 0 else "menu_cost",
                "ingredients": ingredients_used,
                "rating": rating,
            }
        )

    result.sort(key=lambda row: row["margin_percent"], reverse=True)
    return {"items": result, "total_items": len(result)}
