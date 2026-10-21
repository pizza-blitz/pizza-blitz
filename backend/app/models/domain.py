from sqlalchemy import Column, Integer, String, Float, Boolean, DateTime, ForeignKey, JSON, Date, Numeric
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

class SalesRepairBlock(Base):
    __tablename__ = "sales_repair_blocks"
    id = Column(Integer, primary_key=True, index=True)
    month = Column(String(7), unique=True, index=True, nullable=False)
    reason = Column(String, nullable=True)
    source_url = Column(String, nullable=True)
    blocked_by = Column(String(120), nullable=True)
    blocked_at = Column(DateTime, default=datetime.utcnow, index=True)

class MenuItem(Base):
    __tablename__ = "menu_items"
    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, index=True)
    category = Column(String, index=True)
    selling_price = Column(Float, nullable=False)
    cost_price = Column(Float, nullable=False)
    is_available = Column(Boolean, default=True)
    created_at = Column(DateTime, default=datetime.utcnow)

class MenuCustomizationGroup(Base):
    __tablename__ = "menu_customization_groups"
    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(120), unique=True, index=True, nullable=False)
    applies_to_categories = Column(JSON, default=list)
    selection_type = Column(String(20), default="single")
    min_select = Column(Integer, default=0)
    max_select = Column(Integer, default=1)
    sort_order = Column(Integer, default=0)
    is_active = Column(Boolean, default=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    options = relationship("MenuCustomizationOption", back_populates="group")

class MenuCustomizationOption(Base):
    __tablename__ = "menu_customization_options"
    id = Column(Integer, primary_key=True, index=True)
    group_id = Column(Integer, ForeignKey("menu_customization_groups.id"), index=True, nullable=False)
    name = Column(String(120), nullable=False)
    price_delta = Column(Float, default=0.0)
    is_default = Column(Boolean, default=False)
    sort_order = Column(Integer, default=0)
    is_active = Column(Boolean, default=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    group = relationship("MenuCustomizationGroup", back_populates="options")

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

class Customer(Base):
    __tablename__ = "customers"
    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(255), nullable=True)
    phone = Column(String(30), unique=True, index=True, nullable=False)
    email = Column(String(255), nullable=True)
    opt_in_marketing = Column(Boolean, default=True)
    total_orders = Column(Integer, default=0)
    total_spend = Column(Float, default=0.0)
    first_seen_at = Column(DateTime, default=datetime.utcnow)
    last_order_at = Column(DateTime, nullable=True)
    notes = Column(String, nullable=True)

class AdminCredential(Base):
    __tablename__ = "admin_credentials"
    id = Column(Integer, primary_key=True, index=True)
    admin_id = Column(String(120), unique=True, index=True, nullable=False)
    display_name = Column(String(120), default="Restaurant Admin")
    password_hash = Column(String(255), nullable=False)
    is_active = Column(Boolean, default=True, index=True)
    must_rotate = Column(Boolean, default=False)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    last_login_at = Column(DateTime, nullable=True)

class StaffCredential(Base):
    __tablename__ = "staff_credentials"
    id = Column(Integer, primary_key=True, index=True)
    staff_id = Column(String(120), unique=True, index=True, nullable=False)
    display_name = Column(String(120), default="Counter Staff")
    password_hash = Column(String(255), nullable=False)
    is_active = Column(Boolean, default=True, index=True)
    must_rotate = Column(Boolean, default=False)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    last_login_at = Column(DateTime, nullable=True)

class OperationalAuditEvent(Base):
    __tablename__ = "operational_audit_events"
    id = Column(Integer, primary_key=True, index=True)
    event_type = Column(String(80), index=True, nullable=False)
    action = Column(String(120), index=True, nullable=False)
    resource_type = Column(String(80), index=True, nullable=False)
    resource_id = Column(String(120), nullable=True)
    status = Column(String(40), index=True, default="success")
    actor_role = Column(String(40), index=True, nullable=True)
    actor_subject = Column(String(160), nullable=True)
    actor_display_name = Column(String(160), nullable=True)
    detail = Column(String, nullable=True)
    metadata_json = Column(JSON, default=dict)
    ip_address = Column(String(80), nullable=True)
    user_agent = Column(String, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow, index=True)

class Promotion(Base):
    __tablename__ = "promotions"
    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, index=True, nullable=False)
    code = Column(String(50), unique=True, index=True, nullable=True)
    start_date = Column(Date, index=True, nullable=False)
    end_date = Column(Date, index=True, nullable=False)
    description = Column(String, nullable=True)
    discount_type = Column(String, default="percentage")
    discount_value = Column(Float, default=0.0)
    audience = Column(String(50), default="marketing_opt_in")
    channel = Column(String(50), default="whatsapp")
    status = Column(String(30), default="draft")
    message_template = Column(String, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)

class CampaignDelivery(Base):
    __tablename__ = "campaign_deliveries"
    id = Column(Integer, primary_key=True, index=True)
    promotion_id = Column(Integer, ForeignKey("promotions.id"), index=True, nullable=False)
    customer_id = Column(Integer, ForeignKey("customers.id"), index=True, nullable=True)
    channel = Column(String(50), index=True, nullable=False)
    destination = Column(String(255), nullable=True)
    message = Column(String, nullable=False)
    provider = Column(String(80), nullable=True)
    status = Column(String(40), index=True, default="pending")
    external_id = Column(String(255), nullable=True)
    error = Column(String, nullable=True)
    dry_run = Column(Boolean, default=False)
    response_payload = Column(JSON, nullable=True)
    attempted_at = Column(DateTime, default=datetime.utcnow, index=True)
    promotion = relationship("Promotion")
    customer = relationship("Customer")

class ProviderTestRun(Base):
    __tablename__ = "provider_test_runs"
    id = Column(Integer, primary_key=True, index=True)
    test_id = Column(String(120), unique=True, index=True, nullable=False)
    channel = Column(String(50), index=True, nullable=False)
    provider = Column(String(80), nullable=True)
    recipient_masked = Column(String(255), nullable=True)
    message_preview = Column(String, nullable=True)
    queued = Column(Boolean, default=False)
    live_send_blocked = Column(Boolean, default=True)
    response_payload = Column(JSON, nullable=True)
    generated_at = Column(DateTime, default=datetime.utcnow, index=True)

class SocialPost(Base):
    __tablename__ = "social_posts"
    id = Column(Integer, primary_key=True, index=True)
    title = Column(String(255), nullable=False)
    message = Column(String, nullable=False)
    link_url = Column(String, nullable=True)
    image_url = Column(String, nullable=True)
    platforms = Column(JSON, default=list)
    status = Column(String(40), default="draft", index=True)
    scheduled_at = Column(DateTime, nullable=True, index=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    deliveries = relationship("SocialPostDelivery", back_populates="post")

class SocialPostDelivery(Base):
    __tablename__ = "social_post_deliveries"
    id = Column(Integer, primary_key=True, index=True)
    social_post_id = Column(Integer, ForeignKey("social_posts.id"), index=True, nullable=False)
    platform = Column(String(50), index=True, nullable=False)
    provider = Column(String(80), nullable=True)
    status = Column(String(40), index=True, default="pending")
    external_id = Column(String(255), nullable=True)
    error = Column(String, nullable=True)
    dry_run = Column(Boolean, default=False)
    response_payload = Column(JSON, nullable=True)
    attempted_at = Column(DateTime, default=datetime.utcnow, index=True)
    post = relationship("SocialPost", back_populates="deliveries")

class AdCampaign(Base):
    __tablename__ = "ad_campaigns"
    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(255), nullable=False, index=True)
    objective = Column(String(80), default="traffic", index=True)
    platforms = Column(JSON, default=list)
    audience = Column(String(255), nullable=True)
    location = Column(String(255), nullable=True)
    creative_message = Column(String, nullable=False)
    link_url = Column(String, nullable=True)
    image_url = Column(String, nullable=True)
    daily_budget = Column(Float, default=0.0)
    lifetime_budget = Column(Float, default=0.0)
    start_date = Column(Date, nullable=True, index=True)
    end_date = Column(Date, nullable=True, index=True)
    status = Column(String(40), default="draft", index=True)
    external_campaign_id = Column(String(255), nullable=True)
    impressions = Column(Integer, default=0)
    clicks = Column(Integer, default=0)
    conversions = Column(Integer, default=0)
    spend = Column(Float, default=0.0)
    revenue = Column(Float, default=0.0)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    launches = relationship("AdCampaignLaunch", back_populates="campaign")
    actions = relationship("AdCampaignAction", back_populates="campaign")

class AdCampaignLaunch(Base):
    __tablename__ = "ad_campaign_launches"
    id = Column(Integer, primary_key=True, index=True)
    campaign_id = Column(Integer, ForeignKey("ad_campaigns.id"), index=True, nullable=False)
    provider = Column(String(80), nullable=True)
    status = Column(String(40), index=True, default="pending")
    external_campaign_id = Column(String(255), nullable=True)
    error = Column(String, nullable=True)
    dry_run = Column(Boolean, default=False)
    response_payload = Column(JSON, nullable=True)
    attempted_at = Column(DateTime, default=datetime.utcnow, index=True)
    campaign = relationship("AdCampaign", back_populates="launches")

class AdCampaignAction(Base):
    __tablename__ = "ad_campaign_actions"
    id = Column(Integer, primary_key=True, index=True)
    campaign_id = Column(Integer, ForeignKey("ad_campaigns.id"), index=True, nullable=False)
    action = Column(String(40), index=True, nullable=False)
    previous_status = Column(String(40), nullable=True)
    next_status = Column(String(40), nullable=True)
    note = Column(String, nullable=True)
    actor = Column(String(120), nullable=True)
    response_payload = Column(JSON, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow, index=True)
    campaign = relationship("AdCampaign", back_populates="actions")

class BackupRun(Base):
    __tablename__ = "backup_runs"
    id = Column(Integer, primary_key=True, index=True)
    backup_type = Column(String(50), default="sqlite", index=True)
    status = Column(String(40), default="pending", index=True)
    file_path = Column(String, nullable=True)
    size_bytes = Column(Integer, default=0)
    database_backend = Column(String(80), nullable=True)
    error = Column(String, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow, index=True)

class ShiftLog(Base):
    __tablename__ = "shift_log"
    id = Column(Integer, primary_key=True, index=True)
    date = Column(Date, index=True, nullable=False)
    staff_name = Column(String, index=True, nullable=False)
    role = Column(String, nullable=True)
    shift_start = Column(String, nullable=True)
    shift_end = Column(String, nullable=True)
    notes = Column(String, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)

class StaffLeaveRequest(Base):
    __tablename__ = "staff_leave_requests"
    id = Column(Integer, primary_key=True, index=True)
    staff_name = Column(String, index=True, nullable=False)
    leave_type = Column(String(30), index=True, nullable=False)
    start_date = Column(Date, index=True, nullable=False)
    end_date = Column(Date, index=True, nullable=False)
    days = Column(Float, default=1.0)
    status = Column(String(30), default="approved", index=True)
    reason = Column(String, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)

class Vendor(Base):
    __tablename__ = "vendors"
    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, unique=True, index=True, nullable=False)
    contact_person = Column(String, nullable=True)
    phone = Column(String, nullable=True)
    whatsapp = Column(String, nullable=True)
    category = Column(String, nullable=True)
    is_active = Column(Boolean, default=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    price_history = relationship("VendorPriceHistory", back_populates="vendor")

class VendorPriceHistory(Base):
    __tablename__ = "vendor_price_history"
    id = Column(Integer, primary_key=True, index=True)
    vendor_id = Column(Integer, ForeignKey("vendors.id"), index=True, nullable=False)
    item_name = Column(String, index=True, nullable=False)
    price_per_unit = Column(Float, nullable=False)
    unit = Column(String, default="unit")
    notes = Column(String, nullable=True)
    recorded_date = Column(DateTime, default=datetime.utcnow, index=True)
    vendor = relationship("Vendor", back_populates="price_history")

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

class DeliveryZone(Base):
    __tablename__ = "delivery_zones"
    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(100), unique=True, index=True, nullable=False)
    keywords = Column(JSON, default=list)
    delivery_fee = Column(Float, default=0.0)
    minimum_order_amount = Column(Float, default=0.0)
    eta_min_minutes = Column(Integer, default=25)
    eta_max_minutes = Column(Integer, default=45)
    is_active = Column(Boolean, default=True)
    created_at = Column(DateTime, default=datetime.utcnow)

class RestaurantOrder(Base):
    __tablename__ = "orders"
    id = Column(Integer, primary_key=True, index=True)
    date = Column(Date, default=date.today, index=True)
    order_type = Column(String(20), default="dine-in")
    table_number = Column(String(20), nullable=True)
    customer_name = Column(String(255), nullable=True)
    customer_phone = Column(String(30), nullable=True)
    items = Column(JSON, default=list)
    subtotal = Column(Float, default=0.0)
    discount_amount = Column(Float, default=0.0)
    tax_amount = Column(Float, default=0.0)
    total_amount = Column(Float, default=0.0)
    payment_status = Column(String(20), default="pending")
    payment_method = Column(String(50), nullable=True)
    payment_provider = Column(String(50), nullable=True)
    payment_session_id = Column(String(120), nullable=True)
    payment_session_url = Column(String, nullable=True)
    payment_session_created_at = Column(DateTime, nullable=True)
    payment_reference = Column(String(100), nullable=True)
    payment_confirmed_at = Column(DateTime, nullable=True)
    status = Column(String(20), default="open")
    notes = Column(String, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    closed_at = Column(DateTime, nullable=True)
    delivery_assignment = relationship("DeliveryAssignment", back_populates="order", uselist=False)

class PaymentEventAudit(Base):
    __tablename__ = "payment_event_audits"
    id = Column(Integer, primary_key=True, index=True)
    event_key = Column(String(80), unique=True, index=True, nullable=False)
    order_id = Column(Integer, ForeignKey("orders.id"), index=True, nullable=False)
    provider = Column(String(50), index=True, nullable=False)
    event_type = Column(String(120), index=True, nullable=False)
    payment_status = Column(String(40), index=True, nullable=False)
    action = Column(String(40), index=True, nullable=False)
    provider_order_id = Column(String(160), nullable=True)
    provider_payment_id = Column(String(160), nullable=True)
    paid_amount = Column(Float, nullable=True)
    duplicate_count = Column(Integer, default=0)
    raw_payload = Column(JSON, nullable=True)
    received_at = Column(DateTime, default=datetime.utcnow, index=True)
    last_seen_at = Column(DateTime, nullable=True)

class DeliveryAssignment(Base):
    __tablename__ = "delivery_assignments"
    id = Column(Integer, primary_key=True, index=True)
    order_id = Column(Integer, ForeignKey("orders.id"), unique=True, index=True, nullable=False)
    zone_id = Column(Integer, ForeignKey("delivery_zones.id"), nullable=True)
    assigned_to = Column(String(120), nullable=True)
    status = Column(String(30), default="unassigned")
    notes = Column(String, nullable=True)
    assigned_at = Column(DateTime, nullable=True)
    out_for_delivery_at = Column(DateTime, nullable=True)
    delivered_at = Column(DateTime, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    order = relationship("RestaurantOrder", back_populates="delivery_assignment")
    zone = relationship("DeliveryZone")

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
