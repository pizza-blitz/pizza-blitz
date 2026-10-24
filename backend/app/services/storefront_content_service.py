"""Editable storefront landing content with safe defaults."""

from sqlalchemy.orm import Session

from app.models.domain import StorefrontContent

DEFAULT_HERO_IMAGE = (
    "https://images.unsplash.com/photo-1513104890138-7c749659a591"
    "?auto=format&fit=crop&w=1800&q=85"
)
DEFAULT_STORY_IMAGE = (
    "https://images.unsplash.com/photo-1556910103-1c02745aae4d"
    "?auto=format&fit=crop&w=1200&q=80"
)
DEFAULT_CATEGORY_IMAGES = {
    "Pizza": (
        "https://images.unsplash.com/photo-1574071318508-1cdbab80d002"
        "?auto=format&fit=crop&w=900&q=80"
    ),
    "Sides": (
        "https://images.unsplash.com/photo-1630384060421-cb20d0e0649d"
        "?auto=format&fit=crop&w=900&q=80"
    ),
    "Burgers": (
        "https://images.unsplash.com/photo-1568901346375-23c9450c58cd"
        "?auto=format&fit=crop&w=900&q=80"
    ),
    "Sandwiches": (
        "https://images.unsplash.com/photo-1528735602780-2552fd46c7af"
        "?auto=format&fit=crop&w=900&q=80"
    ),
    "Beverages": (
        "https://images.unsplash.com/photo-1544145945-f90425340c7e"
        "?auto=format&fit=crop&w=900&q=80"
    ),
    "Desserts": (
        "https://images.unsplash.com/photo-1551024601-bec78aea704b"
        "?auto=format&fit=crop&w=900&q=80"
    ),
}
DEFAULTS = {
    "hero_title": "Pizza that shows up",
    "hero_highlight": "in a Blitz.",
    "hero_subtitle": (
        "Hand-stretched pizza, loaded sides, thick shakes, and desserts - with "
        "server-verified pricing, coupons that actually apply, and live tracking "
        "from oven to doorstep."
    ),
    "hero_image_url": DEFAULT_HERO_IMAGE,
    "story_title": "Small batches. Real ingredients. No shortcuts.",
    "story_body": (
        "A restaurant is a supply chain, a kitchen, and a delivery network running "
        "at the same time. These are the standards we hold ourselves to - from dough "
        "handling to the box that reaches your door."
    ),
    "story_image_url": DEFAULT_STORY_IMAGE,
    "category_images": DEFAULT_CATEGORY_IMAGES,
}


def content_payload(db: Session) -> dict:
    row = db.query(StorefrontContent).first()
    data = dict(DEFAULTS)
    if row is not None:
        data.update(
            {
                "hero_title": row.hero_title,
                "hero_highlight": row.hero_highlight,
                "hero_subtitle": row.hero_subtitle,
                "hero_image_url": row.hero_image_url,
                "story_title": row.story_title,
                "story_body": row.story_body,
                "story_image_url": row.story_image_url,
                "category_images": row.category_images or {},
            }
        )
    data["category_images"] = {
        **DEFAULT_CATEGORY_IMAGES,
        **{
            str(key): str(value)
            for key, value in (data.get("category_images") or {}).items()
            if str(key).strip() and str(value).strip()
        },
    }
    data["updated_at"] = row.updated_at.isoformat() if row and row.updated_at else None
    data["customised"] = row is not None
    return data


def update_content(db: Session, values: dict) -> dict:
    row = db.query(StorefrontContent).first()
    if row is None:
        row = StorefrontContent(id=1, **DEFAULTS)
        db.add(row)
    for field in (
        "hero_title",
        "hero_highlight",
        "hero_subtitle",
        "hero_image_url",
        "story_title",
        "story_body",
        "story_image_url",
    ):
        if field in values:
            setattr(row, field, values[field])
    if "category_images" in values:
        row.category_images = values["category_images"]
    db.commit()
    db.refresh(row)
    return content_payload(db)


def reset_content(db: Session) -> dict:
    row = db.query(StorefrontContent).first()
    if row is not None:
        db.delete(row)
        db.commit()
    return content_payload(db)
