from typing import Optional

from sqlalchemy.orm import Session

from app.models.domain import DeliveryZone


DEFAULT_DELIVERY_ZONES = [
    {
        "name": "Near Store",
        "keywords": ["market", "main road", "station", "civil lines"],
        "delivery_fee": 25.0,
        "minimum_order_amount": 0.0,
        "eta_min_minutes": 25,
        "eta_max_minutes": 35,
    },
    {
        "name": "City Core",
        "keywords": ["park street", "mg road", "city center", "college"],
        "delivery_fee": 39.0,
        "minimum_order_amount": 0.0,
        "eta_min_minutes": 35,
        "eta_max_minutes": 45,
    },
    {
        "name": "Outer Ring",
        "keywords": ["outer", "bypass", "industrial", "airport"],
        "delivery_fee": 69.0,
        "minimum_order_amount": 199.0,
        "eta_min_minutes": 50,
        "eta_max_minutes": 65,
    },
]


def seed_default_delivery_zones(db: Session) -> None:
    existing = {zone.name for zone in db.query(DeliveryZone).all()}
    for zone in DEFAULT_DELIVERY_ZONES:
        if zone["name"] not in existing:
            db.add(DeliveryZone(**zone, is_active=True))


def serialize_delivery_zone(zone: DeliveryZone) -> dict:
    return {
        "id": zone.id,
        "name": zone.name,
        "keywords": zone.keywords or [],
        "delivery_fee": round(float(zone.delivery_fee or 0), 2),
        "minimum_order_amount": round(float(zone.minimum_order_amount or 0), 2),
        "eta_min_minutes": zone.eta_min_minutes,
        "eta_max_minutes": zone.eta_max_minutes,
        "eta_window": eta_window(zone),
        "is_active": zone.is_active,
    }


def eta_window(zone: DeliveryZone) -> str:
    return f"{zone.eta_min_minutes or 25}-{zone.eta_max_minutes or 45} min"


def validate_delivery_address(address: Optional[str]) -> str:
    normalized = " ".join((address or "").strip().split())
    if len(normalized) < 8:
        raise ValueError("Delivery address must include a clear house/building and area.")
    return normalized


def match_delivery_zone(
    db: Session,
    address: Optional[str],
    zone_id: Optional[int] = None,
) -> Optional[DeliveryZone]:
    active_zones = (
        db.query(DeliveryZone)
        .filter(DeliveryZone.is_active == True)  # noqa: E712
        .order_by(DeliveryZone.delivery_fee.asc(), DeliveryZone.id.asc())
        .all()
    )
    if zone_id:
        return next((zone for zone in active_zones if zone.id == zone_id), None)

    normalized_address = (address or "").lower()
    for zone in active_zones:
        keywords = [str(keyword).lower() for keyword in (zone.keywords or [])]
        if any(keyword and keyword in normalized_address for keyword in keywords):
            return zone
    return active_zones[0] if active_zones else None


def delivery_quote(
    db: Session,
    *,
    address: Optional[str],
    subtotal: float,
    zone_id: Optional[int] = None,
) -> dict:
    normalized_address = validate_delivery_address(address)
    zone = match_delivery_zone(db, normalized_address, zone_id)
    if zone is None:
        return {
            "is_deliverable": False,
            "reason": "No active delivery zone is configured.",
            "address": normalized_address,
            "zone": None,
            "delivery_fee": 0,
            "eta_window": None,
        }

    minimum = float(zone.minimum_order_amount or 0)
    if float(subtotal or 0) < minimum:
        return {
            "is_deliverable": False,
            "reason": f"Minimum order for {zone.name} is Rs {round(minimum)}.",
            "address": normalized_address,
            "zone": serialize_delivery_zone(zone),
            "delivery_fee": round(float(zone.delivery_fee or 0), 2),
            "eta_window": eta_window(zone),
        }

    return {
        "is_deliverable": True,
        "reason": None,
        "address": normalized_address,
        "zone": serialize_delivery_zone(zone),
        "delivery_fee": round(float(zone.delivery_fee or 0), 2),
        "eta_window": eta_window(zone),
    }
