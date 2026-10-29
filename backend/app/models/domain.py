from sqlalchemy import Column, Integer, String, Float, Boolean, DateTime, ForeignKey, JSON, Date, Numeric, UniqueConstraint, Text
from sqlalchemy.orm import relationship
from datetime import date, datetime
from app.db.base import Base

class DailySales(Base):
    __tablename__ = "daily_sales"
    __table_args__ = (
        UniqueConstraint("store_id", "date", name="uq_daily_sales_store_date"),
    )
    id = Column(Integer, primary_key=True, index=True)
    store_id = Column(
        Integer,
        ForeignKey("stores.id"),
        index=True,
        nullable=False,
        default=1,
        server_default="1",
    )
    date = Column(Date, index=True)
    cash_collected = Column(Numeric(10, 2), default=0.0)
    total_expense = Column(Numeric(10, 2), default=0.0)
    total_sale = Column(Numeric(10, 2), default=0.0)
    profit = Column(Numeric(10, 2), default=0.0)
    payment_method = Column(String, default="mixed")
    notes = Column(String, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    store = relationship("Store")

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
    store_id = Column(
        Integer,
        ForeignKey("stores.id"),
        index=True,
        nullable=False,
        default=1,
        server_default="1",
    )
    date = Column(DateTime, index=True)
    category_id = Column(Integer, ForeignKey("expense_categories.id"))
    amount = Column(Float, nullable=False)
    description = Column(String, nullable=True)
    receipt_photo_url = Column(String, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    store = relationship("Store")

class PurchaseOrder(Base):
    __tablename__ = "purchase_orders"
    id = Column(Integer, primary_key=True, index=True)
    store_id = Column(
        Integer,
        ForeignKey("stores.id"),
        index=True,
        nullable=False,
        default=1,
        server_default="1",
    )
    supplier_name = Column(String)
    supplier_whatsapp = Column(String)
    items = Column(JSON)
    total_amount = Column(Float, default=0.0)
    status = Column(String, default="draft") # draft/sent/received
    whatsapp_sent_at = Column(DateTime, nullable=True)
    received_at = Column(DateTime, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    store = relationship("Store")

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


class CustomerMemory(Base):
    """What the concierge is allowed to remember about one returning guest.

    Keyed by phone because that is what the customer types at checkout and what
    the order-history proof already verifies. Everything here is optional: an
    empty row is the same as no row, and a guest who withdraws consent deletes
    it. Allergies are stored as the guest's own words so the assistant can echo
    them back rather than paraphrase a medical claim.
    """

    __tablename__ = "customer_memories"
    # The primary key is already indexed by the database; declaring index=True
    # here made autogenerate want a second index that no migration creates,
    # which failed `alembic check` against PostgreSQL.
    id = Column(Integer, primary_key=True)
    phone = Column(String(30), unique=True, index=True, nullable=False)
    display_name = Column(String(255), nullable=True)
    allergies = Column(JSON, default=list, nullable=False)
    dietary_preferences = Column(JSON, default=list, nullable=False)
    favourite_items = Column(JSON, default=list, nullable=False)
    usual_fulfillment = Column(String(20), nullable=True)
    last_order_summary = Column(String(500), nullable=True)
    notes = Column(Text, nullable=True)
    consent_granted = Column(Boolean, default=True, nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)


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
    department_id = Column(
        Integer, ForeignKey("business_departments.id"), index=True, nullable=True
    )
    store_id = Column(Integer, ForeignKey("stores.id"), index=True, nullable=True)
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
    holdout_percent = Column(Float, nullable=False, default=0.0, server_default="0")
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
    tracking_token = Column(String(80), unique=True, index=True, nullable=True)
    open_token = Column(String(80), unique=True, index=True, nullable=True)
    clicked_at = Column(DateTime, nullable=True)
    click_count = Column(Integer, nullable=False, default=0, server_default="0")
    opened_at = Column(DateTime, nullable=True)
    open_count = Column(Integer, nullable=False, default=0, server_default="0")
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
    video_url = Column(String, nullable=True)
    cover_image_url = Column(String, nullable=True)
    media_type = Column(String(20), nullable=False, default="image", server_default="image")
    approval_status = Column(
        String(30), nullable=False, default="not_required", server_default="not_required"
    )
    approval_note = Column(Text, nullable=True)
    approved_by = Column(String(120), nullable=True)
    approved_at = Column(DateTime, nullable=True)
    submitted_at = Column(DateTime, nullable=True)
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
    service_charge = Column(Float, default=0.0)
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
    service_charge = Column(Float, default=0.0)
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
    store_id = Column(
        Integer,
        ForeignKey("stores.id"),
        index=True,
        nullable=False,
        default=1,
        server_default="1",
    )
    date = Column(Date, default=date.today, index=True)
    item_name = Column(String(255), index=True, nullable=False)
    quantity = Column(Float, default=0.0)
    unit = Column(String(50), default="kg")
    estimated_cost = Column(Float, default=0.0)
    reason = Column(String, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    store = relationship("Store")

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
    parent_id = Column(
        Integer, ForeignKey("business_departments.id"), index=True, nullable=True
    )
    head_staff_id = Column(String(120), nullable=True)
    kind = Column(
        String(20),
        nullable=False,
        default="functional",
        server_default="functional",
        index=True,
    )
    store_id = Column(Integer, ForeignKey("stores.id"), index=True, nullable=True)
    cost_center = Column(String(60), nullable=True)
    external_system = Column(String(80), nullable=True)
    external_url = Column(String(500), nullable=True)
    integration_status = Column(String(30), nullable=False, default="not_connected")
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    parent = relationship(
        "BusinessDepartment",
        remote_side=[id],
        backref="children",
        foreign_keys=[parent_id],
    )
    members = relationship(
        "DepartmentMember", back_populates="department", cascade="all, delete-orphan"
    )
    modules = relationship(
        "DepartmentModule", back_populates="department", cascade="all, delete-orphan"
    )
    roles = relationship(
        "DepartmentRole", back_populates="department", cascade="all, delete-orphan"
    )


class DepartmentRole(Base):
    __tablename__ = "department_roles"
    __table_args__ = (
        UniqueConstraint("department_id", "key", name="uq_department_role"),
    )
    id = Column(Integer, primary_key=True, index=True)
    department_id = Column(
        Integer, ForeignKey("business_departments.id"), index=True, nullable=False
    )
    key = Column(String(40), nullable=False)
    name = Column(String(80), nullable=False)
    description = Column(String(240), nullable=True)
    level = Column(String(20), nullable=False, default="member")
    is_default = Column(
        Boolean, nullable=False, default=False, server_default="0"
    )
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    department = relationship("BusinessDepartment", back_populates="roles")
    permissions = relationship(
        "DepartmentRolePermission",
        back_populates="role",
        cascade="all, delete-orphan",
    )


class DepartmentRolePermission(Base):
    __tablename__ = "department_role_permissions"
    __table_args__ = (
        UniqueConstraint("role_id", "permission_key", name="uq_department_role_permission"),
    )
    id = Column(Integer, primary_key=True, index=True)
    role_id = Column(
        Integer, ForeignKey("department_roles.id"), index=True, nullable=False
    )
    permission_key = Column(String(80), nullable=False, index=True)
    enabled = Column(Boolean, nullable=False, default=True, server_default="1")
    role = relationship("DepartmentRole", back_populates="permissions")


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
    title = Column(String(120), nullable=True)
    reports_to_staff_id = Column(String(120), nullable=True)
    employee_id = Column(
        Integer, ForeignKey("hr_employees.id"), index=True, nullable=True
    )
    department_role_id = Column(
        Integer, ForeignKey("department_roles.id"), index=True, nullable=True
    )
    store_id = Column(Integer, ForeignKey("stores.id"), index=True, nullable=True)
    effective_from = Column(Date, nullable=True)
    effective_to = Column(Date, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    department = relationship("BusinessDepartment", back_populates="members")
    department_role = relationship("DepartmentRole")
    employee = relationship("HREmployee")


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
    description = Column(String(240), nullable=True)
    icon = Column(String(40), nullable=True)
    route = Column(String(240), nullable=True)
    status = Column(String(20), nullable=False, default="planned")
    sort_order = Column(Integer, nullable=False, default=100)
    permission_key = Column(String(80), nullable=True, index=True)
    nav_group = Column(String(80), nullable=True)
    nav_order = Column(
        Integer, nullable=False, default=100, server_default="100"
    )
    is_owner = Column(Boolean, nullable=False, default=True, server_default="1")
    is_shared = Column(Boolean, nullable=False, default=False, server_default="0")
    department = relationship("BusinessDepartment", back_populates="modules")


class WorkItem(Base):
    __tablename__ = "work_items"
    id = Column(Integer, primary_key=True, index=True)
    department_id = Column(
        Integer, ForeignKey("business_departments.id"), index=True, nullable=False
    )
    title = Column(String(200), nullable=False)
    description = Column(Text, nullable=True)
    kind = Column(String(30), nullable=False, default="task")
    status = Column(String(30), nullable=False, default="open", index=True)
    priority = Column(String(20), nullable=False, default="normal", index=True)
    owner_staff_id = Column(String(120), nullable=True, index=True)
    created_by = Column(String(160), nullable=True)
    due_at = Column(DateTime, nullable=True, index=True)
    source_type = Column(String(60), nullable=True)
    source_id = Column(String(120), nullable=True)
    store_id = Column(Integer, ForeignKey("stores.id"), index=True, nullable=True)
    metadata_json = Column(JSON, default=dict)
    completed_at = Column(DateTime, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow, index=True)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    department = relationship("BusinessDepartment")
    comments = relationship(
        "WorkItemComment",
        back_populates="work_item",
        cascade="all, delete-orphan",
    )


class WorkItemComment(Base):
    __tablename__ = "work_item_comments"
    id = Column(Integer, primary_key=True, index=True)
    work_item_id = Column(
        Integer, ForeignKey("work_items.id"), index=True, nullable=False
    )
    author_staff_id = Column(String(120), nullable=True)
    author_name = Column(String(160), nullable=True)
    body = Column(Text, nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow, index=True)
    work_item = relationship("WorkItem", back_populates="comments")


class Approval(Base):
    __tablename__ = "approvals"
    id = Column(Integer, primary_key=True, index=True)
    department_id = Column(
        Integer, ForeignKey("business_departments.id"), index=True, nullable=False
    )
    kind = Column(String(40), nullable=False, index=True)
    title = Column(String(200), nullable=False)
    amount = Column(Float, nullable=True)
    currency = Column(String(8), nullable=False, default="INR")
    status = Column(String(20), nullable=False, default="pending", index=True)
    requested_by = Column(String(160), nullable=True)
    decided_by = Column(String(160), nullable=True)
    decided_at = Column(DateTime, nullable=True)
    note = Column(Text, nullable=True)
    source_type = Column(String(60), nullable=True, index=True)
    source_id = Column(String(120), nullable=True, index=True)
    store_id = Column(Integer, ForeignKey("stores.id"), index=True, nullable=True)
    metadata_json = Column(JSON, default=dict)
    created_at = Column(DateTime, default=datetime.utcnow, index=True)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    department = relationship("BusinessDepartment")
    steps = relationship(
        "ApprovalStep", back_populates="approval", cascade="all, delete-orphan"
    )


class ApprovalStep(Base):
    __tablename__ = "approval_steps"
    id = Column(Integer, primary_key=True, index=True)
    approval_id = Column(
        Integer, ForeignKey("approvals.id"), index=True, nullable=False
    )
    step_order = Column(Integer, nullable=False, default=1)
    approver_department_id = Column(
        Integer, ForeignKey("business_departments.id"), index=True, nullable=True
    )
    approver_staff_id = Column(String(120), nullable=True, index=True)
    status = Column(String(20), nullable=False, default="pending")
    decided_at = Column(DateTime, nullable=True)
    note = Column(Text, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    approval = relationship("Approval", back_populates="steps")


class StaffNotification(Base):
    __tablename__ = "staff_notifications"
    id = Column(Integer, primary_key=True, index=True)
    staff_id = Column(String(120), index=True, nullable=False)
    department_id = Column(
        Integer, ForeignKey("business_departments.id"), index=True, nullable=True
    )
    kind = Column(String(40), nullable=False, default="info")
    title = Column(String(200), nullable=False)
    body = Column(Text, nullable=True)
    link = Column(String(240), nullable=True)
    read_at = Column(DateTime, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow, index=True)


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
    media_type = Column(String(20), nullable=False, default="image", server_default="image")
    poster_url = Column(String(500), nullable=True)
    duration_seconds = Column(Float, nullable=True)
    caption_url = Column(String(500), nullable=True)
    caption_language = Column(String(20), nullable=True)
    width = Column(Integer, nullable=True)
    height = Column(Integer, nullable=True)
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
    payment_provider = Column(String(30), nullable=True)
    prices_include_tax = Column(Boolean, nullable=False, default=False)
    service_charge_rate = Column(Float, nullable=False, default=0.0)
    service_charge_label = Column(String(40), nullable=False, default="Service charge")
    tax_slabs = Column(JSON, default=list)
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
    max_sends_per_customer = Column(Integer, nullable=False, default=0)
    frequency_window_hours = Column(Integer, nullable=False, default=24)
    holdout_percent = Column(Float, nullable=False, default=0.0, server_default="0")
    suppression_hours = Column(Integer, nullable=False, default=0, server_default="0")
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
    touches = relationship(
        "JourneyTouch", back_populates="enrollment", cascade="all, delete-orphan"
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


class JourneyTouch(Base):
    """A successful journey send with its own click/open tracking tokens."""

    __tablename__ = "journey_touches"
    id = Column(Integer, primary_key=True, index=True)
    enrollment_id = Column(
        Integer, ForeignKey("journey_enrollments.id"), nullable=False, index=True
    )
    step_index = Column(Integer, nullable=False, default=0)
    channel = Column(String(50), nullable=False)
    tracking_token = Column(String(80), unique=True, index=True, nullable=True)
    open_token = Column(String(80), unique=True, index=True, nullable=True)
    click_count = Column(Integer, nullable=False, default=0, server_default="0")
    open_count = Column(Integer, nullable=False, default=0, server_default="0")
    clicked_at = Column(DateTime, nullable=True)
    opened_at = Column(DateTime, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow, index=True)
    enrollment = relationship("JourneyEnrollment", back_populates="touches")


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
    offer_approvals_required = Column(Boolean, nullable=False, default=False, server_default="0")
    created_at = Column(DateTime, default=datetime.utcnow, index=True)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    applications = relationship(
        "RecruitmentApplication", back_populates="job", cascade="all, delete-orphan"
    )


class OfferTemplate(Base):
    """Reusable offer terms that are snapshotted onto an application."""

    __tablename__ = "offer_templates"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(160), unique=True, nullable=False)
    body = Column(Text, nullable=False)
    is_default = Column(Boolean, nullable=False, default=False)
    created_at = Column(DateTime, default=datetime.utcnow, index=True)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)


class OfferApproval(Base):
    """One step in a job's offer approval chain."""

    __tablename__ = "offer_approvals"

    id = Column(Integer, primary_key=True, index=True)
    application_id = Column(
        Integer, ForeignKey("recruitment_applications.id"), nullable=False, index=True
    )
    step_index = Column(Integer, nullable=False, default=0)
    step_name = Column(String(120), nullable=False)
    status = Column(String(20), nullable=False, default="pending", index=True)
    approver = Column(String(120), nullable=True)
    note = Column(String(500), nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    decided_at = Column(DateTime, nullable=True)
    application = relationship("RecruitmentApplication", back_populates="offer_approvals")


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
    resume_file_name = Column(String(255), nullable=True)
    resume_original_name = Column(String(255), nullable=True)
    resume_mime_type = Column(String(120), nullable=True)
    resume_text = Column(Text, nullable=True)
    resume_parsed = Column(JSON, default=dict)
    resume_uploaded_at = Column(DateTime, nullable=True)
    offer_token = Column(String(80), nullable=True, unique=True, index=True)
    offer_status = Column(String(30), nullable=True)
    offer_expires_at = Column(DateTime, nullable=True)
    offer_sent_at = Column(DateTime, nullable=True)
    offer_responded_at = Column(DateTime, nullable=True)
    offer_signed_name = Column(String(160), nullable=True)
    offer_response_note = Column(Text, nullable=True)
    offer_pdf_name = Column(String(255), nullable=True)
    offer_delivery_status = Column(String(30), nullable=True)
    offer_delivery_error = Column(Text, nullable=True)
    offer_last_sent_at = Column(DateTime, nullable=True)
    offer_reminder_sent_at = Column(DateTime, nullable=True)
    offer_reminder_count = Column(Integer, nullable=False, default=0, server_default="0")
    offer_countersigned_by = Column(String(160), nullable=True)
    offer_countersigned_at = Column(DateTime, nullable=True)
    offer_template_id = Column(Integer, ForeignKey("offer_templates.id"), nullable=True)
    offer_template_name = Column(String(160), nullable=True)
    offer_terms = Column(Text, nullable=True)
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
    offer_approvals = relationship(
        "OfferApproval", back_populates="application", cascade="all, delete-orphan"
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
    score = Column(Integer, nullable=True)
    recommendation = Column(String(30), nullable=True)
    scored_at = Column(DateTime, nullable=True)
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


class SupportTicket(Base):
    """Guest/staff support conversation for orders, delivery or account issues."""

    __tablename__ = "support_tickets"

    id = Column(Integer, primary_key=True, index=True)
    token = Column(String(80), unique=True, index=True, nullable=False)
    customer_name = Column(String(160), nullable=False)
    email = Column(String(200), nullable=True)
    phone = Column(String(30), nullable=True)
    subject = Column(String(200), nullable=False)
    category = Column(String(40), nullable=False, default="other", index=True)
    priority = Column(String(20), nullable=False, default="normal", index=True)
    status = Column(String(20), nullable=False, default="open", index=True)
    order_id = Column(Integer, ForeignKey("orders.id"), nullable=True, index=True)
    assigned_to = Column(String(120), nullable=True)
    sla_due_at = Column(DateTime, nullable=True, index=True)
    first_response_due_at = Column(DateTime, nullable=True)
    first_response_at = Column(DateTime, nullable=True)
    resolved_at = Column(DateTime, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow, index=True)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    last_message_at = Column(DateTime, default=datetime.utcnow, index=True)
    messages = relationship(
        "SupportMessage", back_populates="ticket", cascade="all, delete-orphan"
    )


class SupportSlaPolicy(Base):
    """Editable first-response and resolution targets per ticket priority."""

    __tablename__ = "support_sla_policies"

    id = Column(Integer, primary_key=True, index=True)
    priority = Column(String(20), unique=True, index=True, nullable=False)
    response_minutes = Column(Integer, nullable=False)
    resolution_minutes = Column(Integer, nullable=False)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)


class SupportNotification(Base):
    """One in-app SLA alert per ticket and alert kind."""

    __tablename__ = "support_notifications"
    __table_args__ = (
        UniqueConstraint("ticket_id", "kind", name="uq_support_notification_ticket_kind"),
    )

    id = Column(Integer, primary_key=True, index=True)
    ticket_id = Column(
        Integer, ForeignKey("support_tickets.id"), nullable=False, index=True
    )
    kind = Column(String(40), nullable=False, index=True)
    message = Column(String(500), nullable=False)
    delivery_status = Column(String(40), nullable=False, default="pending")
    delivery_channels = Column(String(120), nullable=True)
    delivery_error = Column(String(500), nullable=True)
    delivery_attempts = Column(Integer, nullable=False, default=0, server_default="0")
    last_attempt_at = Column(DateTime, nullable=True)
    next_retry_at = Column(DateTime, nullable=True, index=True)
    pager_dedup_key = Column(String(120), nullable=True)
    pager_resolved_at = Column(DateTime, nullable=True)
    delivered_at = Column(DateTime, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow, index=True)
    read_at = Column(DateTime, nullable=True, index=True)


class SupportMessage(Base):
    __tablename__ = "support_messages"
    id = Column(Integer, primary_key=True, index=True)
    ticket_id = Column(
        Integer, ForeignKey("support_tickets.id"), nullable=False, index=True
    )
    author_type = Column(String(20), nullable=False, default="customer")
    author_name = Column(String(160), nullable=True)
    body = Column(Text, nullable=False)
    internal = Column(Boolean, nullable=False, default=False)
    created_at = Column(DateTime, default=datetime.utcnow, index=True)
    ticket = relationship("SupportTicket", back_populates="messages")


# ---------------------------------------------------------------------------
# Department operations: checklists, facilities, quality, training, franchise,
# goals, gift cards and stocktake. These back the department workspaces that
# used to be listed as "planned" in the company catalogue.
# ---------------------------------------------------------------------------


class OpsChecklistTemplate(Base):
    """A reusable opening / closing / shift checklist."""

    __tablename__ = "ops_checklist_templates"
    id = Column(Integer, primary_key=True, index=True)
    department_key = Column(String(60), nullable=False, index=True, default="operations")
    name = Column(String(160), nullable=False)
    description = Column(String(500), nullable=True)
    kind = Column(String(30), nullable=False, default="daily", index=True)
    items = Column(JSON, nullable=False, default=list)
    active = Column(Boolean, nullable=False, default=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)


class OpsChecklistRun(Base):
    """One execution of a checklist on a given day."""

    __tablename__ = "ops_checklist_runs"
    __table_args__ = (
        UniqueConstraint("template_id", "store_id", "run_date", name="uq_checklist_run_day"),
    )
    id = Column(Integer, primary_key=True, index=True)
    template_id = Column(
        Integer, ForeignKey("ops_checklist_templates.id"), nullable=False, index=True
    )
    store_id = Column(
        Integer, ForeignKey("stores.id"), index=True, nullable=False, default=1,
        server_default="1",
    )
    run_date = Column(Date, nullable=False, index=True)
    status = Column(String(20), nullable=False, default="in_progress", index=True)
    items = Column(JSON, nullable=False, default=list)
    started_by = Column(String(120), nullable=True)
    completed_by = Column(String(120), nullable=True)
    completed_at = Column(DateTime, nullable=True)
    notes = Column(String(1000), nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    template = relationship("OpsChecklistTemplate")


class MaintenanceAsset(Base):
    """A piece of equipment tracked by facilities."""

    __tablename__ = "maintenance_assets"
    id = Column(Integer, primary_key=True, index=True)
    store_id = Column(
        Integer, ForeignKey("stores.id"), index=True, nullable=False, default=1,
        server_default="1",
    )
    name = Column(String(160), nullable=False)
    category = Column(String(60), nullable=False, default="kitchen", index=True)
    location = Column(String(120), nullable=True)
    serial_number = Column(String(120), nullable=True)
    status = Column(String(30), nullable=False, default="operational", index=True)
    criticality = Column(String(20), nullable=False, default="normal")
    purchase_date = Column(Date, nullable=True)
    warranty_until = Column(Date, nullable=True)
    next_service_due = Column(Date, nullable=True, index=True)
    notes = Column(String(1000), nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)


class MaintenanceWorkOrder(Base):
    """A repair or preventive-maintenance job."""

    __tablename__ = "maintenance_work_orders"
    id = Column(Integer, primary_key=True, index=True)
    asset_id = Column(
        Integer, ForeignKey("maintenance_assets.id"), index=True, nullable=True
    )
    store_id = Column(
        Integer, ForeignKey("stores.id"), index=True, nullable=False, default=1,
        server_default="1",
    )
    title = Column(String(200), nullable=False)
    description = Column(Text, nullable=True)
    priority = Column(String(20), nullable=False, default="normal", index=True)
    status = Column(String(30), nullable=False, default="open", index=True)
    reported_by = Column(String(120), nullable=True)
    assigned_to = Column(String(120), nullable=True)
    due_at = Column(DateTime, nullable=True, index=True)
    completed_at = Column(DateTime, nullable=True)
    cost = Column(Numeric(10, 2), nullable=False, default=0, server_default="0")
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    asset = relationship("MaintenanceAsset")


class QualityAudit(Base):
    """A scored food-safety / hygiene audit with structured findings."""

    __tablename__ = "quality_audits"
    id = Column(Integer, primary_key=True, index=True)
    store_id = Column(
        Integer, ForeignKey("stores.id"), index=True, nullable=False, default=1,
        server_default="1",
    )
    department_key = Column(String(60), nullable=False, default="quality", index=True)
    title = Column(String(200), nullable=False)
    audit_type = Column(String(40), nullable=False, default="hygiene", index=True)
    auditor = Column(String(120), nullable=True)
    status = Column(String(30), nullable=False, default="scheduled", index=True)
    score = Column(Float, nullable=True)
    max_score = Column(Float, nullable=False, default=100)
    findings = Column(JSON, nullable=False, default=list)
    notes = Column(Text, nullable=True)
    scheduled_for = Column(Date, nullable=True, index=True)
    completed_at = Column(DateTime, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)


class TemperatureLog(Base):
    """Fridge, freezer and hot-holding temperature checks."""

    __tablename__ = "temperature_logs"
    id = Column(Integer, primary_key=True, index=True)
    store_id = Column(
        Integer, ForeignKey("stores.id"), index=True, nullable=False, default=1,
        server_default="1",
    )
    unit_name = Column(String(120), nullable=False)
    unit_type = Column(String(40), nullable=False, default="fridge", index=True)
    temperature_c = Column(Float, nullable=False)
    status = Column(String(20), nullable=False, default="ok", index=True)
    recorded_by = Column(String(120), nullable=True)
    recorded_at = Column(DateTime, default=datetime.utcnow, index=True)
    notes = Column(String(500), nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)


class ComplianceLicence(Base):
    """Licences and certificates with expiry tracking."""

    __tablename__ = "compliance_licences"
    id = Column(Integer, primary_key=True, index=True)
    store_id = Column(
        Integer, ForeignKey("stores.id"), index=True, nullable=True
    )
    name = Column(String(200), nullable=False)
    category = Column(String(60), nullable=False, default="fssai", index=True)
    licence_number = Column(String(120), nullable=True)
    issuing_authority = Column(String(200), nullable=True)
    issued_on = Column(Date, nullable=True)
    expires_on = Column(Date, nullable=True, index=True)
    status = Column(String(30), nullable=False, default="valid", index=True)
    document_url = Column(String(500), nullable=True)
    owner_staff_id = Column(String(120), nullable=True)
    notes = Column(String(1000), nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)


class TrainingCourse(Base):
    """A short internal course with optional quiz questions."""

    __tablename__ = "training_courses"
    id = Column(Integer, primary_key=True, index=True)
    key = Column(String(80), unique=True, index=True, nullable=False)
    title = Column(String(200), nullable=False)
    description = Column(Text, nullable=True)
    department_key = Column(String(60), nullable=False, default="training", index=True)
    level = Column(String(30), nullable=False, default="core", index=True)
    duration_minutes = Column(Integer, nullable=False, default=15)
    pass_score = Column(Integer, nullable=False, default=80)
    quiz = Column(JSON, nullable=False, default=list)
    content = Column(JSON, nullable=False, default=list)
    active = Column(Boolean, nullable=False, default=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)


class TrainingRecord(Base):
    """A course assignment and its result for one employee."""

    __tablename__ = "training_records"
    id = Column(Integer, primary_key=True, index=True)
    course_id = Column(
        Integer, ForeignKey("training_courses.id"), nullable=False, index=True
    )
    employee_id = Column(
        Integer, ForeignKey("hr_employees.id"), nullable=True, index=True
    )
    staff_name = Column(String(160), nullable=False)
    status = Column(String(30), nullable=False, default="assigned", index=True)
    score = Column(Float, nullable=True)
    answers = Column(JSON, nullable=False, default=list)
    assigned_at = Column(DateTime, default=datetime.utcnow)
    due_on = Column(Date, nullable=True)
    completed_at = Column(DateTime, nullable=True)
    notes = Column(String(500), nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    course = relationship("TrainingCourse")


class FranchiseSite(Base):
    """A franchise prospect moving through the expansion pipeline."""

    __tablename__ = "franchise_sites"
    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(200), nullable=False)
    city = Column(String(120), nullable=False, index=True)
    state = Column(String(120), nullable=True)
    contact_name = Column(String(160), nullable=True)
    contact_phone = Column(String(30), nullable=True)
    contact_email = Column(String(200), nullable=True)
    stage = Column(String(40), nullable=False, default="lead", index=True)
    expected_investment = Column(Numeric(12, 2), nullable=False, default=0, server_default="0")
    probability = Column(Integer, nullable=False, default=20)
    owner_staff_id = Column(String(120), nullable=True)
    next_step = Column(String(300), nullable=True)
    next_action_on = Column(Date, nullable=True, index=True)
    notes = Column(Text, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)


class CompanyGoal(Base):
    """A department or company-level target with progress tracking."""

    __tablename__ = "company_goals"
    id = Column(Integer, primary_key=True, index=True)
    department_key = Column(String(60), nullable=False, default="executive", index=True)
    title = Column(String(200), nullable=False)
    description = Column(String(1000), nullable=True)
    owner_staff_id = Column(String(120), nullable=True)
    metric = Column(String(120), nullable=False, default="revenue")
    target_value = Column(Float, nullable=False, default=0)
    current_value = Column(Float, nullable=False, default=0, server_default="0")
    unit = Column(String(30), nullable=False, default="₹")
    period = Column(String(30), nullable=False, default="monthly", index=True)
    start_date = Column(Date, nullable=True)
    end_date = Column(Date, nullable=True, index=True)
    status = Column(String(30), nullable=False, default="active", index=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)


class GiftCard(Base):
    """A stored-value gift card that can be redeemed at checkout."""

    __tablename__ = "gift_cards"
    id = Column(Integer, primary_key=True, index=True)
    code = Column(String(40), unique=True, index=True, nullable=False)
    initial_balance = Column(Numeric(10, 2), nullable=False, default=0)
    balance = Column(Numeric(10, 2), nullable=False, default=0, server_default="0")
    currency = Column(String(10), nullable=False, default="INR")
    status = Column(String(20), nullable=False, default="active", index=True)
    customer_phone = Column(String(30), nullable=True, index=True)
    note = Column(String(500), nullable=True)
    issued_by = Column(String(120), nullable=True)
    issued_at = Column(DateTime, default=datetime.utcnow)
    expires_on = Column(Date, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)


class GiftCardTransaction(Base):
    """Every balance movement for a gift card."""

    __tablename__ = "gift_card_transactions"
    id = Column(Integer, primary_key=True, index=True)
    gift_card_id = Column(
        Integer, ForeignKey("gift_cards.id"), nullable=False, index=True
    )
    order_id = Column(
        Integer, ForeignKey("orders.id"), nullable=True, index=True
    )
    kind = Column(String(30), nullable=False, default="redeem", index=True)
    amount = Column(Numeric(10, 2), nullable=False, default=0)
    balance_after = Column(Numeric(10, 2), nullable=False, default=0)
    reference = Column(String(120), nullable=True)
    note = Column(String(500), nullable=True)
    created_by = Column(String(120), nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow, index=True)
    gift_card = relationship("GiftCard")


class StocktakeSession(Base):
    """A physical stock count for a store."""

    __tablename__ = "stocktake_sessions"
    id = Column(Integer, primary_key=True, index=True)
    store_id = Column(
        Integer, ForeignKey("stores.id"), index=True, nullable=False, default=1,
        server_default="1",
    )
    title = Column(String(200), nullable=False, default="Stocktake")
    status = Column(String(30), nullable=False, default="draft", index=True)
    counted_by = Column(String(120), nullable=True)
    started_at = Column(DateTime, default=datetime.utcnow)
    completed_at = Column(DateTime, nullable=True)
    variance_value = Column(Numeric(12, 2), nullable=False, default=0, server_default="0")
    notes = Column(String(1000), nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)


class StocktakeLine(Base):
    """Expected vs counted quantity for one inventory item."""

    __tablename__ = "stocktake_lines"
    id = Column(Integer, primary_key=True, index=True)
    session_id = Column(
        Integer, ForeignKey("stocktake_sessions.id"), nullable=False, index=True
    )
    item_id = Column(Integer, ForeignKey("inventory_items.id"), nullable=True, index=True)
    item_name = Column(String(160), nullable=False)
    unit = Column(String(30), nullable=True)
    expected_qty = Column(Float, nullable=False, default=0)
    counted_qty = Column(Float, nullable=False, default=0)
    variance_qty = Column(Float, nullable=False, default=0)
    unit_cost = Column(Float, nullable=False, default=0)
    variance_value = Column(Float, nullable=False, default=0)
    note = Column(String(500), nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    session = relationship("StocktakeSession")
