from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from app.core.config import settings
from app.api.api_v1.api import api_router
from app.db.base import Base
from app.db.session import SessionLocal, engine
from app.models import domain
from app.models.domain import DiningTable, ExpenseCategory, MenuItem, Vendor
from app.services.delivery_service import seed_default_delivery_zones

from contextlib import asynccontextmanager
from app.core.scheduler import start_scheduler

DEFAULT_TABLES = [
    ("T1", 4),
    ("T2", 4),
    ("T3", 6),
    ("T4", 2),
    ("T5", 4),
    ("T6", 8),
    ("T7", 2),
    ("T8", 4),
]

DEFAULT_MENU_ITEMS = [
    {"name": "Margherita Pizza (R)", "category": "Pizza", "selling_price": 199.0, "cost_price": 80.0},
    {"name": "Margherita Pizza (M)", "category": "Pizza", "selling_price": 299.0, "cost_price": 120.0},
    {"name": "Margherita Pizza (L)", "category": "Pizza", "selling_price": 449.0, "cost_price": 180.0},
    {"name": "Farmhouse Pizza (R)", "category": "Pizza", "selling_price": 249.0, "cost_price": 100.0},
    {"name": "Garlic Bread", "category": "Sides", "selling_price": 119.0, "cost_price": 40.0},
    {"name": "French Fries", "category": "Sides", "selling_price": 89.0, "cost_price": 25.0},
    {"name": "Cheese Burst Burger", "category": "Burgers", "selling_price": 149.0, "cost_price": 60.0},
    {"name": "Veggie Delight Sandwich", "category": "Sandwiches", "selling_price": 129.0, "cost_price": 50.0},
    {"name": "Cold Coffee", "category": "Beverages", "selling_price": 99.0, "cost_price": 30.0},
    {"name": "Brownie", "category": "Desserts", "selling_price": 79.0, "cost_price": 20.0},
]

DEFAULT_VENDORS = [
    {"name": "Amul Dairy Supplier", "contact_person": "Procurement Desk", "category": "Dairy"},
    {"name": "Local Vegetable Market", "contact_person": "Fresh Produce Desk", "category": "Vegetables"},
    {"name": "Bakery Base Partner", "contact_person": "Kitchen Supplies", "category": "Bakery"},
]

DEFAULT_EXPENSE_CATEGORIES = [
    "Inventory Purchase",
    "Staff & Ops",
    "Utilities",
    "Rent",
    "Marketing",
    "Maintenance",
    "Packaging",
    "Delivery",
]


def seed_baseline_data() -> None:
    db = SessionLocal()
    try:
        existing_tables = {row.table_number for row in db.query(DiningTable).all()}
        for table_number, capacity in DEFAULT_TABLES:
            if table_number not in existing_tables:
                db.add(DiningTable(table_number=table_number, capacity=capacity))

        existing_menu = {row.name for row in db.query(MenuItem).all()}
        for item in DEFAULT_MENU_ITEMS:
            if item["name"] not in existing_menu:
                db.add(MenuItem(**item))

        existing_vendors = {row.name for row in db.query(Vendor).all()}
        for vendor in DEFAULT_VENDORS:
            if vendor["name"] not in existing_vendors:
                db.add(Vendor(**vendor))

        existing_categories = {row.name for row in db.query(ExpenseCategory).all()}
        for category_name in DEFAULT_EXPENSE_CATEGORIES:
            if category_name not in existing_categories:
                db.add(ExpenseCategory(name=category_name, is_active=True))

        seed_default_delivery_zones(db)
        db.commit()
    finally:
        db.close()

@asynccontextmanager
async def lifespan(app: FastAPI):
    Base.metadata.create_all(bind=engine)
    seed_baseline_data()
    start_scheduler()
    yield

app = FastAPI(
    title=settings.PROJECT_NAME,
    openapi_url=f"{settings.API_V1_STR}/openapi.json",
    lifespan=lifespan
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[str(origin) for origin in settings.BACKEND_CORS_ORIGINS] if settings.BACKEND_CORS_ORIGINS else ["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(api_router, prefix=settings.API_V1_STR)

@app.get("/health")
def health_check():
    return {"status": "ok", "project": settings.PROJECT_NAME}
