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
        option_names = {option.name for option in group.options}
        for option_seed in group_seed["options"]:
            if option_seed["name"] not in option_names:
                db.add(MenuCustomizationOption(group_id=group.id, **option_seed, is_active=True))


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
