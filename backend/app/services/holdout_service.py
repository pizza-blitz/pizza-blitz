"""Deterministic campaign holdouts and treated-vs-holdout experiment reporting."""

import hashlib
import math
from datetime import datetime, time

from sqlalchemy.orm import Session

from app.models.domain import CampaignDelivery, Customer, Promotion, RestaurantOrder


def _phone(value: str | None) -> str:
    digits = "".join(character for character in (value or "") if character.isdigit())
    return digits[-10:] if len(digits) >= 10 else digits


def _bucket(promotion_id: int, customer_id: int) -> int:
    digest = hashlib.sha256(f"{promotion_id}:{customer_id}".encode()).hexdigest()
    return int(digest[:8], 16) % 100


def select_holdout_ids(
    promotion_id: int, customer_ids: list[int], holdout_percent: float
) -> set[int]:
    percent = max(0.0, min(float(holdout_percent or 0), 50.0))
    if percent <= 0:
        return set()
    threshold = int(round(percent))
    return {
        customer_id
        for customer_id in customer_ids
        if _bucket(promotion_id, customer_id) < threshold
    }


def _normal_cdf(value: float) -> float:
    return 0.5 * (1 + math.erf(value / math.sqrt(2)))


def _rate(converted: int, customers: int) -> float:
    return round((converted / customers) * 100, 2) if customers else 0.0


def two_proportion_test(
    treated_converted: int,
    treated_total: int,
    holdout_converted: int,
    holdout_total: int,
) -> dict:
    if treated_total <= 0 or holdout_total <= 0:
        return {
            "available": False,
            "reason": "Both groups need at least one assigned customer.",
            "p_value": None,
            "significant_95": False,
            "confidence_interval_95_pp": None,
            "required_per_group_80_power": None,
        }
    treated_rate = treated_converted / treated_total
    holdout_rate = holdout_converted / holdout_total
    pooled = (treated_converted + holdout_converted) / (treated_total + holdout_total)
    standard_error = math.sqrt(
        pooled * (1 - pooled) * (1 / treated_total + 1 / holdout_total)
    )
    difference = treated_rate - holdout_rate
    if standard_error == 0:
        z_score = 0.0
        p_value = 1.0
    else:
        z_score = difference / standard_error
        p_value = max(0.0, min(1.0, 2 * (1 - _normal_cdf(abs(z_score)))))
    unpooled_se = math.sqrt(
        treated_rate * (1 - treated_rate) / treated_total
        + holdout_rate * (1 - holdout_rate) / holdout_total
    )
    margin = 1.96 * unpooled_se
    ci_low = (difference - margin) * 100
    ci_high = (difference + margin) * 100
    required = None
    if 0 < holdout_rate < 1:
        target = min(holdout_rate * 1.2, 0.999)
        delta = target - holdout_rate
        pooled_target = (target + holdout_rate) / 2
        if delta > 0:
            required = math.ceil(
                2
                * (1.96 + 0.84) ** 2
                * pooled_target
                * (1 - pooled_target)
                / (delta**2)
            )
    return {
        "available": True,
        "treated_rate_percent": round(treated_rate * 100, 2),
        "holdout_rate_percent": round(holdout_rate * 100, 2),
        "absolute_lift_pp": round(difference * 100, 2),
        "relative_lift_percent": round(difference / holdout_rate * 100, 2)
        if holdout_rate
        else None,
        "z_score": round(z_score, 3),
        "p_value": round(p_value, 6),
        "significant_95": p_value < 0.05,
        "confidence_interval_95_pp": [round(ci_low, 2), round(ci_high, 2)],
        "relative_confidence_interval_95_percent": [
            round(ci_low / (holdout_rate * 100) * 100, 2),
            round(ci_high / (holdout_rate * 100) * 100, 2),
        ]
        if holdout_rate
        else None,
        "required_per_group_80_power": required,
        "assumption": "Two-sided two-proportion z-test at 95% confidence; 20% relative MDE.",
    }


def experiment_summary(
    db: Session,
    promo: Promotion,
    orders: list[RestaurantOrder],
    deliveries: list[CampaignDelivery],
) -> dict:
    treated_ids = {
        delivery.customer_id
        for delivery in deliveries
        if delivery.status == "sent" and delivery.customer_id
    }
    holdout_ids = {
        delivery.customer_id
        for delivery in deliveries
        if delivery.status == "holdout" and delivery.customer_id
    }
    if not treated_ids and not holdout_ids:
        return {
            "enabled": bool(promo.holdout_percent),
            "holdout_percent": float(promo.holdout_percent or 0),
            "treated": {"customers": 0, "converted": 0, "conversion_rate": 0.0, "revenue": 0.0},
            "holdout": {"customers": 0, "converted": 0, "conversion_rate": 0.0, "revenue": 0.0},
            "lift_percent": 0.0,
            "incremental_revenue": 0.0,
            "significance": two_proportion_test(0, 0, 0, 0),
            "note": "No treated or holdout audience has been recorded yet.",
        }

    customers = {customer.id: customer for customer in db.query(Customer).all()}
    assigned_at: dict[int, datetime] = {}
    for delivery in deliveries:
        if delivery.status not in {"sent", "holdout"} or not delivery.customer_id:
            continue
        if not delivery.attempted_at:
            continue
        current = assigned_at.get(delivery.customer_id)
        if current is None or delivery.attempted_at < current:
            assigned_at[delivery.customer_id] = delivery.attempted_at
    orders_by_phone: dict[str, list[RestaurantOrder]] = {}
    for order in orders:
        orders_by_phone.setdefault(_phone(order.customer_phone), []).append(order)

    def summarize(customer_ids: set[int]) -> dict:
        converted = 0
        revenue = 0.0
        for customer_id in customer_ids:
            customer = customers.get(customer_id)
            if customer is None:
                continue
            assigned = assigned_at.get(customer_id)
            matched = []
            for order in orders_by_phone.get(_phone(customer.phone), []):
                order_at = order.created_at or datetime.combine(order.date, time.min)
                if assigned is None or order_at >= assigned:
                    matched.append(order)
            if matched:
                converted += 1
                revenue += sum(float(order.total_amount or 0) for order in matched)
        count = len(customer_ids)
        return {
            "customers": count,
            "converted": converted,
            "conversion_rate": _rate(converted, count),
            "revenue": round(revenue, 2),
            "revenue_per_customer": round(revenue / count, 2) if count else 0.0,
        }

    treated = summarize(treated_ids)
    holdout = summarize(holdout_ids)
    lift = (
        round(
            ((treated["conversion_rate"] - holdout["conversion_rate"])
            / holdout["conversion_rate"])
            * 100,
            2,
        )
        if holdout["conversion_rate"]
        else 0.0
    )
    incremental = round(
        treated["revenue"] - (holdout["revenue_per_customer"] * treated["customers"]),
        2,
    )
    significance = two_proportion_test(
        treated["converted"],
        treated["customers"],
        holdout["converted"],
        holdout["customers"],
    )
    return {
        "enabled": bool(promo.holdout_percent),
        "holdout_percent": float(promo.holdout_percent or 0),
        "treated": treated,
        "holdout": holdout,
        "lift_percent": lift,
        "incremental_revenue": incremental,
        "significance": significance,
        "note": (
            "Holdout customers receive no campaign send. Conversion uses coupon orders in the "
            "campaign window; treated and holdout revenue-per-customer drive the incremental "
            "estimate. Small samples are directional, not statistical significance."
        ),
    }
