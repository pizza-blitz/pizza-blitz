from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from app.api.deps import get_db
from app.models.domain import Expense, ExpenseCategory
from pydantic import BaseModel
from datetime import datetime
from typing import List, Optional

router = APIRouter()

class ExpenseSchema(BaseModel):
    id: Optional[int] = None
    date: datetime
    category_id: int
    amount: float
    description: Optional[str] = None
    receipt_photo_url: Optional[str] = None

    class Config:
        from_attributes = True

class CategorySchema(BaseModel):
    id: int
    name: str
    is_active: bool

    class Config:
        from_attributes = True

@router.get("/expenses", response_model=List[ExpenseSchema])
def get_expenses(db: Session = Depends(get_db)):
    return db.query(Expense).order_by(Expense.date.desc()).all()

@router.get("/categories", response_model=List[CategorySchema])
def get_categories(db: Session = Depends(get_db)):
    return db.query(ExpenseCategory).filter(ExpenseCategory.is_active == True).all()

@router.post("/expenses", response_model=ExpenseSchema)
def add_expense(req: ExpenseSchema, db: Session = Depends(get_db)):
    db_expense = Expense(
        date=req.date,
        category_id=req.category_id,
        amount=req.amount,
        description=req.description,
        receipt_photo_url=req.receipt_photo_url
    )
    db.add(db_expense)
    db.commit()
    db.refresh(db_expense)
    return db_expense
