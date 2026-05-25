from fastapi import APIRouter, Body, Depends, HTTPException, Query, UploadFile, File
from sqlalchemy.orm import Session
from pydantic import BaseModel

from app.api.deps import get_db, require_roles
from app.models.domain import DailySales
from app.services.sheets_service import SheetsService
from app.services.gemini_service import bytes_part, generate_text, parse_json_response
from datetime import datetime

router = APIRouter()


class SheetImportRequest(BaseModel):
    sheet_url: str
    mode: str = "all"


@router.post("/sheets")
def import_from_sheets(
    payload: SheetImportRequest | None = Body(default=None),
    sheet_url: str | None = Query(default=None),
    mode: str = Query(default="all"),
    db: Session = Depends(get_db),
    session: dict = Depends(require_roles("admin")),
):
    del session
    try:
        target_url = (payload.sheet_url if payload else sheet_url) or ""
        import_mode = (payload.mode if payload else mode) or "all"
        if not target_url.strip():
            raise HTTPException(status_code=422, detail="Google Sheet URL is required.")
        if import_mode not in {"all", "current"}:
            raise HTTPException(status_code=422, detail="Import mode must be 'all' or 'current'.")
        service = SheetsService()
        result = service.process_and_import(db, target_url.strip(), import_mode)
        if result.get("status") == "error":
            raise HTTPException(status_code=422, detail=result.get("message") or "No rows were imported.")
        return {"status": "success", "data": result}
    except HTTPException:
        raise
    except PermissionError as e:
        raise HTTPException(status_code=403, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/pdf")
async def import_from_pdf(file: UploadFile = File(...), db: Session = Depends(get_db)):
    try:
        contents = await file.read()
        pdf_part = bytes_part(contents, "application/pdf")
        
        # Use Gemini Vision (or Text with PDF analysis) to extract data
        prompt = """
        Analyze this restaurant sales/expense report. 
        Extract the daily sales and expense records into a JSON format.
        Expected fields: date (YYYY-MM-DD), total_sale, total_expense, notes.
        Only return a single JSON array of objects. No markdown.
        """
        
        import time
        max_retries = 3
        response = None
        for attempt in range(max_retries):
            try:
                response = generate_text(
                    model="gemini-2.0-flash",
                    contents=[prompt, pdf_part],
                    missing_key_detail="Gemini API Key for Vision not configured",
                )
                break
            except Exception as e:
                if "429" in str(e) and attempt < max_retries - 1:
                    time.sleep(60)  # Wait 60 seconds before retry
                    continue
                raise e
        
        extracted_data = parse_json_response(response or "[]")
        
        imported_count = 0
        for entry in extracted_data:
            # Simple mapping to DailySales
            db_obj = DailySales(
                date=datetime.strptime(entry['date'], '%Y-%m-%d').date(),
                total_sale=entry['total_sale'],
                total_expense=entry['total_expense'],
                profit=float(entry['total_sale']) - float(entry['total_expense']),
                notes=entry.get('notes', 'Imported from PDF')
            )
            db.merge(db_obj) # Avoid duplicates if date exists
            imported_count += 1
            
        db.commit()
        return {"status": "success", "imported": imported_count, "data": extracted_data}
        
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"PDF Processing failed: {str(e)}")
