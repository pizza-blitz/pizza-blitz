from typing import List

from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.api.deps import get_db
from app.models.domain import Recipe


router = APIRouter()


class Ingredient(BaseModel):
    name: str
    quantity: float
    unit: str


class RecipeCreate(BaseModel):
    menu_item: str
    ingredients: List[Ingredient]


def serialize_recipe(recipe: Recipe) -> dict:
    return {
        "id": str(recipe.id),
        "menu_item": recipe.menu_item,
        "ingredients": recipe.ingredients or [],
    }


@router.get("/")
def list_recipes(db: Session = Depends(get_db)):
    rows = db.query(Recipe).order_by(Recipe.menu_item.asc()).all()
    return [serialize_recipe(row) for row in rows]


@router.post("/")
def upsert_recipe(payload: RecipeCreate, db: Session = Depends(get_db)):
    ingredients = [ingredient.dict() for ingredient in payload.ingredients]
    row = db.query(Recipe).filter(Recipe.menu_item == payload.menu_item).first()
    if row:
        row.ingredients = ingredients
    else:
        row = Recipe(menu_item=payload.menu_item, ingredients=ingredients)
        db.add(row)

    db.commit()
    db.refresh(row)
    return serialize_recipe(row)


@router.get("/next-day-prediction")
def next_day_prediction(db: Session = Depends(get_db)):
    rows = db.query(Recipe).order_by(Recipe.menu_item.asc()).all()
    totals = {}

    for recipe in rows:
        for ingredient in recipe.ingredients or []:
            name = ingredient.get("name", "").strip()
            if not name:
                continue
            unit = ingredient.get("unit", "unit")
            key = (name.lower(), unit)
            if key not in totals:
                totals[key] = {
                    "ingredient_name": name,
                    "total_required": 0.0,
                    "unit": unit,
                    "confidence": 0.55,
                }
            totals[key]["total_required"] += float(ingredient.get("quantity") or 0) * 10

    predictions = sorted(
        totals.values(),
        key=lambda item: item["total_required"],
        reverse=True,
    )
    return {"predictions": predictions[:20]}
