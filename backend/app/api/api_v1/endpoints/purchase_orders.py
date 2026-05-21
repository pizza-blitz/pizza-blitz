from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from typing import List, Any
from app.api.deps import get_db
from app.models.domain import PurchaseOrder
from pydantic import BaseModel
from datetime import datetime

router = APIRouter()

class PurchaseOrderCreate(BaseModel):
    supplier_name: str
    supplier_whatsapp: str
    items: List[Any]
    total_amount: float
    status: str = "draft"

@router.get("/", response_model=List[Any])
def get_purchase_orders(db: Session = Depends(get_db)):
    return db.query(PurchaseOrder).all()

@router.post("/")
def create_purchase_order(obj_in: PurchaseOrderCreate, db: Session = Depends(get_db)):
    db_obj = PurchaseOrder(
        supplier_name=obj_in.supplier_name,
        supplier_whatsapp=obj_in.supplier_whatsapp,
        items=obj_in.items,
        total_amount=obj_in.total_amount,
        status=obj_in.status
    )
    db.add(db_obj)
    db.commit()
    db.refresh(db_obj)
    return db_obj

@router.get("/{order_id}")
def get_purchase_order(order_id: int, db: Session = Depends(get_db)):
    order = db.query(PurchaseOrder).filter(PurchaseOrder.id == order_id).first()
    if not order:
        raise HTTPException(status_code=404, detail="Order not found")
    return order
