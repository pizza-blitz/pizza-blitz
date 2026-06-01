from datetime import date

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.api.deps import get_db
from app.api.api_v1.endpoints.orders import checkout_readiness_payload
from app.api.api_v1.endpoints.promotions import _promotion_dict
from app.models.domain import DeliveryZone, Promotion
from app.services.delivery_service import seed_default_delivery_zones, serialize_delivery_zone
from app.services.menu_customization_service import customized_menu_payload


router = APIRouter()


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


def public_promotions(db: Session, limit: int = 8) -> list[dict]:
    today = date.today()
    promotions = (
        db.query(Promotion)
        .filter(Promotion.start_date <= today, Promotion.end_date >= today)
        .filter(Promotion.status.in_(["active", "scheduled"]))
        .order_by(Promotion.end_date.asc(), Promotion.id.asc())
        .limit(limit)
        .all()
    )
    return [_promotion_dict(promotion) for promotion in promotions]


@router.get("/bootstrap")
def storefront_bootstrap(db: Session = Depends(get_db)):
    return {
        "menu": customized_menu_payload(db),
        "checkout_readiness": checkout_readiness_payload(),
        "active_promotions": public_promotions(db),
        "delivery_zones": public_delivery_zones(db),
    }
