from datetime import date, datetime
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.api.deps import get_db
from app.models.domain import (
    Customer,
    DailySales,
    DiningTable,
    InventoryItem,
    InventoryTransaction,
    Invoice,
    Promotion,
    Recipe,
    RestaurantOrder,
)
from app.services.payment_gateway import create_payment_session


router = APIRouter()


DEFAULT_TABLES = [
    ("T1", 4),
    ("T2", 4),
    ("T3", 6),
    ("T4", 2),
    ("T5", 4),
    ("T6", 8),
    ("T7", 2),
    ("T8", 4),
]

ORDER_USAGE_NOTE_PREFIX = "Auto usage from order"


class OrderItem(BaseModel):
    name: str
    quantity: int
    price: float


class OrderCreate(BaseModel):
    order_type: str = "dine-in"
    table_number: Optional[str] = None
    customer_name: Optional[str] = None
    customer_phone: Optional[str] = None
    items: List[OrderItem] = Field(default_factory=list)
    discount_amount: float = 0.0
    coupon_code: Optional[str] = None
    payment_method: Optional[str] = None
    notes: Optional[str] = None


class PaymentConfirmation(BaseModel):
    payment_provider: str = "manual"
    payment_reference: Optional[str] = None
    paid_amount: Optional[float] = None


class PaymentSessionRequest(BaseModel):
    provider: Optional[str] = None
    return_url: Optional[str] = None


class OrderStatusUpdate(BaseModel):
    status: str


def ensure_default_tables(db: Session) -> None:
    existing = {row.table_number for row in db.query(DiningTable).all()}
    for table_number, capacity in DEFAULT_TABLES:
        if table_number not in existing:
            db.add(DiningTable(table_number=table_number, capacity=capacity))
    db.commit()


def serialize_table(table: DiningTable) -> dict:
    return {
        "id": table.id,
        "table_number": table.table_number,
        "capacity": table.capacity,
        "status": table.status,
        "current_order_id": table.current_order_id,
        "last_updated": table.last_updated.isoformat() if table.last_updated else None,
    }


def serialize_invoice(invoice: Invoice) -> dict:
    return {
        "id": invoice.id,
        "invoice_number": invoice.invoice_number,
        "date": invoice.date.isoformat() if invoice.date else None,
        "order_id": invoice.order_id,
        "customer_name": invoice.customer_name,
        "customer_gstin": invoice.customer_gstin,
        "items": invoice.items or [],
        "subtotal": invoice.subtotal,
        "cgst": invoice.cgst,
        "sgst": invoice.sgst,
        "total": invoice.total,
        "payment_method": invoice.payment_method,
        "created_at": invoice.created_at.isoformat() if invoice.created_at else None,
    }


def serialize_order(order: RestaurantOrder) -> dict:
    return {
        "id": order.id,
        "date": order.date.isoformat() if order.date else None,
        "order_type": order.order_type,
        "table_number": order.table_number,
        "customer_name": order.customer_name,
        "customer_phone": order.customer_phone,
        "items": order.items or [],
        "subtotal": order.subtotal,
        "discount_amount": order.discount_amount,
        "tax_amount": order.tax_amount,
        "total_amount": order.total_amount,
        "payment_status": order.payment_status,
        "payment_method": order.payment_method,
        "payment_provider": order.payment_provider,
        "payment_session_id": order.payment_session_id,
        "payment_session_url": order.payment_session_url,
        "payment_session_created_at": (
            order.payment_session_created_at.isoformat()
            if order.payment_session_created_at
            else None
        ),
        "payment_reference": order.payment_reference,
        "payment_confirmed_at": (
            order.payment_confirmed_at.isoformat()
            if order.payment_confirmed_at
            else None
        ),
        "status": order.status,
        "notes": order.notes,
        "created_at": order.created_at.isoformat() if order.created_at else None,
        "closed_at": order.closed_at.isoformat() if order.closed_at else None,
    }


def order_eta_window(order: RestaurantOrder) -> str:
    if order.status == "closed":
        return "Completed"
    if order.status == "ready":
        return "Ready now"
    if order.status == "preparing":
        return "10-15 min"
    if (order.order_type or "").lower() == "delivery":
        return "35-45 min"
    return "20-25 min"


def order_tracking_steps(order: RestaurantOrder) -> list[dict]:
    status = (order.status or "open").lower()
    payment_status = (order.payment_status or "pending").lower()
    payment_ready = payment_status == "paid" or (order.payment_method or "").lower() != "prepaid"
    steps = [
        ("placed", True, "Order placed"),
        ("payment", payment_ready, "Payment checked"),
        ("preparing", status in {"preparing", "ready", "closed"}, "Preparing"),
        ("ready", status in {"ready", "closed"}, "Ready"),
        ("completed", status == "closed", "Completed"),
    ]
    return [
        {"key": key, "label": label, "complete": complete}
        for key, complete, label in steps
    ]


def serialize_order_tracking(order: RestaurantOrder) -> dict:
    payload = serialize_order(order)
    payload.update(
        {
            "eta_window": order_eta_window(order),
            "tracking_steps": order_tracking_steps(order),
            "next_action": order_next_action(order),
        }
    )
    return payload


def order_next_action(order: RestaurantOrder) -> str:
    if (order.payment_method or "").lower() == "prepaid" and order.payment_status != "paid":
        return "Payment is pending. Confirm prepaid payment to continue."
    if order.status == "open":
        return "Order received. Kitchen will begin preparation shortly."
    if order.status == "preparing":
        return "Kitchen is preparing your order."
    if order.status == "ready":
        return "Order is ready for pickup or handoff."
    if order.status == "closed":
        return "Order completed. Thank you for ordering."
    return "Order is being processed."


def normalize_coupon_code(value: Optional[str]) -> Optional[str]:
    if not value:
        return None
    code = value.strip().upper().replace(" ", "")
    return code or None


def calculate_promotion_discount(promo: Promotion, subtotal: float) -> float:
    if promo.discount_type == "percentage":
        discount = subtotal * (float(promo.discount_value or 0) / 100)
    else:
        discount = float(promo.discount_value or 0)
    return round(min(max(discount, 0), subtotal), 2)


def apply_coupon_to_subtotal(
    db: Session,
    coupon_code: Optional[str],
    subtotal: float,
) -> tuple[float, Optional[Promotion]]:
    code = normalize_coupon_code(coupon_code)
    if not code:
        return 0.0, None

    promo = db.query(Promotion).filter(Promotion.code == code).first()
    if not promo:
        raise HTTPException(status_code=404, detail="Coupon code not found.")

    today = date.today()
    if promo.start_date > today or promo.end_date < today:
        raise HTTPException(status_code=409, detail="Coupon is not active today.")
    if promo.status not in {"active", "scheduled"}:
        raise HTTPException(status_code=409, detail="Coupon is not active.")

    return calculate_promotion_discount(promo, subtotal), promo


def append_order_note(notes: Optional[str], extra: str) -> str:
    if notes and notes.strip():
        return f"{notes.strip()} | {extra}"
    return extra


def inventory_usage_note(order_id: int, menu_item: str) -> str:
    return f"{ORDER_USAGE_NOTE_PREFIX} #{order_id}: {menu_item}"


def order_inventory_already_deducted(db: Session, order_id: int) -> bool:
    return (
        db.query(InventoryTransaction)
        .filter(InventoryTransaction.transaction_type == "usage")
        .filter(InventoryTransaction.notes.like(f"{ORDER_USAGE_NOTE_PREFIX} #{order_id}:%"))
        .first()
        is not None
    )


def deduct_inventory_for_order(db: Session, order: RestaurantOrder) -> list[dict]:
    if order_inventory_already_deducted(db, order.id):
        return []

    recipe_by_menu_item = {
        recipe.menu_item.strip().lower(): recipe
        for recipe in db.query(Recipe).all()
        if recipe.menu_item
    }
    inventory_by_name = {
        item.name.strip().lower(): item
        for item in db.query(InventoryItem).all()
        if item.name
    }

    usage_rows = []
    for ordered_item in order.items or []:
        menu_item_name = str(ordered_item.get("name") or "").strip()
        ordered_quantity = float(ordered_item.get("quantity") or 0)
        if not menu_item_name or ordered_quantity <= 0:
            continue

        recipe = recipe_by_menu_item.get(menu_item_name.lower())
        if not recipe:
            continue

        for ingredient in recipe.ingredients or []:
            ingredient_name = str(ingredient.get("name") or "").strip()
            recipe_quantity = float(ingredient.get("quantity") or 0)
            if not ingredient_name or recipe_quantity <= 0:
                continue

            inventory_item = inventory_by_name.get(ingredient_name.lower())
            if not inventory_item:
                continue

            usage_quantity = round(recipe_quantity * ordered_quantity, 4)
            unit_cost = float(inventory_item.cost_per_unit or 0)
            inventory_item.current_stock = round(
                float(inventory_item.current_stock or 0) - usage_quantity,
                4,
            )
            transaction = InventoryTransaction(
                item_id=inventory_item.id,
                transaction_type="usage",
                quantity=usage_quantity,
                unit_cost=unit_cost,
                total_cost=round(usage_quantity * unit_cost, 2),
                notes=inventory_usage_note(order.id, menu_item_name),
            )
            db.add(transaction)
            usage_rows.append(
                {
                    "inventory_item_id": inventory_item.id,
                    "ingredient_name": inventory_item.name,
                    "menu_item": menu_item_name,
                    "quantity": usage_quantity,
                    "unit": ingredient.get("unit") or inventory_item.unit,
                    "new_stock": inventory_item.current_stock,
                    "estimated_cost": transaction.total_cost,
                }
            )

    return usage_rows


def upsert_customer_from_order(db: Session, order: RestaurantOrder) -> None:
    phone = (order.customer_phone or "").strip()
    if not phone:
        return

    customer = db.query(Customer).filter(Customer.phone == phone).first()
    if customer is None:
        customer = Customer(
            name=order.customer_name,
            phone=phone,
            total_orders=0,
            total_spend=0.0,
        )
        db.add(customer)

    if order.customer_name:
        customer.name = order.customer_name
    customer.total_orders = int(customer.total_orders or 0) + 1
    customer.total_spend = float(customer.total_spend or 0.0) + float(order.total_amount or 0.0)
    customer.last_order_at = datetime.utcnow()


@router.get("/tables")
def get_tables(db: Session = Depends(get_db)):
    ensure_default_tables(db)
    tables = db.query(DiningTable).order_by(DiningTable.table_number).all()
    return [serialize_table(table) for table in tables]


@router.post("/")
def create_order(order: OrderCreate, db: Session = Depends(get_db)):
    valid_items = [item for item in order.items if item.quantity > 0]
    if not valid_items:
        raise HTTPException(status_code=422, detail="Order must include at least one item.")

    if order.order_type == "dine-in" and not order.table_number:
        raise HTTPException(status_code=422, detail="Dine-in orders require a table number.")

    if order.table_number:
        table = db.query(DiningTable).filter(
            DiningTable.table_number == order.table_number
        ).first()
        if not table:
            raise HTTPException(status_code=404, detail="Table not found")
        if table.status == "occupied" and table.current_order_id:
            raise HTTPException(status_code=409, detail="Table already has an open order.")

    subtotal = round(sum(item.price * item.quantity for item in valid_items), 2)
    coupon_discount, applied_promo = apply_coupon_to_subtotal(
        db,
        order.coupon_code,
        subtotal,
    )
    discount = (
        coupon_discount
        if applied_promo
        else round(min(max(order.discount_amount or 0, 0), subtotal), 2)
    )
    taxable_subtotal = max(subtotal - discount, 0)
    tax = round(taxable_subtotal * 0.05, 2)
    total = round(taxable_subtotal + tax, 2)
    items = [item.model_dump() for item in valid_items]
    payment_method = (order.payment_method or "cash").lower()
    payment_status = "awaiting_payment" if payment_method == "prepaid" else "pending"

    notes = order.notes
    if applied_promo and applied_promo.code:
        notes = append_order_note(notes, f"Coupon: {applied_promo.code}")

    row = RestaurantOrder(
        order_type=order.order_type,
        table_number=order.table_number,
        customer_name=order.customer_name,
        customer_phone=order.customer_phone,
        items=items,
        subtotal=subtotal,
        discount_amount=discount,
        tax_amount=tax,
        total_amount=total,
        payment_method=payment_method,
        payment_status=payment_status,
        notes=notes,
    )
    db.add(row)
    db.flush()
    upsert_customer_from_order(db, row)

    if order.table_number:
        table.status = "occupied"
        table.current_order_id = row.id
        table.last_updated = datetime.utcnow()

    db.commit()
    return {
        "order_id": row.id,
        "subtotal": subtotal,
        "discount": discount,
        "tax": tax,
        "total": total,
        "status": row.status,
        "payment_status": row.payment_status,
        "coupon_code": applied_promo.code if applied_promo else None,
    }


@router.patch("/{order_id}/close")
def close_order(
    order_id: int,
    payment_method: Optional[str] = None,
    db: Session = Depends(get_db),
):
    order = db.query(RestaurantOrder).filter(RestaurantOrder.id == order_id).first()
    if not order:
        raise HTTPException(status_code=404, detail="Order not found")

    inventory_usage = []
    if order.status != "closed":
        requested_payment_method = (
            payment_method.strip().lower()
            if payment_method
            else (order.payment_method or "cash").strip().lower()
        ) or "cash"
        if (
            (order.payment_method or "").lower() == "prepaid"
            and order.payment_status != "paid"
            and requested_payment_method == "prepaid"
        ):
            raise HTTPException(
                status_code=409,
                detail="Prepaid orders must be confirmed before closing.",
            )

        order.payment_method = requested_payment_method
        order.payment_status = "paid"
        order.status = "closed"
        order.closed_at = datetime.utcnow()
        inventory_usage = deduct_inventory_for_order(db, order)

        if order.table_number:
            table = db.query(DiningTable).filter(
                DiningTable.table_number == order.table_number
            ).first()
            if table:
                table.status = "available"
                table.current_order_id = None
                table.last_updated = datetime.utcnow()

        daily = db.query(DailySales).filter(DailySales.date == date.today()).first()
        if daily:
            daily.total_sale = float(daily.total_sale or 0) + float(order.total_amount or 0)
            if (order.payment_method or "").lower() == "cash":
                daily.cash_collected = float(daily.cash_collected or 0) + float(order.total_amount or 0)
            daily.profit = float(daily.total_sale or 0) - float(daily.total_expense or 0)
        else:
            daily = DailySales(
                date=date.today(),
                total_sale=order.total_amount or 0,
                cash_collected=order.total_amount if (order.payment_method or "").lower() == "cash" else 0,
                total_expense=0,
                profit=order.total_amount or 0,
                payment_method=order.payment_method or "mixed",
                notes=f"Auto-created from order #{order.id}",
            )
            db.add(daily)

    db.commit()
    return {
        "status": "closed",
        "total_collected": order.total_amount,
        "inventory_usage": inventory_usage,
    }


@router.patch("/{order_id}/status")
def update_order_status(
    order_id: int,
    payload: OrderStatusUpdate,
    db: Session = Depends(get_db),
):
    order = db.query(RestaurantOrder).filter(RestaurantOrder.id == order_id).first()
    if not order:
        raise HTTPException(status_code=404, detail="Order not found")
    if order.status == "closed":
        raise HTTPException(status_code=409, detail="Closed orders cannot be moved.")

    status = payload.status.strip().lower()
    allowed_statuses = {"open", "preparing", "ready"}
    if status not in allowed_statuses:
        raise HTTPException(
            status_code=422,
            detail=f"Status must be one of: {', '.join(sorted(allowed_statuses))}.",
        )

    order.status = status
    db.commit()
    db.refresh(order)
    return serialize_order(order)


@router.post("/{order_id}/payment-session")
def create_order_payment_session(
    order_id: int,
    payload: PaymentSessionRequest,
    db: Session = Depends(get_db),
):
    order = db.query(RestaurantOrder).filter(RestaurantOrder.id == order_id).first()
    if not order:
        raise HTTPException(status_code=404, detail="Order not found")
    if order.status == "closed":
        raise HTTPException(status_code=409, detail="Closed orders cannot start payment.")
    if order.payment_status == "paid":
        raise HTTPException(status_code=409, detail="Order is already paid.")

    session = create_payment_session(
        order_id=order.id,
        amount=order.total_amount or 0,
        customer_name=order.customer_name,
        customer_phone=order.customer_phone,
        provider=payload.provider,
        return_url=payload.return_url,
    )
    order.payment_method = "prepaid"
    order.payment_status = "awaiting_payment"
    order.payment_provider = session["provider"]
    order.payment_session_id = session["session_id"]
    order.payment_session_url = session["checkout_url"]
    order.payment_session_created_at = datetime.utcnow()
    db.commit()
    return {
        "order": serialize_order(order),
        "payment_session": session,
    }


@router.post("/{order_id}/payment-confirmation")
def confirm_order_payment(
    order_id: int,
    payload: PaymentConfirmation,
    db: Session = Depends(get_db),
):
    order = db.query(RestaurantOrder).filter(RestaurantOrder.id == order_id).first()
    if not order:
        raise HTTPException(status_code=404, detail="Order not found")

    paid_amount = payload.paid_amount if payload.paid_amount is not None else order.total_amount
    if round(float(paid_amount or 0), 2) < round(float(order.total_amount or 0), 2):
        raise HTTPException(status_code=422, detail="Paid amount is below order total.")

    order.payment_method = "prepaid"
    order.payment_status = "paid"
    order.payment_provider = payload.payment_provider.strip() or "manual"
    order.payment_reference = (
        payload.payment_reference.strip()
        if payload.payment_reference
        else f"PB-PAY-{order.id}"
    )
    order.payment_confirmed_at = datetime.utcnow()
    db.commit()
    db.refresh(order)
    return serialize_order(order)


@router.post("/{order_id}/invoice")
def generate_invoice(
    order_id: int,
    customer_name: str = "Walk-in Customer",
    customer_gstin: Optional[str] = None,
    db: Session = Depends(get_db),
):
    order = db.query(RestaurantOrder).filter(RestaurantOrder.id == order_id).first()
    if not order:
        raise HTTPException(status_code=404, detail="Order not found")

    existing = db.query(Invoice).filter(Invoice.order_id == order_id).first()
    if existing:
        return serialize_invoice(existing)

    count = db.query(Invoice).count()
    invoice_number = f"PB-{date.today().strftime('%Y%m')}-{str(count + 1).zfill(4)}"
    cgst = round((order.subtotal or 0) * 0.025, 2)
    sgst = round((order.subtotal or 0) * 0.025, 2)

    invoice = Invoice(
        invoice_number=invoice_number,
        order_id=order.id,
        customer_name=customer_name,
        customer_gstin=customer_gstin,
        items=order.items or [],
        subtotal=order.subtotal or 0,
        cgst=cgst,
        sgst=sgst,
        total=order.total_amount or 0,
        payment_method=order.payment_method,
    )
    db.add(invoice)
    db.commit()
    db.refresh(invoice)
    return serialize_invoice(invoice)


@router.get("/invoices")
def list_invoices(db: Session = Depends(get_db)):
    invoices = db.query(Invoice).order_by(Invoice.created_at.desc()).limit(50).all()
    return [serialize_invoice(invoice) for invoice in invoices]


@router.get("/today")
def todays_orders(db: Session = Depends(get_db)):
    rows = db.query(RestaurantOrder).filter(
        RestaurantOrder.date == date.today()
    ).order_by(RestaurantOrder.created_at.desc()).all()
    total = sum(float(row.total_amount or 0) for row in rows if row.status == "closed")
    return {
        "orders": [
            serialize_order(row)
            for row in rows
        ],
        "total_collected_today": total,
    }


@router.get("/customer-history/{phone}")
def customer_order_history(phone: str, db: Session = Depends(get_db)):
    normalized_phone = phone.strip()
    if not normalized_phone:
        raise HTTPException(status_code=422, detail="Phone number is required.")

    customer = db.query(Customer).filter(Customer.phone == normalized_phone).first()
    orders = (
        db.query(RestaurantOrder)
        .filter(RestaurantOrder.customer_phone == normalized_phone)
        .order_by(RestaurantOrder.created_at.desc(), RestaurantOrder.id.desc())
        .limit(25)
        .all()
    )
    if customer is None and not orders:
        raise HTTPException(status_code=404, detail="No orders found for this phone number.")

    return {
        "customer": {
            "name": customer.name if customer else None,
            "phone": normalized_phone,
            "email": customer.email if customer else None,
            "total_orders": customer.total_orders if customer else len(orders),
            "total_spend": (
                round(float(customer.total_spend or 0), 2)
                if customer
                else round(sum(float(order.total_amount or 0) for order in orders), 2)
            ),
            "last_order_at": customer.last_order_at.isoformat() if customer and customer.last_order_at else None,
        },
        "orders": [serialize_order(order) for order in orders],
    }


@router.get("/track/{order_id}")
def track_order(order_id: int, phone: str, db: Session = Depends(get_db)):
    normalized_phone = phone.strip()
    if not normalized_phone:
        raise HTTPException(status_code=422, detail="Phone number is required.")

    order = db.query(RestaurantOrder).filter(RestaurantOrder.id == order_id).first()
    if not order or (order.customer_phone or "").strip() != normalized_phone:
        raise HTTPException(status_code=404, detail="Order not found for this phone number.")

    return serialize_order_tracking(order)


@router.get("/{order_id}")
def get_order(order_id: int, db: Session = Depends(get_db)):
    order = db.query(RestaurantOrder).filter(RestaurantOrder.id == order_id).first()
    if not order:
        raise HTTPException(status_code=404, detail="Order not found")
    return serialize_order(order)
