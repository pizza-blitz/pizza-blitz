from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from app.api.deps import get_db
from app.services.ops_service import (
    create_database_backup,
    list_backups,
    readiness_report,
)

router = APIRouter()


@router.get("/readiness")
def production_readiness(db: Session = Depends(get_db)):
    return readiness_report(db)


@router.get("/backups")
def backup_history(
    limit: int = Query(20, ge=1, le=100),
    db: Session = Depends(get_db),
):
    return {"backups": list_backups(db, limit=limit)}


@router.post("/backups/create")
def create_backup(db: Session = Depends(get_db)):
    return {"backup": create_database_backup(db)}
