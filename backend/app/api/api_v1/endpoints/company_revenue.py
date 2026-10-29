"""Gift card API: public balance check plus issued-card management."""

import secrets
from datetime import date, datetime
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy import func, or_
from sqlalchemy.orm import Session

from app.api.deps import get_db, require_department_permission
from app.core.clock import business_today
from app.models.domain import GiftCard, GiftCardTransaction

router = APIRouter()
public_router = APIRouter()

CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
CODE_ATTEMPTS = 10


class GiftCardCreate(BaseModel):
    initial_balance: float = Field(ge=1, le=100000)
    customer_phone: Optional[str] = Field(default=None, max_length=30)
    note: Optional[str] = Field(default=None, max_length=500)
    expires_on: Optional[date] = None


class GiftCardReload(BaseModel):
    amount: float = Field(ge=1, le=100000)
    note: Optional[str] = Field(default=None, max_length=500)


class GiftCardVoid(BaseModel):
    note: Optional[str] = Field(default=None, max_length=500)


class GiftCardRedeem(BaseModel):
    amount: float = Field(gt=0, le=100000)
    order_id: Optional[int] = None
    note: Optional[str] = Field(default=None, max_length=500)


staff_access = require_department_permission(
    "revenue",
    "revenue.loyalty",
    "revenue.view",
)


def _round(value: float) -> float:
    return round(float(value or 0), 2)


def _iso(value) -> Optional[str]:
    return value.isoformat() if value is not None else None


def _generate_code(db: Session) -> str:
    for _ in range(CODE_ATTEMPTS):
        code = "PB-" + "".join(
            secrets.choice(CODE_ALPHABET) for _ in range(8)
        )
        exists = db.query(GiftCard.id).filter(GiftCard.code == code).first()
        if exists is None:
            return code
    raise HTTPException(
        status_code=503,
        detail="Could not allocate a gift card code. Please try again.",
    )


def _effective_status(card: GiftCard) -> str:
    today = business_today()
    if card.expires_on is not None and card.expires_on < today:
        if card.status == "active":
            return "expired"
    return card.status


def _serialize_card(card: GiftCard) -> dict:
    return {
        "id": card.id,
        "code": card.code,
        "initial_balance": _round(card.initial_balance),
        "balance": _round(card.balance),
        "currency": card.currency,
        "status": _effective_status(card),
        "stored_status": card.status,
        "customer_phone": card.customer_phone,
        "note": card.note,
        "issued_by": card.issued_by,
        "issued_at": _iso(card.issued_at),
        "expires_on": _iso(card.expires_on),
        "created_at": _iso(card.created_at),
    }


def _serialize_transaction(txn: GiftCardTransaction) -> dict:
    return {
        "id": txn.id,
        "gift_card_id": txn.gift_card_id,
        "order_id": txn.order_id,
        "kind": txn.kind,
        "amount": _round(txn.amount),
        "balance_after": _round(txn.balance_after),
        "reference": txn.reference,
        "note": txn.note,
        "created_by": txn.created_by,
        "created_at": _iso(txn.created_at),
    }


def _month_start() -> datetime:
    today = business_today()
    return datetime(today.year, today.month, 1)


def _summary(db: Session) -> dict:
    cards = db.query(GiftCard).all()
    active_cards = [card for card in cards if _effective_status(card) == "active"]
    expired_cards = [
        card for card in cards if _effective_status(card) == "expired"
    ]
    month_start = _month_start()
    issued_value = (
        db.query(func.coalesce(func.sum(GiftCardTransaction.amount), 0.0))
        .filter(
            GiftCardTransaction.kind == "issue",
            GiftCardTransaction.created_at >= month_start,
        )
        .scalar()
    )
    redeemed_value = (
        db.query(func.coalesce(func.sum(func.abs(GiftCardTransaction.amount)), 0.0))
        .filter(
            GiftCardTransaction.kind == "redeem",
            GiftCardTransaction.created_at >= month_start,
        )
        .scalar()
    )
    return {
        "active_cards": len(active_cards),
        "outstanding_balance": _round(
            sum(float(card.balance or 0) for card in active_cards)
        ),
        "issued_value_this_month": _round(issued_value),
        "redeemed_this_month": _round(redeemed_value),
        "expired_cards": len(expired_cards),
    }


def _card_or_404(db: Session, card_id: int) -> GiftCard:
    card = db.get(GiftCard, card_id)
    if card is None:
        raise HTTPException(status_code=404, detail="Gift card not found.")
    return card


def _actor(session: dict) -> str:
    return (
        str(session.get("display_name") or "").strip()
        or str(session.get("subject") or "").strip()
        or "staff"
    )


def _record(
    db: Session,
    card: GiftCard,
    *,
    kind: str,
    amount: float,
    note: Optional[str],
    actor: str,
    order_id: Optional[int] = None,
) -> GiftCardTransaction:
    txn = GiftCardTransaction(
        gift_card_id=card.id,
        order_id=order_id,
        kind=kind,
        amount=_round(amount),
        balance_after=_round(card.balance),
        note=note,
        created_by=actor,
    )
    db.add(txn)
    return txn


@public_router.get("/validate/{code}")
def validate_gift_card(code: str, db: Session = Depends(get_db)):
    normalized = (code or "").strip().upper()
    card = (
        db.query(GiftCard)
        .filter(GiftCard.code == normalized)
        .first()
    )
    if card is None:
        return {
            "valid": False,
            "code": normalized,
            "balance": 0.0,
            "status": "unknown",
            "expires_on": None,
            "message": "Gift card not found. Check the code and try again.",
        }
    status = _effective_status(card)
    balance = _round(card.balance)
    if status == "void":
        return {
            "valid": False,
            "code": card.code,
            "balance": balance,
            "status": status,
            "expires_on": _iso(card.expires_on),
            "message": "This gift card has been voided and cannot be used.",
        }
    if status == "expired":
        return {
            "valid": False,
            "code": card.code,
            "balance": balance,
            "status": status,
            "expires_on": _iso(card.expires_on),
            "message": "This gift card has expired and cannot be used.",
        }
    message = "Gift card is ready to use."
    if balance <= 0:
        message = "This gift card has no balance remaining."
    return {
        "valid": status == "active",
        "code": card.code,
        "balance": balance,
        "status": status,
        "expires_on": _iso(card.expires_on),
        "message": message,
    }


@router.get("")
def list_gift_cards(
    status: Optional[str] = None,
    query: Optional[str] = None,
    limit: int = Query(default=100, ge=1, le=500),
    db: Session = Depends(get_db),
    session: dict = Depends(staff_access),
):
    del session
    rows = db.query(GiftCard)
    if query:
        needle = f"%{query.strip()}%"
        rows = rows.filter(
            or_(
                GiftCard.code.ilike(needle),
                GiftCard.customer_phone.ilike(needle),
            )
        )
    rows = rows.order_by(GiftCard.created_at.desc(), GiftCard.id.desc()).all()
    cards = [_serialize_card(card) for card in rows]
    if status:
        wanted = status.strip().lower()
        cards = [card for card in cards if card["status"] == wanted]
    return {"items": cards[:limit], "summary": _summary(db)}


@router.post("", status_code=201)
def create_gift_card(
    payload: GiftCardCreate,
    db: Session = Depends(get_db),
    session: dict = Depends(staff_access),
):
    actor = _actor(session)
    code = _generate_code(db)
    card = GiftCard(
        code=code,
        initial_balance=_round(payload.initial_balance),
        balance=_round(payload.initial_balance),
        status="active",
        customer_phone=payload.customer_phone,
        note=payload.note,
        issued_by=actor,
        expires_on=payload.expires_on,
    )
    db.add(card)
    db.flush()
    _record(
        db,
        card,
        kind="issue",
        amount=payload.initial_balance,
        note="Gift card issued.",
        actor=actor,
    )
    db.commit()
    db.refresh(card)
    return _serialize_card(card)


@router.get("/summary")
def gift_card_summary(
    db: Session = Depends(get_db),
    session: dict = Depends(staff_access),
):
    del session
    return _summary(db)


@router.get("/{card_id}")
def get_gift_card(
    card_id: int,
    db: Session = Depends(get_db),
    session: dict = Depends(staff_access),
):
    del session
    card = _card_or_404(db, card_id)
    transactions = (
        db.query(GiftCardTransaction)
        .filter(GiftCardTransaction.gift_card_id == card.id)
        .order_by(
            GiftCardTransaction.created_at.desc(),
            GiftCardTransaction.id.desc(),
        )
        .all()
    )
    return {
        "card": _serialize_card(card),
        "transactions": [
            _serialize_transaction(txn) for txn in transactions
        ],
    }


@router.post("/{card_id}/reload")
def reload_gift_card(
    card_id: int,
    payload: GiftCardReload,
    db: Session = Depends(get_db),
    session: dict = Depends(staff_access),
):
    card = _card_or_404(db, card_id)
    status = _effective_status(card)
    if status in {"void", "expired"}:
        raise HTTPException(
            status_code=422,
            detail=f"This gift card is {status} and cannot be reloaded.",
        )
    actor = _actor(session)
    card.balance = _round(float(card.balance or 0) + payload.amount)
    card.status = "active"
    _record(
        db,
        card,
        kind="reload",
        amount=payload.amount,
        note=payload.note,
        actor=actor,
    )
    db.commit()
    db.refresh(card)
    return {"card": _serialize_card(card)}


@router.post("/{card_id}/void")
def void_gift_card(
    card_id: int,
    payload: GiftCardVoid,
    db: Session = Depends(get_db),
    session: dict = Depends(staff_access),
):
    card = _card_or_404(db, card_id)
    actor = _actor(session)
    note = payload.note or "Gift card voided."
    card.status = "void"
    _record(
        db,
        card,
        kind="adjust",
        amount=0,
        note=note,
        actor=actor,
    )
    db.commit()
    db.refresh(card)
    return {"card": _serialize_card(card)}


@router.post("/{card_id}/redeem")
def redeem_gift_card(
    card_id: int,
    payload: GiftCardRedeem,
    db: Session = Depends(get_db),
    session: dict = Depends(staff_access),
):
    card = _card_or_404(db, card_id)
    status = _effective_status(card)
    if status != "active":
        raise HTTPException(
            status_code=422,
            detail=f"This gift card is {status} and cannot be redeemed.",
        )
    balance = float(card.balance or 0)
    if balance < payload.amount:
        raise HTTPException(
            status_code=422,
            detail="The gift card balance is lower than the requested amount.",
        )
    actor = _actor(session)
    card.balance = _round(balance - payload.amount)
    if card.balance <= 0:
        card.status = "depleted"
    _record(
        db,
        card,
        kind="redeem",
        amount=-payload.amount,
        note=payload.note,
        actor=actor,
        order_id=payload.order_id,
    )
    db.commit()
    db.refresh(card)
    return {"card": _serialize_card(card)}
