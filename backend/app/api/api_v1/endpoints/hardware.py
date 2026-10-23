from datetime import datetime
from typing import Literal, Optional
from uuid import uuid4

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.api.deps import get_db, require_roles
from app.models.domain import PosHardwareConfig, Store

router = APIRouter()


class HardwareConfigUpdate(BaseModel):
    printer_name: str = Field(default="Browser print", min_length=1, max_length=120)
    paper_width_mm: Literal[58, 80] = 80
    auto_print: bool = False
    receipt_header: Optional[str] = Field(default=None, max_length=255)
    receipt_footer: Optional[str] = Field(default=None, max_length=255)
    cash_drawer_enabled: bool = False
    drawer_pin: Literal["0", "1", "2", "3", "4", "5", "6", "7"] = "2"
    customer_display_url: Optional[str] = Field(default=None, max_length=500)


def _store_or_404(db: Session, store_id: int) -> Store:
    store = db.query(Store).filter(Store.id == store_id).first()
    if store is None:
        raise HTTPException(status_code=404, detail="Store not found.")
    return store


def _config(db: Session, store_id: int) -> PosHardwareConfig | None:
    return (
        db.query(PosHardwareConfig)
        .filter(PosHardwareConfig.store_id == store_id)
        .first()
    )


def _serialize(db: Session, store: Store, config: PosHardwareConfig | None) -> dict:
    values = {
        "store_id": store.id,
        "store_name": store.name,
        "printer_name": config.printer_name if config else "Browser print",
        "paper_width_mm": config.paper_width_mm if config else 80,
        "auto_print": bool(config.auto_print) if config else False,
        "receipt_header": config.receipt_header if config else store.name,
        "receipt_footer": config.receipt_footer if config else "Thank you for ordering.",
        "cash_drawer_enabled": bool(config.cash_drawer_enabled) if config else False,
        "drawer_pin": config.drawer_pin if config else "2",
        "customer_display_url": config.customer_display_url if config else None,
        "configured": config is not None,
        "updated_at": config.updated_at.isoformat()
        if config and config.updated_at
        else None,
    }
    values["readiness"] = {
        "browser_printer": True,
        "thermal_printer_configured": bool(values["printer_name"]),
        "cash_drawer_configured": bool(values["cash_drawer_enabled"]),
        "customer_display_configured": bool(values["customer_display_url"]),
        "escpos_agent_required": True,
    }
    return values


@router.get("/{store_id}")
def get_hardware_config(
    store_id: int,
    db: Session = Depends(get_db),
    _: dict = Depends(require_roles("admin", "staff")),
):
    store = _store_or_404(db, store_id)
    return _serialize(db, store, _config(db, store_id))


@router.put("/{store_id}")
def save_hardware_config(
    store_id: int,
    payload: HardwareConfigUpdate,
    db: Session = Depends(get_db),
    _: dict = Depends(require_roles("admin")),
):
    store = _store_or_404(db, store_id)
    config = _config(db, store_id)
    if config is None:
        config = PosHardwareConfig(store_id=store_id)
        db.add(config)
    config.printer_name = payload.printer_name.strip()
    config.paper_width_mm = payload.paper_width_mm
    config.auto_print = payload.auto_print
    config.receipt_header = (payload.receipt_header or "").strip() or None
    config.receipt_footer = (payload.receipt_footer or "").strip() or None
    config.cash_drawer_enabled = payload.cash_drawer_enabled
    config.drawer_pin = payload.drawer_pin
    config.customer_display_url = (
        payload.customer_display_url or ""
    ).strip() or None
    db.commit()
    db.refresh(config)
    return _serialize(db, store, config)


@router.post("/{store_id}/test-print")
def test_print(
    store_id: int,
    db: Session = Depends(get_db),
    _: dict = Depends(require_roles("admin", "staff")),
):
    store = _store_or_404(db, store_id)
    config = _config(db, store_id)
    values = _serialize(db, store, config)
    header = values["receipt_header"] or store.name
    footer = values["receipt_footer"] or "Thank you for ordering."
    width = values["paper_width_mm"]
    text = "\n".join(
        [
            header,
            "-" * 28,
            "TEST PRINT",
            f"Store: {store.name} ({store.code})",
            f"Printer: {values['printer_name']}",
            f"Paper: {width}mm",
            datetime.utcnow().strftime("%d/%m/%Y %H:%M UTC"),
            "-" * 28,
            "If you can read this, the POS printer path is ready.",
            footer,
        ]
    )
    html = f"""<!doctype html>
<html><head><meta charset="utf-8" />
<title>Pizza Blitz test print</title>
<style>
  body {{ font-family: ui-monospace, monospace; margin: 0; padding: 12px; width: {width - 8}mm; }}
  h1 {{ font-size: 16px; margin: 0 0 8px; }}
  pre {{ white-space: pre-wrap; font-size: 12px; line-height: 1.5; }}
</style></head>
<body><h1>{header}</h1><pre>{text}</pre></body></html>"""
    return {
        "job_id": uuid4().hex,
        "store_id": store.id,
        "printer_name": values["printer_name"],
        "paper_width_mm": width,
        "text": text,
        "html": html,
        "generated_at": datetime.utcnow().isoformat(),
    }


@router.post("/{store_id}/drawer-pulse")
def cash_drawer_pulse(
    store_id: int,
    db: Session = Depends(get_db),
    _: dict = Depends(require_roles("admin", "staff")),
):
    store = _store_or_404(db, store_id)
    config = _config(db, store_id)
    values = _serialize(db, store, config)
    if not values["cash_drawer_enabled"]:
        raise HTTPException(
            status_code=409,
            detail="Enable the cash drawer before sending a pulse.",
        )
    pin = int(values["drawer_pin"])
    pin_byte = 0 if pin in {0, 1, 2, 3, 4} else 1
    command = bytes([0x1B, 0x70, pin_byte, 0x19, 0xFA]).hex().upper()
    return {
        "store_id": store.id,
        "esc_pos_hex": command,
        "pin": pin,
        "pulse_ms": 25,
        "note": "Send these bytes to the ESC/POS printer to open the drawer.",
    }
