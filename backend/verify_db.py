from sqlalchemy import create_engine, inspect
import os
from dotenv import load_dotenv

load_dotenv()

def verify_tables():
    db_url = os.getenv("SQLALCHEMY_DATABASE_URI")
    engine = create_engine(db_url)
    inspector = inspect(engine)
    tables = inspector.get_table_names()
    print("Tables in database:", tables)
    
    required = ["daily_sales", "menu_items", "inventory_items", "inventory_transactions", "expenses", "purchase_orders", "google_sheet_sync"]
    missing = [t for t in required if t not in tables]
    
    if not missing:
        print("✅ All required tables are present.")
    else:
        print(f"❌ Missing tables: {missing}")

if __name__ == "__main__":
    verify_tables()
