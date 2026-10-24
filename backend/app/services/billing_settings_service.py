"""Tax, invoice and tip settings shared by orders, invoices and the storefront."""

from sqlalchemy.orm import Session

from app.models.domain import BillingSettings

DEFAULT_TAX_RATE = 5.0
DEFAULT_TAX_LABEL = "GST"
DEFAULT_TIP_PRESETS = [0, 5, 10, 15]
DEFAULT_INVOICE_FOOTER = ""


def _row(db: Session) -> BillingSettings | None:
    return db.query(BillingSettings).first()


def settings_payload(db: Session) -> dict:
    row = _row(db)
    return {
        "tax_rate": float(row.tax_rate) if row else DEFAULT_TAX_RATE,
        "tax_label": row.tax_label if row else DEFAULT_TAX_LABEL,
        "invoice_footer": row.invoice_footer if row else DEFAULT_INVOICE_FOOTER,
        "tip_presets": list(row.tip_presets) if row and row.tip_presets else list(DEFAULT_TIP_PRESETS),
        "updated_at": row.updated_at.isoformat() if row and row.updated_at else None,
    }


def public_payload(db: Session) -> dict:
    data = settings_payload(db)
    return {
        "tax_rate": data["tax_rate"],
        "tax_label": data["tax_label"],
        "tip_presets": data["tip_presets"],
        "invoice_footer": data["invoice_footer"],
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
    db.commit()
    db.refresh(row)
    return settings_payload(db)
