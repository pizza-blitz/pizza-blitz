from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.api.deps import get_db, require_roles
from app.services.ops_service import (
    beta_delivery_report,
    create_database_backup,
    credential_activation_report,
    data_quality_report,
    final_acceptance_report,
    launch_candidate_report,
    list_backups,
    live_environment_report,
    production_launch_report,
    readiness_report,
    record_managed_backup_proof,
)

router = APIRouter()


class ManagedBackupProofRequest(BaseModel):
    proof_type: str = Field(pattern="^(managed_snapshot|pg_dump|restore_rehearsal)$")
    reference: str = Field(min_length=6, max_length=500)
    notes: str | None = Field(default=None, max_length=1000)
    size_bytes: int | None = Field(default=None, ge=0)


@router.get("/readiness")
def production_readiness(
    db: Session = Depends(get_db),
    session: dict = Depends(require_roles("admin")),
):
    return readiness_report(db)


@router.get("/data-quality")
def data_quality_readiness(
    db: Session = Depends(get_db),
    session: dict = Depends(require_roles("admin")),
):
    return data_quality_report(db)


@router.get("/launch-candidate")
def launch_candidate_readiness(
    db: Session = Depends(get_db),
    session: dict = Depends(require_roles("admin")),
):
    return launch_candidate_report(db)


@router.get("/final-acceptance")
def final_acceptance_readiness(
    db: Session = Depends(get_db),
    session: dict = Depends(require_roles("admin")),
):
    return final_acceptance_report(db)


@router.get("/beta-delivery")
def beta_delivery_readiness(
    db: Session = Depends(get_db),
    session: dict = Depends(require_roles("admin")),
):
    return beta_delivery_report(db)


@router.get("/production-launch")
def production_launch_readiness(
    db: Session = Depends(get_db),
    session: dict = Depends(require_roles("admin")),
):
    return production_launch_report(db)


@router.get("/live-environment")
def live_environment_readiness(
    db: Session = Depends(get_db),
    session: dict = Depends(require_roles("admin")),
):
    return live_environment_report(db)


@router.get("/credential-activation")
def credential_activation_readiness(
    db: Session = Depends(get_db),
    session: dict = Depends(require_roles("admin")),
):
    return credential_activation_report(db)


@router.get("/backups")
def backup_history(
    limit: int = Query(20, ge=1, le=100),
    db: Session = Depends(get_db),
    session: dict = Depends(require_roles("admin")),
):
    return {"backups": list_backups(db, limit=limit)}


@router.post("/backups/create")
def create_backup(
    db: Session = Depends(get_db),
    session: dict = Depends(require_roles("admin")),
):
    return {"backup": create_database_backup(db)}


@router.post("/backups/proof")
def record_backup_proof(
    payload: ManagedBackupProofRequest,
    db: Session = Depends(get_db),
    session: dict = Depends(require_roles("admin")),
):
    try:
        backup = record_managed_backup_proof(
            db,
            proof_type=payload.proof_type,
            reference=payload.reference,
            notes=payload.notes,
            size_bytes=payload.size_bytes,
        )
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    return {"backup": backup}
