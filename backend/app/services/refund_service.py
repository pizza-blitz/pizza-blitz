"""Order refund ledger.

Refunds are recorded against captured payments and tracked both on the order
(``refunded_amount``) and in the ``order_refunds`` ledger. Gateway money movement
is deliberately not faked: a gateway refund is recorded with its provider
reference and status, and the actual provider call remains an integration step.
"""

from sqlalchemy.orm import Session

from app.models.domain import OrderRefund, RestaurantOrder

REFUNDABLE_PAYMENT_STATUSES = {"paid", "partially_refunded", "refund_due"}
REFUND_METHODS = {"cash", "upi", "card", "gateway", "bank", "gift_card", "other"}


class RefundNotAllowed(ValueError):
    """The order is not in a state where money can be refunded."""


class RefundAmountError(ValueError):
    """The requested amount is invalid for this order."""


def refundable_amount(order: RestaurantOrder) -> float:
    total = float(order.total_amount or 0)
    refunded = float(order.refunded_amount or 0)
    return round(max(total - refunded, 0), 2)


def serialize_refund(refund: OrderRefund) -> dict:
    return {
        "id": refund.id,
        "order_id": refund.order_id,
        "amount": float(refund.amount or 0),
        "reason": refund.reason,
        "method": refund.method,
        "reference": refund.reference,
        "status": refund.status,
        "notes": refund.notes,
        "created_by": refund.created_by,
        "created_at": refund.created_at.isoformat() if refund.created_at else None,
    }


def refund_summary(order: RestaurantOrder) -> dict:
    return {
        "refunded_amount": round(float(order.refunded_amount or 0), 2),
        "refundable_amount": refundable_amount(order),
        "payment_status": order.payment_status,
    }


def create_order_refund(
    db: Session,
    order: RestaurantOrder,
    *,
    amount: float,
    reason: str,
    method: str = "cash",
    reference: str | None = None,
    notes: str | None = None,
    created_by: str | None = None,
) -> OrderRefund:
    status = (order.payment_status or "").lower()
    if status not in REFUNDABLE_PAYMENT_STATUSES:
        raise RefundNotAllowed(
            "This order has no captured payment to refund. Void it instead."
        )

    normalized_method = (method or "cash").strip().lower()
    if normalized_method not in REFUND_METHODS:
        raise RefundAmountError("Choose a supported refund method.")

    requested = round(float(amount or 0), 2)
    if requested <= 0:
        raise RefundAmountError("Refund amount must be greater than zero.")
    available = refundable_amount(order)
    if requested > available + 0.001:
        raise RefundAmountError(
            f"Refund exceeds the refundable amount of Rs {available:.2f}."
        )

    refund = OrderRefund(
        order_id=order.id,
        amount=requested,
        reason=reason.strip(),
        method=normalized_method,
        reference=(reference or "").strip() or None,
        status="recorded",
        notes=(notes or "").strip() or None,
        created_by=created_by,
    )
    db.add(refund)
    order.refunded_amount = round(float(order.refunded_amount or 0) + requested, 2)
    total = float(order.total_amount or 0)
    order.payment_status = (
        "refunded" if order.refunded_amount >= total - 0.01 else "partially_refunded"
    )
    db.commit()
    db.refresh(refund)
    db.refresh(order)
    return refund
