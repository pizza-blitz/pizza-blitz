import secrets

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.api.deps import get_db, require_roles
from app.core.config import settings
from app.services.campaign_dispatch_service import send_campaign_message
from app.services.messaging_service import (
    CHANNELS,
    add_message,
    create_template,
    find_or_create_thread,
    get_thread,
    inbound_payload,
    list_templates,
    list_threads,
    mark_read,
    serialize_message,
    serialize_thread,
    update_thread,
)

router = APIRouter()


class ThreadCreate(BaseModel):
    channel: str = Field(min_length=2, max_length=30)
    destination: str = Field(min_length=2, max_length=255)
    contact_name: str = Field(default="", max_length=160)
    body: str = Field(default="", max_length=8000)
    subject: str = Field(default="", max_length=255)


class ThreadMessageCreate(BaseModel):
    body: str = Field(min_length=1, max_length=8000)
    subject: str = Field(default="", max_length=255)


class ThreadUpdate(BaseModel):
    status: str | None = None
    assigned_to: str | None = None


class TemplateCreate(BaseModel):
    name: str = Field(min_length=2, max_length=140)
    channel: str = Field(min_length=2, max_length=30)
    body: str = Field(min_length=1, max_length=8000)
    subject: str = Field(default="", max_length=255)
    category: str = Field(default="marketing", max_length=40)
    status: str = Field(default="draft", max_length=20)


def _require_webhook_token(request: Request) -> None:
    configured = (settings.MESSAGING_WEBHOOK_TOKEN or "").strip()
    if not configured:
        raise HTTPException(
            status_code=503,
            detail="Messaging webhook is not configured. Set MESSAGING_WEBHOOK_TOKEN.",
        )
    supplied = (
        request.query_params.get("token")
        or request.headers.get("x-webhook-token")
        or ""
    ).strip()
    if not supplied or not secrets.compare_digest(supplied, configured):
        raise HTTPException(status_code=401, detail="Invalid messaging webhook token.")


def _deliver(
    db: Session,
    *,
    thread,
    body: str,
    subject: str,
    actor: str,
) -> dict:
    result = send_campaign_message(
        channel=thread.channel,
        destination=thread.destination,
        message=body,
        subject=subject or "Message from Pizza Blitz",
    )
    status = "sent" if result.status in {"sent", "dry_run"} else "failed"
    row = add_message(
        db,
        thread,
        direction="outbound",
        body=body,
        subject=subject,
        status=status,
        provider=result.provider,
        external_id=result.external_id or "",
        error=result.error or "",
        actor=actor,
    )
    db.commit()
    db.refresh(row)
    return {
        "message": serialize_message(row),
        "delivery_status": result.status,
        "error": result.error,
        "thread": serialize_thread(thread),
    }


@router.get("/threads")
def threads(
    status: str | None = None,
    channel: str | None = None,
    search: str = "",
    limit: int = Query(default=100, ge=1, le=200),
    db: Session = Depends(get_db),
    _: dict = Depends(require_roles("admin")),
):
    if channel and channel.lower() not in CHANNELS:
        raise HTTPException(status_code=422, detail="Unsupported messaging channel.")
    return {
        "threads": list_threads(
            db,
            status=status,
            channel=channel.lower() if channel else None,
            search=search,
            limit=limit,
        )
    }


@router.post("/threads", status_code=201)
def create_thread(
    payload: ThreadCreate,
    db: Session = Depends(get_db),
    session: dict = Depends(require_roles("admin")),
):
    channel = payload.channel.lower()
    if channel not in CHANNELS:
        raise HTTPException(status_code=422, detail="Unsupported messaging channel.")
    try:
        thread = find_or_create_thread(
            db,
            channel=channel,
            destination=payload.destination,
            contact_name=payload.contact_name,
        )
        db.commit()
        db.refresh(thread)
        result = None
        if payload.body.strip():
            result = _deliver(
                db,
                thread=thread,
                body=payload.body,
                subject=payload.subject,
                actor=str(session.get("subject") or ""),
            )
    except ValueError as exc:
        db.rollback()
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    return {
        "thread": serialize_thread(thread),
        "messages": [serialize_message(row) for row in thread.messages],
        "delivery": result,
    }


@router.get("/threads/{thread_id}")
def thread_detail(
    thread_id: int,
    db: Session = Depends(get_db),
    _: dict = Depends(require_roles("admin")),
):
    thread = get_thread(db, thread_id)
    if thread is None:
        raise HTTPException(status_code=404, detail="Thread not found.")
    return {
        "thread": serialize_thread(thread),
        "messages": [
            serialize_message(row)
            for row in sorted(thread.messages, key=lambda item: item.created_at)
        ],
    }


@router.post("/threads/{thread_id}/messages")
def reply_to_thread(
    thread_id: int,
    payload: ThreadMessageCreate,
    db: Session = Depends(get_db),
    session: dict = Depends(require_roles("admin")),
):
    thread = get_thread(db, thread_id)
    if thread is None:
        raise HTTPException(status_code=404, detail="Thread not found.")
    try:
        result = _deliver(
            db,
            thread=thread,
            body=payload.body,
            subject=payload.subject,
            actor=str(session.get("subject") or ""),
        )
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    return result


@router.patch("/threads/{thread_id}")
def update_thread_endpoint(
    thread_id: int,
    payload: ThreadUpdate,
    db: Session = Depends(get_db),
    _: dict = Depends(require_roles("admin")),
):
    thread = get_thread(db, thread_id)
    if thread is None:
        raise HTTPException(status_code=404, detail="Thread not found.")
    try:
        return {"thread": update_thread(
            db,
            thread,
            status=payload.status,
            assigned_to=payload.assigned_to,
        )}
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


@router.post("/threads/{thread_id}/read")
def read_thread(
    thread_id: int,
    db: Session = Depends(get_db),
    _: dict = Depends(require_roles("admin")),
):
    thread = get_thread(db, thread_id)
    if thread is None:
        raise HTTPException(status_code=404, detail="Thread not found.")
    mark_read(db, thread)
    return {"thread": serialize_thread(thread)}


@router.get("/templates")
def templates(
    channel: str | None = None,
    db: Session = Depends(get_db),
    _: dict = Depends(require_roles("admin")),
):
    return {"templates": list_templates(db, channel)}


@router.get("/readiness")
def messaging_readiness(
    _: dict = Depends(require_roles("admin")),
):
    from app.services.campaign_dispatch_service import campaign_provider_status

    return {
        "channels": {
            channel: campaign_provider_status(channel)
            for channel in ("whatsapp", "sms", "email")
        },
        "webhook_configured": bool((settings.MESSAGING_WEBHOOK_TOKEN or "").strip()),
    }


@router.post("/templates", status_code=201)
def save_template(
    payload: TemplateCreate,
    db: Session = Depends(get_db),
    _: dict = Depends(require_roles("admin")),
):
    try:
        return {"template": create_template(
            db,
            name=payload.name,
            channel=payload.channel,
            body=payload.body,
            subject=payload.subject,
            category=payload.category,
            status=payload.status,
        )}
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


@router.get("/webhook/{channel}")
def verify_webhook(
    channel: str,
    request: Request,
):
    _require_webhook_token(request)
    if channel.lower() not in CHANNELS:
        raise HTTPException(status_code=404, detail="Unsupported messaging channel.")
    mode = request.query_params.get("hub.mode")
    challenge = request.query_params.get("hub.challenge")
    if mode == "subscribe" and challenge is not None:
        return int(challenge) if challenge.isdigit() else challenge
    return {"ok": True, "channel": channel}


@router.post("/webhook/{channel}")
async def inbound_webhook(
    channel: str,
    request: Request,
    db: Session = Depends(get_db),
):
    _require_webhook_token(request)
    channel = channel.lower()
    if channel not in CHANNELS:
        raise HTTPException(status_code=404, detail="Unsupported messaging channel.")
    content_type = request.headers.get("content-type", "")
    if "application/json" in content_type:
        payload = await request.json()
    else:
        payload = dict(await request.form())
    if not isinstance(payload, dict):
        raise HTTPException(status_code=422, detail="A JSON object or form is required.")
    normalized = inbound_payload(channel, payload)
    try:
        thread = find_or_create_thread(
            db,
            channel=channel,
            destination=normalized["destination"],
            contact_name=normalized["name"],
        )
        row = add_message(
            db,
            thread,
            direction="inbound",
            body=normalized["body"],
            subject=normalized["subject"],
            status="received",
            external_id=normalized["external_id"],
        )
        db.commit()
        db.refresh(row)
    except ValueError as exc:
        db.rollback()
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    return {
        "ok": True,
        "thread_id": thread.id,
        "message": serialize_message(row),
    }
