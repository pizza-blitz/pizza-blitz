"""Loyalty points, tiers, and referral codes.

Points are earned when an order is closed (1 point per rupee of the order
total), and referral bonuses are applied on a customer's first order. The ledger
is idempotent per order and transaction type.
"""

import secrets
from datetime import datetime, timedelta

from sqlalchemy.orm import Session

from app.models.domain import (
    Customer,
    LoyaltyAccount,
    LoyaltyRedemption,
    LoyaltyTransaction,
    RestaurantOrder,
)

REFERRAL_BONUS_POINTS = 100
MIN_REDEEM_POINTS = 100
POINTS_PER_RUPEE = 10
REDEMPTION_TTL_MINUTES = 15
TIERS = [
    (0, "Slice Starter"),
    (300, "Regular"),
    (1000, "Gold Slice"),
    (2500, "VIP Slice Club"),
]


class ReferralError(ValueError):
    """The referral code cannot be used for this order."""


class RedemptionError(ValueError):
    """Points cannot be redeemed for this request or order."""


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


def _digits(value: str | None) -> str:
    return "".join(character for character in str(value or "") if character.isdigit())


def create_redemption(
    db: Session, customer: Customer, points: int
) -> LoyaltyRedemption:
    requested = int(points or 0)
    if requested < MIN_REDEEM_POINTS:
        raise RedemptionError(
            f"Redeem at least {MIN_REDEEM_POINTS} points."
        )
    if requested % POINTS_PER_RUPEE != 0:
        raise RedemptionError(
            f"Points must be a multiple of {POINTS_PER_RUPEE}."
        )
    account = get_or_create_account(db, customer)
    if int(account.points_balance or 0) < requested:
        raise RedemptionError("You do not have enough points for that reward.")

    redemption = LoyaltyRedemption(
        customer_id=customer.id,
        token="LR" + secrets.token_hex(10).upper(),
        points=requested,
        discount_amount=round(requested / POINTS_PER_RUPEE, 2),
        status="reserved",
        expires_at=datetime.utcnow() + timedelta(minutes=REDEMPTION_TTL_MINUTES),
    )
    db.add(redemption)
    db.commit()
    db.refresh(redemption)
    return redemption


def validate_redemption(
    db: Session, token: str, phone: str
) -> LoyaltyRedemption:
    redemption = (
        db.query(LoyaltyRedemption)
        .filter(LoyaltyRedemption.token == (token or "").strip())
        .first()
    )
    if redemption is None or redemption.status != "reserved":
        raise RedemptionError("That points reward is not available.")
    if redemption.expires_at < datetime.utcnow():
        raise RedemptionError("That points reward expired. Redeem points again.")
    customer = (
        db.query(Customer).filter(Customer.id == redemption.customer_id).first()
    )
    if customer is None or _digits(customer.phone) != _digits(phone):
        raise RedemptionError("That points reward belongs to another customer.")
    return redemption


def use_redemption(
    db: Session,
    redemption: LoyaltyRedemption,
    customer: Customer,
    order: RestaurantOrder,
) -> float:
    if redemption.status != "reserved":
        raise RedemptionError("That points reward was already used.")
    account = get_or_create_account(db, customer)
    if int(account.points_balance or 0) < int(redemption.points):
        raise RedemptionError("You no longer have enough points for this reward.")

    account.points_balance -= int(redemption.points)
    redemption.status = "used"
    redemption.order_id = order.id
    db.add(
        LoyaltyTransaction(
            customer_id=customer.id,
            points=-int(redemption.points),
            transaction_type="redeem",
            order_id=order.id,
            note=f"Redeemed {redemption.points} points for order #{order.id}",
        )
    )
    return round(float(redemption.discount_amount or 0), 2)


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
