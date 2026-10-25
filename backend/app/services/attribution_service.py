"""Person-level first/last/linear attribution from campaign sends to coupon orders."""

from datetime import datetime, time, timedelta

from sqlalchemy.orm import Session

from app.models.domain import CampaignDelivery, Customer, Promotion, RestaurantOrder

LOOKBACK_DAYS = 30


def _phone(value: str | None) -> str:
    digits = "".join(character for character in (value or "") if character.isdigit())
    return digits[-10:] if len(digits) >= 10 else digits


def _empty_model() -> dict:
    return {"channels": [], "attributed_revenue": 0.0}


def _rollup(credits: list[tuple[str, float, int]]) -> list[dict]:
    totals: dict[str, dict] = {}
    for channel, revenue, conversions in credits:
        row = totals.setdefault(
            channel, {"channel": channel, "credit_revenue": 0.0, "conversions": 0}
        )
        row["credit_revenue"] += revenue
        row["conversions"] += conversions
    return sorted(
        (
            {
                "channel": row["channel"],
                "credit_revenue": round(row["credit_revenue"], 2),
                "conversions": row["conversions"],
            }
            for row in totals.values()
        ),
        key=lambda row: (-row["credit_revenue"], row["channel"]),
    )


def person_level_attribution(
    db: Session,
    promo: Promotion,
    orders: list[RestaurantOrder],
    *,
    lookback_days: int = LOOKBACK_DAYS,
) -> dict:
    if not orders:
        return {
            "model": "person_level_multi_touch",
            "lookback_days": lookback_days,
            "converted_customers": 0,
            "touch_count": 0,
            "orders_attributed": 0,
            "unmatched_orders": 0,
            "first_touch": _empty_model(),
            "last_touch": _empty_model(),
            "linear": _empty_model(),
            "note": "No coupon orders in this campaign window yet.",
        }

    customer_by_phone: dict[str, Customer] = {}
    for customer in db.query(Customer).all():
        key = _phone(customer.phone)
        if key:
            customer_by_phone[key] = customer

    deliveries = (
        db.query(CampaignDelivery)
        .filter(
            CampaignDelivery.promotion_id == promo.id,
            CampaignDelivery.status == "sent",
        )
        .all()
    )
    deliveries_by_customer: dict[int, list[CampaignDelivery]] = {}
    for delivery in deliveries:
        if delivery.customer_id is None:
            continue
        deliveries_by_customer.setdefault(delivery.customer_id, []).append(delivery)

    first_credits: list[tuple[str, float, int]] = []
    last_credits: list[tuple[str, float, int]] = []
    linear_credits: list[tuple[str, float, int]] = []
    converted_customers: set[int] = set()
    touch_count = 0
    unmatched = 0

    for order in orders:
        revenue = float(order.total_amount or 0)
        customer = customer_by_phone.get(_phone(order.customer_phone))
        if customer is None:
            unmatched += 1
            first_credits.append(("coupon", revenue, 1))
            last_credits.append(("coupon", revenue, 1))
            linear_credits.append(("coupon", revenue, 1))
            continue
        order_at = order.created_at
        reference_at = order_at or datetime.combine(order.date, time.min)
        window_start = reference_at - timedelta(days=lookback_days)
        touches = [
            delivery
            for delivery in deliveries_by_customer.get(customer.id, [])
            if delivery.attempted_at
            and (order_at is None or delivery.attempted_at <= order_at)
            and delivery.attempted_at >= window_start
        ]
        touches.sort(key=lambda delivery: delivery.attempted_at)
        if not touches:
            first_credits.append(("coupon", revenue, 1))
            last_credits.append(("coupon", revenue, 1))
            linear_credits.append(("coupon", revenue, 1))
            converted_customers.add(customer.id)
            continue

        converted_customers.add(customer.id)
        touch_count += len(touches)
        first_credits.append((touches[0].channel, revenue, 1))
        last_credits.append((touches[-1].channel, revenue, 1))
        share = revenue / len(touches)
        channel_seen: set[str] = set()
        for touch in touches:
            linear_credits.append((touch.channel, share, 0))
            channel_seen.add(touch.channel)
        for channel in channel_seen:
            linear_credits.append((channel, 0.0, 1))

    attributed = sum(credit for _, credit, _ in linear_credits)
    return {
        "model": "person_level_multi_touch",
        "lookback_days": lookback_days,
        "converted_customers": len(converted_customers),
        "touch_count": touch_count,
        "orders_attributed": len(orders),
        "unmatched_orders": unmatched,
        "first_touch": {
            "channels": _rollup(first_credits),
            "attributed_revenue": round(sum(value for _, value, _ in first_credits), 2),
        },
        "last_touch": {
            "channels": _rollup(last_credits),
            "attributed_revenue": round(sum(value for _, value, _ in last_credits), 2),
        },
        "linear": {
            "channels": _rollup(linear_credits),
            "attributed_revenue": round(attributed, 2),
        },
        "note": (
            "Deliveries are matched to customers by phone and to orders within the lookback "
            "window. Orders without a matched send fall back to the coupon channel. "
            "Social/ad campaign credit is reported separately."
        ),
    }
