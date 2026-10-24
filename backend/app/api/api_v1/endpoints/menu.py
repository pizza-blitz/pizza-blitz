from collections import Counter
from datetime import datetime
from typing import List, Literal, Optional

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.api.deps import get_db, require_roles
from app.models.domain import (
    InventoryItem,
    MenuCustomizationGroup,
    MenuItem,
    MenuItemChannelPrice,
    Recipe,
    RestaurantOrder,
)
from app.services.media_library_service import register_asset
from app.services.media_service import delete_menu_image, save_menu_image
from app.services.menu_customization_service import (
    calculate_customized_item_price,
    customized_menu_payload,
    find_menu_item_for_order,
    groups_for_menu_item,
    seed_default_customizations,
    serialize_customization_group,
)


router = APIRouter()


CUSTOMIZATION_QUICK_BUILD_RECIPES = [
    {
        "id": "classic-regular",
        "name": "Classic Regular",
        "description": "Default regular pizza with classic crust and sauce.",
        "item_name": "Margherita Pizza (R)",
        "tags": ["fastest", "default"],
        "choices": {
            "Size": ["Regular"],
            "Crust": ["Classic Hand Tossed"],
            "Sauce": ["Classic Tomato"],
        },
    },
    {
        "id": "large-cheese-burst-combo",
        "name": "Large Cheese Burst Combo",
        "description": "Large pizza, cheese burst, two toppings, dip, drink combo.",
        "item_name": "Farmhouse Pizza (R)",
        "tags": ["upsell", "combo"],
        "choices": {
            "Size": ["Large"],
            "Crust": ["Cheese Burst"],
            "Toppings": ["Extra Cheese", "Paneer Cubes"],
            "Add-ons": ["Cheesy Dip"],
            "Combo": ["Garlic Bread + Drink"],
            "Sauce": ["Spicy Schezwan"],
        },
    },
    {
        "id": "family-party-upgrade",
        "name": "Family Party Upgrade",
        "description": "Party size pizza with family combo and dessert add-on.",
        "item_name": "Farmhouse Pizza (R)",
        "tags": ["family", "premium"],
        "choices": {
            "Size": ["Party"],
            "Crust": ["Cheese Burst"],
            "Toppings": ["Extra Cheese", "Sweet Corn"],
            "Add-ons": ["Choco Lava Dessert"],
            "Combo": ["Family Meal Upgrade"],
            "Sauce": ["Tandoori Mayo"],
        },
    },
]


def _top_option_rows(option_counter: Counter[str], limit: int = 8) -> list[dict]:
    ranked_options = option_counter.most_common()
    if not ranked_options:
        return []
    cutoff = ranked_options[min(limit - 1, len(ranked_options) - 1)][1]
    return [
        {"option": option, "quantity": quantity}
        for option, quantity in ranked_options
        if quantity >= cutoff
    ]


class ChannelPriceSchema(BaseModel):
    channel: Literal["dine-in", "takeaway", "delivery", "aggregator"]
    price: float = Field(ge=0, le=100000)
    is_available: bool = True
    is_visible: bool = True


class MenuItemSchema(BaseModel):
    id: Optional[int] = None
    name: str
    category: str
    selling_price: float
    cost_price: float
    is_available: bool = True
    image_url: Optional[str] = None
    image_alt: Optional[str] = None
    allergens: Optional[List[str]] = None
    dietary_tags: Optional[List[str]] = None
    calories: Optional[int] = Field(default=None, ge=0, le=5000)
    protein_g: Optional[float] = Field(default=None, ge=0, le=500)
    carbs_g: Optional[float] = Field(default=None, ge=0, le=500)
    fat_g: Optional[float] = Field(default=None, ge=0, le=500)
    channel_prices: Optional[List[ChannelPriceSchema]] = None

    class Config:
        from_attributes = True


class CustomizationPriceRequest(BaseModel):
    menu_item_id: Optional[int] = None
    item_name: Optional[str] = None
    selected_options: List[dict] = Field(default_factory=list)


def quick_build_selections(recipe: dict) -> list[dict]:
    return [
        {
            "group_name": group_name,
            "option_name": option_name,
        }
        for group_name, option_names in recipe["choices"].items()
        for option_name in option_names
    ]


def quick_build_operator_steps(selected_options: list[dict]) -> list[str]:
    return [
        f"{option['group_name']}: {option['option_name']}"
        + (f" +Rs {round(float(option['price_delta']))}" if float(option.get("price_delta") or 0) > 0 else "")
        for option in selected_options
    ]


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
        "top_options": _top_option_rows(option_counter),
        "recent_customized_lines": recent_customized_lines,
        "next_actions": next_actions,
    }


@router.get("/customizations/quick-builds")
def get_customization_quick_builds(db: Session = Depends(get_db)):
    seed_default_customizations(db)
    db.commit()
    builds = []
    skipped = []

    for recipe in CUSTOMIZATION_QUICK_BUILD_RECIPES:
        menu_item = find_menu_item_for_order(db, item_name=recipe["item_name"])
        if menu_item is None or not menu_item.is_available:
            skipped.append(
                {
                    "id": recipe["id"],
                    "reason": f"{recipe['item_name']} is not available.",
                }
            )
            continue

        try:
            price = calculate_customized_item_price(
                db,
                menu_item,
                quick_build_selections(recipe),
            )
        except HTTPException as exc:
            skipped.append(
                {
                    "id": recipe["id"],
                    "reason": str(exc.detail),
                }
            )
            continue

        selected_options = price["selected_options"]
        builds.append(
            {
                "id": recipe["id"],
                "name": recipe["name"],
                "description": recipe["description"],
                "tags": recipe["tags"],
                "item": {
                    "id": menu_item.id,
                    "name": menu_item.name,
                    "category": menu_item.category,
                    "base_price": price["base_price"],
                },
                "base_price": price["base_price"],
                "customization_total": price["customization_total"],
                "unit_price": price["unit_price"],
                "selected_options": selected_options,
                "option_count": len(selected_options),
                "operator_steps": quick_build_operator_steps(selected_options),
            }
        )

    return {
        "generated_at": datetime.utcnow().isoformat(),
        "summary": {
            "quick_build_count": len(builds),
            "skipped_count": len(skipped),
            "highest_unit_price": round(
                max([float(build["unit_price"]) for build in builds] or [0]),
                2,
            ),
            "average_customization_total": round(
                sum(float(build["customization_total"] or 0) for build in builds) / len(builds),
                2,
            )
            if builds
            else 0,
        },
        "builds": builds,
        "skipped": skipped,
        "next_actions": [
            "Use one-tap builds for common counter orders.",
            "Keep manual customization open for unusual customer requests.",
        ]
        if builds
        else ["Review menu availability and customization option names."],
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
    def clean_list(values: Optional[List[str]]) -> list[str]:
        cleaned: list[str] = []
        for value in values or []:
            text = str(value or "").strip()[:60]
            if text and text.lower() not in {existing.lower() for existing in cleaned}:
                cleaned.append(text)
        return cleaned

    allergens = clean_list(item.allergens)
    dietary_tags = clean_list(item.dietary_tags)
    if item.id:
        db_item = db.query(MenuItem).filter(MenuItem.id == item.id).first()
        if not db_item:
            raise HTTPException(status_code=404, detail="Item not found")
        db_item.name = item.name
        db_item.category = item.category
        db_item.selling_price = item.selling_price
        db_item.cost_price = item.cost_price
        db_item.is_available = item.is_available
        if item.image_url is not None:
            db_item.image_url = item.image_url.strip()[:500] or None
        if item.image_alt is not None:
            db_item.image_alt = item.image_alt.strip()[:255] or None
        db_item.allergens = allergens
        db_item.dietary_tags = dietary_tags
        db_item.calories = item.calories
        db_item.protein_g = item.protein_g
        db_item.carbs_g = item.carbs_g
        db_item.fat_g = item.fat_g
    else:
        db_item = MenuItem(
            name=item.name,
            category=item.category,
            selling_price=item.selling_price,
            cost_price=item.cost_price,
            is_available=item.is_available,
            image_url=(item.image_url or "").strip()[:500] or None,
            image_alt=(item.image_alt or "").strip()[:255] or None,
            allergens=allergens,
            dietary_tags=dietary_tags,
            calories=item.calories,
            protein_g=item.protein_g,
            carbs_g=item.carbs_g,
            fat_g=item.fat_g,
        )
        db.add(db_item)
        db.flush()

    if item.channel_prices is not None:
        existing_prices = {
            row.channel: row for row in (db_item.channel_prices or [])
        }
        keep: set[str] = set()
        for row in item.channel_prices:
            keep.add(row.channel)
            current = existing_prices.get(row.channel)
            if current is None:
                db_item.channel_prices.append(
                    MenuItemChannelPrice(
                        channel=row.channel,
                        price=round(float(row.price), 2),
                        is_available=row.is_available,
                        is_visible=row.is_visible,
                    )
                )
            else:
                current.price = round(float(row.price), 2)
                current.is_available = row.is_available
                current.is_visible = row.is_visible
        for channel, current in existing_prices.items():
            if channel not in keep:
                db_item.channel_prices.remove(current)

    db.commit()
    db.refresh(db_item)
    return db_item


@router.post("/menu/{item_id}/image", response_model=MenuItemSchema)
async def upload_menu_item_image(
    item_id: int,
    file: UploadFile = File(...),
    alt: Optional[str] = Form(default=None),
    db: Session = Depends(get_db),
    session: dict = Depends(require_roles("admin")),
):
    db_item = db.query(MenuItem).filter(MenuItem.id == item_id).first()
    if not db_item:
        raise HTTPException(status_code=404, detail="Item not found")

    data = await file.read()
    try:
        image_url = save_menu_image(item_id, data)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    register_asset(
        db,
        url=image_url,
        file_name=image_url.rsplit("/", 1)[-1],
        mime_type=file.content_type or "image/jpeg",
        size_bytes=len(data),
        name=db_item.name,
        uploaded_by=str(session.get("subject") or ""),
        tags=["menu"],
    )

    previous_url = db_item.image_url
    db_item.image_url = image_url
    db_item.image_alt = (alt or db_item.image_alt or db_item.name).strip()[:255] or db_item.name
    db.commit()
    db.refresh(db_item)
    delete_menu_image(previous_url)
    return db_item


@router.delete("/menu/{item_id}/image", response_model=MenuItemSchema)
def remove_menu_item_image(
    item_id: int,
    db: Session = Depends(get_db),
    session: dict = Depends(require_roles("admin")),
):
    del session
    db_item = db.query(MenuItem).filter(MenuItem.id == item_id).first()
    if not db_item:
        raise HTTPException(status_code=404, detail="Item not found")
    previous_url = db_item.image_url
    db_item.image_url = None
    db_item.image_alt = None
    db.commit()
    db.refresh(db_item)
    delete_menu_image(previous_url)
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
