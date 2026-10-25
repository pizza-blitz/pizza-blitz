from typing import List, Optional

from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.api.deps import get_db, require_roles
from app.services.billing_settings_service import (
    public_payload,
    settings_payload,
    update_settings,
)

router = APIRouter()


class TaxSlab(BaseModel):
    threshold: float = Field(ge=0)
    rate: float = Field(ge=0, le=28)


class BillingSettingsUpdate(BaseModel):
    tax_rate: float = Field(ge=0, le=28)
    tax_label: str = Field(min_length=1, max_length=30)
    invoice_footer: Optional[str] = Field(default=None, max_length=255)
    tip_presets: List[int] = Field(default_factory=list, max_length=8)
    payment_provider: str = Field(default="manual", max_length=30)
    prices_include_tax: bool = False
    service_charge_rate: float = Field(default=0, ge=0, le=30)
    service_charge_label: str = Field(default="Service charge", max_length=40)
    tax_slabs: List[TaxSlab] = Field(default_factory=list, max_length=6)


@router.get("/")
def get_billing_settings(
    db: Session = Depends(get_db),
    _: dict = Depends(require_roles("admin")),
):
    return {"settings": settings_payload(db)}


@router.get("/public")
def get_public_billing_settings(db: Session = Depends(get_db)):
    return {"settings": public_payload(db)}


@router.put("/")
def save_billing_settings(
    payload: BillingSettingsUpdate,
    db: Session = Depends(get_db),
    _: dict = Depends(require_roles("admin")),
):
    presets = sorted({max(0, min(int(value), 100)) for value in payload.tip_presets})
    if not presets:
        presets = [0, 5, 10, 15]
    return {
        "settings": update_settings(
            db,
            {
                "tax_rate": payload.tax_rate,
                "tax_label": payload.tax_label.strip() or "GST",
                "invoice_footer": (payload.invoice_footer or "").strip() or None,
                "tip_presets": presets,
                "payment_provider": payload.payment_provider,
                "prices_include_tax": payload.prices_include_tax,
                "service_charge_rate": payload.service_charge_rate,
                "service_charge_label": payload.service_charge_label,
                "tax_slabs": [slab.model_dump() for slab in payload.tax_slabs],
            },
        )
    }
