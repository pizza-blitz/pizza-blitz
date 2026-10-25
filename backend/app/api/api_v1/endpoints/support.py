from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.api.deps import get_db, require_roles
from app.core.rate_limit import enforce_rate_limit
from app.services.support_service import (
    add_message,
    create_ticket,
    find_by_token,
    get_sla_policies,
    list_tickets,
    public_payload,
    serialize_sla_policy,
    serialize_ticket,
    support_summary,
    update_sla_policy,
    update_ticket,
)

router = APIRouter()


class TicketCreate(BaseModel):
    customer_name: str = Field(min_length=2, max_length=160)
    email: str = Field(default="", max_length=200)
    phone: str = Field(default="", max_length=30)
    subject: str = Field(min_length=3, max_length=200)
    message: str = Field(min_length=5, max_length=5000)
    category: str = Field(default="other", max_length=40)
    priority: str = Field(default="normal", max_length=20)
    order_id: Optional[int] = Field(default=None, ge=1)


class TicketMessage(BaseModel):
    body: str = Field(min_length=2, max_length=5000)
    internal: bool = False


class TicketUpdate(BaseModel):
    status: Optional[str] = Field(default=None, max_length=20)
    priority: Optional[str] = Field(default=None, max_length=20)
    category: Optional[str] = Field(default=None, max_length=40)
    assigned_to: Optional[str] = Field(default=None, max_length=120)


class SlaPolicyUpdate(BaseModel):
    response_minutes: int = Field(ge=5, le=10080)
    resolution_minutes: int = Field(ge=5, le=10080)


def _ticket_or_404(db: Session, ticket_id: int):
    from app.models.domain import SupportTicket

    row = db.query(SupportTicket).filter(SupportTicket.id == ticket_id).first()
    if row is None:
        raise HTTPException(status_code=404, detail="Support ticket not found.")
    return row


def _public_or_404(db: Session, token: str):
    row = find_by_token(db, token)
    if row is None:
        raise HTTPException(status_code=404, detail="Support ticket not found.")
    return row


@router.post("/tickets", status_code=201)
def public_create_ticket(
    payload: TicketCreate,
    request: Request,
    db: Session = Depends(get_db),
):
    enforce_rate_limit(request, "support-ticket", 10)
    try:
        ticket = create_ticket(
            db,
            customer_name=payload.customer_name,
            email=payload.email,
            phone=payload.phone,
            subject=payload.subject,
            message=payload.message,
            category=payload.category,
            priority=payload.priority,
            order_id=payload.order_id,
        )
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    return ticket


@router.get("/ticket/{token}")
def public_ticket(token: str, db: Session = Depends(get_db)):
    return {"ticket": public_payload(_public_or_404(db, token))}


@router.post("/ticket/{token}/reply")
def public_ticket_reply(
    token: str,
    payload: TicketMessage,
    request: Request,
    db: Session = Depends(get_db),
):
    enforce_rate_limit(request, "support-ticket-reply", 20)
    row = _public_or_404(db, token)
    if row.status == "closed":
        raise HTTPException(status_code=409, detail="This ticket is closed.")
    try:
        add_message(
            db,
            row,
            author_type="customer",
            author_name=row.customer_name,
            body=payload.body,
        )
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    return {"ticket": public_payload(row)}


@router.get("/sla-policy")
def support_sla_policy(
    db: Session = Depends(get_db),
    _: dict = Depends(require_roles("admin", "staff")),
):
    policies = get_sla_policies(db)
    return {
        "policies": [
            serialize_sla_policy(policies[priority])
            for priority in ("urgent", "high", "normal", "low")
        ]
    }


@router.put("/sla-policy/{priority}")
def support_sla_policy_update(
    priority: str,
    payload: SlaPolicyUpdate,
    db: Session = Depends(get_db),
    _: dict = Depends(require_roles("admin")),
):
    try:
        return {
            "policy": update_sla_policy(
                db,
                priority,
                response_minutes=payload.response_minutes,
                resolution_minutes=payload.resolution_minutes,
            )
        }
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


@router.get("/tickets")
def support_tickets(
    status: str = Query(default="", max_length=20),
    q: str = Query(default="", max_length=120),
    limit: int = Query(default=100, ge=1, le=200),
    db: Session = Depends(get_db),
    _: dict = Depends(require_roles("admin", "staff")),
):
    try:
        return {"tickets": list_tickets(db, status=status, query=q, limit=limit)}
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


@router.get("/summary")
def support_ticket_summary(
    db: Session = Depends(get_db),
    _: dict = Depends(require_roles("admin", "staff")),
):
    return support_summary(db)


@router.get("/tickets/{ticket_id}")
def support_ticket_detail(
    ticket_id: int,
    db: Session = Depends(get_db),
    _: dict = Depends(require_roles("admin", "staff")),
):
    row = _ticket_or_404(db, ticket_id)
    return {"ticket": serialize_ticket(row, detail=True, include_internal=True)}


@router.post("/tickets/{ticket_id}/reply")
def support_ticket_reply(
    ticket_id: int,
    payload: TicketMessage,
    db: Session = Depends(get_db),
    session: dict = Depends(require_roles("admin", "staff")),
):
    row = _ticket_or_404(db, ticket_id)
    try:
        add_message(
            db,
            row,
            author_type="staff",
            author_name=str(session.get("subject") or "staff"),
            body=payload.body,
            internal=payload.internal,
        )
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    return {"ticket": serialize_ticket(row, detail=True, include_internal=True)}


@router.patch("/tickets/{ticket_id}")
def support_ticket_update(
    ticket_id: int,
    payload: TicketUpdate,
    db: Session = Depends(get_db),
    _: dict = Depends(require_roles("admin", "staff")),
):
    row = _ticket_or_404(db, ticket_id)
    try:
        update_ticket(
            db,
            row,
            status=payload.status,
            priority=payload.priority,
            category=payload.category,
            assigned_to=payload.assigned_to,
        )
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    return {"ticket": serialize_ticket(row, detail=True, include_internal=True)}
