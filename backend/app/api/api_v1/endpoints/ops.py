from fastapi import APIRouter, Depends, HTTPException, Query, Request
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.api.deps import get_db, require_roles
from app.services.operational_audit_service import (
    operational_audit_report,
    record_operational_audit_event,
    serialize_operational_audit_event,
)
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


class OperationalAuditProofRequest(BaseModel):
    event_type: str = Field(default="security", min_length=2, max_length=80)
    action: str = Field(default="settings_audit_probe", min_length=2, max_length=120)
    resource_type: str = Field(default="settings", min_length=2, max_length=80)
    resource_id: str | None = Field(default=None, max_length=120)
    status: str = Field(default="success", max_length=40)
    detail: str | None = Field(default=None, max_length=1000)
    metadata: dict = Field(default_factory=dict)


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


@router.get("/audit-events")
def list_operational_audit_events(
    limit: int = Query(50, ge=1, le=200),
    db: Session = Depends(get_db),
    session: dict = Depends(require_roles("admin")),
):
    del session
    return operational_audit_report(db, limit=limit)


@router.post("/audit-events/proof")
def create_operational_audit_proof(
    payload: OperationalAuditProofRequest,
    request: Request,
    db: Session = Depends(get_db),
    session: dict = Depends(require_roles("admin")),
):
    event = record_operational_audit_event(
        db,
        session=session,
        request=request,
        event_type=payload.event_type,
        action=payload.action,
        resource_type=payload.resource_type,
        resource_id=payload.resource_id,
        status=payload.status,
        detail=payload.detail or "Admin recorded an operational audit proof.",
        metadata=payload.metadata,
    )
    return {"event": serialize_operational_audit_event(event)}


@router.post("/backups/create")
def create_backup(
    request: Request,
    db: Session = Depends(get_db),
    session: dict = Depends(require_roles("admin")),
):
    backup = create_database_backup(db)
    record_operational_audit_event(
        db,
        session=session,
        request=request,
        event_type="backup",
        action="backup_create",
        resource_type="backup_run",
        resource_id=backup.get("id"),
        detail=f"Database backup created with status {backup.get('status')}.",
        metadata={"status": backup.get("status"), "size_bytes": backup.get("size_bytes")},
    )
    return {"backup": backup}


@router.post("/backups/proof")
def record_backup_proof(
    payload: ManagedBackupProofRequest,
    request: Request,
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
    record_operational_audit_event(
        db,
        session=session,
        request=request,
        event_type="backup",
        action="backup_proof_recorded",
        resource_type="backup_run",
        resource_id=backup.get("id"),
        detail=f"{payload.proof_type} proof recorded for backup readiness.",
        metadata={
            "proof_type": payload.proof_type,
            "reference": payload.reference,
            "size_bytes": payload.size_bytes,
        },
    )
    return {"backup": backup}
