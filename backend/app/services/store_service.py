"""Franchise store registry and consolidated reporting."""

from datetime import date, datetime, time, timedelta, timezone

from sqlalchemy import func
from sqlalchemy.orm import Session

from app.core.clock import business_today, business_zone
from app.models.domain import RestaurantOrder, Store

DEFAULT_STORE_ID = 1


def ensure_default_store(db: Session) -> Store:
    store = db.query(Store).filter(Store.code == "MAIN").first()
    if store is not None:
        return store
    store = Store(
        id=DEFAULT_STORE_ID,
        name="Pizza Blitz",
        code="MAIN",
        address_line="Main store",
        timezone="Asia/Kolkata",
        is_active=True,
    )
    db.add(store)
    db.flush()
    return store


def serialize_store(store: Store, summary: dict | None = None) -> dict:
    return {
        "id": store.id,
        "name": store.name,
        "code": store.code,
        "address_line": store.address_line,
        "phone": store.phone,
        "timezone": store.timezone,
        "is_active": bool(store.is_active),
        "created_at": store.created_at.isoformat() if store.created_at else None,
        **(summary or {}),
    }


def resolve_store(db: Session, store_id: int | None = None) -> Store:
    """Return a requested store or the default store when none is named."""
    if store_id is None:
        return ensure_default_store(db)
    store = db.query(Store).filter(Store.id == store_id).first()
    if store is None:
        raise ValueError("Store not found.")
    return store


def period_bounds(start_date: date, end_date: date) -> tuple[datetime, datetime]:
    zone = business_zone()
    start_local = datetime.combine(start_date, time.min, tzinfo=zone)
    end_local = datetime.combine(end_date + timedelta(days=1), time.min, tzinfo=zone)
    return (
        start_local.astimezone(timezone.utc).replace(tzinfo=None),
        end_local.astimezone(timezone.utc).replace(tzinfo=None),
    )


def _bounds(start_date: date, end_date: date) -> tuple[datetime, datetime]:
    return period_bounds(start_date, end_date)


def store_metrics(
    db: Session, store_id: int, start_date: date, end_date: date
) -> dict:
    start_at, end_at = _bounds(start_date, end_date)
    row = (
        db.query(
            func.count(RestaurantOrder.id).label("orders"),
            func.coalesce(func.sum(RestaurantOrder.total_amount), 0.0).label("revenue"),
            func.coalesce(func.sum(RestaurantOrder.tip_amount), 0.0).label("tips"),
            func.coalesce(func.sum(RestaurantOrder.refunded_amount), 0.0).label("refunds"),
        )
        .filter(
            RestaurantOrder.store_id == store_id,
            RestaurantOrder.created_at >= start_at,
            RestaurantOrder.created_at < end_at,
            func.coalesce(RestaurantOrder.status, "") != "cancelled",
        )
        .one()
    )
    orders = int(row.orders or 0)
    revenue = round(float(row.revenue or 0), 2)
    return {
        "orders": orders,
        "revenue": revenue,
        "avg_order_value": round(revenue / orders, 2) if orders else 0.0,
        "tips": round(float(row.tips or 0), 2),
        "refunds": round(float(row.refunds or 0), 2),
    }


def store_summaries(
    db: Session, start_date: date, end_date: date
) -> list[dict]:
    stores = db.query(Store).order_by(Store.id.asc()).all()
    return [
        serialize_store(store, store_metrics(db, store.id, start_date, end_date))
        for store in stores
    ]


def consolidated_report(
    db: Session, start_date: date, end_date: date
) -> dict:
    stores = store_summaries(db, start_date, end_date)
    totals = {
        "orders": sum(store["orders"] for store in stores),
        "revenue": round(sum(store["revenue"] for store in stores), 2),
        "tips": round(sum(store["tips"] for store in stores), 2),
        "refunds": round(sum(store["refunds"] for store in stores), 2),
    }
    totals["avg_order_value"] = (
        round(totals["revenue"] / totals["orders"], 2) if totals["orders"] else 0.0
    )
    active = [store for store in stores if store["is_active"]]
    best = max(active, key=lambda store: store["revenue"], default=None)
    return {
        "start_date": start_date.isoformat(),
        "end_date": end_date.isoformat(),
        "stores": stores,
        "totals": totals,
        "best_store": (
            {"id": best["id"], "name": best["name"], "revenue": best["revenue"]}
            if best
            else None
        ),
        "generated_at": datetime.utcnow().isoformat(),
    }


def default_range(days: int = 30) -> tuple[date, date]:
    end = business_today()
    return end - timedelta(days=max(days, 1) - 1), end
