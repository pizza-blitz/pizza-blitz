from fastapi import APIRouter, Depends, HTTPException, UploadFile, File
from sqlalchemy.orm import Session
from app.api.deps import get_db
from app.models.domain import DailySales, Expense, GoogleSheetSync
from app.services.sheets_service import SheetsService
import google.generativeai as genai
import os
import json
from datetime import datetime

router = APIRouter()

@router.post("/sheets")
def import_from_sheets(sheet_url: str, db: Session = Depends(get_db)):
    try:
        service = SheetsService()
        result = service.process_and_import(db, sheet_url)
        return {"status": "success", "data": result}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/pdf")
async def import_from_pdf(file: UploadFile = File(...), db: Session = Depends(get_db)):
    api_key = os.getenv("GEMINI_API_KEY")
    if not api_key:
        raise HTTPException(status_code=500, detail="Gemini API Key for Vision not configured")
    
    genai.configure(api_key=api_key)
    
    try:
        contents = await file.read()
        model = genai.GenerativeModel('gemini-2.0-flash')
        
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
                response = model.generate_content([prompt, {"mime_type": "application/pdf", "data": contents}])
                break
            except Exception as e:
                if "429" in str(e) and attempt < max_retries - 1:
                    time.sleep(60)  # Wait 60 seconds before retry
                    continue
                raise e
        
        # Clean and parse JSON
        text = response.text.replace('```json', '').replace('```', '').strip()
        extracted_data = json.loads(text)
        
        imported_count = 0
        for entry in extracted_data:
            # Simple mapping to DailySales
            db_obj = DailySales(
                date=datetime.strptime(entry['date'], '%Y-%m-%d').date(),
                total_sale=entry['total_sale'],
                total_expense=entry['total_expense'],
                notes=entry.get('notes', 'Imported from PDF')
            )
            db.merge(db_obj) # Avoid duplicates if date exists
            imported_count += 1
            
        db.commit()
        return {"status": "success", "imported": imported_count, "data": extracted_data}
        
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"PDF Processing failed: {str(e)}")
