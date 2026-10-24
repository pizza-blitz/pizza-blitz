from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.api.deps import get_db, require_hr_permission
from app.services.hr_analytics_service import overview

router = APIRouter()


@router.get("/overview")
def hr_overview(
    db: Session = Depends(get_db),
    _: dict = Depends(require_hr_permission("hr.view")),
):
    return overview(db)
