from sqlalchemy import Column, Integer, String, Float, Boolean, DateTime, ForeignKey, JSON, Date, Numeric, Computed
from sqlalchemy.orm import relationship
from datetime import date, datetime
from app.db.base import Base

class DailySales(Base):
    __tablename__ = "daily_sales"
    id = Column(Integer, primary_key=True, index=True)
    date = Column(Date, unique=True, index=True)
    cash_collected = Column(Numeric(10, 2), default=0.0)
    total_expense = Column(Numeric(10, 2), default=0.0)
    total_sale = Column(Numeric(10, 2), default=0.0)
    profit = Column(Numeric(10, 2), default=0.0)
    payment_method = Column(String, default="mixed")
    notes = Column(String, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)

class MenuItem(Base):
    __tablename__ = "menu_items"
    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, index=True)
    category = Column(String, index=True)
    selling_price = Column(Float, nullable=False)
    cost_price = Column(Float, nullable=False)
    is_available = Column(Boolean, default=True)
    created_at = Column(DateTime, default=datetime.utcnow)

class InventoryItem(Base):
    __tablename__ = "inventory_items"
    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, unique=True, index=True)
    category = Column(String, index=True)
    unit = Column(String)
    current_stock = Column(Float, default=0.0)
    minimum_stock = Column(Float, default=0.0)
    cost_per_unit = Column(Float, default=0.0)
    supplier_name = Column(String, nullable=True)
    supplier_whatsapp = Column(String, nullable=True)
    last_updated = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

class InventoryTransaction(Base):
    __tablename__ = "inventory_transactions"
    id = Column(Integer, primary_key=True, index=True)
    item_id = Column(Integer, ForeignKey("inventory_items.id"))
    transaction_type = Column(String) # purchase/usage/wastage
    quantity = Column(Float)
    unit_cost = Column(Float)
    total_cost = Column(Float)
    notes = Column(String, nullable=True)
    photo_url = Column(String, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)

class ExpenseCategory(Base):
    __tablename__ = "expense_categories"
    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, unique=True, index=True)
    is_active = Column(Boolean, default=True)

class Expense(Base):
    __tablename__ = "expenses"
    id = Column(Integer, primary_key=True, index=True)
    date = Column(DateTime, index=True)
    category_id = Column(Integer, ForeignKey("expense_categories.id"))
    amount = Column(Float, nullable=False)
    description = Column(String, nullable=True)
    receipt_photo_url = Column(String, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)

class PurchaseOrder(Base):
    __tablename__ = "purchase_orders"
    id = Column(Integer, primary_key=True, index=True)
    supplier_name = Column(String)
    supplier_whatsapp = Column(String)
    items = Column(JSON)
    total_amount = Column(Float, default=0.0)
    status = Column(String, default="draft") # draft/sent/received
    whatsapp_sent_at = Column(DateTime, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)

class GoogleSheetSync(Base):
    __tablename__ = "google_sheet_sync"
    id = Column(Integer, primary_key=True, index=True)
    sheet_id = Column(String, index=True)
    last_synced_at = Column(DateTime, nullable=True)
    sync_status = Column(String) # success/failed
    rows_imported = Column(Integer, default=0)

class DiningTable(Base):
    __tablename__ = "tables"
    id = Column(Integer, primary_key=True, index=True)
    table_number = Column(String(20), unique=True, index=True, nullable=False)
    capacity = Column(Integer, default=4)
    status = Column(String(20), default="available")
    current_order_id = Column(Integer, nullable=True)
    last_updated = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

class RestaurantOrder(Base):
    __tablename__ = "orders"
    id = Column(Integer, primary_key=True, index=True)
    date = Column(Date, default=date.today, index=True)
    order_type = Column(String(20), default="dine-in")
    table_number = Column(String(20), nullable=True)
    items = Column(JSON, default=list)
    subtotal = Column(Float, default=0.0)
    tax_amount = Column(Float, default=0.0)
    total_amount = Column(Float, default=0.0)
    payment_status = Column(String(20), default="pending")
    payment_method = Column(String(50), nullable=True)
    status = Column(String(20), default="open")
    notes = Column(String, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    closed_at = Column(DateTime, nullable=True)

class Invoice(Base):
    __tablename__ = "invoices"
    id = Column(Integer, primary_key=True, index=True)
    invoice_number = Column(String(50), unique=True, index=True, nullable=False)
    date = Column(Date, default=date.today, index=True)
    order_id = Column(Integer, nullable=True)
    customer_name = Column(String(255), nullable=True)
    customer_gstin = Column(String(20), nullable=True)
    items = Column(JSON, default=list)
    subtotal = Column(Float, default=0.0)
    cgst = Column(Float, default=0.0)
    sgst = Column(Float, default=0.0)
    total = Column(Float, default=0.0)
    payment_method = Column(String(50), nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)

class FixedCost(Base):
    __tablename__ = "fixed_costs"
    id = Column(Integer, primary_key=True, index=True)
    month = Column(String(7), unique=True, index=True, nullable=False)
    rent = Column(Float, default=0.0)
    salaries = Column(Float, default=0.0)
    utilities = Column(Float, default=0.0)
    other_fixed = Column(Float, default=0.0)
    avg_order_value = Column(Float, default=250.0)
    created_at = Column(DateTime, default=datetime.utcnow)

class WasteLog(Base):
    __tablename__ = "waste_log"
    id = Column(Integer, primary_key=True, index=True)
    date = Column(Date, default=date.today, index=True)
    item_name = Column(String(255), index=True, nullable=False)
    quantity = Column(Float, default=0.0)
    unit = Column(String(50), default="kg")
    estimated_cost = Column(Float, default=0.0)
    reason = Column(String, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)

class Recipe(Base):
    __tablename__ = "recipes"
    id = Column(Integer, primary_key=True, index=True)
    menu_item = Column(String(255), unique=True, index=True, nullable=False)
    ingredients = Column(JSON, default=list)
    created_at = Column(DateTime, default=datetime.utcnow)
