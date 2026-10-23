from typing import Optional
from urllib.parse import urlparse

from fastapi import APIRouter, Body, Depends, Header, HTTPException, Query, Request
from pydantic import BaseModel, Field
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.api.deps import get_db, require_roles
from app.models.domain import AggregatorIntegration, AggregatorOrder
from app.services.aggregator_service import (
    AggregatorError,
    PLATFORMS,
    create_integration,
    ensure_outbound_secret,
    ingest_order,
    integration_for_token,
    push_menu_sync,
    recent_aggregator_events,
    recent_aggregator_orders,
    rotate_token,
    serialize_integration,
)

router = APIRouter()


class AggregatorIntegrationCreate(BaseModel):
    platform: str = Field(min_length=2, max_length=30)
    store_id: int = 1
    display_name: Optional[str] = Field(default=None, max_length=120)


class AggregatorIntegrationUpdate(BaseModel):
    display_name: Optional[str] = Field(default=None, max_length=120)
    is_active: Optional[bool] = None
    auto_accept: Optional[bool] = None
    outbound_url: Optional[str] = Field(default=None, max_length=500)
    outbound_enabled: Optional[bool] = None
    menu_sync_url: Optional[str] = Field(default=None, max_length=500)
    menu_sync_enabled: Optional[bool] = None


def _integration_or_404(db: Session, integration_id: int) -> AggregatorIntegration:
    integration = (
        db.query(AggregatorIntegration)
        .filter(AggregatorIntegration.id == integration_id)
        .first()
    )
    if integration is None:
        raise HTTPException(status_code=404, detail="Aggregator integration not found.")
    return integration


def _with_webhook_url(data: dict, request: Request) -> dict:
    return {
        **data,
        "webhook_url": str(request.base_url).rstrip("/") + data["webhook_path"],
    }


@router.post("/webhook/{platform}")
def aggregator_webhook(
    platform: str,
    payload: dict = Body(...),
    token: Optional[str] = Query(default=None),
    x_aggregator_token: Optional[str] = Header(default=None),
    db: Session = Depends(get_db),
):
    supplied = (x_aggregator_token or token or "").strip()
    if not supplied:
        raise HTTPException(status_code=401, detail="Aggregator webhook token is required.")
    try:
        integration = integration_for_token(db, platform, supplied)
    except AggregatorError as exc:
        raise HTTPException(status_code=401, detail=str(exc)) from exc
    try:
        return ingest_order(db, integration, payload)
    except AggregatorError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


@router.get("/")
def list_aggregator_integrations(
    request: Request,
    db: Session = Depends(get_db),
    _: dict = Depends(require_roles("admin")),
):
    integrations = (
        db.query(AggregatorIntegration)
        .order_by(AggregatorIntegration.created_at.asc())
        .all()
    )
    result = []
    for integration in integrations:
        count = (
            db.query(func.count(AggregatorOrder.id))
            .filter(AggregatorOrder.integration_id == integration.id)
            .scalar()
            or 0
        )
        last = (
            db.query(func.max(AggregatorOrder.created_at))
            .filter(AggregatorOrder.integration_id == integration.id)
            .scalar()
        )
        result.append(
            {
                **_with_webhook_url(
                    serialize_integration(integration), request
                ),
                "orders_count": int(count),
                "last_order_at": last.isoformat() if last else None,
            }
        )
    return {
        "platforms": [
            {"key": key, "label": label} for key, label in sorted(PLATFORMS.items())
        ],
        "integrations": result,
    }


@router.post("/")
def connect_aggregator(
    payload: AggregatorIntegrationCreate,
    request: Request,
    db: Session = Depends(get_db),
    _: dict = Depends(require_roles("admin")),
):
    try:
        integration = create_integration(
            db,
            platform=payload.platform,
            store_id=payload.store_id,
            display_name=payload.display_name,
        )
    except AggregatorError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    return _with_webhook_url(serialize_integration(integration), request)


@router.patch("/{integration_id}")
def update_aggregator(
    integration_id: int,
    payload: AggregatorIntegrationUpdate,
    request: Request,
    db: Session = Depends(get_db),
    _: dict = Depends(require_roles("admin")),
):
    integration = _integration_or_404(db, integration_id)
    if payload.display_name is not None:
        integration.display_name = payload.display_name.strip()
    if payload.is_active is not None:
        integration.is_active = payload.is_active
    if payload.auto_accept is not None:
        integration.auto_accept = payload.auto_accept
    if payload.outbound_url is not None:
        url = payload.outbound_url.strip()
        if url:
            parsed = urlparse(url)
            if parsed.scheme not in {"http", "https"} or not parsed.netloc:
                raise HTTPException(
                    status_code=422,
                    detail="Outbound URL must be a full http(s) URL.",
                )
        integration.outbound_url = url or None
    if payload.outbound_enabled is not None:
        if payload.outbound_enabled and not integration.outbound_url:
            raise HTTPException(
                status_code=422,
                detail="Set an outbound URL before enabling status sync.",
            )
        integration.outbound_enabled = payload.outbound_enabled
        if payload.outbound_enabled:
            ensure_outbound_secret(integration)
    if payload.menu_sync_url is not None:
        menu_url = payload.menu_sync_url.strip()
        if menu_url:
            parsed = urlparse(menu_url)
            if parsed.scheme not in {"http", "https"} or not parsed.netloc:
                raise HTTPException(
                    status_code=422,
                    detail="Menu sync URL must be a full http(s) URL.",
                )
        integration.menu_sync_url = menu_url or None
    if payload.menu_sync_enabled is not None:
        if payload.menu_sync_enabled and not integration.menu_sync_url:
            raise HTTPException(
                status_code=422,
                detail="Set a menu sync URL before enabling menu sync.",
            )
        integration.menu_sync_enabled = payload.menu_sync_enabled
        if payload.menu_sync_enabled:
            ensure_outbound_secret(integration)
    db.commit()
    db.refresh(integration)
    return _with_webhook_url(serialize_integration(integration), request)


@router.post("/{integration_id}/rotate-token")
def rotate_aggregator_token(
    integration_id: int,
    request: Request,
    db: Session = Depends(get_db),
    _: dict = Depends(require_roles("admin")),
):
    integration = rotate_token(db, _integration_or_404(db, integration_id))
    return _with_webhook_url(serialize_integration(integration), request)


@router.get("/{integration_id}/orders")
def list_aggregator_orders(
    integration_id: int,
    limit: int = Query(default=20, ge=1, le=100),
    db: Session = Depends(get_db),
    _: dict = Depends(require_roles("admin")),
):
    integration = _integration_or_404(db, integration_id)
    return {
        "integration_id": integration.id,
        "orders": recent_aggregator_orders(db, integration, limit),
    }


@router.get("/{integration_id}/events")
def list_aggregator_events(
    integration_id: int,
    limit: int = Query(default=20, ge=1, le=100),
    db: Session = Depends(get_db),
    _: dict = Depends(require_roles("admin")),
):
    integration = _integration_or_404(db, integration_id)
    return {
        "integration_id": integration.id,
        "events": recent_aggregator_events(db, integration, limit),
    }


@router.post("/{integration_id}/menu-sync")
def sync_aggregator_menu(
    integration_id: int,
    db: Session = Depends(get_db),
    _: dict = Depends(require_roles("admin")),
):
    integration = _integration_or_404(db, integration_id)
    try:
        return push_menu_sync(db, integration)
    except AggregatorError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
