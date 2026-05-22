from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.api.deps import get_db
from app.models.domain import InventoryItem, MenuItem, Recipe


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


@router.get("/menu", response_model=List[MenuItemSchema])
def get_menu(db: Session = Depends(get_db)):
    return db.query(MenuItem).order_by(MenuItem.name.asc()).all()


@router.post("/menu", response_model=MenuItemSchema)
def update_or_create_menu(item: MenuItemSchema, db: Session = Depends(get_db)):
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
def delete_menu_item(item_id: int, db: Session = Depends(get_db)):
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
