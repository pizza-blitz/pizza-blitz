import re
from typing import List, Dict, Any
from datetime import datetime
from sqlalchemy.orm import Session
from app.models.domain import DailySales, Expense, ExpenseCategory, GoogleSheetSync
from googleapiclient.discovery import build
from google.auth.exceptions import DefaultCredentialsError

class SheetsService:
    def __init__(self):
        self.scopes = ['https://www.googleapis.com/auth/spreadsheets.readonly']

    def extract_sheet_id(self, url: str) -> str:
        match = re.search(r'/d/([a-zA-Z0-9-_]+)', url)
        if match:
            return match.group(1)
        raise ValueError("Invalid Google Sheets URL")

    def fetch_all_sheet_tabs(self, sheet_url: str) -> List[str]:
        sheet_id = self.extract_sheet_id(sheet_url)
        try:
            import google.auth
            credentials, project = google.auth.default(scopes=self.scopes)
            service = build('sheets', 'v4', credentials=credentials)
            spreadsheet = service.spreadsheets().get(spreadsheetId=sheet_id).execute()
            return [s['properties']['title'] for s in spreadsheet.get('sheets', [])]
        except Exception as e:
            print(f"Error fetching tabs: {e}")
            return []

    def fetch_sheet_data(self, sheet_url: str, range_name: str = 'A:Z') -> List[List[Any]]:
        sheet_id = self.extract_sheet_id(sheet_url)
        try:
            import google.auth
            credentials, project = google.auth.default(scopes=self.scopes)
            service = build('sheets', 'v4', credentials=credentials)
            result = service.spreadsheets().values().get(spreadsheetId=sheet_id, range=range_name).execute()
            return result.get('values', [])
        except Exception:
            return []

    def parse_sheet_date(self, day_str: str, tab_name: str) -> datetime:
        """Parses '1-Feb' and tab like 'Feb 2025' or 'Feb-25' into a date."""
        # Extract day from "1-Feb" or "1"
        day_match = re.match(r'(\d+)', day_str)
        if not day_match:
            raise ValueError(f"Could not parse day from {day_str}")
        day = int(day_match.group(1))

        # Extract Month and Year from Tab Name (e.g., "Feb 2025", "Jan-26")
        months = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"]
        month_found = None
        for i, m in enumerate(months):
            if m in tab_name.lower():
                month_found = i + 1
                break
        
        if not month_found:
             # Fallback to current month if not in tab name
             month_found = datetime.utcnow().month
             
        # Extract year
        year_match = re.search(r'(20\d{2})|(\d{2})$', tab_name)
        if year_match:
            year_str = year_match.group(0)
            year = int(year_str) if len(year_str) == 4 else 2000 + int(year_str)
        else:
            year = datetime.utcnow().year

        return datetime(year, month_found, day)

    def process_and_import(self, db: Session, sheet_url: str) -> Dict[str, Any]:
        tabs = self.fetch_all_sheet_tabs(sheet_url)
        if not tabs:
            return {"rows_imported": 0, "status": "error", "message": "No tabs found or auth error"}
            
        total_imported = 0
        all_months_processed = []

        for tab in tabs:
            # Skip summary tabs if any
            if "summary" in tab.lower() or "yearly" in tab.lower():
                continue
                
            rows = self.fetch_sheet_data(sheet_url, range_name=f"'{tab}'!A:D")
            if not rows or len(rows) < 2:
                continue
                
            imported_this_tab = 0
            for row in rows[1:]: # Skip header
                if not row or len(row) < 4: continue
                
                try:
                    dt = self.parse_sheet_date(row[0], tab)
                    cash = float(str(row[1]).replace('₹', '').replace(',', '').strip() or 0)
                    expense = float(str(row[2]).replace('₹', '').replace(',', '').strip() or 0)
                    sale = float(str(row[3]).replace('₹', '').replace(',', '').strip() or 0)
                except (ValueError, IndexError):
                    continue
                
                # Update or Create DailySales
                sale_record = db.query(DailySales).filter(DailySales.date == dt.date()).first()
                if not sale_record:
                    sale_record = DailySales(
                        date=dt.date(),
                        cash_collected=cash,
                        total_expense=expense,
                        total_sale=sale,
                        notes=f"Imported from tab {tab}"
                    )
                    db.add(sale_record)
                else:
                    sale_record.cash_collected = cash
                    sale_record.total_expense = expense
                    sale_record.total_sale = sale
                
                imported_this_tab += 1
                total_imported += 1
            
            all_months_processed.append(tab)
            db.commit()

        sync_log = GoogleSheetSync(
            sheet_id=self.extract_sheet_id(sheet_url), 
            sync_status="success", 
            rows_imported=total_imported, 
            last_synced_at=datetime.utcnow()
        )
        db.add(sync_log)
        db.commit()

        return {
            "rows_imported": total_imported,
            "months_processed": len(all_months_processed),
            "status": "success"
        }

