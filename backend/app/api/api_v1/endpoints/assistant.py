"""Public conversational ordering assistant endpoints.

The chat itself works for anonymous visitors. Memory is different: it is only
read or written for a caller who has proved the phone number, using the same
rule as order history — a matching customer session or a real order id. A
phone number typed into a box is not proof of anything.
"""

from datetime import datetime, timedelta
from typing import Literal, Optional
from urllib.parse import quote

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.api.api_v1.endpoints.orders import (
    authorize_customer_history_access,
    serialize_order_tracking,
)
from app.api.deps import (
    customer_subject_phone,
    get_db,
    get_optional_session,
)
from app.core.rate_limit import enforce_rate_limit
from app.models.domain import RestaurantOrder
from app.services.assistant_service import (
    MAX_MESSAGE_LENGTH,
    assistant_chat,
    assistant_config,
)
from app.services.customer_memory_service import (
    apply_latest_order,
    get_memory,
    remember_from_turn,
    serialize_memory,
    upsert_memory,
)
from app.services.customer_otp_service import OtpError, normalize_phone

router = APIRouter()


class AssistantCartLine(BaseModel):
    menu_item_id: int
    quantity: int = Field(default=1, ge=1, le=20)
    selected_options: list[dict] = Field(default_factory=list)


class AssistantTurn(BaseModel):
    role: Literal["user", "assistant"]
    content: str = Field(default="", max_length=800)


class AssistantChatRequest(BaseModel):
    message: str = Field(default="", max_length=MAX_MESSAGE_LENGTH)
    cart: list[AssistantCartLine] = Field(default_factory=list, max_length=30)
    fulfillment: Literal["pickup", "delivery"] = "pickup"
    coupon_code: Optional[str] = Field(default=None, max_length=50)
    history: list[AssistantTurn] = Field(default_factory=list, max_length=10)
    # Optional proof for callers that do not hold a customer session, such as a
    # native app. Ignored unless it matches a real order for that phone.
    phone: Optional[str] = Field(default=None, max_length=30)
    order_id: Optional[int] = None
    display_name: Optional[str] = Field(default=None, max_length=255)


class AssistantMemoryUpdate(BaseModel):
    phone: Optional[str] = Field(default=None, max_length=30)
    order_id: Optional[int] = None
    display_name: Optional[str] = Field(default=None, max_length=255)
    allergies: Optional[list[str]] = Field(default=None, max_length=20)
    dietary_preferences: Optional[list[str]] = Field(default=None, max_length=20)
    usual_fulfillment: Optional[Literal["pickup", "delivery"]] = None
    consent_granted: bool = True


def _verified_phone(
    db: Session,
    session: dict | None,
    phone: str | None,
    order_id: int | None,
    *,
    required: bool,
) -> str | None:
    """Return the proved phone number, or None when the caller stays anonymous.

    ``required`` is used by the memory endpoints, where silently ignoring an
    unproved phone would look like a successful save. The chat uses the
    non-required form so an anonymous visitor is never blocked from ordering.
    """
    candidate = (phone or "").strip()
    if not candidate and session is not None and session.get("role") == "customer":
        candidate = str(session.get("phone") or customer_subject_phone(session) or "").strip()
    if not candidate:
        if required:
            raise HTTPException(
                status_code=401,
                detail=(
                    "Sign in with a verified phone number or provide the phone and "
                    "a recent order id to use saved preferences."
                ),
            )
        return None
    try:
        normalized = normalize_phone(candidate)
    except OtpError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    try:
        authorize_customer_history_access(session, normalized, order_id, db)
    except HTTPException:
        if required:
            raise
        return None
    return normalized


ACTIVE_ORDER_HOURS = 24


def _active_order_summary(db: Session, phone: str) -> dict | None:
    """The guest's newest live order, for a caller who already proved the phone.

    Only facts the concierge may say out loud: the order id, its guest-facing
    state and timing, and a link back to the same tracking page the guest would
    open by hand. Items, address, and spend stay out of chat. An order only
    counts as live for a day, because a row left open for longer is a store-side
    problem, not a promise the guest should be told.
    """
    cutoff = datetime.utcnow() - timedelta(hours=ACTIVE_ORDER_HOURS)
    orders = (
        db.query(RestaurantOrder)
        .filter(
            RestaurantOrder.customer_phone == phone,
            RestaurantOrder.created_at >= cutoff,
        )
        .order_by(RestaurantOrder.created_at.desc(), RestaurantOrder.id.desc())
        .limit(5)
        .all()
    )
    for order in orders:
        if (order.status or "").lower() in {"closed", "cancelled"}:
            continue
        assignment = order.delivery_assignment
        if assignment is not None and (assignment.status or "").lower() == "delivered":
            continue
        tracking = serialize_order_tracking(order)
        return {
            "id": order.id,
            "order_type": order.order_type,
            "status": order.status,
            "next_action": tracking.get("next_action") or "",
            "eta_window": tracking.get("eta_window") or "",
            "eta_at": tracking.get("eta_at"),
            "rider": (tracking.get("rider") or {}).get("assigned_to"),
            "tracking_href": f"/track?order={order.id}&phone={quote(phone, safe='')}",
        }
    return None


REPEAT_ORDER_DAYS = 90
MAX_REPEAT_LINES = 10


def _repeatable_order(db: Session, phone: str) -> dict | None:
    """The guest's newest real order, for a caller who already proved the phone.

    Only what is needed to rebuild a cart: the order id, how it was fulfilled,
    and the item ids, quantities and customisations the guest chose. Prices are
    deliberately not copied — the concierge re-prices every line against the
    live menu, so a repeat can never bring back an old price or a hidden item.
    Cancelled orders and orders older than 90 days are not offered.
    """
    cutoff = datetime.utcnow() - timedelta(days=REPEAT_ORDER_DAYS)
    orders = (
        db.query(RestaurantOrder)
        .filter(
            RestaurantOrder.customer_phone == phone,
            RestaurantOrder.created_at >= cutoff,
        )
        .order_by(RestaurantOrder.created_at.desc(), RestaurantOrder.id.desc())
        .limit(5)
        .all()
    )
    for order in orders:
        if (order.status or "").lower() == "cancelled":
            continue
        items: list[dict] = []
        for item in order.items or []:
            if not isinstance(item, dict):
                continue
            name = " ".join(str(item.get("name") or "").split())
            try:
                quantity = int(item.get("quantity") or 0)
                menu_item_id = int(item.get("menu_item_id") or 0)
            except (TypeError, ValueError):
                continue
            if not name or quantity <= 0:
                continue
            options = item.get("selected_options")
            if not isinstance(options, list):
                options = []
            items.append(
                {
                    "menu_item_id": menu_item_id,
                    "name": name,
                    "quantity": min(quantity, 20),
                    "selected_options": options,
                }
            )
            if len(items) >= MAX_REPEAT_LINES:
                break
        if not items:
            continue
        return {
            "id": order.id,
            "order_type": (order.order_type or "").strip().lower(),
            "items": items,
        }
    return None


@router.get("/config")
def get_assistant_config(db: Session = Depends(get_db)):
    return assistant_config(db)


@router.get("/memory")
def get_assistant_memory(
    request: Request,
    phone: Optional[str] = None,
    order_id: Optional[int] = None,
    session: dict | None = Depends(get_optional_session),
    db: Session = Depends(get_db),
):
    enforce_rate_limit(request, "assistant-memory", 60)
    verified = _verified_phone(db, session, phone, order_id, required=True)
    return {
        "phone": verified,
        "memory": apply_latest_order(
            db, verified, serialize_memory(get_memory(db, verified))
        ),
    }


@router.put("/memory")
def put_assistant_memory(
    payload: AssistantMemoryUpdate,
    request: Request,
    session: dict | None = Depends(get_optional_session),
    db: Session = Depends(get_db),
):
    enforce_rate_limit(request, "assistant-memory-write", 30)
    verified = _verified_phone(
        db, session, payload.phone, payload.order_id, required=True
    )
    memory = upsert_memory(
        db,
        verified,
        display_name=payload.display_name,
        allergies=payload.allergies,
        dietary_preferences=payload.dietary_preferences,
        usual_fulfillment=payload.usual_fulfillment,
        consent_granted=payload.consent_granted,
    )
    return {
        "phone": verified,
        "memory": apply_latest_order(db, verified, memory),
        "forgotten": not payload.consent_granted,
    }


@router.delete("/memory")
def delete_assistant_memory(
    request: Request,
    phone: Optional[str] = None,
    order_id: Optional[int] = None,
    session: dict | None = Depends(get_optional_session),
    db: Session = Depends(get_db),
):
    enforce_rate_limit(request, "assistant-memory-write", 30)
    verified = _verified_phone(db, session, phone, order_id, required=True)
    upsert_memory(db, verified, consent_granted=False)
    return {"phone": verified, "forgotten": True}


@router.post("/chat")
def post_assistant_chat(
    payload: AssistantChatRequest,
    request: Request,
    session: dict | None = Depends(get_optional_session),
    db: Session = Depends(get_db),
):
    enforce_rate_limit(request, "assistant-chat", 60)
    verified = _verified_phone(
        db, session, payload.phone, payload.order_id, required=False
    )
    active_order = _active_order_summary(db, verified) if verified else None
    repeat_order = _repeatable_order(db, verified) if verified else None
    memory = None
    changed: list[str] = []
    if verified:
        session_name = ""
        if session is not None and session.get("role") == "customer":
            session_name = str(session.get("display_name") or "").strip()
        remembered = remember_from_turn(
            db,
            verified,
            payload.message,
            display_name=payload.display_name or session_name or None,
        )
        memory = apply_latest_order(db, verified, remembered["memory"])
        changed = remembered["changed"]

    result = assistant_chat(
        db,
        message=payload.message,
        cart=[line.model_dump() for line in payload.cart],
        fulfillment=payload.fulfillment,
        coupon_code=payload.coupon_code,
        history=[turn.model_dump() for turn in payload.history],
        memory=memory,
        memory_changed=changed,
        active_order=active_order,
        repeat_order=repeat_order,
        customer_verified=bool(verified),
    )
    result["memory_linked"] = bool(verified)
    return result
