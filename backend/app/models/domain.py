from sqlalchemy import Column, Integer, String, Float, Boolean, DateTime, ForeignKey, JSON, Date, Numeric, UniqueConstraint, Text
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
    image_url = Column(String(500), nullable=True)
    image_alt = Column(String(255), nullable=True)
    allergens = Column(JSON, default=list)
    dietary_tags = Column(JSON, default=list)
    calories = Column(Integer, nullable=True)
    protein_g = Column(Float, nullable=True)
    carbs_g = Column(Float, nullable=True)
    fat_g = Column(Float, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    channel_prices = relationship(
        "MenuItemChannelPrice",
        back_populates="menu_item",
        cascade="all, delete-orphan",
    )

class MenuItemChannelPrice(Base):
    __tablename__ = "menu_item_channel_prices"
    __table_args__ = (
        UniqueConstraint(
            "menu_item_id", "channel", name="uq_menu_channel_price_item_channel"
        ),
    )
    id = Column(Integer, primary_key=True, index=True)
    menu_item_id = Column(
        Integer, ForeignKey("menu_items.id"), index=True, nullable=False
    )
    channel = Column(String(20), nullable=False, index=True)
    price = Column(Float, nullable=False, default=0.0)
    is_available = Column(Boolean, nullable=False, default=True)
    is_visible = Column(Boolean, nullable=False, default=True)
    menu_item = relationship("MenuItem", back_populates="channel_prices")


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
    addresses = relationship(
        "CustomerAddress", back_populates="customer", cascade="all, delete-orphan"
    )


class CustomerAddress(Base):
    __tablename__ = "customer_addresses"
    id = Column(Integer, primary_key=True, index=True)
    customer_id = Column(Integer, ForeignKey("customers.id"), index=True, nullable=False)
    label = Column(String(60), nullable=False, default="Home")
    address_line = Column(String(500), nullable=False)
    zone_id = Column(Integer, nullable=True)
    is_default = Column(Boolean, nullable=False, default=False)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    customer = relationship("Customer", back_populates="addresses")


class LoyaltyAccount(Base):
    __tablename__ = "loyalty_accounts"
    id = Column(Integer, primary_key=True, index=True)
    customer_id = Column(
        Integer, ForeignKey("customers.id"), unique=True, index=True, nullable=False
    )
    points_balance = Column(Integer, nullable=False, default=0)
    lifetime_points = Column(Integer, nullable=False, default=0)
    referral_code = Column(String(20), unique=True, index=True, nullable=False)
    referred_by_customer_id = Column(Integer, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    customer = relationship("Customer")


class LoyaltyTransaction(Base):
    __tablename__ = "loyalty_transactions"
    __table_args__ = (
        UniqueConstraint(
            "customer_id",
            "order_id",
            "transaction_type",
            name="uq_loyalty_transactions_customer_order_type",
        ),
    )
    id = Column(Integer, primary_key=True, index=True)
    customer_id = Column(Integer, ForeignKey("customers.id"), index=True, nullable=False)
    points = Column(Integer, nullable=False)
    transaction_type = Column(String(30), nullable=False)
    order_id = Column(Integer, nullable=True)
    note = Column(String(255), nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow, index=True)
    customer = relationship("Customer")


class LoyaltyRedemption(Base):
    __tablename__ = "loyalty_redemptions"
    id = Column(Integer, primary_key=True, index=True)
    customer_id = Column(Integer, ForeignKey("customers.id"), index=True, nullable=False)
    token = Column(String(40), unique=True, index=True, nullable=False)
    points = Column(Integer, nullable=False)
    discount_amount = Column(Float, nullable=False)
    status = Column(String(20), nullable=False, default="reserved")
    order_id = Column(Integer, nullable=True)
    expires_at = Column(DateTime, nullable=False, index=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    customer = relationship("Customer")

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


class ScheduledShift(Base):
    __tablename__ = "scheduled_shifts"
    id = Column(Integer, primary_key=True, index=True)
    staff_name = Column(String(120), index=True, nullable=False)
    role = Column(String(60), nullable=True)
    date = Column(Date, index=True, nullable=False)
    start_time = Column(String(10), nullable=False)
    end_time = Column(String(10), nullable=False)
    hourly_rate = Column(Float, nullable=False, default=0.0)
    status = Column(String(20), nullable=False, default="scheduled", index=True)
    notes = Column(String(255), nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

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

class Store(Base):
    __tablename__ = "stores"
    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(120), nullable=False)
    code = Column(String(40), unique=True, index=True, nullable=False)
    address_line = Column(String(255), nullable=True)
    phone = Column(String(40), nullable=True)
    timezone = Column(String(60), nullable=False, default="Asia/Kolkata")
    is_active = Column(Boolean, nullable=False, default=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)


class RestaurantOrder(Base):
    __tablename__ = "orders"
    id = Column(Integer, primary_key=True, index=True)
    store_id = Column(
        Integer,
        ForeignKey("stores.id"),
        index=True,
        nullable=False,
        default=1,
        server_default="1",
    )
    date = Column(Date, default=date.today, index=True)
    order_type = Column(String(20), default="dine-in")
    table_number = Column(String(20), nullable=True)
    customer_name = Column(String(255), nullable=True)
    customer_phone = Column(String(30), nullable=True)
    items = Column(JSON, default=list)
    subtotal = Column(Float, default=0.0)
    discount_amount = Column(Float, default=0.0)
    tax_amount = Column(Float, default=0.0)
    tip_amount = Column(Float, nullable=False, default=0.0, server_default="0")
    refunded_amount = Column(Float, nullable=False, default=0.0, server_default="0")
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
    scheduled_for = Column(DateTime, nullable=True, index=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    closed_at = Column(DateTime, nullable=True)
    delivery_assignment = relationship("DeliveryAssignment", back_populates="order", uselist=False)
    refunds = relationship("OrderRefund", back_populates="order", cascade="all, delete-orphan")
    notifications = relationship(
        "OrderNotification", back_populates="order", cascade="all, delete-orphan"
    )


class OrderRefund(Base):
    __tablename__ = "order_refunds"
    id = Column(Integer, primary_key=True, index=True)
    order_id = Column(Integer, ForeignKey("orders.id"), index=True, nullable=False)
    amount = Column(Float, nullable=False)
    reason = Column(String(255), nullable=False)
    method = Column(String(40), nullable=False, default="cash")
    reference = Column(String(120), nullable=True)
    status = Column(String(20), nullable=False, default="recorded")
    notes = Column(String, nullable=True)
    created_by = Column(String(120), nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow, index=True)
    order = relationship("RestaurantOrder", back_populates="refunds")


class OrderNotification(Base):
    __tablename__ = "order_notifications"
    __table_args__ = (
        UniqueConstraint("order_id", "event", name="uq_order_notifications_order_event"),
    )
    id = Column(Integer, primary_key=True, index=True)
    order_id = Column(Integer, ForeignKey("orders.id"), index=True, nullable=False)
    event = Column(String(40), nullable=False)
    channel = Column(String(20), nullable=False, default="sms")
    recipient = Column(String(30), nullable=True)
    message = Column(String(500), nullable=True)
    status = Column(String(20), nullable=False, default="skipped")
    provider = Column(String(40), nullable=True)
    provider_message_id = Column(String(120), nullable=True)
    error = Column(String(500), nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow, index=True)
    sent_at = Column(DateTime, nullable=True)
    order = relationship("RestaurantOrder", back_populates="notifications")


class CustomerOtp(Base):
    __tablename__ = "customer_otps"
    id = Column(Integer, primary_key=True, index=True)
    phone = Column(String(30), index=True, nullable=False)
    code_hash = Column(String(128), nullable=False)
    channel = Column(String(20), nullable=False, default="sms")
    attempts = Column(Integer, nullable=False, default=0)
    expires_at = Column(DateTime, nullable=False, index=True)
    consumed_at = Column(DateTime, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow, index=True)

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
    rider_token = Column(String(64), unique=True, index=True, nullable=True)
    rider_phone = Column(String(30), nullable=True)
    current_lat = Column(Float, nullable=True)
    current_lng = Column(Float, nullable=True)
    location_updated_at = Column(DateTime, nullable=True)
    proof_type = Column(String(30), nullable=True)
    proof_reference = Column(String(500), nullable=True)
    proof_notes = Column(String(500), nullable=True)
    proof_captured_at = Column(DateTime, nullable=True)
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


class StoreProfile(Base):
    """Single-row store identity, opening hours, and online-ordering controls."""

    __tablename__ = "store_profile"
    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(120), nullable=False, default="Pizza Blitz")
    tagline = Column(String(255), nullable=True)
    phone = Column(String(40), nullable=True)
    email = Column(String(120), nullable=True)
    address_line = Column(String(255), nullable=True)
    map_url = Column(String(500), nullable=True)
    instagram_url = Column(String(255), nullable=True)
    # {"mon": {"open": "11:00", "close": "23:00"}, ...}; null means 24/7,
    # an empty map means closed every day.
    opening_hours = Column(JSON, nullable=True)
    online_ordering_paused = Column(Boolean, default=False)
    pause_message = Column(String(255), nullable=True)
    prep_time_minutes = Column(Integer, default=25)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)


class SavedReport(Base):
    __tablename__ = "saved_reports"
    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(120), nullable=False)
    metrics = Column(JSON, default=list)
    dimensions = Column(JSON, default=list)
    range_days = Column(Integer, nullable=False, default=30)
    filters = Column(JSON, default=dict)
    schedule = Column(String(20), nullable=False, default="none")
    recipients = Column(String(500), nullable=True)
    status = Column(String(20), nullable=False, default="active")
    created_by = Column(String(120), nullable=True)
    last_run_at = Column(DateTime, nullable=True)
    last_delivery_status = Column(String(30), nullable=True)
    last_delivery_error = Column(String(500), nullable=True)
    next_run_at = Column(DateTime, nullable=True, index=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)


class TwoFactorCredential(Base):
    __tablename__ = "two_factor_credentials"
    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(String(120), unique=True, index=True, nullable=False)
    secret = Column(String(64), nullable=False)
    enabled = Column(Boolean, nullable=False, default=False)
    recovery_codes = Column(JSON, default=list)
    confirmed_at = Column(DateTime, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)


class RolePermission(Base):
    __tablename__ = "role_permissions"
    __table_args__ = (
        UniqueConstraint("role", "permission", name="uq_role_permissions_role_permission"),
    )
    id = Column(Integer, primary_key=True, index=True)
    role = Column(String(30), nullable=False, index=True)
    permission = Column(String(60), nullable=False, index=True)
    enabled = Column(Boolean, nullable=False, default=False)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)


class AggregatorIntegration(Base):
    __tablename__ = "aggregator_integrations"
    __table_args__ = (
        UniqueConstraint("platform", "store_id", name="uq_aggregator_platform_store"),
    )
    id = Column(Integer, primary_key=True, index=True)
    platform = Column(String(30), nullable=False, index=True)
    store_id = Column(Integer, ForeignKey("stores.id"), nullable=False, index=True)
    display_name = Column(String(120), nullable=False)
    webhook_token = Column(String(80), unique=True, index=True, nullable=False)
    is_active = Column(Boolean, nullable=False, default=True)
    auto_accept = Column(Boolean, nullable=False, default=True)
    outbound_url = Column(String(500), nullable=True)
    outbound_secret = Column(String(80), nullable=True)
    outbound_enabled = Column(Boolean, nullable=False, default=False)
    menu_sync_url = Column(String(500), nullable=True)
    menu_sync_enabled = Column(Boolean, nullable=False, default=False)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    store = relationship("Store")


class AggregatorEvent(Base):
    __tablename__ = "aggregator_events"
    __table_args__ = (
        UniqueConstraint(
            "integration_id",
            "order_id",
            "status",
            "event_type",
            name="uq_aggregator_event_order_status",
        ),
    )
    id = Column(Integer, primary_key=True, index=True)
    integration_id = Column(
        Integer, ForeignKey("aggregator_integrations.id"), index=True, nullable=False
    )
    order_id = Column(Integer, index=True, nullable=False)
    external_order_id = Column(String(120), nullable=True)
    event_type = Column(String(40), nullable=False, default="order.status")
    status = Column(String(30), nullable=False)
    payload = Column(JSON, default=dict)
    delivery_status = Column(String(20), nullable=False, default="pending", index=True)
    attempts = Column(Integer, nullable=False, default=0)
    next_attempt_at = Column(DateTime, nullable=True, index=True)
    last_error = Column(String(500), nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    integration = relationship("AggregatorIntegration")


class AggregatorOrder(Base):
    __tablename__ = "aggregator_orders"
    __table_args__ = (
        UniqueConstraint(
            "integration_id", "external_order_id", name="uq_aggregator_external_order"
        ),
    )
    id = Column(Integer, primary_key=True, index=True)
    integration_id = Column(
        Integer, ForeignKey("aggregator_integrations.id"), index=True, nullable=False
    )
    external_order_id = Column(String(120), nullable=False, index=True)
    order_id = Column(Integer, nullable=True)
    status = Column(String(30), nullable=False, default="accepted")
    payload = Column(JSON, default=dict)
    error = Column(String(500), nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    integration = relationship("AggregatorIntegration")


class ClientErrorReport(Base):
    __tablename__ = "client_error_reports"
    id = Column(Integer, primary_key=True, index=True)
    message = Column(String(500), nullable=False)
    stack = Column(String(5000), nullable=True)
    url = Column(String(500), nullable=True)
    user_agent = Column(String(500), nullable=True)
    request_id = Column(String(64), nullable=True, index=True)
    created_at = Column(DateTime, default=datetime.utcnow, index=True)


class PosHardwareConfig(Base):
    __tablename__ = "pos_hardware_configs"
    id = Column(Integer, primary_key=True, index=True)
    store_id = Column(
        Integer, ForeignKey("stores.id"), unique=True, index=True, nullable=False
    )
    printer_name = Column(String(120), nullable=False, default="Browser print")
    paper_width_mm = Column(Integer, nullable=False, default=80)
    auto_print = Column(Boolean, nullable=False, default=False)
    receipt_header = Column(String(255), nullable=True)
    receipt_footer = Column(String(255), nullable=True)
    cash_drawer_enabled = Column(Boolean, nullable=False, default=False)
    drawer_pin = Column(String(2), nullable=False, default="2")
    customer_display_url = Column(String(500), nullable=True)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    store = relationship("Store")


class OrderFeedback(Base):
    __tablename__ = "order_feedback"
    id = Column(Integer, primary_key=True, index=True)
    order_id = Column(
        Integer, ForeignKey("orders.id"), unique=True, index=True, nullable=False
    )
    customer_phone = Column(String(30), index=True, nullable=False)
    rating = Column(Integer, nullable=False)
    nps = Column(Integer, nullable=False)
    comment = Column(String(1000), nullable=True)
    tags = Column(JSON, default=list)
    created_at = Column(DateTime, default=datetime.utcnow, index=True)
    order = relationship("RestaurantOrder")


class BusinessDepartment(Base):
    """An admin-domain department (Operations, People & HR, Finance...)."""

    __tablename__ = "business_departments"
    id = Column(Integer, primary_key=True, index=True)
    key = Column(String(60), unique=True, index=True, nullable=False)
    name = Column(String(120), nullable=False)
    description = Column(String(500), nullable=True)
    color = Column(String(20), nullable=False, default="#f97316")
    icon = Column(String(40), nullable=False, default="building")
    status = Column(String(20), nullable=False, default="active", index=True)
    sort_order = Column(Integer, nullable=False, default=100)
    external_system = Column(String(80), nullable=True)
    external_url = Column(String(500), nullable=True)
    integration_status = Column(String(30), nullable=False, default="not_connected")
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    members = relationship(
        "DepartmentMember", back_populates="department", cascade="all, delete-orphan"
    )
    modules = relationship(
        "DepartmentModule", back_populates="department", cascade="all, delete-orphan"
    )


class DepartmentMember(Base):
    __tablename__ = "department_members"
    __table_args__ = (
        UniqueConstraint("department_id", "staff_id", name="uq_department_member"),
    )
    id = Column(Integer, primary_key=True, index=True)
    department_id = Column(
        Integer, ForeignKey("business_departments.id"), index=True, nullable=False
    )
    staff_id = Column(String(120), index=True, nullable=False)
    role = Column(String(30), nullable=False, default="member")
    created_at = Column(DateTime, default=datetime.utcnow)
    department = relationship("BusinessDepartment", back_populates="members")


class DepartmentModule(Base):
    __tablename__ = "department_modules"
    __table_args__ = (
        UniqueConstraint(
            "department_id", "module_key", name="uq_department_module"
        ),
    )
    id = Column(Integer, primary_key=True, index=True)
    department_id = Column(
        Integer, ForeignKey("business_departments.id"), index=True, nullable=False
    )
    module_key = Column(String(60), nullable=False)
    label = Column(String(120), nullable=False)
    route = Column(String(240), nullable=True)
    status = Column(String(20), nullable=False, default="planned")
    sort_order = Column(Integer, nullable=False, default=100)
    department = relationship("BusinessDepartment", back_populates="modules")


class HREmployee(Base):
    """Local HR employee mirror, linked to a POS staff credential when present."""

    __tablename__ = "hr_employees"
    id = Column(Integer, primary_key=True, index=True)
    employee_code = Column(String(40), unique=True, index=True, nullable=False)
    full_name = Column(String(160), nullable=False)
    email = Column(String(200), unique=True, index=True, nullable=True)
    phone = Column(String(30), nullable=True)
    designation = Column(String(120), nullable=True)
    employment_type = Column(
        String(30), nullable=False, default="full_time", index=True
    )
    status = Column(String(30), nullable=False, default="active", index=True)
    joining_date = Column(Date, nullable=True)
    store_id = Column(Integer, ForeignKey("stores.id"), index=True, nullable=True)
    staff_id = Column(String(120), unique=True, index=True, nullable=True)
    reports_to = Column(String(160), nullable=True)
    notes = Column(String(1000), nullable=True)
    external_system = Column(String(80), nullable=True)
    external_id = Column(String(120), index=True, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    store = relationship("Store")


class HRLeaveType(Base):
    __tablename__ = "hr_leave_types"
    id = Column(Integer, primary_key=True, index=True)
    code = Column(String(30), unique=True, index=True, nullable=False)
    name = Column(String(80), nullable=False)
    paid = Column(Boolean, nullable=False, default=True)
    annual_quota = Column(Float, nullable=False, default=0.0)
    carry_forward = Column(Boolean, nullable=False, default=False)
    max_carry_forward = Column(Float, nullable=False, default=0.0)
    color = Column(String(20), nullable=False, default="#0f766e")
    is_active = Column(Boolean, nullable=False, default=True)
    created_at = Column(DateTime, default=datetime.utcnow)


class HRHoliday(Base):
    __tablename__ = "hr_holidays"
    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(120), nullable=False)
    date = Column(Date, index=True, nullable=False)
    store_id = Column(Integer, ForeignKey("stores.id"), index=True, nullable=True)
    notes = Column(String(255), nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    store = relationship("Store")


class HRLeaveBalance(Base):
    __tablename__ = "hr_leave_balances"
    __table_args__ = (
        UniqueConstraint(
            "employee_id", "leave_type_id", "year", name="uq_hr_leave_balance"
        ),
    )
    id = Column(Integer, primary_key=True, index=True)
    employee_id = Column(
        Integer, ForeignKey("hr_employees.id"), index=True, nullable=False
    )
    leave_type_id = Column(
        Integer, ForeignKey("hr_leave_types.id"), index=True, nullable=False
    )
    year = Column(Integer, nullable=False, index=True)
    entitled = Column(Float, nullable=False, default=0.0)
    used = Column(Float, nullable=False, default=0.0)
    adjusted = Column(Float, nullable=False, default=0.0)
    employee = relationship("HREmployee")
    leave_type = relationship("HRLeaveType")


class HRLeaveRequest(Base):
    __tablename__ = "hr_leave_requests"
    id = Column(Integer, primary_key=True, index=True)
    employee_id = Column(
        Integer, ForeignKey("hr_employees.id"), index=True, nullable=False
    )
    leave_type_id = Column(
        Integer, ForeignKey("hr_leave_types.id"), index=True, nullable=False
    )
    start_date = Column(Date, index=True, nullable=False)
    end_date = Column(Date, index=True, nullable=False)
    days = Column(Float, nullable=False, default=1.0)
    reason = Column(String(500), nullable=True)
    status = Column(String(20), nullable=False, default="pending", index=True)
    decided_by = Column(String(120), nullable=True)
    decided_at = Column(DateTime, nullable=True)
    decision_note = Column(String(500), nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow, index=True)
    employee = relationship("HREmployee")
    leave_type = relationship("HRLeaveType")


class HRAttendance(Base):
    __tablename__ = "hr_attendance"
    __table_args__ = (
        UniqueConstraint("employee_id", "date", name="uq_hr_attendance_day"),
    )
    id = Column(Integer, primary_key=True, index=True)
    employee_id = Column(
        Integer, ForeignKey("hr_employees.id"), index=True, nullable=False
    )
    date = Column(Date, nullable=False, index=True)
    status = Column(String(20), nullable=False, default="present", index=True)
    check_in_at = Column(DateTime, nullable=True)
    check_out_at = Column(DateTime, nullable=True)
    worked_minutes = Column(Integer, nullable=False, default=0)
    source = Column(String(20), nullable=False, default="manual")
    note = Column(String(500), nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    employee = relationship("HREmployee")


class HRSalaryStructure(Base):
    __tablename__ = "hr_salary_structures"
    id = Column(Integer, primary_key=True, index=True)
    employee_id = Column(
        Integer, ForeignKey("hr_employees.id"), unique=True, index=True, nullable=False
    )
    basic = Column(Float, nullable=False, default=0.0)
    hra = Column(Float, nullable=False, default=0.0)
    allowances = Column(Float, nullable=False, default=0.0)
    other_deductions = Column(Float, nullable=False, default=0.0)
    tds = Column(Float, nullable=False, default=0.0)
    pf_enabled = Column(Boolean, nullable=False, default=True)
    esi_enabled = Column(Boolean, nullable=False, default=True)
    professional_tax = Column(Float, nullable=False, default=200.0)
    effective_from = Column(Date, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    employee = relationship("HREmployee")


class HRPayRun(Base):
    __tablename__ = "hr_pay_runs"
    __table_args__ = (
        UniqueConstraint("year", "month", name="uq_hr_pay_run_month"),
    )
    id = Column(Integer, primary_key=True, index=True)
    year = Column(Integer, nullable=False, index=True)
    month = Column(Integer, nullable=False, index=True)
    status = Column(String(20), nullable=False, default="draft", index=True)
    employee_count = Column(Integer, nullable=False, default=0)
    gross_total = Column(Float, nullable=False, default=0.0)
    deductions_total = Column(Float, nullable=False, default=0.0)
    net_total = Column(Float, nullable=False, default=0.0)
    employer_cost = Column(Float, nullable=False, default=0.0)
    created_by = Column(String(120), nullable=True)
    finalized_at = Column(DateTime, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    payslips = relationship(
        "HRPayslip", back_populates="run", cascade="all, delete-orphan"
    )


class HRPayslip(Base):
    __tablename__ = "hr_payslips"
    __table_args__ = (
        UniqueConstraint("run_id", "employee_id", name="uq_hr_payslip_run_employee"),
    )
    id = Column(Integer, primary_key=True, index=True)
    run_id = Column(
        Integer, ForeignKey("hr_pay_runs.id"), index=True, nullable=False
    )
    employee_id = Column(
        Integer, ForeignKey("hr_employees.id"), index=True, nullable=False
    )
    employee_code = Column(String(40), nullable=False)
    employee_name = Column(String(160), nullable=False)
    designation = Column(String(120), nullable=True)
    days_in_month = Column(Integer, nullable=False, default=30)
    paid_days = Column(Float, nullable=False, default=30)
    basic = Column(Float, nullable=False, default=0.0)
    hra = Column(Float, nullable=False, default=0.0)
    allowances = Column(Float, nullable=False, default=0.0)
    gross = Column(Float, nullable=False, default=0.0)
    pf_employee = Column(Float, nullable=False, default=0.0)
    esi_employee = Column(Float, nullable=False, default=0.0)
    professional_tax = Column(Float, nullable=False, default=0.0)
    tds = Column(Float, nullable=False, default=0.0)
    other_deductions = Column(Float, nullable=False, default=0.0)
    total_deductions = Column(Float, nullable=False, default=0.0)
    net = Column(Float, nullable=False, default=0.0)
    employer_pf = Column(Float, nullable=False, default=0.0)
    employer_esi = Column(Float, nullable=False, default=0.0)
    breakdown = Column(JSON, default=dict)
    created_at = Column(DateTime, default=datetime.utcnow)
    run = relationship("HRPayRun", back_populates="payslips")
    employee = relationship("HREmployee")


class HROnboardingCandidate(Base):
    __tablename__ = "hr_onboarding_candidates"
    id = Column(Integer, primary_key=True, index=True)
    candidate_code = Column(String(40), unique=True, index=True, nullable=False)
    full_name = Column(String(160), nullable=False)
    email = Column(String(200), unique=True, index=True, nullable=True)
    phone = Column(String(30), nullable=True)
    designation = Column(String(120), nullable=True)
    employment_type = Column(String(30), nullable=False, default="full_time")
    store_id = Column(Integer, ForeignKey("stores.id"), index=True, nullable=True)
    expected_joining_date = Column(Date, nullable=True)
    status = Column(String(30), nullable=False, default="documents_pending", index=True)
    source = Column(String(80), nullable=True)
    notes = Column(String(1000), nullable=True)
    employee_id = Column(
        Integer, ForeignKey("hr_employees.id"), unique=True, index=True, nullable=True
    )
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    store = relationship("Store")
    employee = relationship("HREmployee")
    tasks = relationship(
        "HROnboardingTask", back_populates="candidate", cascade="all, delete-orphan"
    )


class HROnboardingTask(Base):
    __tablename__ = "hr_onboarding_tasks"
    id = Column(Integer, primary_key=True, index=True)
    candidate_id = Column(
        Integer,
        ForeignKey("hr_onboarding_candidates.id"),
        index=True,
        nullable=False,
    )
    title = Column(String(160), nullable=False)
    category = Column(String(40), nullable=False, default="documents")
    status = Column(String(20), nullable=False, default="pending", index=True)
    due_date = Column(Date, nullable=True)
    notes = Column(String(500), nullable=True)
    sort_order = Column(Integer, nullable=False, default=100)
    completed_at = Column(DateTime, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    candidate = relationship("HROnboardingCandidate", back_populates="tasks")


class HRDocument(Base):
    __tablename__ = "hr_documents"
    id = Column(Integer, primary_key=True, index=True)
    employee_id = Column(
        Integer, ForeignKey("hr_employees.id"), index=True, nullable=False
    )
    category = Column(String(40), nullable=False, default="other", index=True)
    title = Column(String(160), nullable=False)
    file_name = Column(String(255), nullable=False)
    mime_type = Column(String(120), nullable=False)
    size_bytes = Column(Integer, nullable=False, default=0)
    storage_path = Column(String(500), nullable=False)
    visibility = Column(String(20), nullable=False, default="hr")
    expires_at = Column(Date, nullable=True, index=True)
    notes = Column(String(500), nullable=True)
    uploaded_by = Column(String(120), nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    employee = relationship("HREmployee")


class HRLetter(Base):
    __tablename__ = "hr_letters"
    id = Column(Integer, primary_key=True, index=True)
    employee_id = Column(
        Integer, ForeignKey("hr_employees.id"), index=True, nullable=False
    )
    letter_type = Column(String(30), nullable=False, index=True)
    title = Column(String(160), nullable=False)
    content_html = Column(Text, nullable=False)
    verification_code = Column(String(40), unique=True, index=True, nullable=False)
    status = Column(String(20), nullable=False, default="issued", index=True)
    issued_by = Column(String(120), nullable=True)
    issued_at = Column(DateTime, default=datetime.utcnow, index=True)
    employee = relationship("HREmployee")


class HRExit(Base):
    __tablename__ = "hr_exits"
    id = Column(Integer, primary_key=True, index=True)
    employee_id = Column(
        Integer, ForeignKey("hr_employees.id"), unique=True, index=True, nullable=False
    )
    exit_type = Column(String(30), nullable=False, default="resignation")
    status = Column(String(30), nullable=False, default="initiated", index=True)
    resignation_date = Column(Date, nullable=False)
    last_working_date = Column(Date, nullable=False, index=True)
    notice_days = Column(Integer, nullable=False, default=30)
    reason = Column(String(500), nullable=True)
    settlement = Column(JSON, default=dict)
    settled_at = Column(DateTime, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    employee = relationship("HREmployee")
    clearance_tasks = relationship(
        "HRExitClearance", back_populates="exit", cascade="all, delete-orphan"
    )


class HRExitClearance(Base):
    __tablename__ = "hr_exit_clearance"
    id = Column(Integer, primary_key=True, index=True)
    exit_id = Column(
        Integer, ForeignKey("hr_exits.id"), index=True, nullable=False
    )
    title = Column(String(160), nullable=False)
    department = Column(String(60), nullable=False, default="HR")
    status = Column(String(20), nullable=False, default="pending", index=True)
    notes = Column(String(500), nullable=True)
    sort_order = Column(Integer, nullable=False, default=100)
    cleared_at = Column(DateTime, nullable=True)
    exit = relationship("HRExit", back_populates="clearance_tasks")


class MediaAsset(Base):
    """Shared media library used by menu, landing content, social and ads."""

    __tablename__ = "media_assets"
    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(160), nullable=False)
    url = Column(String(500), unique=True, index=True, nullable=False)
    file_name = Column(String(255), nullable=False)
    mime_type = Column(String(120), nullable=False)
    size_bytes = Column(Integer, nullable=False, default=0)
    tags = Column(JSON, default=list)
    uploaded_by = Column(String(120), nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow, index=True)


class StorefrontContent(Base):
    """Editable landing-page hero, story and category imagery."""

    __tablename__ = "storefront_content"
    id = Column(Integer, primary_key=True, index=True)
    hero_title = Column(String(160), nullable=False)
    hero_highlight = Column(String(120), nullable=False)
    hero_subtitle = Column(Text, nullable=False)
    hero_image_url = Column(String(500), nullable=True)
    story_title = Column(String(200), nullable=False)
    story_body = Column(Text, nullable=False)
    story_image_url = Column(String(500), nullable=True)
    category_images = Column(JSON, default=dict)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)


class BillingSettings(Base):
    """Single-row tax, invoice and tip configuration."""

    __tablename__ = "billing_settings"
    id = Column(Integer, primary_key=True, index=True)
    tax_rate = Column(Float, nullable=False, default=5.0)
    tax_label = Column(String(30), nullable=False, default="GST")
    invoice_footer = Column(String(255), nullable=True)
    tip_presets = Column(JSON, default=lambda: [0, 5, 10, 15])
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)


class ProviderSetting(Base):
    """Encrypted provider credentials with environment fallback."""

    __tablename__ = "provider_settings"
    id = Column(Integer, primary_key=True, index=True)
    provider = Column(String(60), unique=True, index=True, nullable=False)
    credentials_encrypted = Column(Text, nullable=False)
    enabled = Column(Boolean, nullable=False, default=True)
    updated_by = Column(String(120), nullable=True)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)


class MessageThread(Base):
    """One conversation with a customer or contact, per channel."""

    __tablename__ = "message_threads"
    __table_args__ = (
        UniqueConstraint("channel", "destination", name="uq_message_thread_channel_destination"),
    )
    id = Column(Integer, primary_key=True, index=True)
    channel = Column(String(30), nullable=False, index=True)
    destination = Column(String(255), nullable=False, index=True)
    contact_name = Column(String(160), nullable=True)
    customer_id = Column(Integer, ForeignKey("customers.id"), nullable=True, index=True)
    status = Column(String(30), nullable=False, default="open", index=True)
    assigned_to = Column(String(120), nullable=True)
    unread_count = Column(Integer, nullable=False, default=0)
    last_message_at = Column(DateTime, default=datetime.utcnow, index=True)
    created_at = Column(DateTime, default=datetime.utcnow, index=True)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    customer = relationship("Customer")
    messages = relationship(
        "Message", back_populates="thread", cascade="all, delete-orphan"
    )


class Message(Base):
    """An inbound or outbound message in a conversation."""

    __tablename__ = "messages"
    id = Column(Integer, primary_key=True, index=True)
    thread_id = Column(Integer, ForeignKey("message_threads.id"), nullable=False, index=True)
    direction = Column(String(20), nullable=False, index=True)
    channel = Column(String(30), nullable=False, index=True)
    body = Column(Text, nullable=False)
    subject = Column(String(255), nullable=True)
    status = Column(String(30), nullable=False, default="received", index=True)
    provider = Column(String(60), nullable=True)
    external_id = Column(String(255), nullable=True)
    error = Column(Text, nullable=True)
    actor = Column(String(120), nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow, index=True)
    thread = relationship("MessageThread", back_populates="messages")


class MessageTemplate(Base):
    """Reusable channel-specific message copy."""

    __tablename__ = "message_templates"
    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(140), nullable=False)
    channel = Column(String(30), nullable=False)
    subject = Column(String(255), nullable=True)
    body = Column(Text, nullable=False)
    category = Column(String(40), nullable=False, default="marketing")
    status = Column(String(30), nullable=False, default="draft")
    created_at = Column(DateTime, default=datetime.utcnow, index=True)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)


class MarketingJourney(Base):
    """A trigger-based sequence of delays and message steps."""

    __tablename__ = "marketing_journeys"
    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(160), nullable=False)
    description = Column(String(500), nullable=True)
    trigger = Column(String(50), nullable=False, index=True)
    status = Column(String(30), nullable=False, default="draft", index=True)
    steps = Column(JSON, default=list)
    created_at = Column(DateTime, default=datetime.utcnow, index=True)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)


class JourneyEnrollment(Base):
    """One customer's progress through a journey."""

    __tablename__ = "journey_enrollments"
    __table_args__ = (
        UniqueConstraint("journey_id", "trigger_ref", name="uq_journey_enrollment_ref"),
    )
    id = Column(Integer, primary_key=True, index=True)
    journey_id = Column(Integer, ForeignKey("marketing_journeys.id"), nullable=False, index=True)
    customer_id = Column(Integer, ForeignKey("customers.id"), nullable=True, index=True)
    trigger_ref = Column(String(160), nullable=False)
    status = Column(String(30), nullable=False, default="running", index=True)
    current_step = Column(Integer, nullable=False, default=0)
    next_run_at = Column(DateTime, default=datetime.utcnow, index=True)
    context = Column(JSON, default=dict)
    created_at = Column(DateTime, default=datetime.utcnow, index=True)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    journey = relationship("MarketingJourney")
    customer = relationship("Customer")
    events = relationship(
        "JourneyEvent", back_populates="enrollment", cascade="all, delete-orphan"
    )


class JourneyEvent(Base):
    """A step result recorded for an enrollment."""

    __tablename__ = "journey_events"
    id = Column(Integer, primary_key=True, index=True)
    enrollment_id = Column(Integer, ForeignKey("journey_enrollments.id"), nullable=False, index=True)
    step_index = Column(Integer, nullable=False, default=0)
    step_type = Column(String(30), nullable=False)
    status = Column(String(30), nullable=False)
    detail = Column(String(500), nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow, index=True)
    enrollment = relationship("JourneyEnrollment", back_populates="events")


class RecruitmentJob(Base):
    """A job requisition for the HR recruitment pipeline."""

    __tablename__ = "recruitment_jobs"
    id = Column(Integer, primary_key=True, index=True)
    title = Column(String(160), nullable=False, index=True)
    department = Column(String(120), nullable=True)
    location = Column(String(160), nullable=True)
    employment_type = Column(String(30), nullable=False, default="full_time")
    description = Column(Text, nullable=True)
    requirements = Column(Text, nullable=True)
    salary_min = Column(Float, nullable=True)
    salary_max = Column(Float, nullable=True)
    openings = Column(Integer, nullable=False, default=1)
    status = Column(String(30), nullable=False, default="draft", index=True)
    created_at = Column(DateTime, default=datetime.utcnow, index=True)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    applications = relationship(
        "RecruitmentApplication", back_populates="job", cascade="all, delete-orphan"
    )


class RecruitmentApplication(Base):
    """One candidate's application to a job."""

    __tablename__ = "recruitment_applications"
    id = Column(Integer, primary_key=True, index=True)
    job_id = Column(Integer, ForeignKey("recruitment_jobs.id"), nullable=False, index=True)
    candidate_name = Column(String(160), nullable=False)
    email = Column(String(200), nullable=True)
    phone = Column(String(30), nullable=True)
    source = Column(String(80), nullable=True)
    stage = Column(String(30), nullable=False, default="applied", index=True)
    rating = Column(Integer, nullable=True)
    notes = Column(Text, nullable=True)
    rejection_reason = Column(String(500), nullable=True)
    expected_salary = Column(Float, nullable=True)
    offered_salary = Column(Float, nullable=True)
    joining_date = Column(Date, nullable=True)
    onboarding_candidate_id = Column(Integer, ForeignKey("hr_onboarding_candidates.id"), nullable=True)
    applied_at = Column(DateTime, default=datetime.utcnow, index=True)
    stage_changed_at = Column(DateTime, default=datetime.utcnow)
    hired_at = Column(DateTime, nullable=True)
    job = relationship("RecruitmentJob", back_populates="applications")
    interviews = relationship(
        "RecruitmentInterview", back_populates="application", cascade="all, delete-orphan"
    )
    stage_events = relationship(
        "RecruitmentStageEvent", back_populates="application", cascade="all, delete-orphan"
    )


class RecruitmentInterview(Base):
    """An interview scheduled for an application."""

    __tablename__ = "recruitment_interviews"
    id = Column(Integer, primary_key=True, index=True)
    application_id = Column(
        Integer, ForeignKey("recruitment_applications.id"), nullable=False, index=True
    )
    scheduled_at = Column(DateTime, nullable=False, index=True)
    mode = Column(String(30), nullable=False, default="in_person")
    interviewer = Column(String(160), nullable=True)
    notes = Column(Text, nullable=True)
    status = Column(String(30), nullable=False, default="scheduled")
    created_at = Column(DateTime, default=datetime.utcnow, index=True)
    application = relationship("RecruitmentApplication", back_populates="interviews")


class RecruitmentStageEvent(Base):
    """Audit trail for application stage moves."""

    __tablename__ = "recruitment_stage_events"
    id = Column(Integer, primary_key=True, index=True)
    application_id = Column(
        Integer, ForeignKey("recruitment_applications.id"), nullable=False, index=True
    )
    from_stage = Column(String(30), nullable=True)
    to_stage = Column(String(30), nullable=False)
    actor = Column(String(120), nullable=True)
    note = Column(String(500), nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow, index=True)
    application = relationship("RecruitmentApplication", back_populates="stage_events")
