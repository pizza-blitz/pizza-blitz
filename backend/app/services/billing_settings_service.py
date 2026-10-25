"""Tax, invoice, tips and active payment provider settings."""

from sqlalchemy.orm import Session

from app.core.config import settings
from app.models.domain import BillingSettings

DEFAULT_TAX_RATE = 5.0
DEFAULT_TAX_LABEL = "GST"
DEFAULT_TIP_PRESETS = [0, 5, 10, 15]
DEFAULT_INVOICE_FOOTER = ""
PAYMENT_PROVIDERS = ("manual", "direct_bank", "cashfree", "razorpay")


def _row(db: Session) -> BillingSettings | None:
    return db.query(BillingSettings).first()


def settings_payload(db: Session) -> dict:
    row = _row(db)
    return {
        "tax_rate": float(row.tax_rate) if row else DEFAULT_TAX_RATE,
        "tax_label": row.tax_label if row else DEFAULT_TAX_LABEL,
        "invoice_footer": row.invoice_footer if row else DEFAULT_INVOICE_FOOTER,
        "tip_presets": list(row.tip_presets) if row and row.tip_presets else list(DEFAULT_TIP_PRESETS),
        "payment_provider": active_payment_provider_from_row(row),
        "updated_at": row.updated_at.isoformat() if row and row.updated_at else None,
    }


def active_payment_provider_from_row(row: BillingSettings | None) -> str:
    value = (row.payment_provider if row else None) or settings.PAYMENT_PROVIDER or "manual"
    value = str(value).strip().lower()
    return value if value in PAYMENT_PROVIDERS else "manual"


def active_payment_provider(db: Session | None = None) -> str:
    if db is not None:
        return active_payment_provider_from_row(_row(db))
    from app.db.session import SessionLocal

    session = SessionLocal()
    try:
        return active_payment_provider_from_row(_row(session))
    finally:
        session.close()


def public_payload(db: Session) -> dict:
    data = settings_payload(db)
    return {
        "tax_rate": data["tax_rate"],
        "tax_label": data["tax_label"],
        "tip_presets": data["tip_presets"],
        "invoice_footer": data["invoice_footer"],
        "payment_provider": data["payment_provider"],
    }


def tax_rate(db: Session) -> float:
    row = _row(db)
    return float(row.tax_rate) if row else DEFAULT_TAX_RATE


def tax_for_subtotal(db: Session, taxable_subtotal: float) -> float:
    return round(max(0.0, float(taxable_subtotal)) * (tax_rate(db) / 100), 2)


def split_tax(tax_amount: float) -> tuple[float, float]:
    cgst = round(max(0.0, float(tax_amount)) / 2, 2)
    return cgst, round(max(0.0, float(tax_amount)) - cgst, 2)


def update_settings(db: Session, values: dict) -> dict:
    row = _row(db)
    if row is None:
        row = BillingSettings(id=1)
        db.add(row)
    row.tax_rate = float(values["tax_rate"])
    row.tax_label = values["tax_label"]
    row.invoice_footer = values.get("invoice_footer") or None
    row.tip_presets = values["tip_presets"]
    if "payment_provider" in values:
        provider = str(values["payment_provider"] or "").strip().lower()
        row.payment_provider = provider if provider in PAYMENT_PROVIDERS else "manual"
    db.commit()
    db.refresh(row)
    return settings_payload(db)
