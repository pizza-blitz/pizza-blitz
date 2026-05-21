import os
import sys
from datetime import datetime
from sqlalchemy import create_engine, select
from sqlalchemy.orm import Session
from google.oauth2 import service_account
from googleapiclient.discovery import build
import json

# Add current directory to path to import models
sys.path.append(os.getcwd())
from app.db.session import SessionLocal
from app.models.domain import DailySales

# Configuration
SPREADSHEET_ID = '19oM-A7K2_p3u2Z_mHl2m3y2g-e_zF2x-y'
CREDENTIALS_PATH = os.path.join(os.getcwd(), 'google_sheets_credentials.json')

def get_sheets_service():
    if not os.path.exists(CREDENTIALS_PATH):
        # Fallback to env var if file doesn't exist
        creds_json = os.getenv('GOOGLE_SHEETS_CREDENTIALS')
        if not creds_json:
            raise Exception("Google Sheets credentials not found.")
        info = json.loads(creds_json)
    else:
        info = json.load(open(CREDENTIALS_PATH))
    
    creds = service_account.Credentials.from_service_account_info(
        info, scopes=['https://www.googleapis.com/auth/spreadsheets.readonly']
    )
    return build('sheets', 'v4', credentials=creds)

def parse_date(date_str, tab_name):
    # Try common formats
    for fmt in ('%d-%m-%Y', '%Y-%m-%d', '%d/%m/%Y'):
        try:
            return datetime.strptime(date_str, fmt).date()
        except ValueError:
            continue
    # If it's just a day (1, 2, 3...) try to combine with tab name month/year
    try:
        day = int(date_str)
        # Parse Month Year from tab (e.g., "Jan 2024")
        tab_dt = datetime.strptime(tab_name, '%b %Y')
        return tab_dt.replace(day=day).date()
    except:
        return None

def import_data():
    service = get_sheets_service()
    sheet = service.spreadsheets()
    
    # Get all sheets
    metadata = sheet.get(spreadsheetId=SPREADSHEET_ID).execute()
    sheets = [s['properties']['title'] for s in metadata['sheets']]
    
    db = SessionLocal()
    total_imported = 0

    try:
        for tab in sheets:
            print(f"Processing tab: {tab}...")
            result = sheet.values().get(
                spreadsheetId=SPREADSHEET_ID,
                range=f"'{tab}'!A:D"
            ).execute()
            
            values = result.get('values', [])
            if not values:
                continue
                
            # Skip header if present
            start_idx = 1 if 'date' in str(values[0][0]).lower() else 0
            
            for row in values[start_idx:]:
                if len(row) < 4: continue
                
                date_val = parse_date(row[0], tab)
                if not date_val: continue
                
                try:
                    # Map: A:Date, B:Cash, C:Expense, D:Sale
                    cash = float(str(row[1]).replace(',', '').strip() or 0)
                    expense = float(str(row[2]).replace(',', '').strip() or 0)
                    sale = float(str(row[3]).replace(',', '').strip() or 0)
                    
                    # Check if exists
                    existing = db.query(DailySales).filter(DailySales.date == date_val).first()
                    if existing:
                        existing.cash_collected = cash
                        existing.total_expense = expense
                        existing.total_sale = sale
                    else:
                        new_entry = DailySales(
                            date=date_val,
                            cash_collected=cash,
                            total_expense=expense,
                            total_sale=sale,
                            payment_method="Mixed",
                            notes=f"Auto-imported from Sheet tab {tab}"
                        )
                        db.add(new_entry)
                    total_imported += 1
                except ValueError:
                    continue
            
            db.commit()
            print(f"Finished tab {tab}.")
            
    except Exception as e:
        print(f"Error: {e}")
        db.rollback()
    finally:
        db.close()
        print(f"Import complete. Total records processed: {total_imported}")

if __name__ == "__main__":
    import_data()
