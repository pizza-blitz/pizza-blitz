"""Tax, invoice, tips and active payment provider settings."""

from sqlalchemy.orm import Session

from app.core.config import settings
from app.models.domain import BillingSettings

DEFAULT_TAX_RATE = 5.0
DEFAULT_TAX_LABEL = "GST"
DEFAULT_TIP_PRESETS = [0, 5, 10, 15]
DEFAULT_INVOICE_FOOTER = ""
DEFAULT_SERVICE_CHARGE_LABEL = "Service charge"
PAYMENT_PROVIDERS = ("manual", "direct_bank", "cashfree", "razorpay")


def _valid_slabs(raw) -> list[dict]:
    slabs: list[dict] = []
    for item in raw or []:
        if not isinstance(item, dict):
            continue
        try:
            threshold = round(max(float(item.get("threshold", 0)), 0), 2)
            rate = round(max(min(float(item.get("rate", 0)), 28), 0), 2)
        except (TypeError, ValueError):
            continue
        slabs.append({"threshold": threshold, "rate": rate})
    return sorted(slabs, key=lambda item: item["threshold"])


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
        "prices_include_tax": bool(row.prices_include_tax) if row else False,
        "service_charge_rate": float(row.service_charge_rate or 0) if row else 0.0,
        "service_charge_label": row.service_charge_label
        if row and row.service_charge_label
        else DEFAULT_SERVICE_CHARGE_LABEL,
        "tax_slabs": _valid_slabs(row.tax_slabs if row else []),
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
        "prices_include_tax": data["prices_include_tax"],
        "service_charge_rate": data["service_charge_rate"],
        "service_charge_label": data["service_charge_label"],
        "tax_slabs": data["tax_slabs"],
    }


def tax_rate(db: Session) -> float:
    row = _row(db)
    return float(row.tax_rate) if row else DEFAULT_TAX_RATE


def tax_rate_for_subtotal(db: Session, taxable_subtotal: float) -> float:
    row = _row(db)
    slabs = _valid_slabs(row.tax_slabs if row else [])
    if not slabs:
        return float(row.tax_rate) if row else DEFAULT_TAX_RATE
    rate = slabs[0]["rate"]
    for slab in slabs:
        if float(taxable_subtotal) >= slab["threshold"]:
            rate = slab["rate"]
    return rate


def _inclusive_tax(amount: float, rate: float) -> float:
    if amount <= 0 or rate <= 0:
        return 0.0
    return round(amount - (amount / (1 + rate / 100)), 2)


def calculate_charges(
    db: Session, taxable_subtotal: float
) -> dict:
    row = _row(db)
    subtotal = round(max(0.0, float(taxable_subtotal)), 2)
    rate = tax_rate_for_subtotal(db, subtotal)
    service_rate = float(row.service_charge_rate or 0) if row else 0.0
    service_charge = round(subtotal * (service_rate / 100), 2)
    inclusive = bool(row.prices_include_tax) if row else False
    base = round(subtotal + service_charge, 2)
    tax = _inclusive_tax(base, rate) if inclusive else round(base * (rate / 100), 2)
    total = round(base, 2) if inclusive else round(base + tax, 2)
    return {
        "subtotal": subtotal,
        "service_charge": service_charge,
        "service_charge_rate": service_rate,
        "tax_rate": rate,
        "tax": tax,
        "tax_inclusive": inclusive,
        "total": total,
    }


def tax_for_subtotal(db: Session, taxable_subtotal: float, *, include_service: bool = True) -> float:
    charges = calculate_charges(db, taxable_subtotal)
    return charges["tax"] if include_service else _inclusive_tax(
        max(0.0, float(taxable_subtotal)), tax_rate_for_subtotal(db, taxable_subtotal)
    )


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
    if "prices_include_tax" in values:
        row.prices_include_tax = bool(values["prices_include_tax"])
    if "service_charge_rate" in values:
        row.service_charge_rate = max(min(float(values["service_charge_rate"] or 0), 30), 0)
    if "service_charge_label" in values:
        row.service_charge_label = (
            str(values["service_charge_label"] or "").strip()[:40]
            or DEFAULT_SERVICE_CHARGE_LABEL
        )
    if "tax_slabs" in values:
        row.tax_slabs = _valid_slabs(values["tax_slabs"])
    db.commit()
    db.refresh(row)
    return settings_payload(db)
