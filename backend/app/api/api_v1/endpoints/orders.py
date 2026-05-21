from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session
from sqlalchemy import text
from app.api.deps import get_db
from pydantic import BaseModel
from typing import Optional, List
import json
from datetime import date

router = APIRouter()

class OrderItem(BaseModel):
    name: str
    quantity: int
    price: float

class OrderCreate(BaseModel):
    order_type: str = "dine-in"
    table_number: Optional[str] = None
    items: List[OrderItem] = []
    payment_method: Optional[str] = None
    notes: Optional[str] = None

@router.get("/tables")
def get_tables(db: Session = Depends(get_db)):
    result = db.execute(text("SELECT * FROM tables ORDER BY table_number")).fetchall()
    return [dict(r._mapping) for r in result]

@router.post("/")
def create_order(order: OrderCreate, db: Session = Depends(get_db)):
    subtotal = sum(i.price * i.quantity for i in order.items)
    tax = round(subtotal * 0.05, 2)
    total = round(subtotal + tax, 2)
    items_json = json.dumps([i.dict() for i in order.items])
    result = db.execute(text("""
        INSERT INTO orders (order_type, table_number, items, subtotal, tax_amount, total_amount, payment_method, notes)
        VALUES (:type, :table, :items::jsonb, :sub, :tax, :total, :payment, :notes)
        RETURNING id
    """), {"type": order.order_type, "table": order.table_number,
           "items": items_json, "sub": subtotal, "tax": tax,
           "total": total, "payment": order.payment_method, "notes": order.notes}).fetchone()
    if order.table_number:
        db.execute(text("""
            UPDATE tables SET status='occupied', current_order_id=:oid, last_updated=NOW()
            WHERE table_number=:t
        """), {"oid": result.id, "t": order.table_number})
    db.commit()
    return {"order_id": result.id, "total": total, "tax": tax}

@router.patch("/{order_id}/close")
def close_order(order_id: int, db: Session = Depends(get_db)):
    order = db.execute(text("SELECT * FROM orders WHERE id=:id"), {"id": order_id}).fetchone()
    if not order:
        return {"error": "Order not found"}
    db.execute(text("UPDATE orders SET status='closed', closed_at=NOW() WHERE id=:id"), {"id": order_id})
    if order.table_number:
        db.execute(text("""
            UPDATE tables SET status='available', current_order_id=NULL, last_updated=NOW()
            WHERE table_number=:t
        """), {"t": order.table_number})
    # Sync with daily_sales
    db.execute(text("""
        INSERT INTO daily_sales (date, total_sale, total_expense, profit, cash_collected)
        VALUES (CURRENT_DATE, :amount, 0, :amount, :amount)
        ON CONFLICT (date) DO UPDATE
        SET total_sale = daily_sales.total_sale + :amount,
            profit = daily_sales.profit + :amount,
            cash_collected = daily_sales.cash_collected + :amount
    """), {"amount": order.total_amount})
    db.commit()
    return {"status": "closed", "total_collected": order.total_amount}

@router.post("/{order_id}/invoice")
def generate_invoice(order_id: int, customer_name: str = "Walk-in Customer",
                     customer_gstin: Optional[str] = None, db: Session = Depends(get_db)):
    order = db.execute(text("SELECT * FROM orders WHERE id=:id"), {"id": order_id}).fetchone()
    if not order:
        return {"error": "Order not found"}
    count = db.execute(text("SELECT COUNT(*) as c FROM invoices")).fetchone()
    invoice_number = f"PB-{date.today().strftime('%Y%m')}-{str(count.c + 1).zfill(4)}"
    cgst = round(order.subtotal * 0.025, 2)
    sgst = round(order.subtotal * 0.025, 2)
    db.execute(text("""
        INSERT INTO invoices (invoice_number, date, order_id, customer_name, customer_gstin,
            items, subtotal, cgst, sgst, total, payment_method)
        VALUES (:inv, CURRENT_DATE, :oid, :cname, :gstin, :items, :sub, :cgst, :sgst, :total, :payment)
        ON CONFLICT (invoice_number) DO NOTHING
    """), {"inv": invoice_number, "oid": order_id, "cname": customer_name,
           "gstin": customer_gstin, "items": str(order.items), "sub": order.subtotal,
           "cgst": cgst, "sgst": sgst, "total": order.total_amount, "payment": order.payment_method})
    db.commit()
    return {"invoice_number": invoice_number, "customer": customer_name,
            "subtotal": order.subtotal, "cgst_2_5_pct": cgst, "sgst_2_5_pct": sgst,
            "total": order.total_amount}

@router.get("/invoices")
def list_invoices(db: Session = Depends(get_db)):
    result = db.execute(text("SELECT * FROM invoices ORDER BY created_at DESC LIMIT 50")).fetchall()
    return [dict(r._mapping) for r in result]

@router.get("/today")
def todays_orders(db: Session = Depends(get_db)):
    result = db.execute(text("""
        SELECT id, order_type, table_number, total_amount, status, payment_method, created_at
        FROM orders WHERE date = CURRENT_DATE ORDER BY created_at DESC
    """)).fetchall()
    total = db.execute(text(
        "SELECT COALESCE(SUM(total_amount),0) as t FROM orders WHERE date=CURRENT_DATE AND status='closed'"
    )).fetchone()
    return {"orders": [dict(r._mapping) for r in result],
            "total_collected_today": float(total.t)}
