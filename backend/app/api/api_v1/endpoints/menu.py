from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from app.api.deps import get_db
from app.models.domain import MenuItem
from pydantic import BaseModel
from typing import List, Optional

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
    return db.query(MenuItem).all()

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
            is_available=item.is_available
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
    from sqlalchemy import text
    import json
    items = db.execute(text("SELECT * FROM menu_items ORDER BY name")).fetchall()
    recipes = db.execute(text("SELECT * FROM recipes")).fetchall()
    inventory = db.execute(text("SELECT name, cost_per_unit, unit FROM inventory_items")).fetchall()
    
    inv_cost = {r.name.lower(): float(r.cost_per_unit or 0) for r in inventory}
    recipe_map = {r.menu_item_name.lower(): r for r in recipes}
    
    result = []
    for item in items:
        selling_price = float(item.selling_price or 0)
        recipe = recipe_map.get(item.name.lower())
        cost_to_make = 0
        ingredients_used = []
        
        if recipe:
            ingredients = json.loads(recipe.ingredients) if isinstance(recipe.ingredients, str) else (recipe.ingredients or [])
            for ing in ingredients:
                unit_cost = inv_cost.get(ing.get("name","").lower(), 0)
                ing_cost = unit_cost * float(ing.get("quantity", 0))
                cost_to_make += ing_cost
                ingredients_used.append({"name": ing.get("name"), "cost": round(ing_cost, 2)})
        
        margin = selling_price - cost_to_make
        margin_pct = (margin / selling_price * 100) if selling_price > 0 else 0
        
        result.append({
            "item": item.name,
            "selling_price": selling_price,
            "cost_to_make": round(cost_to_make, 2),
            "margin": round(margin, 2),
            "margin_percent": round(margin_pct, 1),
            "ingredients": ingredients_used,
            "rating": "⭐ High Margin" if margin_pct > 60 else "✅ Good" if margin_pct > 40 else "⚠️ Low Margin" if margin_pct > 20 else "❌ Review Pricing"
        })
    
    result.sort(key=lambda x: x["margin_percent"], reverse=True)
    return {"items": result, "total_items": len(result)}
