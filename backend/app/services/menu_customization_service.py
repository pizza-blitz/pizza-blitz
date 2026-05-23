from typing import Any

from fastapi import HTTPException
from sqlalchemy.orm import Session

from app.models.domain import MenuCustomizationGroup, MenuCustomizationOption, MenuItem


DEFAULT_CUSTOMIZATION_GROUPS = [
    {
        "name": "Size",
        "applies_to_categories": ["Pizza"],
        "selection_type": "single",
        "min_select": 1,
        "max_select": 1,
        "sort_order": 10,
        "options": [
            {"name": "Regular", "price_delta": 0.0, "is_default": True, "sort_order": 10},
            {"name": "Medium", "price_delta": 100.0, "is_default": False, "sort_order": 20},
            {"name": "Large", "price_delta": 250.0, "is_default": False, "sort_order": 30},
            {"name": "Party", "price_delta": 420.0, "is_default": False, "sort_order": 40},
        ],
    },
    {
        "name": "Crust",
        "applies_to_categories": ["Pizza"],
        "selection_type": "single",
        "min_select": 1,
        "max_select": 1,
        "sort_order": 20,
        "options": [
            {"name": "Classic Hand Tossed", "price_delta": 0.0, "is_default": True, "sort_order": 10},
            {"name": "Thin Crust", "price_delta": 20.0, "is_default": False, "sort_order": 20},
            {"name": "Cheese Burst", "price_delta": 59.0, "is_default": False, "sort_order": 30},
            {"name": "Wheat Thin Crust", "price_delta": 35.0, "is_default": False, "sort_order": 40},
        ],
    },
    {
        "name": "Toppings",
        "applies_to_categories": ["Pizza", "Burgers", "Sandwiches"],
        "selection_type": "multiple",
        "min_select": 0,
        "max_select": 5,
        "sort_order": 30,
        "options": [
            {"name": "Extra Cheese", "price_delta": 39.0, "is_default": False, "sort_order": 10},
            {"name": "Jalapeno", "price_delta": 29.0, "is_default": False, "sort_order": 20},
            {"name": "Olives", "price_delta": 29.0, "is_default": False, "sort_order": 30},
            {"name": "Mushroom", "price_delta": 35.0, "is_default": False, "sort_order": 40},
            {"name": "Paneer Cubes", "price_delta": 49.0, "is_default": False, "sort_order": 50},
            {"name": "Sweet Corn", "price_delta": 25.0, "is_default": False, "sort_order": 60},
            {"name": "Peri Peri Chicken", "price_delta": 69.0, "is_default": False, "sort_order": 70},
        ],
    },
    {
        "name": "Add-ons",
        "applies_to_categories": ["Pizza", "Sides", "Burgers", "Sandwiches"],
        "selection_type": "multiple",
        "min_select": 0,
        "max_select": 3,
        "sort_order": 40,
        "options": [
            {"name": "Cheesy Dip", "price_delta": 25.0, "is_default": False, "sort_order": 10},
            {"name": "Garlic Dip", "price_delta": 20.0, "is_default": False, "sort_order": 20},
            {"name": "Extra Sauce Sachet", "price_delta": 10.0, "is_default": False, "sort_order": 30},
            {"name": "Peri Peri Seasoning", "price_delta": 15.0, "is_default": False, "sort_order": 40},
            {"name": "Choco Lava Dessert", "price_delta": 89.0, "is_default": False, "sort_order": 50},
        ],
    },
    {
        "name": "Combo",
        "applies_to_categories": ["Pizza", "Burgers", "Sandwiches"],
        "selection_type": "single",
        "min_select": 0,
        "max_select": 1,
        "sort_order": 50,
        "options": [
            {"name": "No Combo", "price_delta": 0.0, "is_default": True, "sort_order": 10},
            {"name": "Fries + Drink", "price_delta": 99.0, "is_default": False, "sort_order": 20},
            {"name": "Garlic Bread + Drink", "price_delta": 129.0, "is_default": False, "sort_order": 30},
            {"name": "Family Meal Upgrade", "price_delta": 249.0, "is_default": False, "sort_order": 40},
        ],
    },
    {
        "name": "Sauce",
        "applies_to_categories": ["Pizza", "Burgers", "Sandwiches"],
        "selection_type": "single",
        "min_select": 0,
        "max_select": 1,
        "sort_order": 60,
        "options": [
            {"name": "Classic Tomato", "price_delta": 0.0, "is_default": True, "sort_order": 10},
            {"name": "Spicy Schezwan", "price_delta": 20.0, "is_default": False, "sort_order": 20},
            {"name": "Pesto Drizzle", "price_delta": 35.0, "is_default": False, "sort_order": 30},
            {"name": "Tandoori Mayo", "price_delta": 25.0, "is_default": False, "sort_order": 40},
        ],
    },
    {
        "name": "Beverage",
        "applies_to_categories": ["Beverages"],
        "selection_type": "single",
        "min_select": 0,
        "max_select": 1,
        "sort_order": 70,
        "options": [
            {"name": "Regular Cup", "price_delta": 0.0, "is_default": True, "sort_order": 10},
            {"name": "Large Cup", "price_delta": 25.0, "is_default": False, "sort_order": 20},
            {"name": "No Ice", "price_delta": 0.0, "is_default": False, "sort_order": 30},
        ],
    },
]


def seed_default_customizations(db: Session) -> None:
    existing_groups = {group.name: group for group in db.query(MenuCustomizationGroup).all()}
    for group_seed in DEFAULT_CUSTOMIZATION_GROUPS:
        group = existing_groups.get(group_seed["name"])
        if group is None:
            group = MenuCustomizationGroup(
                name=group_seed["name"],
                applies_to_categories=group_seed["applies_to_categories"],
                selection_type=group_seed["selection_type"],
                min_select=group_seed["min_select"],
                max_select=group_seed["max_select"],
                sort_order=group_seed["sort_order"],
                is_active=True,
            )
            db.add(group)
            db.flush()
        else:
            group.applies_to_categories = group_seed["applies_to_categories"]
            group.selection_type = group_seed["selection_type"]
            group.min_select = group_seed["min_select"]
            group.max_select = group_seed["max_select"]
            group.sort_order = group_seed["sort_order"]
            group.is_active = True
        existing_options = {option.name: option for option in group.options}
        for option_seed in group_seed["options"]:
            option = existing_options.get(option_seed["name"])
            if option is None:
                db.add(MenuCustomizationOption(group_id=group.id, **option_seed, is_active=True))
            else:
                option.price_delta = option_seed["price_delta"]
                option.is_default = option_seed["is_default"]
                option.sort_order = option_seed["sort_order"]
                option.is_active = True


def serialize_customization_group(group: MenuCustomizationGroup) -> dict:
    return {
        "id": group.id,
        "name": group.name,
        "applies_to_categories": group.applies_to_categories or [],
        "selection_type": group.selection_type,
        "min_select": group.min_select,
        "max_select": group.max_select,
        "sort_order": group.sort_order,
        "is_active": group.is_active,
        "options": [
            {
                "id": option.id,
                "name": option.name,
                "price_delta": round(float(option.price_delta or 0), 2),
                "is_default": option.is_default,
                "sort_order": option.sort_order,
                "is_active": option.is_active,
            }
            for option in sorted(
                [option for option in group.options if option.is_active],
                key=lambda row: (row.sort_order or 0, row.id or 0),
            )
        ],
    }


def groups_for_menu_item(groups: list[MenuCustomizationGroup], item: MenuItem) -> list[dict]:
    item_category = (item.category or "").strip().lower()
    matched_groups = []
    for group in groups:
        categories = [
            str(category).strip().lower()
            for category in (group.applies_to_categories or [])
        ]
        if "*" in categories or item_category in categories:
            matched_groups.append(serialize_customization_group(group))
    return matched_groups


def _active_groups_for_menu_item(
    groups: list[MenuCustomizationGroup], item: MenuItem
) -> list[MenuCustomizationGroup]:
    item_category = (item.category or "").strip().lower()
    matched_groups = []
    for group in groups:
        if not group.is_active:
            continue
        categories = [
            str(category).strip().lower()
            for category in (group.applies_to_categories or [])
        ]
        if "*" in categories or item_category in categories:
            matched_groups.append(group)
    return matched_groups


def _value_matches(raw_value: Any, candidate: Any) -> bool:
    if raw_value in (None, ""):
        return False
    try:
        return int(raw_value) == int(candidate)
    except (TypeError, ValueError):
        return str(raw_value).strip().lower() == str(candidate).strip().lower()


def _find_group(
    groups: list[MenuCustomizationGroup], selected_option: dict
) -> MenuCustomizationGroup | None:
    group_id = selected_option.get("group_id")
    group_name = str(selected_option.get("group_name") or "").strip().lower()
    for group in groups:
        if _value_matches(group_id, group.id):
            return group
        if group_name and group.name.strip().lower() == group_name:
            return group
    return None


def _find_option(
    group: MenuCustomizationGroup, selected_option: dict
) -> MenuCustomizationOption | None:
    option_id = selected_option.get("option_id")
    option_name = str(selected_option.get("option_name") or "").strip().lower()
    for option in group.options:
        if not option.is_active:
            continue
        if _value_matches(option_id, option.id):
            return option
        if option_name and option.name.strip().lower() == option_name:
            return option
    return None


def _default_options_for_group(group: MenuCustomizationGroup) -> list[MenuCustomizationOption]:
    active_options = [
        option
        for option in sorted(group.options, key=lambda row: (row.sort_order or 0, row.id or 0))
        if option.is_active
    ]
    defaults = [option for option in active_options if option.is_default]
    if defaults:
        return defaults
    return active_options[:1] if active_options and int(group.min_select or 0) > 0 else []


def _serialize_selected_option(
    group: MenuCustomizationGroup, option: MenuCustomizationOption
) -> dict:
    return {
        "group_id": group.id,
        "group_name": group.name,
        "option_id": option.id,
        "option_name": option.name,
        "price_delta": round(float(option.price_delta or 0), 2),
    }


def find_menu_item_for_order(
    db: Session, item_name: str, menu_item_id: int | None = None
) -> MenuItem | None:
    if menu_item_id:
        item = db.query(MenuItem).filter(MenuItem.id == menu_item_id).first()
        if item:
            return item
    normalized_name = item_name.strip().lower()
    if not normalized_name:
        return None
    return (
        db.query(MenuItem)
        .filter(MenuItem.name.ilike(normalized_name))
        .first()
    )


def calculate_customized_item_price(
    db: Session,
    menu_item: MenuItem,
    selected_options: list[dict] | None = None,
) -> dict:
    seed_default_customizations(db)
    db.flush()
    groups = (
        db.query(MenuCustomizationGroup)
        .filter(MenuCustomizationGroup.is_active == True)  # noqa: E712
        .order_by(MenuCustomizationGroup.sort_order.asc(), MenuCustomizationGroup.id.asc())
        .all()
    )
    applicable_groups = _active_groups_for_menu_item(groups, menu_item)
    selected_by_group: dict[int, list[MenuCustomizationOption]] = {
        group.id: [] for group in applicable_groups
    }
    errors: list[str] = []

    for raw_selection in selected_options or []:
        if not isinstance(raw_selection, dict):
            errors.append("Selected options must be objects.")
            continue
        group = _find_group(applicable_groups, raw_selection)
        if group is None:
            label = raw_selection.get("group_name") or raw_selection.get("group_id") or "unknown"
            errors.append(f"Customization group {label} is not available for {menu_item.name}.")
            continue
        option = _find_option(group, raw_selection)
        if option is None:
            label = raw_selection.get("option_name") or raw_selection.get("option_id") or "unknown"
            errors.append(f"Option {label} is not available in {group.name}.")
            continue
        if option.id not in [row.id for row in selected_by_group[group.id]]:
            selected_by_group[group.id].append(option)

    final_selected_options: list[dict] = []
    for group in applicable_groups:
        options = selected_by_group.get(group.id, [])
        if not options:
            options = _default_options_for_group(group)
        max_select = max(int(group.max_select or 0), 0)
        min_select = max(int(group.min_select or 0), 0)

        if group.selection_type == "single" and len(options) > 1:
            errors.append(f"{group.name} allows only one option.")
        if max_select and len(options) > max_select:
            errors.append(f"{group.name} allows up to {max_select} option(s).")
        if len(options) < min_select:
            errors.append(f"{group.name} requires at least {min_select} option(s).")

        for option in options[: max_select or len(options)]:
            if group.name == "Combo" and option.name == "No Combo":
                continue
            final_selected_options.append(_serialize_selected_option(group, option))

    if errors:
        raise HTTPException(status_code=422, detail=" ".join(errors))

    base_price = round(float(menu_item.selling_price or 0), 2)
    customization_total = round(
        sum(float(option["price_delta"] or 0) for option in final_selected_options),
        2,
    )
    unit_price = round(base_price + customization_total, 2)
    return {
        "menu_item_id": menu_item.id,
        "name": menu_item.name,
        "category": menu_item.category,
        "base_price": base_price,
        "customization_total": customization_total,
        "unit_price": unit_price,
        "selected_options": final_selected_options,
        "customization_groups": groups_for_menu_item(applicable_groups, menu_item),
    }


def customized_menu_payload(db: Session) -> list[dict]:
    seed_default_customizations(db)
    db.commit()
    groups = (
        db.query(MenuCustomizationGroup)
        .filter(MenuCustomizationGroup.is_active == True)  # noqa: E712
        .order_by(MenuCustomizationGroup.sort_order.asc(), MenuCustomizationGroup.id.asc())
        .all()
    )
    items = db.query(MenuItem).order_by(MenuItem.name.asc()).all()
    return [
        {
            "id": item.id,
            "name": item.name,
            "category": item.category,
            "selling_price": item.selling_price,
            "cost_price": item.cost_price,
            "is_available": item.is_available,
            "customization_groups": groups_for_menu_item(groups, item),
        }
        for item in items
    ]
