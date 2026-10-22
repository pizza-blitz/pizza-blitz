"""Loyalty points, tiers, and referral codes.

Points are earned when an order is closed (1 point per rupee of the order
total), and referral bonuses are applied on a customer's first order. The ledger
is idempotent per order and transaction type.
"""

import secrets

from sqlalchemy.orm import Session

from app.models.domain import (
    Customer,
    LoyaltyAccount,
    LoyaltyTransaction,
    RestaurantOrder,
)

REFERRAL_BONUS_POINTS = 100
TIERS = [
    (0, "Slice Starter"),
    (300, "Regular"),
    (1000, "Gold Slice"),
    (2500, "VIP Slice Club"),
]


class ReferralError(ValueError):
    """The referral code cannot be used for this order."""


def _generate_code(db: Session) -> str:
    alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
    for _ in range(20):
        code = "PB" + "".join(secrets.choice(alphabet) for _ in range(6))
        exists = (
            db.query(LoyaltyAccount)
            .filter(LoyaltyAccount.referral_code == code)
            .first()
        )
        if exists is None:
            return code
    raise RuntimeError("Could not allocate a referral code.")


def get_or_create_account(db: Session, customer: Customer) -> LoyaltyAccount:
    account = (
        db.query(LoyaltyAccount)
        .filter(LoyaltyAccount.customer_id == customer.id)
        .first()
    )
    if account is not None:
        return account
    account = LoyaltyAccount(
        customer_id=customer.id,
        points_balance=0,
        lifetime_points=0,
        referral_code=_generate_code(db),
    )
    db.add(account)
    db.flush()
    return account


def tier_for(points: int) -> tuple[str, str | None, int, int]:
    """Return (tier, next_tier, progress_percent, points_to_next)."""
    lifetime = max(int(points or 0), 0)
    current = TIERS[0]
    next_tier = None
    for index, tier in enumerate(TIERS):
        if lifetime >= tier[0]:
            current = tier
            next_tier = TIERS[index + 1] if index + 1 < len(TIERS) else None
    if next_tier is None:
        return current[1], None, 100, 0
    span = next_tier[0] - current[0]
    progress = round(((lifetime - current[0]) / span) * 100) if span else 100
    return current[1], next_tier[1], min(max(progress, 0), 100), next_tier[0] - lifetime


def validate_referral_code(db: Session, code: str, phone: str) -> LoyaltyAccount:
    normalized = (code or "").strip().upper()
    if not normalized:
        raise ReferralError("Enter a referral code.")
    account = (
        db.query(LoyaltyAccount)
        .filter(LoyaltyAccount.referral_code == normalized)
        .first()
    )
    if account is None:
        raise ReferralError("That referral code is not valid.")
    referrer = db.query(Customer).filter(Customer.id == account.customer_id).first()
    if referrer is not None and referrer.phone == (phone or "").strip():
        raise ReferralError("You cannot use your own referral code.")
    return account


def apply_referral(
    db: Session,
    new_customer: Customer,
    referrer_account: LoyaltyAccount,
    order: RestaurantOrder,
) -> bool:
    new_account = get_or_create_account(db, new_customer)
    if new_account.referred_by_customer_id is not None:
        return False
    new_account.referred_by_customer_id = referrer_account.customer_id

    referrer_account.points_balance += REFERRAL_BONUS_POINTS
    referrer_account.lifetime_points += REFERRAL_BONUS_POINTS
    new_account.points_balance += REFERRAL_BONUS_POINTS
    new_account.lifetime_points += REFERRAL_BONUS_POINTS

    db.add(
        LoyaltyTransaction(
            customer_id=referrer_account.customer_id,
            points=REFERRAL_BONUS_POINTS,
            transaction_type="referral_bonus",
            order_id=order.id,
            note=f"Referral bonus from order #{order.id}",
        )
    )
    db.add(
        LoyaltyTransaction(
            customer_id=new_customer.id,
            points=REFERRAL_BONUS_POINTS,
            transaction_type="referral_joined",
            order_id=order.id,
            note="Welcome referral bonus",
        )
    )
    return True


def award_order_points(db: Session, order: RestaurantOrder) -> int:
    phone = (order.customer_phone or "").strip()
    if not phone:
        return 0
    customer = db.query(Customer).filter(Customer.phone == phone).first()
    if customer is None:
        return 0
    existing = (
        db.query(LoyaltyTransaction)
        .filter(
            LoyaltyTransaction.customer_id == customer.id,
            LoyaltyTransaction.order_id == order.id,
            LoyaltyTransaction.transaction_type == "earn",
        )
        .first()
    )
    if existing is not None:
        return 0

    points = max(int(float(order.total_amount or 0)), 0)
    if points <= 0:
        return 0
    account = get_or_create_account(db, customer)
    account.points_balance += points
    account.lifetime_points += points
    db.add(
        LoyaltyTransaction(
            customer_id=customer.id,
            points=points,
            transaction_type="earn",
            order_id=order.id,
            note=f"Order #{order.id}",
        )
    )
    db.commit()
    return points


def loyalty_summary(db: Session, customer: Customer) -> dict:
    account = get_or_create_account(db, customer)
    db.commit()
    db.refresh(account)

    tier, next_tier, progress, points_to_next = tier_for(account.lifetime_points)
    transactions = (
        db.query(LoyaltyTransaction)
        .filter(LoyaltyTransaction.customer_id == customer.id)
        .order_by(LoyaltyTransaction.created_at.desc(), LoyaltyTransaction.id.desc())
        .limit(10)
        .all()
    )
    referrals = (
        db.query(LoyaltyAccount)
        .filter(LoyaltyAccount.referred_by_customer_id == customer.id)
        .count()
    )
    return {
        "points_balance": int(account.points_balance or 0),
        "lifetime_points": int(account.lifetime_points or 0),
        "tier": tier,
        "next_tier": next_tier,
        "tier_progress_percent": progress,
        "points_to_next_tier": points_to_next,
        "referral_code": account.referral_code,
        "referral_bonus_points": REFERRAL_BONUS_POINTS,
        "referrals_made": referrals,
        "transactions": [
            {
                "points": row.points,
                "type": row.transaction_type,
                "note": row.note,
                "created_at": row.created_at.isoformat() if row.created_at else None,
            }
            for row in transactions
        ],
    }
