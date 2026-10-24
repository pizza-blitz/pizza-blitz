import logging
import os
import time
from uuid import uuid4

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles
from sqlalchemy import text
from app.core.config import settings, validate_production_settings
from app.core.rate_limit import reset_rate_limits
from app.api.api_v1.api import api_router
from app.db.base import Base
from app.db.session import SessionLocal, engine
from app.models import domain  # noqa: F401 - registers the complete SQLAlchemy metadata
from app.models.domain import DiningTable, ExpenseCategory, MenuItem, Vendor
from app.services.delivery_service import seed_default_delivery_zones
from app.services.menu_customization_service import seed_default_customizations
from app.services.store_service import ensure_default_store
from app.services.department_service import ensure_departments
from app.services.hr_leave_service import ensure_leave_types
from app.services.media_service import media_root

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

POSTGRES_BOOTSTRAP_LOCK_ID = 20260525


def _environment_flag(name: str, default: bool) -> bool:
    raw_value = os.getenv(name)
    if raw_value is None:
        return default
    return raw_value.strip().lower() in {"1", "true", "yes", "on"}


def is_vercel_serverless_runtime() -> bool:
    return os.getenv("VERCEL") == "1"


def should_bootstrap_database_on_startup() -> bool:
    return _environment_flag(
        "PIZZA_BLITZ_BOOTSTRAP_ON_STARTUP",
        not is_vercel_serverless_runtime(),
    )


def should_start_scheduler() -> bool:
    return _environment_flag(
        "PIZZA_BLITZ_SCHEDULER_ENABLED",
        not is_vercel_serverless_runtime(),
    )


def seed_baseline_data(db=None) -> None:
    owns_session = db is None
    if db is None:
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
        seed_default_customizations(db)
        ensure_default_store(db)
        ensure_departments(db)
        ensure_leave_types(db)
        if owns_session:
            db.commit()
        else:
            db.flush()
    finally:
        if owns_session:
            db.close()


def bootstrap_database() -> None:
    if engine.dialect.name == "postgresql":
        with engine.begin() as connection:
            connection.execute(
                text("SELECT pg_advisory_xact_lock(:lock_id)"),
                {"lock_id": POSTGRES_BOOTSTRAP_LOCK_ID},
            )
            Base.metadata.create_all(bind=connection)
            db = SessionLocal(bind=connection)
            try:
                seed_baseline_data(db)
            finally:
                db.close()
        return

    Base.metadata.create_all(bind=engine)
    seed_baseline_data()

@asynccontextmanager
async def lifespan(app: FastAPI):
    # A fresh process (including each test client) starts with empty buckets.
    reset_rate_limits()
    validate_production_settings()
    if should_bootstrap_database_on_startup():
        bootstrap_database()
    if should_start_scheduler():
        start_scheduler()
    yield

app = FastAPI(
    title=settings.PROJECT_NAME,
    openapi_url=f"{settings.API_V1_STR}/openapi.json",
    lifespan=lifespan
)

configured_cors_origins = settings.cors_origins
allow_origins = (
    configured_cors_origins
    if configured_cors_origins or settings.ENVIRONMENT.lower() == "production"
    else ["*"]
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=allow_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

request_logger = logging.getLogger("pizzablitz.requests")


def _security_headers() -> dict[str, str]:
    headers = {
        "X-Content-Type-Options": "nosniff",
        "X-Frame-Options": "DENY",
        "Referrer-Policy": "no-referrer",
        "Permissions-Policy": "camera=(), microphone=(), geolocation=(self)",
        "Content-Security-Policy": "default-src 'none'; frame-ancestors 'none'; base-uri 'none'",
        "X-XSS-Protection": "0",
    }
    if settings.ENVIRONMENT.lower() == "production":
        headers["Strict-Transport-Security"] = (
            "max-age=31536000; includeSubDomains; preload"
        )
    return headers


@app.middleware("http")
async def add_security_headers(request: Request, call_next):
    response = await call_next(request)
    for name, value in _security_headers().items():
        response.headers.setdefault(name, value)
    return response


@app.middleware("http")
async def monitor_requests(request: Request, call_next):
    request_id = (request.headers.get("X-Request-ID") or uuid4().hex)[:64]
    started_at = time.perf_counter()
    try:
        response = await call_next(request)
    except Exception:
        request_logger.exception(
            "Unhandled request error id=%s method=%s path=%s",
            request_id,
            request.method,
            request.url.path,
        )
        return JSONResponse(
            status_code=500,
            content={
                "detail": "Internal server error.",
                "request_id": request_id,
            },
            headers={"X-Request-ID": request_id, **_security_headers()},
        )
    duration_ms = round((time.perf_counter() - started_at) * 1000, 1)
    response.headers["X-Request-ID"] = request_id
    if response.status_code >= 500:
        request_logger.warning(
            "Server error id=%s status=%s method=%s path=%s duration_ms=%s",
            request_id,
            response.status_code,
            request.method,
            request.url.path,
            duration_ms,
        )
    elif duration_ms >= 2000:
        request_logger.info(
            "Slow request id=%s status=%s method=%s path=%s duration_ms=%s",
            request_id,
            response.status_code,
            request.method,
            request.url.path,
            duration_ms,
        )
    return response

app.include_router(api_router, prefix=settings.API_V1_STR)

media_root().mkdir(parents=True, exist_ok=True)
app.mount("/media", StaticFiles(directory=str(media_root())), name="media")

@app.get("/health")
def health_check():
    return {"status": "ok", "project": settings.PROJECT_NAME}


@app.get("/ready")
def readiness_check():
    """Deployment readiness probe: confirms the database is reachable."""
    try:
        with engine.connect() as connection:
            connection.execute(text("SELECT 1"))
    except Exception:
        return JSONResponse(
            status_code=503,
            content={"status": "unavailable", "database": "error"},
        )
    return {
        "status": "ready",
        "database": "ok",
        "project": settings.PROJECT_NAME,
    }
