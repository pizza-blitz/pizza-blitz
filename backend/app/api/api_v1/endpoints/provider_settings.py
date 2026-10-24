from typing import Dict

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.api.deps import get_db, require_roles
from app.services.provider_settings_service import (
    PROVIDERS,
    list_provider_summaries,
    provider_summary,
    reset_provider,
    save_provider,
)

router = APIRouter()


class ProviderValues(BaseModel):
    values: Dict[str, str] = Field(default_factory=dict)
    enabled: bool = True


@router.get("/")
def list_providers(
    db: Session = Depends(get_db),
    _: dict = Depends(require_roles("admin")),
):
    return {"providers": list_provider_summaries(db)}


@router.get("/{provider}")
def get_provider(
    provider: str,
    db: Session = Depends(get_db),
    _: dict = Depends(require_roles("admin")),
):
    if provider not in PROVIDERS:
        raise HTTPException(status_code=404, detail="Provider not found.")
    return {"provider": provider_summary(provider, db)}


@router.put("/{provider}")
def save_provider_settings(
    provider: str,
    payload: ProviderValues,
    db: Session = Depends(get_db),
    session: dict = Depends(require_roles("admin")),
):
    if provider not in PROVIDERS:
        raise HTTPException(status_code=404, detail="Provider not found.")
    try:
        summary = save_provider(
            db,
            provider,
            values=payload.values,
            enabled=payload.enabled,
            updated_by=str(session.get("subject") or ""),
        )
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    return {"provider": summary}


@router.post("/{provider}/validate")
def validate_provider(
    provider: str,
    db: Session = Depends(get_db),
    _: dict = Depends(require_roles("admin")),
):
    if provider not in PROVIDERS:
        raise HTTPException(status_code=404, detail="Provider not found.")
    summary = provider_summary(provider, db)
    return {
        "provider": provider,
        "valid": summary["configured"],
        "missing": summary["missing"],
        "detail": (
            "Required fields are present. This checks configuration only; provider live "
            "verification happens on the first real send."
            if summary["configured"]
            else "Add the missing fields and enable the provider."
        ),
    }


@router.delete("/{provider}")
def reset_provider_settings(
    provider: str,
    db: Session = Depends(get_db),
    _: dict = Depends(require_roles("admin")),
):
    if provider not in PROVIDERS:
        raise HTTPException(status_code=404, detail="Provider not found.")
    return {"provider": reset_provider(db, provider)}
