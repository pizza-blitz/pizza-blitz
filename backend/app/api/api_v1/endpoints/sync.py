from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from app.api.deps import get_db
from app.services.sheets_service import SheetsService
from pydantic import BaseModel

router = APIRouter()

class SyncRequest(BaseModel):
    sheet_url: str

@router.post("/sync-sheets")
def sync_sheets(request: SyncRequest, db: Session = Depends(get_db)):
    service = SheetsService()
    try:
        result = service.process_and_import(db, request.sheet_url)
        return result
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))

@router.get("/sync-status")
def sync_status(db: Session = Depends(get_db)):
    from app.models.domain import GoogleSheetSync
    last_sync = db.query(GoogleSheetSync).order_by(GoogleSheetSync.last_synced_at.desc()).first()
    if not last_sync:
        return {"status": "Never synced"}
    return {
        "last_sync_time": last_sync.last_synced_at,
        "status": last_sync.sync_status,
        "rows_imported": last_sync.rows_imported
    }
