
from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.core.clock import business_today
from app.api.deps import get_db
from app.api.api_v1.endpoints.orders import checkout_readiness_payload
from app.api.api_v1.endpoints.promotions import _promotion_dict
from app.models.domain import DeliveryZone, Promotion
from app.services.delivery_service import seed_default_delivery_zones, serialize_delivery_zone
from app.services.menu_customization_service import customized_menu_payload
from app.services.payment_gateway import public_payment_checkout_status
from app.services.store_profile_service import (
    get_store_profile,
    serialize_public_profile,
    store_status,
)
from app.services.storefront_content_service import content_payload
from app.services.billing_settings_service import public_payload as billing_public_payload


router = APIRouter()
INTERNAL_PROMOTION_MARKERS = ("proof", "e2e", "[internal", "[live verify")


def public_delivery_zones(db: Session) -> list[dict]:
    zones = (
        db.query(DeliveryZone)
        .filter(DeliveryZone.is_active.is_(True))
        .order_by(DeliveryZone.delivery_fee.asc(), DeliveryZone.id.asc())
        .all()
    )
    if not zones:
        seed_default_delivery_zones(db)
        db.commit()
        zones = (
            db.query(DeliveryZone)
            .filter(DeliveryZone.is_active.is_(True))
            .order_by(DeliveryZone.delivery_fee.asc(), DeliveryZone.id.asc())
            .all()
        )
    return [serialize_delivery_zone(zone) for zone in zones]


def is_public_storefront_promotion(promotion: Promotion) -> bool:
    searchable = " ".join(
        str(value or "")
        for value in (promotion.name, promotion.description, promotion.code)
    ).lower()
    return (
        (promotion.audience or "").strip().lower() == "all_customers"
        and not any(marker in searchable for marker in INTERNAL_PROMOTION_MARKERS)
    )


def public_promotions(db: Session, limit: int = 8) -> list[dict]:
    today = business_today()
    promotions = (
        db.query(Promotion)
        .filter(Promotion.start_date <= today, Promotion.end_date >= today)
        .filter(Promotion.status.in_(["active", "scheduled"]))
        .order_by(Promotion.end_date.asc(), Promotion.id.asc())
        .all()
    )
    return [
        _promotion_dict(promotion)
        for promotion in promotions
        if is_public_storefront_promotion(promotion)
    ][:limit]


def public_menu(db: Session) -> list[dict]:
    """Menu for the public storefront: never expose internal cost data."""
    return [
        {key: value for key, value in item.items() if key != "cost_price"}
        for item in customized_menu_payload(db)
    ]


@router.get("/profile")
def storefront_profile(db: Session = Depends(get_db)):
    profile = get_store_profile(db)
    return {
        "profile": serialize_public_profile(profile),
        "status": store_status(profile),
    }


@router.get("/bootstrap")
def storefront_bootstrap(db: Session = Depends(get_db)):
    profile = get_store_profile(db)
    return {
        "menu": public_menu(db),
        "checkout_readiness": checkout_readiness_payload(db),
        "payment_checkout": public_payment_checkout_status(),
        "active_promotions": public_promotions(db),
        "delivery_zones": public_delivery_zones(db),
        "store_profile": serialize_public_profile(profile),
        "site_content": content_payload(db),
        "billing": billing_public_payload(db),
    }
