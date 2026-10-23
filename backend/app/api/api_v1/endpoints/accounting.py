"""GST-ready accounting summary and order-level CSV export."""

import csv
import io
from datetime import date, datetime, time, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session

from app.api.deps import get_db, require_roles
from app.core.clock import business_zone
from app.models.domain import RestaurantOrder, Store

router = APIRouter()


def _bounds(start_date: date, end_date: date) -> tuple[datetime, datetime]:
    if end_date < start_date:
        raise HTTPException(
            status_code=422, detail="End date must be on or after the start date."
        )
    if (end_date - start_date).days > 366:
        raise HTTPException(
            status_code=422, detail="Choose a range of 366 days or less."
        )
    zone = business_zone()
    start_local = datetime.combine(start_date, time.min, tzinfo=zone)
    end_local = datetime.combine(end_date + timedelta(days=1), time.min, tzinfo=zone)
    return (
        start_local.astimezone(timezone.utc).replace(tzinfo=None),
        end_local.astimezone(timezone.utc).replace(tzinfo=None),
    )


def _orders(
    db: Session,
    start_date: date,
    end_date: date,
    store_id: int | None = None,
) -> list[RestaurantOrder]:
    start_at, end_at = _bounds(start_date, end_date)
    query = db.query(RestaurantOrder).filter(
        RestaurantOrder.created_at >= start_at,
        RestaurantOrder.created_at < end_at,
        RestaurantOrder.status != "cancelled",
    )
    if store_id is not None:
        query = query.filter(RestaurantOrder.store_id == store_id)
    return query.order_by(RestaurantOrder.id.asc()).all()


def _money(value) -> float:
    return round(float(value or 0), 2)


def accounting_summary(
    db: Session,
    start_date: date,
    end_date: date,
    store_id: int | None = None,
) -> dict:
    orders = _orders(db, start_date, end_date, store_id)
    gross = sum(_money(order.subtotal) for order in orders)
    discounts = sum(_money(order.discount_amount) for order in orders)
    tax = sum(_money(order.tax_amount) for order in orders)
    tips = sum(_money(order.tip_amount) for order in orders)
    refunds = sum(_money(order.refunded_amount) for order in orders)
    billed = sum(_money(order.total_amount) for order in orders)
    cgst = round(tax / 2, 2)
    sgst = round(tax - cgst, 2)

    payments: dict[str, dict] = {}
    for order in orders:
        method = (order.payment_method or "unpaid").lower()
        bucket = payments.setdefault(
            method, {"method": method, "orders": 0, "billed": 0.0, "tax": 0.0}
        )
        bucket["orders"] += 1
        bucket["billed"] = round(bucket["billed"] + _money(order.total_amount), 2)
        bucket["tax"] = round(bucket["tax"] + _money(order.tax_amount), 2)

    stores = {store.id: store for store in db.query(Store).all()}
    store_rows: dict[int, dict] = {}
    for order in orders:
        store = stores.get(order.store_id)
        bucket = store_rows.setdefault(
            order.store_id,
            {
                "store_id": order.store_id,
                "store_name": store.name if store else "Unknown store",
                "store_code": store.code if store else "-",
                "orders": 0,
                "billed": 0.0,
                "tax": 0.0,
                "refunds": 0.0,
            },
        )
        bucket["orders"] += 1
        bucket["billed"] = round(bucket["billed"] + _money(order.total_amount), 2)
        bucket["tax"] = round(bucket["tax"] + _money(order.tax_amount), 2)
        bucket["refunds"] = round(bucket["refunds"] + _money(order.refunded_amount), 2)

    return {
        "start_date": start_date.isoformat(),
        "end_date": end_date.isoformat(),
        "store_id": store_id,
        "orders": len(orders),
        "gross_sales": round(gross, 2),
        "discounts": round(discounts, 2),
        "tax": round(tax, 2),
        "cgst": cgst,
        "sgst": sgst,
        "tips": round(tips, 2),
        "refunds": round(refunds, 2),
        "total_billed": round(billed, 2),
        "net_collected": round(billed - refunds, 2),
        "avg_order_value": round(billed / len(orders), 2) if orders else 0.0,
        "payments": sorted(payments.values(), key=lambda row: row["method"]),
        "stores": sorted(store_rows.values(), key=lambda row: row["store_id"]),
        "generated_at": datetime.utcnow().isoformat(),
    }


def accounting_csv(
    db: Session, start_date: date, end_date: date, store_id: int | None = None
) -> str:
    orders = _orders(db, start_date, end_date, store_id)
    stores = {store.id: store for store in db.query(Store).all()}
    buffer = io.StringIO()
    writer = csv.writer(buffer)
    writer.writerow(
        [
            "order_id",
            "business_date",
            "store_code",
            "store_name",
            "order_type",
            "payment_method",
            "payment_status",
            "order_status",
            "subtotal",
            "discount",
            "tax",
            "cgst",
            "sgst",
            "tip",
            "refunded",
            "total",
            "net_collected",
        ]
    )
    for order in orders:
        store = stores.get(order.store_id)
        tax = _money(order.tax_amount)
        cgst = round(tax / 2, 2)
        writer.writerow(
            [
                order.id,
                order.date.isoformat() if order.date else "",
                store.code if store else "",
                store.name if store else "",
                order.order_type,
                order.payment_method or "",
                order.payment_status,
                order.status,
                f"{_money(order.subtotal):.2f}",
                f"{_money(order.discount_amount):.2f}",
                f"{tax:.2f}",
                f"{cgst:.2f}",
                f"{round(tax - cgst, 2):.2f}",
                f"{_money(order.tip_amount):.2f}",
                f"{_money(order.refunded_amount):.2f}",
                f"{_money(order.total_amount):.2f}",
                f"{_money(order.total_amount) - _money(order.refunded_amount):.2f}",
            ]
        )
    return buffer.getvalue()


@router.get("/summary")
def get_accounting_summary(
    start_date: date,
    end_date: date,
    store_id: int | None = Query(default=None),
    db: Session = Depends(get_db),
    _: dict = Depends(require_roles("admin")),
):
    return accounting_summary(db, start_date, end_date, store_id)


@router.get("/export")
def export_accounting_csv(
    start_date: date,
    end_date: date,
    store_id: int | None = Query(default=None),
    db: Session = Depends(get_db),
    _: dict = Depends(require_roles("admin")),
):
    content = accounting_csv(db, start_date, end_date, store_id)
    filename = f"pizza-blitz-accounting-{start_date.isoformat()}-to-{end_date.isoformat()}.csv"
    return StreamingResponse(
        iter([content]),
        media_type="text/csv",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )
