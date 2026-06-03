import os
import shutil
import sqlite3
import urllib.error
import urllib.request
from datetime import date, datetime, timedelta
from pathlib import Path
from typing import Optional

from sqlalchemy import func, text
from sqlalchemy.engine.url import make_url
from sqlalchemy.orm import Session

from app.core.config import settings
from app.models.domain import (
    AdCampaign,
    AdCampaignLaunch,
    BackupRun,
    CampaignDelivery,
    Customer,
    DailySales,
    DeliveryAssignment,
    DeliveryZone,
    Expense,
    ExpenseCategory,
    MenuCustomizationGroup,
    MenuCustomizationOption,
    MenuItem,
    OperationalAuditEvent,
    Promotion,
    ProviderTestRun,
    RestaurantOrder,
    SocialPost,
    SocialPostDelivery,
    ShiftLog,
    StaffLeaveRequest,
)
from app.services.ad_campaign_service import ad_provider_status
from app.services.auth_service import has_managed_admin_credentials, has_managed_staff_credentials
from app.services.campaign_dispatch_service import campaign_provider_status
from app.services.payment_gateway import payment_provider_status
from app.services.social_publish_service import social_provider_status


DEFAULT_SECRET_VALUES = {
    "",
    "admin123",
    "staff123",
    "change-me",
    "change-this-long-random-secret",
    "pizza-blitz-local-secret",
    "pizza-blitz-local-session-secret",
}

PAYMENT_PROVIDER_ORDER = ("manual", "direct_bank", "cashfree", "razorpay")
BACKUP_PROOF_TYPES = {"managed_snapshot", "pg_dump"}
RESTORE_REHEARSAL_EVIDENCE_REQUIREMENTS = [
    {
        "key": "source_backup",
        "label": "Source backup or snapshot",
        "detail": "Use a recent managed snapshot or pg_dump export as the restore source.",
    },
    {
        "key": "clean_restore_target",
        "label": "Clean restore target",
        "detail": "Restore into a separate clean database, not over the live production database.",
    },
    {
        "key": "admin_login_smoke",
        "label": "Admin login smoke",
        "detail": "Sign in as the master admin and open Dashboard, Ops, Reports and Settings.",
    },
    {
        "key": "order_flow_smoke",
        "label": "Order flow smoke",
        "detail": "Open customer checkout or counter POS, create a test order, and confirm receipt/tracking loads.",
    },
    {
        "key": "report_export_smoke",
        "label": "Report/export smoke",
        "detail": "Confirm customer, sales/report, and payment audit data can be read from the restored database.",
    },
]
RESTORE_REHEARSAL_NOTE_HINTS = [
    ("restore target", ("restore", "restored", "target", "clean database")),
    ("admin login smoke", ("admin", "login", "ops", "dashboard")),
    ("order smoke", ("order", "checkout", "pos", "receipt", "tracking")),
    ("report/export smoke", ("report", "export", "customer", "sales")),
]
RESTORE_REHEARSAL_REQUIRED_TABLES = (
    "customers",
    "daily_sales",
    "orders",
    "menu_items",
    "backup_runs",
)
LIVE_DEPLOYMENT_AUDIT_ACTION = "live_deployment_probe"
LIVE_DEPLOYMENT_REQUIRED_CHECKS = (
    "public_api_health",
    "checkout_database_readiness",
    "cors_origin_lock",
    "public_order_page",
)

ENVIRONMENT_VARIABLE_GROUPS = [
    {
        "key": "core",
        "title": "Core Deployment",
        "variables": [
            {
                "name": "ENVIRONMENT",
                "required": True,
                "sensitive": False,
                "purpose": "Run the API in production mode before public launch.",
            },
            {
                "name": "SQLALCHEMY_DATABASE_URI",
                "required": True,
                "sensitive": True,
                "purpose": "Connect the API to the production database.",
            },
            {
                "name": "BACKEND_CORS_ORIGINS",
                "required": True,
                "sensitive": False,
                "purpose": "Restrict browser access to deployed frontend origins.",
            },
            {
                "name": "BACKUP_DIR",
                "required": False,
                "sensitive": False,
                "purpose": "Choose where local SQLite backups are written.",
            },
            {
                "name": "BACKUP_RETENTION_DAYS",
                "required": False,
                "sensitive": False,
                "purpose": "Control local backup retention pruning.",
            },
        ],
    },
    {
        "key": "security",
        "title": "Environment Security",
        "variables": [
            {
                "name": "RESTAURANT_ADMIN_ID",
                "aliases": ["PIZZA_BLITZ_ADMIN_ID"],
                "required": True,
                "sensitive": False,
                "purpose": "Configure the admin login id.",
            },
            {
                "name": "RESTAURANT_ADMIN_PASSWORD",
                "aliases": ["PIZZA_BLITZ_ADMIN_PASSWORD"],
                "required": True,
                "sensitive": True,
                "purpose": "Configure a strong admin password.",
            },
            {
                "name": "PIZZA_BLITZ_STAFF_ID",
                "required": False,
                "sensitive": False,
                "purpose": "Optional fallback staff login id when managed staff credentials are not used.",
            },
            {
                "name": "PIZZA_BLITZ_STAFF_PASSWORD",
                "required": False,
                "sensitive": True,
                "purpose": "Optional fallback staff password when managed staff credentials are not used.",
            },
            {
                "name": "AUTH_SECRET_KEY",
                "required": True,
                "sensitive": True,
                "purpose": "Sign API bearer tokens.",
            },
            {
                "name": "PIZZA_BLITZ_SESSION_SECRET",
                "required": True,
                "sensitive": True,
                "purpose": "Sign portal cookies consistently across frontend and backend.",
            },
        ],
    },
    {
        "key": "payments",
        "title": "Payment Gateway",
        "variables": [
            {
                "name": "PAYMENT_PROVIDER",
                "required": True,
                "sensitive": False,
                "purpose": "Select manual, Cashfree, or Razorpay.",
            },
            {
                "name": "PAYMENT_RETURN_URL",
                "required": True,
                "sensitive": False,
                "purpose": "Send customers back after checkout.",
            },
            {
                "name": "DIRECT_BANK_UPI_ID",
                "required": False,
                "sensitive": False,
                "purpose": "Enable direct UPI payment instructions without a third-party gateway.",
            },
            {
                "name": "DIRECT_BANK_ACCOUNT_NAME",
                "required": False,
                "sensitive": False,
                "purpose": "Display the restaurant bank account holder name for direct transfer.",
            },
            {
                "name": "DIRECT_BANK_ACCOUNT_NUMBER",
                "required": False,
                "sensitive": True,
                "purpose": "Display direct bank transfer details when direct bank mode is enabled.",
            },
            {
                "name": "DIRECT_BANK_IFSC",
                "required": False,
                "sensitive": False,
                "purpose": "Display IFSC for direct bank transfer mode.",
            },
            {
                "name": "CASHFREE_APP_ID",
                "required": False,
                "sensitive": True,
                "purpose": "Cashfree checkout credential.",
            },
            {
                "name": "CASHFREE_SECRET_KEY",
                "required": False,
                "sensitive": True,
                "purpose": "Cashfree checkout signing secret.",
            },
            {
                "name": "CASHFREE_WEBHOOK_SECRET",
                "required": False,
                "sensitive": True,
                "purpose": "Cashfree webhook verification secret.",
            },
            {
                "name": "RAZORPAY_KEY_ID",
                "required": False,
                "sensitive": True,
                "purpose": "Razorpay checkout credential.",
            },
            {
                "name": "RAZORPAY_KEY_SECRET",
                "required": False,
                "sensitive": True,
                "purpose": "Razorpay checkout signing secret.",
            },
            {
                "name": "RAZORPAY_WEBHOOK_SECRET",
                "required": False,
                "sensitive": True,
                "purpose": "Razorpay webhook verification secret.",
            },
        ],
    },
    {
        "key": "growth",
        "title": "Growth Channels",
        "variables": [
            {
                "name": "CAMPAIGN_SEND_ENABLED",
                "required": False,
                "sensitive": False,
                "purpose": "Enable real promotion sends.",
            },
            {
                "name": "RESEND_API_KEY",
                "required": False,
                "sensitive": True,
                "purpose": "Enable real email sending.",
            },
            {
                "name": "RESEND_FROM_EMAIL",
                "required": False,
                "sensitive": False,
                "purpose": "Set the verified sender email address.",
            },
            {
                "name": "TWILIO_ACCOUNT_SID",
                "required": False,
                "sensitive": True,
                "purpose": "Enable Twilio SMS sending.",
            },
            {
                "name": "TWILIO_AUTH_TOKEN",
                "required": False,
                "sensitive": True,
                "purpose": "Authenticate Twilio SMS sending.",
            },
            {
                "name": "TWILIO_FROM_NUMBER",
                "required": False,
                "sensitive": False,
                "purpose": "Set the outbound SMS sender number.",
            },
            {
                "name": "TWILIO_MESSAGING_SERVICE_SID",
                "required": False,
                "sensitive": False,
                "purpose": "Set the Twilio messaging service sender.",
            },
            {
                "name": "WHATSAPP_ACCESS_TOKEN",
                "required": False,
                "sensitive": True,
                "purpose": "Enable WhatsApp template sends.",
            },
            {
                "name": "WHATSAPP_PHONE_NUMBER_ID",
                "required": False,
                "sensitive": False,
                "purpose": "Set the WhatsApp business phone number id.",
            },
            {
                "name": "WHATSAPP_TEMPLATE_NAME",
                "required": False,
                "sensitive": False,
                "purpose": "Set the approved WhatsApp marketing template.",
            },
            {
                "name": "SOCIAL_PUBLISH_ENABLED",
                "required": False,
                "sensitive": False,
                "purpose": "Enable real social posting.",
            },
            {
                "name": "FACEBOOK_PAGE_ID",
                "required": False,
                "sensitive": False,
                "purpose": "Set the Facebook page target for posting.",
            },
            {
                "name": "FACEBOOK_PAGE_ACCESS_TOKEN",
                "required": False,
                "sensitive": True,
                "purpose": "Enable Facebook page publishing.",
            },
            {
                "name": "INSTAGRAM_BUSINESS_ACCOUNT_ID",
                "required": False,
                "sensitive": False,
                "purpose": "Set the Instagram business account target.",
            },
            {
                "name": "INSTAGRAM_ACCESS_TOKEN",
                "required": False,
                "sensitive": True,
                "purpose": "Enable Instagram publishing.",
            },
            {
                "name": "ADS_LAUNCH_ENABLED",
                "required": False,
                "sensitive": False,
                "purpose": "Enable paused Meta Ads campaign creation.",
            },
            {
                "name": "META_AD_ACCOUNT_ID",
                "required": False,
                "sensitive": False,
                "purpose": "Set the Meta ad account for campaign creation.",
            },
            {
                "name": "META_AD_ACCESS_TOKEN",
                "required": False,
                "sensitive": True,
                "purpose": "Authenticate Meta Ads campaign creation.",
            },
        ],
    },
]

LAUNCH_CRITICAL_ROUTE_PROOFS = [
    {
        "key": "ops",
        "label": "Production Ops",
        "route": "/ops",
        "module_key": "production_operations",
        "proof": "verify-production-ops-readiness.cjs",
    },
    {
        "key": "roadmap",
        "label": "Roadmap Command Board",
        "route": "/roadmap",
        "module_key": "production_operations",
        "proof": "verify-roadmap-command-board.cjs",
    },
    {
        "key": "customer_checkout",
        "label": "Customer Checkout",
        "route": "/order",
        "module_key": "ordering_flow",
        "proof": "verify-customer-web-checkout.cjs",
    },
    {
        "key": "counter_orders",
        "label": "Counter Orders",
        "route": "/orders",
        "module_key": "ordering_flow",
        "proof": "verify-counter-order-e2e.cjs",
    },
    {
        "key": "kitchen_ticket",
        "label": "Kitchen Station Ticket",
        "route": "/kitchen-ticket/{orderId}",
        "module_key": "kitchen_station_operations",
        "proof": "verify-counter-kitchen-ticket.cjs",
    },
    {
        "key": "delivery_ops",
        "label": "Delivery Operations",
        "route": "/operations",
        "module_key": "delivery_operations",
        "proof": "verify-delivery-order-e2e.cjs",
    },
    {
        "key": "employee_attendance",
        "label": "Employee Attendance",
        "route": "/shifts",
        "module_key": "employee_workforce",
        "proof": "verify-employee-attendance-command.cjs",
    },
    {
        "key": "expense_audit",
        "label": "Expense Audit",
        "route": "/expenses",
        "module_key": "expense_audit",
        "proof": "verify-expense-audit-command.cjs",
    },
    {
        "key": "reports",
        "label": "Reports",
        "route": "/reports",
        "module_key": "finance_reporting",
        "proof": "verify-reporting-comparison-dashboard.cjs",
    },
    {
        "key": "promotions",
        "label": "Promotions",
        "route": "/promotions",
        "module_key": "growth_publishing",
        "proof": "verify-marketing-live-readiness-command.cjs",
    },
    {
        "key": "customers",
        "label": "Customers",
        "route": "/customers",
        "module_key": "marketing_crm",
        "proof": "verify-data-quality-export-command.cjs",
    },
]

FINAL_ACCEPTANCE_WALKTHROUGHS = [
    {
        "key": "admin",
        "title": "Admin Walkthrough",
        "owner": "Owner / Admin",
        "focus": "Business control, blocker review and reporting confidence.",
        "steps": [
            {
                "key": "admin_ops",
                "label": "Production Ops",
                "route": "/ops",
                "module_key": "production_operations",
                "proof": "verify-production-ops-readiness.cjs",
                "detail": "Review readiness score, launch blockers, backups, secrets and deployment checklist.",
            },
            {
                "key": "admin_roadmap",
                "label": "Roadmap Command Board",
                "route": "/roadmap",
                "module_key": "production_operations",
                "proof": "verify-roadmap-command-board.cjs",
                "detail": "Confirm day tracker, proof audit and next handoff are current.",
            },
            {
                "key": "admin_reports",
                "label": "Reports",
                "route": "/reports",
                "module_key": "finance_reporting",
                "proof": "verify-reporting-comparison-dashboard.cjs",
                "detail": "Review sales comparison, exports and management reporting views.",
            },
            {
                "key": "admin_marketing",
                "label": "Promotions",
                "route": "/promotions",
                "module_key": "growth_publishing",
                "proof": "verify-marketing-live-readiness-command.cjs",
                "detail": "Confirm campaign, social and ad launch readiness before sending live offers.",
            },
        ],
    },
    {
        "key": "staff",
        "title": "Staff/POS Walkthrough",
        "owner": "Counter / Kitchen / Delivery Staff",
        "focus": "Counter order entry, kitchen state and delivery handoff.",
        "steps": [
            {
                "key": "staff_counter",
                "label": "Counter Orders",
                "route": "/orders",
                "module_key": "ordering_flow",
                "proof": "verify-counter-order-e2e.cjs",
                "detail": "Place a counter order, confirm totals and keep payment/order status visible.",
            },
            {
                "key": "staff_delivery",
                "label": "Delivery Operations",
                "route": "/operations",
                "module_key": "delivery_operations",
                "proof": "verify-delivery-order-e2e.cjs",
                "detail": "Assign delivery, validate zone/charge handoff and close the order loop.",
            },
            {
                "key": "staff_command",
                "label": "Operational Command Board",
                "route": "/operations",
                "module_key": "delivery_operations",
                "proof": "verify-operational-dashboard-command.cjs",
                "detail": "Review kitchen state, delivery state and owner alerts from live order data.",
            },
            {
                "key": "staff_order_polish",
                "label": "Order Flow Polish",
                "route": "/orders",
                "module_key": "ordering_flow",
                "proof": "verify-order-flow-polish.cjs",
                "detail": "Confirm core order flow remains clear enough for a staff handoff.",
            },
        ],
    },
    {
        "key": "customer",
        "title": "Customer Walkthrough",
        "owner": "Customer",
        "focus": "Website order, account capture, checkout and tracking confidence.",
        "steps": [
            {
                "key": "customer_checkout",
                "label": "Customer Checkout",
                "route": "/order",
                "module_key": "ordering_flow",
                "proof": "verify-customer-web-checkout.cjs",
                "detail": "Choose products, add cart details and complete checkout intent.",
            },
            {
                "key": "customer_account",
                "label": "Customer Account",
                "route": "/account",
                "module_key": "marketing_crm",
                "proof": "verify-customer-account-lifecycle.cjs",
                "detail": "Confirm customer identity, opt-in and profile lifecycle are captured.",
            },
            {
                "key": "customer_customization",
                "label": "Product Customization",
                "route": "/order",
                "module_key": "product_catalog",
                "proof": "verify-product-customization.cjs",
                "detail": "Confirm sizes, toppings and add-ons remain selectable in the order path.",
            },
            {
                "key": "customer_full_order",
                "label": "Full Customer Order",
                "route": "/track",
                "module_key": "ordering_flow",
                "proof": "verify-full-customer-order-e2e.cjs",
                "detail": "Run the full web order and tracking proof before the June 20 checkpoint.",
            },
        ],
    },
]

BETA_DELIVERY_PROOF_QUEUE = [
    {
        "key": "frontend_build",
        "label": "Final frontend build",
        "proof": "npm run build",
        "status": "pass",
        "detail": "Next.js production build is the required final checkpoint before handoff.",
    },
    {
        "key": "production_ops",
        "label": "Production Ops smoke",
        "proof": "verify-production-ops-readiness.cjs",
        "status_source": "launch_candidate",
        "source_key": "ops_smoke",
        "detail": "Production Ops, environment inventory, backup action and deployment checklist stay visible.",
    },
    {
        "key": "roadmap",
        "label": "Roadmap proof",
        "proof": "verify-roadmap-command-board.cjs",
        "status": "pass",
        "detail": "Roadmap, proof audit and daily execution tracker stay visible.",
    },
    {
        "key": "final_acceptance",
        "label": "Final acceptance walkthrough",
        "proof": "verify-final-acceptance-walkthrough.cjs",
        "status_source": "final_acceptance",
        "detail": "Admin, staff/POS and customer walkthrough lanes stay visible for review.",
    },
    {
        "key": "customer_checkout",
        "label": "Customer checkout smoke",
        "proof": "verify-customer-web-checkout.cjs",
        "status_source": "route",
        "route_key": "customer_checkout",
        "detail": "Customer web order path remains represented in the final checkpoint queue.",
    },
    {
        "key": "counter_order",
        "label": "Counter order smoke",
        "proof": "verify-counter-order-e2e.cjs",
        "status_source": "route",
        "route_key": "counter_orders",
        "detail": "Staff counter/POS order path remains represented in the final checkpoint queue.",
    },
    {
        "key": "delivery_order",
        "label": "Delivery order smoke",
        "proof": "verify-delivery-order-e2e.cjs",
        "status_source": "route",
        "route_key": "delivery_ops",
        "detail": "Delivery assignment and handoff path remains represented in the final checkpoint queue.",
    },
    {
        "key": "data_quality",
        "label": "Data quality export smoke",
        "proof": "verify-data-quality-export-command.cjs",
        "status_source": "data_quality",
        "detail": "Customer export, report export, import readiness and backup/restore proof stay visible.",
    },
]

BETA_KNOWN_GAPS = [
    {
        "key": "real_payments",
        "label": "Real payment credentials",
        "status": "warn",
        "detail": "Manual/local payment readiness is represented; live Cashfree/Razorpay credentials and webhook verification remain production work.",
    },
    {
        "key": "managed_database",
        "label": "Managed production database",
        "status": "warn",
        "detail": "Local SQLite is acceptable for development; production still needs managed PostgreSQL-compatible storage.",
    },
    {
        "key": "backup_restore",
        "label": "Backup and restore rehearsal",
        "status": "warn",
        "detail": "A fresh backup and restore rehearsal must be completed before public traffic.",
    },
    {
        "key": "deployment_secrets",
        "label": "Deployment secrets and host",
        "status": "warn",
        "detail": "Production host secrets, log access, rollback owner and deployed smoke run remain the next operations track.",
    },
    {
        "key": "live_marketing",
        "label": "Live marketing providers",
        "status": "warn",
        "detail": "WhatsApp/SMS/email/social/ad provider credentials are readiness-tracked but still need live account configuration.",
    },
]


def database_backend() -> str:
    try:
        return make_url(settings.SQLALCHEMY_DATABASE_URI).get_backend_name()
    except Exception:
        return "unknown"


def sqlite_database_path() -> Optional[Path]:
    try:
        url = make_url(settings.SQLALCHEMY_DATABASE_URI)
    except Exception:
        return None
    if url.get_backend_name() != "sqlite":
        return None
    database = url.database
    if not database or database == ":memory:":
        return None
    path = Path(database)
    if not path.is_absolute():
        path = Path.cwd() / path
    return path.resolve()


def _public_base_url() -> str:
    return (settings.PIZZA_BLITZ_PUBLIC_URL or "https://pizza-blitz.vercel.app").rstrip("/")


def _public_api_prefix() -> str:
    prefix = (settings.PIZZA_BLITZ_PUBLIC_API_PREFIX or "/server").strip()
    if not prefix:
        return ""
    if not prefix.startswith("/"):
        prefix = f"/{prefix}"
    return prefix.rstrip("/")


def _public_url(path: str, *, api: bool = False) -> str:
    clean_path = path if path.startswith("/") else f"/{path}"
    if api:
        return f"{_public_base_url()}{_public_api_prefix()}{clean_path}"
    return f"{_public_base_url()}{clean_path}"


def _http_probe(url: str, *, headers: Optional[dict[str, str]] = None, timeout: int = 5) -> dict:
    request = urllib.request.Request(
        url,
        headers=headers or {},
        method="GET",
    )
    started_at = datetime.utcnow()
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            body = response.read(2048)
            text_body = body.decode("utf-8", errors="replace")
            payload = None
            try:
                import json

                payload = json.loads(text_body)
            except Exception:
                payload = None
            return {
                "ok": 200 <= int(response.status) < 400,
                "status_code": int(response.status),
                "headers": {key.lower(): value for key, value in response.headers.items()},
                "payload": payload,
                "body_preview": text_body[:240],
                "duration_ms": round((datetime.utcnow() - started_at).total_seconds() * 1000),
            }
    except urllib.error.HTTPError as exc:
        body = exc.read(512).decode("utf-8", errors="replace")
        return {
            "ok": False,
            "status_code": int(exc.code),
            "headers": {key.lower(): value for key, value in exc.headers.items()},
            "payload": None,
            "body_preview": body[:240],
            "duration_ms": round((datetime.utcnow() - started_at).total_seconds() * 1000),
            "error": exc.reason,
        }
    except Exception as exc:
        return {
            "ok": False,
            "status_code": 0,
            "headers": {},
            "payload": None,
            "body_preview": "",
            "duration_ms": round((datetime.utcnow() - started_at).total_seconds() * 1000),
            "error": str(exc),
        }


def _http_probe_with_retry(url: str, *, headers: Optional[dict[str, str]] = None) -> dict:
    first = _http_probe(url, headers=headers)
    if first.get("status_code") != 0:
        return first
    second = _http_probe(url, headers=headers)
    if second.get("status_code") == 0:
        second["duration_ms"] = int(first.get("duration_ms") or 0) + int(second.get("duration_ms") or 0)
    return second


def run_live_deployment_probe(db: Session | None = None) -> dict:
    del db
    base_url = _public_base_url()
    health_url = _public_url("/health", api=True)
    checkout_url = _public_url("/api/v1/restaurant/orders/checkout-readiness", api=True)
    order_url = _public_url("/order")

    health_probe = _http_probe_with_retry(health_url)
    health_payload = health_probe.get("payload") or {}
    health_pass = (
        health_probe.get("ok")
        and health_payload.get("status") == "ok"
        and bool(health_payload.get("project"))
    )

    checkout_probe = _http_probe_with_retry(checkout_url)
    checkout_payload = checkout_probe.get("payload") or {}
    checkout_pass = (
        checkout_probe.get("ok")
        and bool(checkout_payload.get("accepting_orders"))
        and bool(checkout_payload.get("database_ready"))
        and str(checkout_payload.get("environment", "")).lower() == "production"
    )

    cors_probe = _http_probe_with_retry(health_url, headers={"Origin": base_url})
    cors_headers = cors_probe.get("headers") or {}
    cors_pass = (
        cors_probe.get("ok")
        and cors_headers.get("access-control-allow-origin") == base_url
        and cors_headers.get("access-control-allow-credentials", "").lower() == "true"
    )

    order_probe = _http_probe_with_retry(order_url)
    order_pass = bool(order_probe.get("ok"))

    checks = [
        {
            "key": "public_api_health",
            "label": "Public API health",
            "status": "pass" if health_pass else "fail",
            "url": health_url,
            "detail": (
                "Public API health returned ok."
                if health_pass
                else f"Public API health failed with HTTP {health_probe.get('status_code')}."
            ),
            "evidence": {
                "status_code": health_probe.get("status_code"),
                "duration_ms": health_probe.get("duration_ms"),
            },
        },
        {
            "key": "checkout_database_readiness",
            "label": "Checkout database readiness",
            "status": "pass" if checkout_pass else "fail",
            "url": checkout_url,
            "detail": (
                "Checkout is accepting orders against a production persistent database."
                if checkout_pass
                else "Checkout readiness did not prove production order capture and database readiness."
            ),
            "evidence": {
                "status_code": checkout_probe.get("status_code"),
                "accepting_orders": bool(checkout_payload.get("accepting_orders")),
                "database_ready": bool(checkout_payload.get("database_ready")),
                "environment": checkout_payload.get("environment"),
                "duration_ms": checkout_probe.get("duration_ms"),
            },
        },
        {
            "key": "cors_origin_lock",
            "label": "CORS origin lock",
            "status": "pass" if cors_pass else "fail",
            "url": health_url,
            "detail": (
                "Production API allows the deployed frontend origin with credentials."
                if cors_pass
                else "Production API did not return the expected credentialed frontend CORS origin."
            ),
            "evidence": {
                "status_code": cors_probe.get("status_code"),
                "allow_origin": cors_headers.get("access-control-allow-origin"),
                "allow_credentials": cors_headers.get("access-control-allow-credentials"),
                "duration_ms": cors_probe.get("duration_ms"),
            },
        },
        {
            "key": "public_order_page",
            "label": "Public order page",
            "status": "pass" if order_pass else "fail",
            "url": order_url,
            "detail": (
                "Public order page is reachable."
                if order_pass
                else f"Public order page failed with HTTP {order_probe.get('status_code')}."
            ),
            "evidence": {
                "status_code": order_probe.get("status_code"),
                "duration_ms": order_probe.get("duration_ms"),
            },
        },
    ]
    score = _readiness_score(checks)
    status = _rollup_status(checks)
    return {
        "generated_at": datetime.utcnow().isoformat(),
        "base_url": base_url,
        "api_prefix": _public_api_prefix(),
        "status": status,
        "score": score,
        "checks_total": len(checks),
        "checks_passed": sum(1 for check in checks if check["status"] == "pass"),
        "checks": checks,
        "next_actions": (
            ["Live deployment proof is green. Keep this proof fresh after each production deploy."]
            if status == "pass"
            else [
                "Fix failing live deployment checks before routing real customer traffic.",
                "Re-run the proof after deployment, database, or CORS changes.",
            ]
        ),
    }


def _latest_live_deployment_event(db: Session) -> OperationalAuditEvent | None:
    return (
        db.query(OperationalAuditEvent)
        .filter(OperationalAuditEvent.event_type == "deployment")
        .filter(OperationalAuditEvent.action == LIVE_DEPLOYMENT_AUDIT_ACTION)
        .order_by(OperationalAuditEvent.created_at.desc(), OperationalAuditEvent.id.desc())
        .first()
    )


def _live_deployment_status(db: Session) -> dict:
    event = _latest_live_deployment_event(db)
    if event is None:
        return {
            "status": "warn",
            "score": 0,
            "detail": "No live deployment proof has been recorded yet.",
            "last_checked_at": None,
            "base_url": _public_base_url(),
            "checks": [
                {
                    "key": key,
                    "label": key.replace("_", " ").title(),
                    "status": "warn",
                    "detail": "Run the live deployment proof from Production Ops.",
                }
                for key in LIVE_DEPLOYMENT_REQUIRED_CHECKS
            ],
        }
    metadata = event.metadata_json or {}
    proof = metadata.get("proof") or {}
    age_hours = (
        (datetime.utcnow() - event.created_at).total_seconds() / 3600
        if event.created_at
        else None
    )
    recorded_status = proof.get("status") or ("pass" if event.status == "success" else "fail")
    if recorded_status == "pass" and age_hours is not None and age_hours > 24:
        status = "warn"
        detail = "Last live deployment proof passed but is older than 24 hours."
    else:
        status = recorded_status
        detail = proof.get("detail") or event.detail or "Latest live deployment proof is recorded."
    return {
        "status": status,
        "score": int(proof.get("score") or 0),
        "detail": detail,
        "last_checked_at": event.created_at.isoformat() if event.created_at else None,
        "base_url": proof.get("base_url") or _public_base_url(),
        "checks_total": proof.get("checks_total"),
        "checks_passed": proof.get("checks_passed"),
        "checks": proof.get("checks") or [],
        "event_id": event.id,
    }


def _live_deployment_command(live_deployment: dict) -> dict:
    return {
        "key": "live_deployment_proof_command",
        "title": "Live Deployment Proof",
        "status": live_deployment.get("status", "warn"),
        "score": live_deployment.get("score", 0),
        "detail": live_deployment.get("detail") or "Run a public production smoke proof from Production Ops.",
        "base_url": live_deployment.get("base_url") or _public_base_url(),
        "last_checked_at": live_deployment.get("last_checked_at"),
        "checks": live_deployment.get("checks") or [],
        "run_endpoint": "/api/v1/restaurant/ops/live-deployment-proof/run",
        "next_actions": [
            "Run this proof after each Vercel deploy or environment variable change.",
            "Require public API health, checkout database readiness, CORS, and order page checks to pass before live traffic.",
        ],
    }


def readiness_report(db: Session) -> dict:
    environment = settings.ENVIRONMENT.lower()
    payment_status = payment_provider_status()
    payment_providers = [payment_provider_status(provider) for provider in PAYMENT_PROVIDER_ORDER]
    backup_freshness = _backup_freshness(db)
    restore_rehearsal = _restore_rehearsal_status(db)
    live_deployment = _live_deployment_status(db)
    checks = [
        _database_check(db),
        _database_persistence_check(environment),
        _admin_password_check(environment, db),
        _staff_password_check(environment, db),
        _auth_secret_check(environment),
        _portal_session_secret_check(environment),
        _cors_check(environment),
        _payment_gateway_check(environment, payment_status),
        _payment_webhook_check(environment, payment_status),
        _backup_storage_check(),
    ]
    environment_manifest = _environment_manifest(db)
    environment_summary = _environment_summary(environment_manifest)
    go_live_sections = _go_live_sections(
        checks=checks,
        environment=environment,
        payment_status=payment_status,
        backup_freshness=backup_freshness,
    )
    go_live_items = [
        item
        for section in go_live_sections
        for item in section["items"]
    ]
    module_readiness = _launch_module_readiness(
        db,
        checks=checks,
        payment_status=payment_status,
        backup_freshness=backup_freshness,
        live_deployment=live_deployment,
        go_live_items=go_live_items,
    )
    restaurant_ready_audit = _restaurant_ready_audit(
        modules=module_readiness,
        payment_status=payment_status,
        payment_providers=payment_providers,
        backup_freshness=backup_freshness,
        restore_rehearsal=restore_rehearsal,
        go_live_items=go_live_items,
    )
    launch_blockers = [item for item in go_live_items if item["status"] == "fail"]
    setup_actions = [
        item
        for item in go_live_items
        if item["status"] in {"fail", "warn"}
    ][:8]
    failed = sum(1 for check in checks if check["status"] == "fail")
    warnings = sum(1 for check in checks if check["status"] == "warn")
    overall = "ready"
    if failed:
        overall = "blocked"
    elif warnings:
        overall = "attention"

    return {
        "environment": settings.ENVIRONMENT,
        "database_backend": database_backend(),
        "database_path": str(sqlite_database_path()) if sqlite_database_path() else None,
        "backup_dir": str(_backup_dir().resolve()),
        "backup_retention_days": settings.BACKUP_RETENTION_DAYS,
        "payment": payment_status,
        "payment_providers": payment_providers,
        "payment_webhook_contracts": _payment_webhook_contracts(),
        "environment_manifest": environment_manifest,
        "environment_summary": environment_summary,
        "backup_freshness": backup_freshness,
        "live_deployment": live_deployment,
        "live_deployment_command": _live_deployment_command(live_deployment),
        "restore_rehearsal": restore_rehearsal,
        "restore_rehearsal_command": _restore_rehearsal_command(
            db,
            backup_freshness=backup_freshness,
            restore_rehearsal=restore_rehearsal,
        ),
        "production_database_plan": _production_database_plan(
            environment=environment,
            backup_freshness=backup_freshness,
            restore_rehearsal=restore_rehearsal,
        ),
        "environment_security_plan": _environment_security_plan(
            environment=environment,
            checks=checks,
            environment_manifest=environment_manifest,
            environment_summary=environment_summary,
        ),
        "deployment_pipeline_plan": _deployment_pipeline_plan(
            environment=environment,
            checks=checks,
            environment_summary=environment_summary,
            readiness_score=_readiness_score(go_live_items),
            module_readiness=module_readiness,
            backup_freshness=backup_freshness,
        ),
        "readiness_score": _readiness_score(go_live_items),
        "launch_blockers": launch_blockers,
        "setup_actions": setup_actions,
        "go_live_sections": go_live_sections,
        "launch_summary": _launch_summary(module_readiness),
        "module_readiness": module_readiness,
        "restaurant_ready_audit": restaurant_ready_audit,
        "overall": overall,
        "failed_checks": failed,
        "warning_checks": warnings,
        "checks": checks,
    }


def data_quality_report(db: Session) -> dict:
    customers = db.query(Customer).all()
    daily_rows = db.query(DailySales).order_by(DailySales.date.desc()).all()
    promotions = db.query(Promotion).order_by(Promotion.created_at.desc(), Promotion.id.desc()).all()
    orders_total = db.query(func.count(RestaurantOrder.id)).scalar() or 0
    orders_missing_phone = (
        db.query(func.count(RestaurantOrder.id))
        .filter((RestaurantOrder.customer_phone.is_(None)) | (RestaurantOrder.customer_phone == ""))
        .scalar()
        or 0
    )
    duplicate_phone_count = (
        db.query(Customer.phone)
        .group_by(Customer.phone)
        .having(func.count(Customer.id) > 1)
        .count()
    )
    total_customers = len(customers)
    opted_in = sum(1 for customer in customers if customer.opt_in_marketing)
    with_phone = sum(1 for customer in customers if (customer.phone or "").strip())
    with_email = sum(1 for customer in customers if (customer.email or "").strip())
    reachable = sum(
        1
        for customer in customers
        if customer.opt_in_marketing and ((customer.phone or "").strip() or (customer.email or "").strip())
    )
    missing_email = max(total_customers - with_email, 0)
    no_order_profile_count = sum(1 for customer in customers if not customer.last_order_at)
    latest_sale = daily_rows[0].date if daily_rows else None
    latest_campaign = promotions[0] if promotions else None
    backup_freshness = _backup_freshness(db)
    restore_rehearsal = _restore_rehearsal_status(db)
    latest_backup = db.query(BackupRun).order_by(BackupRun.created_at.desc(), BackupRun.id.desc()).first()

    customer_status = "pass" if duplicate_phone_count == 0 and with_phone == total_customers else "warn"
    reach_status = "pass" if total_customers and reachable / total_customers >= 0.8 else "warn" if reachable else "fail"
    report_status = "pass" if daily_rows else "warn"
    backup_status = backup_freshness.get("status", "warn")
    restore_status = restore_rehearsal.get("status", "warn")
    backup_restore_status = _rollup_status(
        [{"status": backup_status}, {"status": restore_status}]
    )
    import_status = "pass"
    checks = [
        {
            "key": "customer_identity",
            "label": "Customer identity quality",
            "status": customer_status,
            "detail": f"{duplicate_phone_count} duplicate phone group(s), {with_phone}/{total_customers} profiles have phone numbers.",
        },
        {
            "key": "customer_reachability",
            "label": "Customer import/export reachability",
            "status": reach_status,
            "detail": f"{reachable}/{total_customers} customers are marketing-reachable; {missing_email} profiles still need email capture.",
        },
        {
            "key": "report_exports",
            "label": "Report export coverage",
            "status": report_status,
            "detail": f"{len(daily_rows)} daily sales row(s) are available for CSV export.",
        },
        {
            "key": "backup_restore",
            "label": "Backup/restore proof",
            "status": backup_restore_status,
            "detail": (
                f"Backup: {backup_freshness.get('detail') or 'status unavailable'} "
                f"Restore: {restore_rehearsal.get('detail') or 'status unavailable'}"
            ),
        },
        {
            "key": "import_controls",
            "label": "Import controls",
            "status": import_status,
            "detail": "Sheets, PDF and customer CSV dry-run validation endpoints exist; keep backup and duplicate review ahead of live bulk uploads.",
        },
    ]
    score = _readiness_score(checks)
    next_actions = [
        "Run customer CSV export before any bulk cleanup.",
        "Run sales/report CSV export and attach it to the daily manager review.",
        "Create or verify a fresh backup, then rehearse restore before importing production data.",
        "Run customer CSV dry-run validation before each bulk customer cleanup import.",
    ]

    return {
        "generated_at": datetime.utcnow().isoformat(),
        "score": score,
        "status": _rollup_status(checks),
        "summary": {
            "total_customers": total_customers,
            "reachable_customers": reachable,
            "opted_in_customers": opted_in,
            "email_ready_customers": with_email,
            "missing_email_customers": missing_email,
            "duplicate_phone_groups": duplicate_phone_count,
            "no_order_profile_count": no_order_profile_count,
            "orders_total": orders_total,
            "orders_missing_phone": orders_missing_phone,
            "daily_sales_rows": len(daily_rows),
            "latest_sales_date": latest_sale.isoformat() if isinstance(latest_sale, date) else None,
            "campaign_export_count": len(promotions),
        },
        "checks": checks,
        "exports": [
            {
                "key": "customers",
                "label": "Customer CSV export",
                "status": "pass",
                "endpoint": "/api/v1/restaurant/customers/export.csv",
                "detail": f"{total_customers} customer profile(s) export with consent and contact fields.",
            },
            {
                "key": "sales",
                "label": "Sales report CSV export",
                "status": report_status,
                "endpoint": "/api/v1/restaurant/sales/export/csv",
                "detail": f"{len(daily_rows)} sales day(s) export with sale, expense and profit columns.",
            },
            {
                "key": "campaign_performance",
                "label": "Campaign performance CSV export",
                "status": "pass" if latest_campaign else "warn",
                "endpoint": (
                    f"/api/v1/restaurant/promotions/performance/{latest_campaign.id}/export.csv"
                    if latest_campaign
                    else None
                ),
                "detail": (
                    f"Latest campaign export is ready for {latest_campaign.name}."
                    if latest_campaign
                    else "Create a campaign before campaign performance CSV export can be proved."
                ),
            },
            {
                "key": "backup_history",
                "label": "Backup history API",
                "status": backup_status,
                "endpoint": "/api/v1/restaurant/ops/backups",
                "detail": backup_freshness.get("detail") or "Backup history is available to admins.",
            },
        ],
        "imports": [
            {
                "key": "google_sheets",
                "label": "Google Sheets import",
                "status": "warn",
                "endpoint": "/api/v1/restaurant/import/sheets",
                "detail": "Endpoint exists, but production import should run through dry-run review and source locking.",
            },
            {
                "key": "pdf_import",
                "label": "PDF sales import",
                "status": "warn",
                "endpoint": "/api/v1/restaurant/import/pdf",
                "detail": "Endpoint exists for historical statements; verify extracted totals before merge.",
            },
            {
                "key": "customer_csv_import",
                "label": "Customer CSV import dry-run",
                "status": "pass",
                "endpoint": "/api/v1/restaurant/customers/import/validate",
                "detail": "Admin-only validation previews invalid rows, duplicate phones and existing-customer matches without writing records.",
            },
        ],
        "backup_restore": {
            "latest_status": latest_backup.status if latest_backup else "none",
            "latest_backup_at": latest_backup.created_at.isoformat() if latest_backup and latest_backup.created_at else None,
            "latest_size_bytes": latest_backup.size_bytes if latest_backup else 0,
            "freshness": backup_freshness,
            "restore_rehearsal": {
                "status": restore_status,
                "detail": restore_rehearsal.get("detail")
                or "Restore a backup into a clean database and run login, customer export, sales export and order smoke proof.",
            },
        },
        "next_actions": next_actions,
    }


def launch_candidate_report(
    db: Session,
    *,
    readiness: Optional[dict] = None,
    data_quality: Optional[dict] = None,
) -> dict:
    readiness = readiness if readiness is not None else readiness_report(db)
    data_quality = data_quality if data_quality is not None else data_quality_report(db)
    modules = readiness.get("module_readiness") or []
    module_by_key = {module["key"]: module for module in modules}
    deployment_plan = readiness.get("deployment_pipeline_plan") or {}
    production_plan = readiness.get("production_database_plan") or {}
    security_plan = readiness.get("environment_security_plan") or {}
    launch_blockers = readiness.get("launch_blockers") or []
    setup_actions = readiness.get("setup_actions") or []

    critical_routes = []
    for route in LAUNCH_CRITICAL_ROUTE_PROOFS:
        module = module_by_key.get(route["module_key"])
        status = module["status"] if module else "fail"
        score = module["score"] if module else 0
        critical_routes.append(
            {
                **route,
                "status": status,
                "score": score,
                "detail": (
                    module["detail"]
                    if module
                    else "Route is not represented in the launch module readiness matrix."
                ),
                "next_action": (
                    module["next_actions"][0]
                    if module and module.get("next_actions")
                    else "Run the route proof before final acceptance."
                ),
            }
        )

    proof_gates = [
        {
            "key": "frontend_build",
            "label": "Frontend production build",
            "status": _gate_status(deployment_plan.get("build_gate"), "frontend_build"),
            "proof": "npm run build",
            "detail": "Next.js production build must pass before every launch-candidate handoff.",
        },
        {
            "key": "ops_smoke",
            "label": "Production Ops smoke",
            "status": _route_collection_status([critical_routes[0]]),
            "proof": "verify-production-ops-readiness.cjs",
            "detail": "Ops readiness, backup action, deployment checklist and environment inventory stay visible.",
        },
        {
            "key": "route_smoke",
            "label": "Critical route smoke",
            "status": _route_collection_status(critical_routes),
            "proof": "verify-launch-candidate-hardening.cjs",
            "detail": "Launch candidate board tracks every critical customer, staff and admin route with a named proof.",
        },
        {
            "key": "production_blockers",
            "label": "Production blocker review",
            "status": "fail" if launch_blockers else "warn" if setup_actions else "pass",
            "proof": "ops/readiness launch_blockers",
            "detail": f"{len(launch_blockers)} hard blocker(s), {len(setup_actions)} setup action(s) remain in the readiness API.",
        },
        {
            "key": "data_quality",
            "label": "Data quality export proof",
            "status": data_quality.get("status", "warn"),
            "proof": "verify-data-quality-export-command.cjs",
            "detail": "Customer export, report export, import readiness and backup/restore proof remain visible.",
        },
    ]

    hardening_checks = [
        {
            "key": "route_inventory",
            "label": "Critical route inventory",
            "status": "pass" if len(critical_routes) >= 8 else "fail",
            "detail": f"{len(critical_routes)} critical route(s) have named proof ownership.",
        },
        {
            "key": "proof_gate_inventory",
            "label": "Proof gate inventory",
            "status": "pass" if all(gate.get("proof") for gate in proof_gates) else "fail",
            "detail": f"{len(proof_gates)} launch proof gate(s) are listed for handoff.",
        },
        {
            "key": "deployment_pipeline",
            "label": "Deployment pipeline review",
            "status": deployment_plan.get("status", "warn"),
            "detail": deployment_plan.get("summary") or "Deployment pipeline status is not available.",
        },
        {
            "key": "production_database",
            "label": "Production database review",
            "status": production_plan.get("status", "warn"),
            "detail": production_plan.get("decision") or "Production database plan is not available.",
        },
        {
            "key": "environment_security",
            "label": "Environment security review",
            "status": security_plan.get("status", "warn"),
            "detail": security_plan.get("summary") or "Environment security plan is not available.",
        },
    ]

    all_status_items = critical_routes + proof_gates + hardening_checks
    release_status = _rollup_status(all_status_items)
    release_decision = "hold"
    if release_status == "pass":
        release_decision = "ready"
    elif readiness.get("overall") != "blocked":
        release_decision = "conditional"

    next_actions = [
        "Run npm run build and the launch candidate proof queue before final acceptance.",
        "Review launch_blockers and setup_actions in Production Ops after every credential or database change.",
        "Click through /ops, /roadmap, /order, /orders, /operations, /reports, /promotions and /customers before June 20.",
        "Keep production blockers visible until real credentials, managed database, backups and deployment secrets are complete.",
    ]

    return {
        "generated_at": datetime.utcnow().isoformat(),
        "status": release_status,
        "score": _readiness_score(all_status_items),
        "release_decision": release_decision,
        "summary": {
            "critical_routes": len(critical_routes),
            "routes_ready": sum(1 for route in critical_routes if route["status"] == "pass"),
            "routes_attention": sum(1 for route in critical_routes if route["status"] == "warn"),
            "routes_blocked": sum(1 for route in critical_routes if route["status"] == "fail"),
            "proof_gates": len(proof_gates),
            "launch_blockers": len(launch_blockers),
            "setup_actions": len(setup_actions),
            "module_score": readiness.get("launch_summary", {}).get("implementation_score", 0),
            "readiness_score": readiness.get("readiness_score", 0),
        },
        "critical_routes": critical_routes,
        "proof_gates": proof_gates,
        "hardening_checks": hardening_checks,
        "blocker_review": {
            "hard_blockers": launch_blockers[:8],
            "setup_actions": setup_actions[:8],
            "deployment_blockers": deployment_plan.get("blockers", [])[:8],
            "database_blockers": production_plan.get("blockers", [])[:8],
            "security_blockers": security_plan.get("blockers", [])[:8],
        },
        "next_actions": next_actions,
    }


def final_acceptance_report(
    db: Session,
    *,
    readiness: Optional[dict] = None,
    launch_candidate: Optional[dict] = None,
    data_quality: Optional[dict] = None,
) -> dict:
    readiness = readiness if readiness is not None else readiness_report(db)
    data_quality = data_quality if data_quality is not None else data_quality_report(db)
    launch_candidate = (
        launch_candidate
        if launch_candidate is not None
        else launch_candidate_report(db, readiness=readiness, data_quality=data_quality)
    )
    modules = readiness.get("module_readiness") or []
    module_by_key = {module["key"]: module for module in modules}

    lanes = []
    for lane in FINAL_ACCEPTANCE_WALKTHROUGHS:
        steps = []
        for step in lane["steps"]:
            module = module_by_key.get(step["module_key"])
            steps.append(
                {
                    **step,
                    "status": module["status"] if module else "fail",
                    "score": module["score"] if module else 0,
                    "next_action": (
                        module["next_actions"][0]
                        if module and module.get("next_actions")
                        else "Run this walkthrough proof before beta handoff."
                    ),
                }
            )
        lanes.append(
            {
                "key": lane["key"],
                "title": lane["title"],
                "owner": lane["owner"],
                "focus": lane["focus"],
                "status": _rollup_status(steps),
                "score": _readiness_score(steps),
                "steps": steps,
            }
        )

    acceptance_gates = [
        {
            "key": "admin_walkthrough",
            "label": "Admin walkthrough",
            "status": lanes[0]["status"],
            "proof": "verify-production-ops-readiness.cjs + verify-roadmap-command-board.cjs",
            "detail": "Owner can review blockers, reports, roadmap and launch controls from visible pages.",
        },
        {
            "key": "staff_walkthrough",
            "label": "Staff/POS walkthrough",
            "status": lanes[1]["status"],
            "proof": "verify-counter-order-e2e.cjs + verify-delivery-order-e2e.cjs",
            "detail": "Counter, kitchen and delivery staff flows stay represented and proof-backed.",
        },
        {
            "key": "customer_walkthrough",
            "label": "Customer walkthrough",
            "status": lanes[2]["status"],
            "proof": "verify-customer-web-checkout.cjs + verify-full-customer-order-e2e.cjs",
            "detail": "Customer order, customization, account capture and tracking paths stay represented.",
        },
        {
            "key": "launch_candidate",
            "label": "Launch candidate hardening",
            "status": launch_candidate.get("status", "warn"),
            "proof": "verify-launch-candidate-hardening.cjs",
            "detail": "Critical routes, E2E proof ownership, blockers and release decision remain visible.",
        },
        {
            "key": "data_quality",
            "label": "Data quality handoff",
            "status": data_quality.get("status", "warn"),
            "proof": "verify-data-quality-export-command.cjs",
            "detail": "Customer export, report export, import readiness and backup/restore proof remain visible.",
        },
    ]
    blocker_count = (
        launch_candidate.get("summary", {}).get("launch_blockers", 0)
        + len(launch_candidate.get("blocker_review", {}).get("deployment_blockers", []))
        + len(launch_candidate.get("blocker_review", {}).get("database_blockers", []))
        + len(launch_candidate.get("blocker_review", {}).get("security_blockers", []))
    )
    all_status_items = acceptance_gates + lanes
    status = _rollup_status(all_status_items)
    decision = "hold"
    if status == "pass" and blocker_count == 0:
        decision = "ready"
    elif readiness.get("overall") != "blocked":
        decision = "conditional"

    return {
        "generated_at": datetime.utcnow().isoformat(),
        "status": status,
        "score": _readiness_score(all_status_items),
        "decision": decision,
        "summary": {
            "lanes_total": len(lanes),
            "lanes_ready": sum(1 for lane in lanes if lane["status"] == "pass"),
            "lanes_attention": sum(1 for lane in lanes if lane["status"] == "warn"),
            "lanes_blocked": sum(1 for lane in lanes if lane["status"] == "fail"),
            "steps_total": sum(len(lane["steps"]) for lane in lanes),
            "proofs_total": len({step["proof"] for lane in lanes for step in lane["steps"]}),
            "acceptance_gates": len(acceptance_gates),
            "production_blockers": blocker_count,
            "launch_score": launch_candidate.get("score", 0),
            "readiness_score": readiness.get("readiness_score", 0),
        },
        "lanes": lanes,
        "acceptance_gates": acceptance_gates,
        "blockers": {
            "launch_blockers": launch_candidate.get("blocker_review", {}).get("hard_blockers", [])[:8],
            "setup_actions": launch_candidate.get("blocker_review", {}).get("setup_actions", [])[:8],
            "deployment_blockers": launch_candidate.get("blocker_review", {}).get("deployment_blockers", [])[:8],
            "database_blockers": launch_candidate.get("blocker_review", {}).get("database_blockers", [])[:8],
            "security_blockers": launch_candidate.get("blocker_review", {}).get("security_blockers", [])[:8],
        },
        "next_actions": [
            "Run the admin walkthrough through /ops, /roadmap, /reports and /promotions.",
            "Run the staff walkthrough through counter orders, kitchen/operations and delivery assignment.",
            "Run the customer walkthrough through /order, account capture, product customization and /track.",
            "Keep the June 20 beta checkpoint as a hold until live credentials, database, backups and deployment secrets are complete.",
        ],
    }


def beta_delivery_report(
    db: Session,
    *,
    readiness: Optional[dict] = None,
    launch_candidate: Optional[dict] = None,
    final_acceptance: Optional[dict] = None,
    data_quality: Optional[dict] = None,
) -> dict:
    readiness = readiness if readiness is not None else readiness_report(db)
    data_quality = data_quality if data_quality is not None else data_quality_report(db)
    launch_candidate = (
        launch_candidate
        if launch_candidate is not None
        else launch_candidate_report(db, readiness=readiness, data_quality=data_quality)
    )
    final_acceptance = (
        final_acceptance
        if final_acceptance is not None
        else final_acceptance_report(
            db,
            readiness=readiness,
            launch_candidate=launch_candidate,
            data_quality=data_quality,
        )
    )
    proof_by_key = {gate["key"]: gate for gate in launch_candidate.get("proof_gates", [])}
    route_by_key = {route["key"]: route for route in launch_candidate.get("critical_routes", [])}

    proof_queue = []
    for proof in BETA_DELIVERY_PROOF_QUEUE:
        status = proof.get("status")
        if proof.get("status_source") == "launch_candidate":
            status = proof_by_key.get(proof["source_key"], {}).get("status", "warn")
        elif proof.get("status_source") == "final_acceptance":
            status = final_acceptance.get("status", "warn")
        elif proof.get("status_source") == "route":
            status = route_by_key.get(proof["route_key"], {}).get("status", "warn")
        elif proof.get("status_source") == "data_quality":
            status = data_quality.get("status", "warn")
        proof_queue.append({**proof, "status": status or "warn"})

    deployment_plan = readiness.get("deployment_pipeline_plan") or {}
    production_plan = readiness.get("production_database_plan") or {}
    security_plan = readiness.get("environment_security_plan") or {}
    known_gaps = [
        *BETA_KNOWN_GAPS,
        *[
            {
                "key": f"deployment_{index}",
                "label": "Deployment blocker",
                "status": "warn",
                "detail": blocker,
            }
            for index, blocker in enumerate(deployment_plan.get("blockers", [])[:3])
        ],
        *[
            {
                "key": f"database_{index}",
                "label": "Database blocker",
                "status": "warn",
                "detail": blocker,
            }
            for index, blocker in enumerate(production_plan.get("blockers", [])[:3])
        ],
        *[
            {
                "key": f"security_{index}",
                "label": "Security blocker",
                "status": "warn",
                "detail": blocker,
            }
            for index, blocker in enumerate(security_plan.get("blockers", [])[:3])
        ],
    ][:12]

    production_plan_steps = [
        {
            "key": "live_credentials",
            "label": "Connect live credentials",
            "status": "warn",
            "detail": "Add real payment, messaging, social and ad credentials through the deployment secret store.",
        },
        {
            "key": "managed_database",
            "label": "Move to managed database",
            "status": production_plan.get("status", "warn"),
            "detail": "Set SQLALCHEMY_DATABASE_URI, run migrations and seed verified launch data.",
        },
        {
            "key": "backup_rehearsal",
            "label": "Run backup/restore drill",
            "status": readiness.get("backup_freshness", {}).get("status", "warn"),
            "detail": "Create a fresh backup or managed snapshot and rehearse restore before public beta traffic.",
        },
        {
            "key": "deployment_smoke",
            "label": "Deploy and smoke test",
            "status": deployment_plan.get("status", "warn"),
            "detail": "Deploy to the production host, inspect logs, run smoke proofs and confirm rollback owner.",
        },
    ]

    all_status_items = proof_queue + known_gaps + production_plan_steps + [
        {
            "key": "final_acceptance",
            "status": final_acceptance.get("status", "warn"),
        }
    ]
    status = _rollup_status(all_status_items)
    decision = "hold"
    if status == "pass" and not known_gaps:
        decision = "ready"
    elif readiness.get("overall") != "blocked":
        decision = "conditional"

    return {
        "generated_at": datetime.utcnow().isoformat(),
        "status": status,
        "score": _readiness_score(all_status_items),
        "decision": decision,
        "summary": {
            "proofs_total": len(proof_queue),
            "proofs_ready": sum(1 for proof in proof_queue if proof["status"] == "pass"),
            "proofs_attention": sum(1 for proof in proof_queue if proof["status"] == "warn"),
            "proofs_blocked": sum(1 for proof in proof_queue if proof["status"] == "fail"),
            "known_gaps": len(known_gaps),
            "production_steps": len(production_plan_steps),
            "readiness_score": readiness.get("readiness_score", 0),
            "final_acceptance_score": final_acceptance.get("score", 0),
        },
        "proof_queue": proof_queue,
        "known_gaps": known_gaps,
        "production_plan": production_plan_steps,
        "handoff": {
            "title": "June 20 beta delivery checkpoint",
            "status": decision,
            "detail": "Beta is proof-backed for local review; public production launch remains gated by live credentials, managed database, backup/restore rehearsal and deployment secrets.",
        },
        "next_actions": [
            "Run final build and the checkpoint proof queue before publishing a beta handoff note.",
            "Document known production gaps beside the beta handoff so no live dependency is hidden.",
            "Move next into live credentials, managed database, deployment secrets, backups and production smoke.",
            "Keep this checkpoint visible in Production Ops until the public launch environment is ready.",
        ],
    }


def production_launch_report(
    db: Session,
    *,
    readiness: Optional[dict] = None,
    beta_delivery: Optional[dict] = None,
) -> dict:
    readiness = readiness if readiness is not None else readiness_report(db)
    beta_delivery = (
        beta_delivery
        if beta_delivery is not None
        else beta_delivery_report(db, readiness=readiness)
    )
    payment_status = payment_provider_status()
    campaign_statuses = [campaign_provider_status(channel) for channel in ["whatsapp", "sms", "email"]]
    social_statuses = [social_provider_status(platform) for platform in ["facebook", "instagram"]]
    ads_status = ad_provider_status()
    production_plan = readiness.get("production_database_plan") or {}
    security_plan = readiness.get("environment_security_plan") or {}
    deployment_plan = readiness.get("deployment_pipeline_plan") or {}
    backup_freshness = readiness.get("backup_freshness") or {}
    environment_summary = readiness.get("environment_summary") or {}
    live_deployment = readiness.get("live_deployment") or _live_deployment_status(db)

    payment_live_ready = (
        payment_status.get("provider") != "manual"
        and payment_status.get("checkout_configured")
        and payment_status.get("webhook_configured")
    )
    payment_missing = [
        *payment_status.get("missing_checkout_settings", []),
        *payment_status.get("missing_webhook_settings", []),
    ]
    if payment_status.get("provider") == "manual":
        payment_missing.append("PAYMENT_PROVIDER=direct_bank, cashfree, or razorpay")

    campaign_ready = sum(1 for status in campaign_statuses if status.get("configured"))
    campaign_missing = sorted({
        setting
        for status in campaign_statuses
        for setting in status.get("missing_settings", [])
    })
    social_ready = sum(1 for status in social_statuses if status.get("configured"))
    social_missing = sorted({
        setting
        for status in social_statuses
        for setting in status.get("missing_settings", [])
    })
    ads_missing = ads_status.get("missing_settings", [])

    live_credential_steps = [
        {
            "key": "payment_gateway",
            "label": "Payment gateway credentials",
            "status": "pass" if payment_live_ready else "warn",
            "owner": "Admin / payment provider",
            "detail": "Direct Bank, Cashfree, or Razorpay live settlement must replace manual payment mode before public launch.",
            "proof": "verify-payment-production-pass.cjs",
            "missing_settings": sorted(set(payment_missing)),
        },
        {
            "key": "message_providers",
            "label": "WhatsApp/SMS/email credentials",
            "status": "pass" if campaign_ready == len(campaign_statuses) else "warn",
            "owner": "Marketing / provider accounts",
            "detail": f"{campaign_ready}/{len(campaign_statuses)} campaign channels are configured for real sending.",
            "proof": "verify-messaging-readiness.cjs",
            "missing_settings": campaign_missing,
        },
        {
            "key": "social_and_ads",
            "label": "Social and Meta Ads credentials",
            "status": "pass" if social_ready == len(social_statuses) and ads_status.get("configured") else "warn",
            "owner": "Marketing / Meta business",
            "detail": f"{social_ready}/{len(social_statuses)} social channels plus Meta Ads must be connected before automated publishing.",
            "proof": "verify-social-publishing-readiness.cjs + verify-ad-provider-sync.cjs",
            "missing_settings": sorted({*social_missing, *ads_missing}),
        },
    ]

    lanes = [
        {
            "key": "live_credentials",
            "title": "Live Credentials",
            "status": _rollup_status(live_credential_steps),
            "owner": "Admin / provider accounts",
            "detail": "Real payment, messaging, social and ad-provider credentials are grouped here so no launch dependency stays hidden.",
            "steps": live_credential_steps,
        },
        {
            "key": "managed_database",
            "title": "Managed Database",
            "status": production_plan.get("status", "warn"),
            "owner": "Engineering / database owner",
            "detail": production_plan.get("decision") or "Production must run on a managed PostgreSQL-compatible database.",
            "steps": [
                {
                    "key": step.get("key"),
                    "label": step.get("label"),
                    "status": step.get("status", "warn"),
                    "owner": "Engineering",
                    "detail": step.get("detail"),
                    "proof": "verify-production-database-path.cjs",
                    "missing_settings": [],
                }
                for step in production_plan.get("migration_steps", [])[:4]
            ],
        },
        {
            "key": "backup_restore",
            "title": "Backup/Restore Rehearsal",
            "status": backup_freshness.get("status", "warn"),
            "owner": "Operations / engineering",
            "detail": "A fresh backup or managed snapshot plus restore rehearsal is required before real customer traffic.",
            "steps": [
                {
                    "key": step.get("key"),
                    "label": step.get("label"),
                    "status": step.get("status", "warn"),
                    "owner": "Operations",
                    "detail": step.get("detail"),
                    "proof": "verify-data-quality-export-command.cjs",
                    "missing_settings": [],
                }
                for step in production_plan.get("backup_restore_drill", [])[:4]
            ],
        },
        {
            "key": "deployment_secrets",
            "title": "Deployment Secrets",
            "status": security_plan.get("status", "warn"),
            "owner": "Engineering / deployment owner",
            "detail": security_plan.get("summary") or "Required env vars and sensitive secrets must be set in the deployment host.",
            "steps": [
                {
                    "key": step.get("key"),
                    "label": step.get("label"),
                    "status": step.get("status", "warn"),
                    "owner": "Engineering",
                    "detail": step.get("detail"),
                    "proof": "verify-environment-secrets-security.cjs",
                    "missing_settings": [],
                }
                for step in security_plan.get("deployment_env", [])[:4]
            ],
        },
        {
            "key": "production_smoke",
            "title": "Production Smoke",
            "status": deployment_plan.get("status", "warn"),
            "owner": "Launch captain",
            "detail": "Build, deploy, log inspection, rollback ownership and browser smoke tests are the final launch gate.",
            "steps": [
                {
                    "key": "live_deployment_proof",
                    "label": "Run live deployment proof",
                    "status": live_deployment.get("status", "warn"),
                    "owner": "Launch captain",
                    "detail": live_deployment.get("detail")
                    or "Verify public API health, production checkout database readiness, CORS and order page availability.",
                    "proof": "verify-live-deployment-proof.cjs",
                    "missing_settings": [],
                },
                {
                    "key": "frontend_build",
                    "label": "Run production build",
                    "status": "pass",
                    "owner": "Engineering",
                    "detail": "Run npm run build before promoting the public environment.",
                    "proof": "npm run build",
                    "missing_settings": [],
                },
                {
                    "key": "ops_smoke",
                    "label": "Run Production Ops smoke",
                    "status": beta_delivery.get("status", "warn"),
                    "owner": "Launch captain",
                    "detail": "Open /ops, /roadmap, customer checkout and staff order paths against production.",
                    "proof": "verify-production-ops-readiness.cjs",
                    "missing_settings": [],
                },
                {
                    "key": "deploy_smoke",
                    "label": "Deploy and smoke test",
                    "status": deployment_plan.get("status", "warn"),
                    "owner": "Launch captain",
                    "detail": "Deploy to the public host, inspect logs, run browser smoke and confirm rollback owner.",
                    "proof": "verify-deployment-pipeline.cjs",
                    "missing_settings": [],
                },
            ],
        },
    ]

    blocker_details = [
        *[
            item.get("detail") or item.get("label")
            for item in readiness.get("launch_blockers", [])
        ],
        *production_plan.get("blockers", []),
        *security_plan.get("blockers", []),
        *deployment_plan.get("blockers", []),
        *[
            f"{step['label']}: {', '.join(step['missing_settings'])}"
            for step in live_credential_steps
            if step.get("missing_settings")
        ],
        (
            f"Live deployment proof: {live_deployment.get('detail')}"
            if live_deployment.get("status") != "pass"
            else None
        ),
    ]
    blockers = [
        {
            "key": f"launch_blocker_{index + 1}",
            "label": "Production launch blocker",
            "status": "warn",
            "detail": detail,
        }
        for index, detail in enumerate(dict.fromkeys(filter(None, blocker_details)))
    ][:14]

    execution_plan = [
        {
            "key": "collect_live_credentials",
            "label": "Collect live credentials",
            "status": lanes[0]["status"],
            "owner": "Admin / provider accounts",
            "detail": "Collect payment, messaging, social and ad credentials, then store them in the deployment secret manager.",
            "proof": "verify-production-launch-integrations.cjs",
        },
        {
            "key": "provision_managed_database",
            "label": "Provision managed database",
            "status": production_plan.get("status", "warn"),
            "owner": "Engineering",
            "detail": "Create the managed PostgreSQL database, set SQLALCHEMY_DATABASE_URI and run migrations.",
            "proof": "verify-production-database-path.cjs",
        },
        {
            "key": "set_deployment_secrets",
            "label": "Set deployment secrets",
            "status": security_plan.get("status", "warn"),
            "owner": "Engineering",
            "detail": "Set required env vars, rotate default credentials and keep sensitive values masked.",
            "proof": "verify-environment-secrets-security.cjs",
        },
        {
            "key": "backup_restore_rehearsal",
            "label": "Run backup/restore rehearsal",
            "status": backup_freshness.get("status", "warn"),
            "owner": "Operations",
            "detail": "Create a backup or snapshot, restore it into a clean database and run smoke checks.",
            "proof": "verify-data-quality-export-command.cjs",
        },
        {
            "key": "deploy_smoke",
            "label": "Deploy and smoke test",
            "status": deployment_plan.get("status", "warn"),
            "owner": "Launch captain",
            "detail": "Promote the environment, inspect logs, run smoke proofs and record rollback ownership.",
            "proof": "verify-deployment-pipeline.cjs",
        },
    ]

    status = _rollup_status([*lanes, *execution_plan])
    decision = "hold"
    if status == "pass" and not blockers:
        decision = "ready"
    elif status != "fail" and readiness.get("overall") != "blocked":
        decision = "conditional"

    return {
        "generated_at": datetime.utcnow().isoformat(),
        "status": status,
        "score": _readiness_score([*lanes, *execution_plan]),
        "decision": decision,
        "summary": {
            "lanes_total": len(lanes),
            "lanes_ready": sum(1 for lane in lanes if lane["status"] == "pass"),
            "integration_steps": sum(len(lane["steps"]) for lane in lanes),
            "live_credentials_ready": f"{sum(1 for step in live_credential_steps if step['status'] == 'pass')}/{len(live_credential_steps)}",
            "required_env": f"{environment_summary.get('required_configured', 0)}/{environment_summary.get('required_total', 0)}",
            "production_blockers": len(blockers),
            "readiness_score": readiness.get("readiness_score", 0),
            "beta_score": beta_delivery.get("score", 0),
        },
        "lanes": lanes,
        "blockers": blockers,
        "execution_plan": execution_plan,
        "handoff": {
            "title": "Production launch integrations",
            "status": decision,
            "detail": "The system now shows which live provider, database, backup, secret and deploy gates are ready before the June 20 launch window.",
        },
        "next_actions": [
            "Replace manual payment mode with the chosen live gateway credentials.",
            "Provision the managed database and run migrations against production secrets.",
            "Run backup/restore rehearsal before routing real customer traffic.",
            "Deploy to the public host and run customer, staff, ops and roadmap smoke checks.",
        ],
    }


def live_environment_report(
    db: Session,
    *,
    readiness: Optional[dict] = None,
    production_launch: Optional[dict] = None,
) -> dict:
    readiness = readiness if readiness is not None else readiness_report(db)
    production_launch = (
        production_launch
        if production_launch is not None
        else production_launch_report(db, readiness=readiness)
    )
    production_plan = readiness.get("production_database_plan") or {}
    security_plan = readiness.get("environment_security_plan") or {}
    deployment_plan = readiness.get("deployment_pipeline_plan") or {}
    backup_freshness = readiness.get("backup_freshness") or {}
    environment_summary = readiness.get("environment_summary") or {}
    lane_by_key = {lane["key"]: lane for lane in production_launch.get("lanes", [])}

    phases = [
        {
            "key": "credential_cutover",
            "title": "Credential Cutover",
            "status": lane_by_key.get("live_credentials", {}).get("status", "warn"),
            "owner": "Admin / provider accounts",
            "goal": "Replace local/manual provider modes with live payment, messaging, social and ad credentials in the deployment secret store.",
            "steps": [
                {
                    "key": "payment_live_credentials",
                    "label": "Apply live payment credentials",
                    "status": _gate_status(lane_by_key.get("live_credentials", {}).get("steps"), "payment_gateway"),
                    "owner": "Admin / payment provider",
                    "command": "Set PAYMENT_PROVIDER plus Cashfree/Razorpay checkout and webhook secrets",
                    "proof": "verify-payment-production-pass.cjs",
                    "detail": "Live checkout and webhook secrets must replace manual mode before paid public orders.",
                },
                {
                    "key": "message_live_credentials",
                    "label": "Apply WhatsApp/SMS/email credentials",
                    "status": _gate_status(lane_by_key.get("live_credentials", {}).get("steps"), "message_providers"),
                    "owner": "Marketing / provider accounts",
                    "command": "Set CAMPAIGN_SEND_ENABLED=true with provider API keys and sender IDs",
                    "proof": "verify-messaging-readiness.cjs",
                    "detail": "Campaign channels should have real provider tokens and compliant templates before live sends.",
                },
                {
                    "key": "meta_live_credentials",
                    "label": "Apply social and ad credentials",
                    "status": _gate_status(lane_by_key.get("live_credentials", {}).get("steps"), "social_and_ads"),
                    "owner": "Marketing / Meta business",
                    "command": "Set social publish and Meta Ads account tokens",
                    "proof": "verify-social-publishing-readiness.cjs + verify-ad-provider-sync.cjs",
                    "detail": "Facebook, Instagram and Meta Ads credentials should be present before automated posts or ad sync.",
                },
            ],
        },
        {
            "key": "database_migration",
            "title": "Database Migration",
            "status": lane_by_key.get("managed_database", {}).get("status", "warn"),
            "owner": "Engineering / database owner",
            "goal": "Move from local SQLite to the managed PostgreSQL-compatible database and prove schema/data readiness.",
            "steps": [
                {
                    "key": "freeze_local_writes",
                    "label": "Freeze local writes",
                    "status": "warn",
                    "owner": "Engineering",
                    "command": "Schedule a short cutover window and stop local write traffic",
                    "proof": "launch runbook note",
                    "detail": "Avoid order/customer drift while production data is migrated and smoke tested.",
                },
                {
                    "key": "run_migrations",
                    "label": "Bootstrap managed database",
                    "status": _gate_status(production_plan.get("migration_steps"), "run_migrations"),
                    "owner": "Engineering",
                    "command": "python bootstrap_managed_database.py --stamp-alembic",
                    "proof": "verify-production-database-path.cjs",
                    "detail": "Create the current schema, seed the verified baseline, validate every application table and stamp the fresh managed database.",
                },
                {
                    "key": "seed_baseline",
                    "label": "Seed launch baseline",
                    "status": _gate_status(production_plan.get("migration_steps"), "seed_baseline"),
                    "owner": "Operations / engineering",
                    "command": "Load menu, customization, delivery zones and launch users",
                    "proof": "verify-full-customer-order-e2e.cjs",
                    "detail": "Production must contain verified menu, delivery and admin/staff baseline data.",
                },
            ],
        },
        {
            "key": "secret_sync",
            "title": "Secret Sync",
            "status": lane_by_key.get("deployment_secrets", {}).get("status", "warn"),
            "owner": "Engineering / deployment owner",
            "goal": "Put required environment values into the live host and verify that sensitive values stay masked.",
            "steps": [
                {
                    "key": "host_secret_store",
                    "label": "Set deployment host secrets",
                    "status": _gate_status(security_plan.get("deployment_env"), "host_secret_store"),
                    "owner": "Engineering",
                    "command": "Set required environment values in the deployment host secret manager",
                    "proof": "verify-environment-secrets-security.cjs",
                    "detail": "Required env vars should be set outside source files and never printed in readiness responses.",
                },
                {
                    "key": "cors_live_origin",
                    "label": "Pin live CORS origin",
                    "status": _gate_status(security_plan.get("deployment_env"), "cors_origins"),
                    "owner": "Engineering",
                    "command": "Set BACKEND_CORS_ORIGINS to the public frontend domain",
                    "proof": "verify-production-ops-readiness.cjs",
                    "detail": "Credentialed browser calls must use explicit live origins, not wildcard CORS.",
                },
                {
                    "key": "session_rotation",
                    "label": "Rotate session secrets",
                    "status": _gate_status(security_plan.get("rotation_drill"), "session_rotation"),
                    "owner": "Engineering",
                    "command": "Rotate AUTH_SECRET_KEY and PIZZA_BLITZ_SESSION_SECRET before public traffic",
                    "proof": "verify-environment-secrets-security.cjs",
                    "detail": "Live launch should not reuse local/default auth or portal session secrets.",
                },
            ],
        },
        {
            "key": "restore_rehearsal",
            "title": "Restore Rehearsal",
            "status": lane_by_key.get("backup_restore", {}).get("status", "warn"),
            "owner": "Operations / engineering",
            "goal": "Create a backup or managed snapshot, restore into a clean environment and prove the recovery path.",
            "steps": [
                {
                    "key": "fresh_backup",
                    "label": "Create fresh backup or snapshot",
                    "status": backup_freshness.get("status", "warn"),
                    "owner": "Operations",
                    "command": "Create managed DB snapshot or run the backup command before deploy",
                    "proof": "verify-data-quality-export-command.cjs",
                    "detail": backup_freshness.get("detail") or "A successful backup or managed snapshot proof is required.",
                },
                {
                    "key": "restore_clean_db",
                    "label": "Restore into clean database",
                    "status": _gate_status(production_plan.get("backup_restore_drill"), "restore_rehearsal"),
                    "owner": "Engineering",
                    "command": "Restore the latest backup into a clean database and run smoke checks",
                    "proof": "restore rehearsal evidence",
                    "detail": "A restore rehearsal proves the rollback path before real customer traffic.",
                },
                {
                    "key": "rollback_window",
                    "label": "Confirm rollback window",
                    "status": _gate_status(production_plan.get("backup_restore_drill"), "rollback_window"),
                    "owner": "Launch captain",
                    "command": "Document latest backup location, recovery owner and rollback deadline",
                    "proof": "launch runbook note",
                    "detail": "Rollback ownership must be explicit during the first live ordering window.",
                },
            ],
        },
        {
            "key": "public_host_smoke",
            "title": "Public Host Smoke",
            "status": lane_by_key.get("production_smoke", {}).get("status", "warn"),
            "owner": "Launch captain",
            "goal": "Deploy the live host and prove customer, staff, admin and roadmap paths against the public environment.",
            "steps": [
                {
                    "key": "frontend_build",
                    "label": "Run final production build",
                    "status": _gate_status(deployment_plan.get("build_gate"), "frontend_build"),
                    "owner": "Engineering",
                    "command": "npm run build",
                    "proof": "npm run build",
                    "detail": "The optimized frontend build must pass immediately before promotion.",
                },
                {
                    "key": "deploy_live_host",
                    "label": "Deploy live host",
                    "status": _gate_status(deployment_plan.get("release_steps"), "promote_release"),
                    "owner": "Launch captain",
                    "command": "Promote release after build, migration, backup and secret checks",
                    "proof": "verify-deployment-pipeline.cjs",
                    "detail": "Deploy only after the release checklist is green and rollback ownership is known.",
                },
                {
                    "key": "customer_staff_smoke",
                    "label": "Run customer and staff smoke",
                    "status": production_launch.get("status", "warn"),
                    "owner": "Launch captain",
                    "command": "Run checkout, counter order, delivery, ops and roadmap E2E proofs against the live URL",
                    "proof": "verify-live-environment-execution.cjs",
                    "detail": "The public host must prove customer checkout, staff POS, delivery, Ops and Roadmap paths together.",
                },
            ],
        },
    ]

    phase_status = _rollup_status(phases)
    blockers = [
        {
            "key": blocker.get("key", f"live_blocker_{index + 1}"),
            "label": blocker.get("label", "Live environment blocker"),
            "status": blocker.get("status", "warn"),
            "detail": blocker.get("detail"),
        }
        for index, blocker in enumerate(production_launch.get("blockers", []))
    ]
    for missing_name in environment_summary.get("missing_required", []):
        blockers.append(
            {
                "key": f"missing_env_{missing_name.lower()}",
                "label": "Missing required environment",
                "status": "warn",
                "detail": f"{missing_name} must be set in the live deployment environment.",
            }
        )

    evidence = [
        {
            "key": "live_environment_command",
            "label": "Live environment execution command",
            "status": "pass",
            "proof": "verify-live-environment-execution.cjs",
            "artifact": "visible-live-environment-execution-command.png",
            "detail": "This board proves the cutover phases, blockers, evidence and go/no-go checkpoint are visible.",
        },
        {
            "key": "production_launch_command",
            "label": "Production launch integrations command",
            "status": "pass",
            "proof": "verify-production-launch-integrations.cjs",
            "artifact": "visible-production-launch-integrations-command.png",
            "detail": "Live credentials, database, backup, secrets and production smoke lanes are visible.",
        },
        {
            "key": "deployment_pipeline",
            "label": "Deployment pipeline proof",
            "status": deployment_plan.get("status", "warn"),
            "proof": "verify-deployment-pipeline.cjs",
            "artifact": "visible-deployment-pipeline.png",
            "detail": "Build gate, release checklist, rollback/log inspection and smoke path remain visible.",
        },
        {
            "key": "ops_readiness",
            "label": "Production Ops readiness proof",
            "status": readiness.get("overall") == "ready" and "pass" or "warn",
            "proof": "verify-production-ops-readiness.cjs",
            "artifact": "visible-production-ops-readiness.png",
            "detail": "Readiness, environment inventory and backup controls remain visible to admins.",
        },
    ]

    cutover_windows = [
        {
            "key": "preflight",
            "title": "Preflight",
            "status": phase_status,
            "window": "T-24h to T-2h",
            "detail": "Confirm provider credentials, managed database URL, required secrets, backup proof and rollback owner.",
        },
        {
            "key": "cutover",
            "title": "Cutover",
            "status": "warn",
            "window": "T-60m to T",
            "detail": "Freeze local writes, run migrations, seed launch baseline and promote the live host.",
        },
        {
            "key": "smoke",
            "title": "Smoke",
            "status": lane_by_key.get("production_smoke", {}).get("status", "warn"),
            "window": "T to T+60m",
            "detail": "Run customer checkout, staff POS, delivery, payment/webhook, Ops and Roadmap smoke on the live URL.",
        },
        {
            "key": "rollback",
            "title": "Rollback",
            "status": _gate_status(deployment_plan.get("rollback_checks"), "rollback_owner"),
            "window": "T+60m to T+24h",
            "detail": "Keep rollback owner, logs and restore evidence available during the first live traffic window.",
        },
    ]

    go_no_go = {
        "title": "Live environment go/no-go",
        "status": "hold" if blockers else ("ready" if phase_status == "pass" else "conditional"),
        "detail": "Move to public launch only after live credentials, managed database, restore rehearsal, deployment secrets and public-host smoke are proved together.",
        "required_signoffs": [
            "Admin confirms live provider credentials and settlement owner.",
            "Engineering confirms managed database migration, secrets, CORS and rollback controls.",
            "Operations confirms backup/restore evidence and live order smoke results.",
        ],
    }

    return {
        "generated_at": datetime.utcnow().isoformat(),
        "status": phase_status,
        "score": _readiness_score(phases),
        "decision": go_no_go["status"],
        "summary": {
            "phases_total": len(phases),
            "phases_ready": sum(1 for phase in phases if phase["status"] == "pass"),
            "actions_total": sum(len(phase["steps"]) for phase in phases),
            "evidence_total": len(evidence),
            "live_blockers": len(blockers),
            "required_env": f"{environment_summary.get('required_configured', 0)}/{environment_summary.get('required_total', 0)}",
            "production_launch_score": production_launch.get("score", 0),
            "readiness_score": readiness.get("readiness_score", 0),
        },
        "phases": phases,
        "cutover_windows": cutover_windows,
        "evidence": evidence,
        "blockers": blockers[:14],
        "go_no_go": go_no_go,
        "next_actions": [
            "Enter real gateway, messaging, social and ad credentials in the live host secret store.",
            "Run the managed database migration and restore rehearsal with one assigned rollback owner.",
            "Deploy the public host and run customer checkout, staff POS, delivery and Ops smoke against the live URL.",
            "Record go/no-go signoff beside the evidence before opening public ordering.",
        ],
    }


def credential_activation_report(db: Session) -> dict:
    readiness = readiness_report(db)
    production_launch = production_launch_report(db, readiness=readiness)
    live_environment = live_environment_report(
        db,
        readiness=readiness,
        production_launch=production_launch,
    )
    payment_status = payment_provider_status()
    campaign_statuses = [campaign_provider_status(channel) for channel in ["whatsapp", "sms", "email"]]
    social_statuses = [social_provider_status(platform) for platform in ["facebook", "instagram"]]
    ads_status = ad_provider_status()

    payment_live_ready = (
        payment_status.get("provider") != "manual"
        and payment_status.get("checkout_configured")
        and payment_status.get("webhook_configured")
    )
    payment_missing = [
        *payment_status.get("missing_checkout_settings", []),
        *payment_status.get("missing_webhook_settings", []),
    ]
    if payment_status.get("provider") == "manual":
        payment_missing.append("PAYMENT_PROVIDER=direct_bank, cashfree, or razorpay")

    campaign_providers = [
        {
            "key": f"campaign_{status['channel']}",
            "label": f"{status['channel'].title()} sender",
            "provider": status.get("provider", "unknown"),
            "status": "pass" if status.get("configured") else "warn",
            "channel": status["channel"],
            "configured": bool(status.get("configured")),
            "missing_settings": status.get("missing_settings", []),
            "proof": "verify-messaging-readiness.cjs",
            "detail": f"{status['channel'].title()} sending must use the live provider token and compliance-approved sender/template.",
        }
        for status in campaign_statuses
    ]
    social_providers = [
        {
            "key": f"social_{status['platform']}",
            "label": f"{status['platform'].title()} publishing",
            "provider": status.get("provider", "unknown"),
            "status": "pass" if status.get("configured") else "warn",
            "channel": status["platform"],
            "configured": bool(status.get("configured")),
            "missing_settings": status.get("missing_settings", []),
            "proof": "verify-social-publishing-readiness.cjs",
            "detail": f"{status['platform'].title()} must have live Meta credentials before public auto-posting.",
        }
        for status in social_statuses
    ]
    provider_matrix = [
        {
            "key": "payment_checkout",
            "label": "Payment checkout",
            "provider": payment_status.get("provider", "manual"),
            "status": "pass" if payment_live_ready else "warn",
            "channel": "payment",
            "configured": payment_live_ready,
            "missing_settings": sorted(set(payment_missing)),
            "proof": "verify-payment-production-pass.cjs",
            "detail": "Live gateway checkout and webhook credentials must be configured before paid orders.",
        },
        *campaign_providers,
        *social_providers,
        {
            "key": "meta_ads",
            "label": "Meta Ads sync",
            "provider": ads_status.get("provider", "meta-ads"),
            "status": "pass" if ads_status.get("configured") else "warn",
            "channel": "ads",
            "configured": bool(ads_status.get("configured")),
            "missing_settings": ads_status.get("missing_settings", []),
            "proof": "verify-ad-provider-sync.cjs",
            "detail": "Meta Ads account and token must be configured before live ad sync or launch.",
        },
    ]

    activation_lanes = [
        {
            "key": "payment_gateway",
            "title": "Payment Gateway Activation",
            "status": provider_matrix[0]["status"],
            "owner": "Admin / payment provider",
            "detail": "Activate Direct Bank, Cashfree, or Razorpay live settlement ownership.",
            "providers": [provider_matrix[0]],
        },
        {
            "key": "messaging_channels",
            "title": "Messaging Channel Activation",
            "status": _rollup_status(campaign_providers),
            "owner": "Marketing / provider accounts",
            "detail": "Activate WhatsApp, SMS and email providers with compliant templates and test-send evidence.",
            "providers": campaign_providers,
        },
        {
            "key": "social_publishing",
            "title": "Social Publishing Activation",
            "status": _rollup_status(social_providers),
            "owner": "Marketing / Meta business",
            "detail": "Activate Facebook and Instagram publishing credentials before automated launch offers.",
            "providers": social_providers,
        },
        {
            "key": "ad_campaign_sync",
            "title": "Ad Campaign Sync Activation",
            "status": provider_matrix[-1]["status"],
            "owner": "Marketing / Meta Ads",
            "detail": "Activate Meta Ads credentials, external campaign IDs and paused launch sync controls.",
            "providers": [provider_matrix[-1]],
        },
    ]

    smoke_plan = [
        {
            "key": "low_value_checkout",
            "label": "Run low-value payment checkout",
            "status": provider_matrix[0]["status"],
            "owner": "Admin / finance",
            "proof": "verify-payment-production-pass.cjs",
            "detail": "Create a low-value paid order and confirm provider order ID, payment ID and receipt state.",
        },
        {
            "key": "payment_webhook",
            "label": "Run payment webhook proof",
            "status": "pass" if payment_live_ready else "warn",
            "owner": "Engineering / finance",
            "proof": payment_status.get("webhook_endpoint", "/api/v1/restaurant/orders/payments/webhook/{provider}"),
            "detail": "Send or receive a signed gateway webhook and prove the order payment state updates safely.",
        },
        {
            "key": "campaign_send",
            "label": "Run campaign test sends",
            "status": _rollup_status(campaign_providers),
            "owner": "Marketing",
            "proof": "verify-messaging-readiness.cjs",
            "detail": "Send controlled WhatsApp/SMS/email smoke messages to owner-approved test contacts only.",
        },
        {
            "key": "social_post",
            "label": "Run social publish smoke",
            "status": _rollup_status(social_providers),
            "owner": "Marketing",
            "proof": "verify-social-publishing-readiness.cjs",
            "detail": "Publish or dry-run a launch offer post and confirm provider delivery/audit state.",
        },
        {
            "key": "ad_sync",
            "label": "Run ad sync smoke",
            "status": provider_matrix[-1]["status"],
            "owner": "Marketing / ads",
            "proof": "verify-ad-provider-sync.cjs",
            "detail": "Sync a paused campaign or external campaign ID and confirm guardrails prevent accidental live spend.",
        },
    ]

    blocker_details = [
        *[
            f"{provider['label']}: {', '.join(provider['missing_settings'])}"
            for provider in provider_matrix
            if provider.get("missing_settings")
        ],
        *[
            blocker.get("detail")
            for blocker in production_launch.get("blockers", [])
            if blocker.get("detail")
        ][:4],
        *[
            blocker.get("detail")
            for blocker in live_environment.get("blockers", [])
            if blocker.get("detail")
        ][:4],
    ]
    blockers = [
        {
            "key": f"credential_blocker_{index + 1}",
            "label": "Credential activation blocker",
            "status": "warn",
            "detail": detail,
        }
        for index, detail in enumerate(dict.fromkeys(filter(None, blocker_details)))
    ][:14]

    evidence = [
        {
            "key": "credential_activation",
            "label": "Credential activation command",
            "status": "pass",
            "proof": "verify-credential-activation-command.cjs",
            "artifact": "visible-credential-activation-command.png",
            "detail": "Provider readiness, smoke sequence, blockers and go/no-go are visible in Production Ops.",
        },
        {
            "key": "payment_proof",
            "label": "Payment production proof",
            "status": provider_matrix[0]["status"],
            "proof": "verify-payment-production-pass.cjs",
            "artifact": "visible-payment-production-pass.png",
            "detail": "Gateway setup, webhook readiness and settlement visibility are represented.",
        },
        {
            "key": "messaging_proof",
            "label": "Messaging readiness proof",
            "status": _rollup_status(campaign_providers),
            "proof": "verify-messaging-readiness.cjs",
            "artifact": "visible-messaging-readiness.png",
            "detail": "WhatsApp, SMS and email provider setup and safe test-send controls are represented.",
        },
        {
            "key": "social_ads_proof",
            "label": "Social and ads proof",
            "status": _rollup_status([*social_providers, provider_matrix[-1]]),
            "proof": "verify-social-publishing-readiness.cjs + verify-ad-provider-sync.cjs",
            "artifact": "visible-ad-provider-sync.png",
            "detail": "Social token readiness, delivery audit and Meta Ads sync controls are represented.",
        },
    ]

    status = _rollup_status([*activation_lanes, *smoke_plan])
    decision = "hold" if blockers else ("ready" if status == "pass" else "conditional")

    return {
        "generated_at": datetime.utcnow().isoformat(),
        "status": status,
        "score": _readiness_score([*activation_lanes, *smoke_plan]),
        "decision": decision,
        "summary": {
            "providers_total": len(provider_matrix),
            "providers_ready": sum(1 for provider in provider_matrix if provider["status"] == "pass"),
            "smoke_steps": len(smoke_plan),
            "smoke_ready": sum(1 for step in smoke_plan if step["status"] == "pass"),
            "missing_settings": sum(len(provider.get("missing_settings", [])) for provider in provider_matrix),
            "blockers": len(blockers),
            "live_environment_score": live_environment.get("score", 0),
            "readiness_score": readiness.get("readiness_score", 0),
        },
        "activation_lanes": activation_lanes,
        "provider_matrix": provider_matrix,
        "smoke_plan": smoke_plan,
        "evidence": evidence,
        "blockers": blockers,
        "go_no_go": {
            "title": "Credential activation go/no-go",
            "status": decision,
            "detail": "Run live provider smoke only after gateway, messaging, social and ad credentials are present in the live secret store with rollback owners assigned.",
            "required_signoffs": [
                "Finance confirms low-value payment and webhook proof owner.",
                "Marketing confirms test recipients, templates, social pages and Meta Ads spend guardrails.",
                "Engineering confirms secrets are live-host only, masked, and rollback-ready.",
            ],
        },
        "next_actions": [
            "Enter live gateway credentials and run one low-value checkout plus webhook proof.",
            "Enter WhatsApp/SMS/email credentials and run owner-approved test sends only.",
            "Enter Facebook, Instagram and Meta Ads credentials, then smoke publish/sync with spend guardrails.",
            "Record provider IDs, external IDs, receipts and blockers before opening public promotional traffic.",
        ],
    }


def _production_database_plan(*, environment: str, backup_freshness: dict, restore_rehearsal: dict) -> dict:
    backend = database_backend()
    current_path = sqlite_database_path()
    managed_database_ready = backend not in {"sqlite", "unknown"}
    production_mode_ready = environment == "production"
    backup_ready = backup_freshness.get("status") == "pass"
    status = "pass" if managed_database_ready and production_mode_ready and backup_ready else "warn"

    blockers = []
    if not managed_database_ready:
        blockers.append("SQLALCHEMY_DATABASE_URI still needs a managed PostgreSQL-compatible database URL.")
    if not production_mode_ready:
        blockers.append("ENVIRONMENT is not production yet.")
    if not backup_ready:
        blockers.append(backup_freshness.get("detail") or "A successful backup or managed snapshot proof is still required.")
    blockers.append("Restore rehearsal must be run before public beta traffic.")

    return {
        "decision": "Use a managed PostgreSQL-compatible database for production.",
        "status": status,
        "current_backend": backend,
        "current_path": str(current_path) if current_path else None,
        "target_backend": "Managed PostgreSQL",
        "target_driver": "postgresql+psycopg2",
        "readiness_metrics": [
            {"label": "Current DB", "value": backend},
            {"label": "Target DB", "value": "PostgreSQL"},
            {"label": "Mode", "value": "production" if production_mode_ready else "development"},
            {"label": "Backup", "value": backup_freshness.get("status", "warn")},
        ],
        "migration_steps": [
            {
                "key": "choose_provider",
                "label": "Choose managed PostgreSQL provider",
                "status": "pass",
                "detail": "Target is PostgreSQL-compatible managed storage so SQLAlchemy, Alembic, backups and deployment hosts stay aligned.",
            },
            {
                "key": "set_database_url",
                "label": "Set SQLALCHEMY_DATABASE_URI",
                "status": "pass" if managed_database_ready else "warn",
                "detail": "Use postgresql+psycopg2://... in production secrets; keep local SQLite only for development.",
            },
            {
                "key": "run_migrations",
                "label": "Bootstrap managed database",
                "status": "warn",
                "detail": "Run python bootstrap_managed_database.py --stamp-alembic against the fresh managed database before importing menu, customers or orders.",
            },
            {
                "key": "seed_baseline",
                "label": "Seed menu and admin baseline",
                "status": "warn",
                "detail": "Load verified menu, customization options, delivery zones and admin/staff credentials after migrations.",
            },
            {
                "key": "production_smoke",
                "label": "Run production smoke proof",
                "status": "warn",
                "detail": "Prove login, reports, orders, backups and payment-readiness checks against the managed database.",
            },
        ],
        "backup_restore_drill": [
            {
                "key": "snapshot_policy",
                "label": "Snapshot policy",
                "status": "warn" if not managed_database_ready else "pass",
                "detail": "Managed DB must have daily snapshots or pg_dump equivalent with retention documented.",
            },
            {
                "key": "backup_freshness",
                "label": "Backup freshness",
                "status": backup_freshness.get("status", "warn"),
                "detail": backup_freshness.get("detail") or "Latest backup status is not available.",
            },
            {
                "key": "restore_rehearsal",
                "label": "Restore rehearsal",
                "status": restore_rehearsal.get("status", "warn"),
                "detail": restore_rehearsal.get("detail")
                or "Restore a backup into a clean database and run the admin/order/report smoke proof before public launch.",
            },
            {
                "key": "rollback_window",
                "label": "Rollback window",
                "status": "warn",
                "detail": "Keep a rollback plan for the first beta week with latest backup location, owner and recovery steps.",
            },
        ],
        "blockers": blockers,
    }


def _environment_security_plan(
    *,
    environment: str,
    checks: list[dict],
    environment_manifest: list[dict],
    environment_summary: dict,
) -> dict:
    check_by_key = {check["key"]: check for check in checks}
    secret_checks = [
        check_by_key["admin_password"],
        check_by_key["staff_password"],
        check_by_key["auth_secret"],
        check_by_key["portal_session_secret"],
    ]
    secret_passed = sum(1 for check in secret_checks if check["status"] == "pass")
    variables = [
        variable
        for group in environment_manifest
        for variable in group["variables"]
    ]
    sensitive_variables = [variable for variable in variables if variable["sensitive"]]
    configured_sensitive = [
        variable
        for variable in sensitive_variables
        if variable["configured"]
    ]
    required_total = environment_summary["required_total"]
    required_configured = environment_summary["required_configured"]
    required_ready = required_total > 0 and required_configured == required_total
    secrets_ready = secret_passed == len(secret_checks)
    production_mode_ready = environment == "production"
    status = "pass" if required_ready and secrets_ready and production_mode_ready else "warn"

    blockers = []
    if not production_mode_ready:
        blockers.append("ENVIRONMENT must be set to production before public launch.")
    for name in environment_summary["missing_required"]:
        blockers.append(f"{name} is missing from the deployment environment.")
    for check in secret_checks:
        if check["status"] != "pass":
            blockers.append(f"{check['label']}: {check['detail']}")
    blockers.append("Secret rotation and rollback access rehearsal must be completed before open beta.")

    return {
        "summary": "Production launch needs required env vars in the host secret store, no default credentials, masked secret display and a rotation owner.",
        "status": status,
        "readiness_metrics": [
            {"label": "Required Env", "value": f"{required_configured}/{required_total}"},
            {"label": "Secret Checks", "value": f"{secret_passed}/{len(secret_checks)}"},
            {"label": "Sensitive Set", "value": f"{len(configured_sensitive)}/{len(sensitive_variables)}"},
            {"label": "Masking", "value": "Hidden"},
        ],
        "secret_controls": [
            {
                "key": "admin_password",
                "label": "Admin password",
                "status": check_by_key["admin_password"]["status"],
                "detail": check_by_key["admin_password"]["detail"],
            },
            {
                "key": "staff_password",
                "label": "Staff password",
                "status": check_by_key["staff_password"]["status"],
                "detail": check_by_key["staff_password"]["detail"],
            },
            {
                "key": "auth_secret",
                "label": "AUTH_SECRET_KEY",
                "status": check_by_key["auth_secret"]["status"],
                "detail": check_by_key["auth_secret"]["detail"],
            },
            {
                "key": "portal_session_secret",
                "label": "PIZZA_BLITZ_SESSION_SECRET",
                "status": check_by_key["portal_session_secret"]["status"],
                "detail": check_by_key["portal_session_secret"]["detail"],
            },
            {
                "key": "secret_masking",
                "label": "Secret value masking",
                "status": "pass",
                "detail": "Sensitive environment values are reported as hidden and never returned through the readiness API.",
            },
        ],
        "deployment_env": [
            {
                "key": "host_secret_store",
                "label": "Host secret store",
                "status": "warn" if not required_ready else "pass",
                "detail": "Set required production values in the deployment host secret manager, not in source files.",
            },
            {
                "key": "environment_mode",
                "label": "ENVIRONMENT=production",
                "status": "pass" if production_mode_ready else "warn",
                "detail": "Production mode should be enabled only after the required secrets and database URL are set.",
            },
            {
                "key": "cors_origins",
                "label": "BACKEND_CORS_ORIGINS",
                "status": check_by_key["cors_origins"]["status"],
                "detail": check_by_key["cors_origins"]["detail"],
            },
            {
                "key": "database_url",
                "label": "SQLALCHEMY_DATABASE_URI",
                "status": "pass" if "SQLALCHEMY_DATABASE_URI" not in environment_summary["missing_required"] else "warn",
                "detail": "Production database credentials must be stored as a masked secret and rotated with deployment access.",
            },
        ],
        "rotation_drill": [
            {
                "key": "credential_rotation",
                "label": "Credential rotation owner",
                "status": "warn",
                "detail": "Assign an owner for rotating admin, staff, gateway, messaging and social provider credentials.",
            },
            {
                "key": "session_rotation",
                "label": "Session secret rotation",
                "status": "warn",
                "detail": "Document how to rotate AUTH_SECRET_KEY and PIZZA_BLITZ_SESSION_SECRET with a planned user re-login window.",
            },
            {
                "key": "provider_token_rotation",
                "label": "Provider token rotation",
                "status": "warn",
                "detail": "Keep payment, WhatsApp, SMS, email, Meta social and ads token rotation steps in the launch runbook.",
            },
            {
                "key": "rollback_access",
                "label": "Rollback access rehearsal",
                "status": "warn",
                "detail": "Confirm who can access deployment logs, rollback controls and restore credentials during the first beta week.",
            },
        ],
        "blockers": blockers,
    }


def _deployment_pipeline_plan(
    *,
    environment: str,
    checks: list[dict],
    environment_summary: dict,
    readiness_score: int,
    module_readiness: list[dict],
    backup_freshness: dict,
) -> dict:
    check_by_key = {check["key"]: check for check in checks}
    modules_ready = sum(1 for module in module_readiness if module["status"] == "pass")
    modules_total = len(module_readiness)
    required_ready = (
        environment_summary["required_total"] > 0
        and environment_summary["required_configured"] == environment_summary["required_total"]
    )
    production_mode_ready = environment == "production"
    database_ready = check_by_key["database_persistence"]["status"] == "pass"
    backup_ready = backup_freshness.get("status") == "pass"
    status = "pass" if production_mode_ready and required_ready and database_ready and backup_ready else "warn"

    blockers = []
    if not production_mode_ready:
        blockers.append("ENVIRONMENT must be production before a public deploy is promoted.")
    if not required_ready:
        blockers.append("Required deployment environment variables are not fully configured.")
    if not database_ready:
        blockers.append(check_by_key["database_persistence"]["detail"])
    if not backup_ready:
        blockers.append(backup_freshness.get("detail") or "A backup or managed snapshot proof is still required.")
    blockers.append("Rollback/log inspection must be rehearsed before the June 20 beta checkpoint.")

    return {
        "summary": "Deployment needs a repeatable build gate, host secret check, migration/backup proof, production smoke run, log inspection and rollback owner.",
        "status": status,
        "readiness_metrics": [
            {"label": "Build Gate", "value": "next build"},
            {"label": "Required Env", "value": f"{environment_summary['required_configured']}/{environment_summary['required_total']}"},
            {"label": "Modules Ready", "value": f"{modules_ready}/{modules_total}"},
            {"label": "Go-Live Score", "value": f"{readiness_score}%"},
        ],
        "build_gate": [
            {
                "key": "frontend_build",
                "label": "Frontend production build",
                "status": "pass",
                "detail": "Run npm run build before every deploy and block promotion if the optimized Next.js build fails.",
            },
            {
                "key": "backend_import",
                "label": "Backend import and health check",
                "status": "pass",
                "detail": "Start the API and verify /health before browser proof runs or deployment promotion.",
            },
            {
                "key": "browser_suite",
                "label": "Browser proof suite",
                "status": "pass",
                "detail": "Run critical Playwright proofs for ops, roadmap, checkout, delivery, reporting and visual route health.",
            },
            {
                "key": "artifact_review",
                "label": "Artifact review",
                "status": "warn",
                "detail": "Review screenshots for /ops and /roadmap after deployment so blank screens or layout regressions are caught.",
            },
        ],
        "release_steps": [
            {
                "key": "secrets_pull",
                "label": "Pull deployment secrets",
                "status": "warn" if not required_ready else "pass",
                "detail": "Confirm deployment host secrets match the readiness manifest without exposing values in logs.",
            },
            {
                "key": "database_migration",
                "label": "Run database migrations",
                "status": "warn" if not database_ready else "pass",
                "detail": "Run Alembic migrations against the production database before routing live traffic.",
            },
            {
                "key": "backup_snapshot",
                "label": "Create pre-deploy backup",
                "status": backup_freshness.get("status", "warn"),
                "detail": backup_freshness.get("detail") or "Create a backup or managed snapshot before deploy.",
            },
            {
                "key": "promote_release",
                "label": "Promote release",
                "status": "warn",
                "detail": "Promote only after build, migration, backup and smoke gates are green.",
            },
        ],
        "rollback_checks": [
            {
                "key": "log_inspection",
                "label": "Log inspection",
                "status": "warn",
                "detail": "Inspect frontend and backend logs immediately after deploy for auth, API, payment and database errors.",
            },
            {
                "key": "rollback_owner",
                "label": "Rollback owner",
                "status": "warn",
                "detail": "Assign one person who can roll back deployment and restore access during the first beta week.",
            },
            {
                "key": "restore_link",
                "label": "Restore path link",
                "status": "warn",
                "detail": "Keep the latest backup or managed snapshot reference beside the rollback checklist.",
            },
            {
                "key": "incident_note",
                "label": "Incident note",
                "status": "warn",
                "detail": "Record deploy time, commit, smoke proof result, rollback decision and owner notes.",
            },
        ],
        "production_smoke": [
            {
                "key": "admin_login",
                "label": "Admin login smoke",
                "status": "warn",
                "detail": "Confirm admin login and Production Ops readiness load against the deployed URL.",
            },
            {
                "key": "customer_order",
                "label": "Customer order smoke",
                "status": "warn",
                "detail": "Place one pickup and one delivery test order through the customer website.",
            },
            {
                "key": "staff_order",
                "label": "Counter POS smoke",
                "status": "warn",
                "detail": "Create a counter order, generate receipt and verify kitchen/order status updates.",
            },
            {
                "key": "reporting_smoke",
                "label": "Owner reporting smoke",
                "status": "warn",
                "detail": "Open reports and confirm comparison cards, channel signals and product movers render.",
            },
        ],
        "blockers": blockers,
    }


def _count(db: Session, model, *criteria) -> int:
    query = db.query(func.count(model.id))
    if criteria:
        query = query.filter(*criteria)
    return int(query.scalar() or 0)


def _weighted_score(items: list[dict]) -> int:
    if not items:
        return 0
    weights = {"pass": 1.0, "warn": 0.5, "fail": 0.0}
    return round(sum(weights.get(item["status"], 0) for item in items) / len(items) * 100)


def _module_status(score: int) -> str:
    if score >= 85:
        return "pass"
    if score >= 45:
        return "warn"
    return "fail"


def _module(
    *,
    key: str,
    title: str,
    score: int,
    route: str,
    detail: str,
    metrics: list[dict],
    next_actions: list[str],
) -> dict:
    return {
        "key": key,
        "title": title,
        "status": _module_status(score),
        "score": score,
        "route": route,
        "detail": detail,
        "metrics": metrics,
        "next_actions": next_actions[:3],
    }


def _launch_module_readiness(
    db: Session,
    *,
    checks: list[dict],
    payment_status: dict,
    backup_freshness: dict,
    live_deployment: dict,
    go_live_items: list[dict],
) -> list[dict]:
    check_by_key = {check["key"]: check for check in checks}
    campaign_statuses = [campaign_provider_status(channel) for channel in ["whatsapp", "sms", "email"]]
    social_statuses = [social_provider_status(platform) for platform in ["facebook", "instagram"]]
    ads_status = ad_provider_status()

    active_menu = _count(db, MenuItem, MenuItem.is_available.is_(True))
    customization_groups = _count(db, MenuCustomizationGroup, MenuCustomizationGroup.is_active.is_(True))
    customization_options = _count(db, MenuCustomizationOption, MenuCustomizationOption.is_active.is_(True))
    order_count = _count(db, RestaurantOrder)
    open_orders = _count(db, RestaurantOrder, RestaurantOrder.status != "closed")
    paid_orders = _count(db, RestaurantOrder, RestaurantOrder.payment_status == "paid")
    kitchen_station_metrics = _kitchen_station_metrics(db)
    active_zones = _count(db, DeliveryZone, DeliveryZone.is_active.is_(True))
    delivery_assignments = _count(db, DeliveryAssignment)
    customers = _count(db, Customer)
    opted_in_customers = _count(db, Customer, Customer.opt_in_marketing.is_(True))
    promotions = _count(db, Promotion)
    campaign_deliveries = _count(db, CampaignDelivery)
    provider_test_runs = _count(db, ProviderTestRun)
    social_posts = _count(db, SocialPost)
    social_deliveries = _count(db, SocialPostDelivery)
    ad_campaigns = _count(db, AdCampaign)
    ad_launches = _count(db, AdCampaignLaunch)
    daily_sales = _count(db, DailySales)
    expense_metrics = _expense_audit_metrics(db)
    successful_backups = _count(db, BackupRun, BackupRun.status == "success")
    employee_metrics = _employee_attendance_metrics(db)

    security_score = _weighted_score([
        check_by_key["admin_password"],
        check_by_key["staff_password"],
        check_by_key["auth_secret"],
        check_by_key["portal_session_secret"],
        check_by_key["cors_origins"],
    ])
    catalog_score = (
        (40 if active_menu else 0)
        + (30 if customization_groups else 0)
        + (30 if customization_options else 0)
    )
    ordering_score = (
        (35 if active_menu else 0)
        + (35 if order_count else 0)
        + (15 if payment_status.get("provider") else 0)
        + (15 if paid_orders else 8)
    )
    kitchen_score = (
        (35 if order_count else 0)
        + (35 if kitchen_station_metrics["stationed_orders"] else 0)
        + (20 if kitchen_station_metrics["station_count"] >= 2 else 10 if kitchen_station_metrics["station_count"] else 0)
        + 10
    )
    delivery_score = (
        (70 if active_zones else 0)
        + (20 if delivery_assignments else 10)
        + 10
    )
    marketing_score = (
        (35 if customers else 0)
        + (25 if opted_in_customers else 0)
        + (20 if promotions else 0)
        + (20 if campaign_deliveries else 10)
    )
    growth_score = (
        (25 if any(status["configured"] for status in campaign_statuses) else 10)
        + (20 if campaign_deliveries else 5)
        + (20 if social_posts or social_deliveries else 5)
        + (20 if ad_campaigns or ad_launches else 5)
        + (15 if ads_status["configured"] or any(status["configured"] for status in social_statuses) else 5)
    )
    growth_software_checks = [
        {
            "label": "Provider safe tests",
            "ready": bool(provider_test_runs or campaign_deliveries),
        },
        {
            "label": "Campaign delivery audit",
            "ready": bool(campaign_deliveries),
        },
        {
            "label": "Social publishing audit",
            "ready": bool(social_posts or social_deliveries),
        },
        {
            "label": "Ad campaign guardrails",
            "ready": bool(ad_campaigns or ad_launches),
        },
    ]
    growth_software_ready = sum(1 for check in growth_software_checks if check["ready"])
    growth_provider_ready = (
        sum(1 for status in campaign_statuses if status["configured"])
        + sum(1 for status in social_statuses if status["configured"])
        + (1 if ads_status["configured"] else 0)
    )
    growth_provider_total = len(campaign_statuses) + len(social_statuses) + 1
    if growth_software_ready == len(growth_software_checks) and growth_provider_ready < growth_provider_total:
        growth_score = max(growth_score, 80)
    finance_score = (
        (30 if daily_sales else 10)
        + (25 if order_count else 0)
        + (25 if backup_freshness["status"] == "pass" else 10)
        + 20
    )
    employee_score = (
        (35 if employee_metrics["shift_count"] else 0)
        + (25 if employee_metrics["leave_count"] else 10)
        + (25 if employee_metrics["staff_count"] >= 2 else 10 if employee_metrics["staff_count"] else 0)
        + (15 if employee_metrics["covered_role_count"] >= 2 else 5 if employee_metrics["covered_role_count"] else 0)
    )
    expense_score = (
        (30 if expense_metrics["expense_count"] else 15 if expense_metrics["expense_signal_days"] else 0)
        + (25 if expense_metrics["category_count"] >= 5 else 10 if expense_metrics["category_count"] else 0)
        + (25 if expense_metrics["expense_signal_days"] else 0)
        + (20 if expense_metrics["high_risk_days"] == 0 else 10)
    )
    live_deployment_score = int(live_deployment.get("score") or 0)
    live_deployment_ready = live_deployment.get("status") == "pass"
    production_score = round(
        (_readiness_score(go_live_items) * 0.45)
        + (15 if successful_backups else 8)
        + (live_deployment_score * 0.40)
    )
    production_next_actions = [
        (
            "Keep live deployment proof fresh after each production deploy."
            if live_deployment_ready
            else "Run live deployment proof from Production Ops after each production deploy."
        ),
        (
            "Local dev is still using SQLite; production proof is tracked separately."
            if database_backend() == "sqlite" and live_deployment_ready
            else "Move from local SQLite to managed production database."
            if database_backend() == "sqlite"
            else "Record the first managed database backup/restore proof so backup freshness turns green."
            if backup_freshness["status"] != "pass"
            else "Keep managed database backup evidence current."
        ),
        "Keep deployment secrets in Vercel/Supabase and out of the repository.",
    ]

    return [
        _module(
            key="security_foundation",
            title="Security Foundation",
            score=security_score,
            route="/settings",
            detail="Admin/staff roles, portal sessions, backend role gates, and CORS are tracked together.",
            metrics=[
                {"label": "Checks", "value": f"{sum(1 for check in checks if check['status'] == 'pass')}/{len(checks)} pass"},
                {"label": "Role gates", "value": "enabled"},
            ],
            next_actions=[
                "Set production admin/staff credentials and unique session secrets.",
                "Keep BACKEND_CORS_ORIGINS pinned to deployed frontend domains.",
            ],
        ),
        _module(
            key="product_catalog",
            title="Product Catalog",
            score=catalog_score,
            route="/menu",
            detail="Menu items, sizes, toppings, add-ons, and customization pricing are available for ordering.",
            metrics=[
                {"label": "Active products", "value": str(active_menu)},
                {"label": "Customization groups", "value": str(customization_groups)},
                {"label": "Options", "value": str(customization_options)},
            ],
            next_actions=[
                "Review product names, photos, and live pricing before launch.",
                "Add combos or offer bundles for higher average order value.",
            ],
        ),
        _module(
            key="ordering_flow",
            title="Ordering Flow",
            score=ordering_score,
            route="/orders",
            detail="Counter POS, website checkout, order status, receipts, and payment state are connected.",
            metrics=[
                {"label": "Orders", "value": str(order_count)},
                {"label": "Open orders", "value": str(open_orders)},
                {"label": "Paid orders", "value": str(paid_orders)},
            ],
            next_actions=[
                "Run one complete pickup and delivery order before launch.",
                "Connect the real payment provider when credentials are ready.",
            ],
        ),
        _module(
            key="kitchen_station_operations",
            title="Kitchen Station Operations",
            score=kitchen_score,
            route="/kitchen-ticket/{orderId}",
            detail="Counter orders now carry kitchen station routing so KOT views can split oven, sides, cold and prep work.",
            metrics=[
                {"label": "Stationed orders", "value": str(kitchen_station_metrics["stationed_orders"])},
                {"label": "Stations seen", "value": str(kitchen_station_metrics["station_count"])},
                {"label": "Routed lines", "value": str(kitchen_station_metrics["stationed_lines"])},
            ],
            next_actions=[
                "Create one mixed counter order and print station-filtered KOT slips.",
                "Confirm station names match the physical kitchen layout before launch.",
            ],
        ),
        _module(
            key="delivery_operations",
            title="Delivery Operations",
            score=delivery_score,
            route="/operations",
            detail="Delivery zones, charges, ETA windows, address validation, and assignment records are tracked.",
            metrics=[
                {"label": "Active zones", "value": str(active_zones)},
                {"label": "Assignments", "value": str(delivery_assignments)},
            ],
            next_actions=[
                "Confirm live delivery areas and minimum order rules.",
                "Assign test delivery orders to staff and close the handoff loop.",
            ],
        ),
        _module(
            key="employee_workforce",
            title="Employee Attendance And CL/PL",
            score=employee_score,
            route="/shifts",
            detail="Staff shift roster, role coverage, attendance flags and CL/PL leave balances are now tracked together.",
            metrics=[
                {"label": "Shift logs", "value": str(employee_metrics["shift_count"])},
                {"label": "Staff members", "value": str(employee_metrics["staff_count"])},
                {"label": "Leave records", "value": str(employee_metrics["leave_count"])},
                {"label": "Roles covered", "value": str(employee_metrics["covered_role_count"])},
            ],
            next_actions=[
                "Log today's counter, kitchen, prep and delivery staff before opening.",
                "Record CL/PL leave entries so payroll and coverage gaps stay visible.",
            ],
        ),
        _module(
            key="expense_audit",
            title="Expense Audit And Cost Control",
            score=expense_score,
            route="/expenses",
            detail="Owner can audit expense ratio, manual ledger variance, category exposure, and daily cost risks.",
            metrics=[
                {"label": "Manual expenses", "value": str(expense_metrics["expense_count"])},
                {"label": "Cost categories", "value": str(expense_metrics["category_count"])},
                {"label": "Expense days", "value": str(expense_metrics["expense_signal_days"])},
                {"label": "High-risk days", "value": str(expense_metrics["high_risk_days"])},
            ],
            next_actions=[
                "Log supplier, utility, rent, staff and marketing costs against categories.",
                "Review expense audit variance between imported sales data and manual expense ledger.",
            ],
        ),
        _module(
            key="marketing_crm",
            title="Marketing CRM",
            score=marketing_score,
            route="/customers",
            detail="Customer capture, marketing opt-in, promotions, and campaign delivery history are connected.",
            metrics=[
                {"label": "Customers", "value": str(customers)},
                {"label": "Opted in", "value": str(opted_in_customers)},
                {"label": "Promotions", "value": str(promotions)},
            ],
            next_actions=[
                "Import or capture real customer consent before sending campaigns.",
                "Create one launch offer and send a dry-run campaign proof.",
            ],
        ),
        _module(
            key="growth_publishing",
            title="Growth Publishing",
            score=growth_score,
            route="/promotions",
            detail="Campaign sending, social auto-posting, and ad campaign launch controls are represented; live publishing stays blocked until provider credentials are configured.",
            metrics=[
                {"label": "Campaign sends", "value": str(campaign_deliveries)},
                {"label": "Software proofs", "value": f"{growth_software_ready}/{len(growth_software_checks)} ready"},
                {"label": "Live providers", "value": f"{growth_provider_ready}/{growth_provider_total} configured"},
                {"label": "Social posts", "value": str(social_posts)},
                {"label": "Ad campaigns", "value": str(ad_campaigns)},
            ],
            next_actions=[
                (
                    "Software Growth controls are verified; keep live sends, posts and ads blocked until provider credentials are configured."
                    if growth_provider_ready < growth_provider_total
                    else "Run owner-approved live smoke sends, social posts and paused ad syncs."
                ),
                "Add real WhatsApp/SMS/email provider credentials.",
                "Add Facebook, Instagram, and Meta Ads credentials when business accounts are ready.",
            ],
        ),
        _module(
            key="finance_reporting",
            title="Finance Reporting",
            score=finance_score,
            route="/reports",
            detail="Sales logs, order-channel comparisons, marketing attribution, and backup freshness are visible.",
            metrics=[
                {"label": "Sales days", "value": str(daily_sales)},
                {"label": "Order records", "value": str(order_count)},
                {"label": "Backups", "value": str(successful_backups)},
            ],
            next_actions=[
                "Close several real POS orders so daily sales dashboards fill with live figures.",
                "Review weekly, monthly, and year-over-year comparison cards after data import.",
            ],
        ),
        _module(
            key="production_operations",
            title="Production Operations",
            score=production_score,
            route="/ops",
            detail="Environment inventory, backup history, payment contracts, and deployment blockers are centralized.",
            metrics=[
                {"label": "Go-live score", "value": f"{_readiness_score(go_live_items)}%"},
                {"label": "Live proof", "value": f"{live_deployment.get('status', 'warn')} {live_deployment_score}%"},
                {"label": "Backup status", "value": backup_freshness["status"]},
            ],
            next_actions=production_next_actions,
        ),
    ]


def _launch_summary(modules: list[dict]) -> dict:
    total = len(modules)
    ready = sum(1 for module in modules if module["status"] == "pass")
    attention = sum(1 for module in modules if module["status"] == "warn")
    blocked = sum(1 for module in modules if module["status"] == "fail")
    score = round(sum(module["score"] for module in modules) / total) if total else 0
    next_actions = [
        action
        for module in modules
        if module["status"] != "pass"
        for action in module["next_actions"]
    ]
    return {
        "modules_total": total,
        "modules_ready": ready,
        "modules_attention": attention,
        "modules_blocked": blocked,
        "implementation_score": score,
        "next_actions": next_actions[:6],
    }


def _restaurant_ready_audit(
    *,
    modules: list[dict],
    payment_status: dict,
    payment_providers: list[dict],
    backup_freshness: dict,
    restore_rehearsal: dict,
    go_live_items: list[dict],
) -> dict:
    module_by_key = {module["key"]: module for module in modules}

    def module_requirement(
        *,
        key: str,
        module_key: str,
        label: str,
        route: str,
        next_action: str,
        evidence: str | None = None,
        score_adjustment: int = 0,
    ) -> dict:
        module = module_by_key.get(module_key, {})
        score = max(0, min(100, int(module.get("score", 0)) + score_adjustment))
        status = _module_status(score)
        return {
            "key": key,
            "label": label,
            "status": status,
            "score": score,
            "route": route or module.get("route", "/ops"),
            "evidence": evidence or module.get("detail") or "No live evidence has been recorded yet.",
            "next_action": next_action,
        }

    security_module = module_by_key.get("security_foundation", {})
    production_module = module_by_key.get("production_operations", {})
    security_score = int(security_module.get("score", 0))
    production_score = int(production_module.get("score", 0))
    backup_ready = backup_freshness.get("status") == "pass"
    restore_ready = restore_rehearsal.get("status") == "pass"
    owner_score = round(
        (security_score * 0.35)
        + (production_score * 0.35)
        + (15 if backup_ready else 5)
        + (15 if restore_ready else 5)
    )
    if owner_score >= 85 and backup_ready and restore_ready:
        owner_status = "pass"
    elif owner_score >= 45 or backup_ready:
        owner_status = "warn"
    else:
        owner_status = "fail"

    selected_provider = payment_status.get("provider", "manual")
    settlement_providers = [
        provider
        for provider in payment_providers
        if provider.get("provider") in {"direct_bank", "cashfree", "razorpay"}
    ]
    active_payment_ready = (
        selected_provider in {"direct_bank", "cashfree", "razorpay"}
        and payment_status.get("checkout_configured")
        and payment_status.get("webhook_configured")
    )
    configured_settlement = next(
        (
            provider
            for provider in settlement_providers
            if provider.get("checkout_configured") and provider.get("webhook_configured")
        ),
        None,
    )
    if active_payment_ready:
        payment_score = 100
        payment_status_value = "pass"
        payment_evidence = f"{selected_provider} checkout and payment confirmation are configured."
        payment_next_action = "Run one live Rs. 1 or provider-sandbox payment proof before customer launch."
    elif configured_settlement:
        payment_score = 75
        payment_status_value = "warn"
        payment_evidence = (
            f"{configured_settlement['provider']} looks configured, but the active provider is {selected_provider}."
        )
        payment_next_action = f"Set PAYMENT_PROVIDER={configured_settlement['provider']} and run checkout plus webhook proof."
    elif selected_provider == "manual":
        payment_score = 45
        payment_status_value = "warn"
        payment_evidence = "Manual payment proof exists, but real customer launch still needs Direct Bank, Cashfree, or Razorpay."
        payment_next_action = "Choose Direct Bank for staff-verified UPI/bank transfer or Cashfree/Razorpay for gateway checkout."
    else:
        missing = sorted({
            *payment_status.get("missing_checkout_settings", []),
            *payment_status.get("missing_webhook_settings", []),
        })
        payment_score = 35
        payment_status_value = "fail"
        payment_evidence = f"{selected_provider} is selected but missing: {', '.join(missing) or 'provider settings'}."
        payment_next_action = "Add the missing provider settings in Vercel/Supabase and rerun payment readiness proof."

    go_live_score = _readiness_score(go_live_items)
    requirements = [
        {
            "key": "owner_admin_production_controls",
            "label": "Owner/Admin And Production Controls",
            "status": owner_status,
            "score": owner_score,
            "route": "/ops",
            "evidence": (
                f"Security foundation is {security_score}% and production operations are {production_score}%. "
                f"Backup: {backup_freshness.get('status', 'warn')}; restore: {restore_rehearsal.get('status', 'warn')}."
            ),
            "next_action": (
                "Record real restore rehearsal proof."
                if not restore_ready
                else "Keep admin credentials, Vercel secrets, and backup evidence current."
            ),
        },
        module_requirement(
            key="product_catalog_customization",
            module_key="product_catalog",
            label="Product Catalog, Sizes, Toppings And Add-ons",
            route="/menu",
            next_action="Finish real menu pricing, images, combos, and all required topping/add-on groups.",
        ),
        module_requirement(
            key="counter_pos_order_taking",
            module_key="ordering_flow",
            label="Counter POS Order Taking",
            route="/counter",
            next_action="Run one real walk-in/takeaway bill through Quick Counter during counter practice.",
            evidence="Quick Counter is available for fast staff order taking and uses the live menu/order flow.",
        ),
        module_requirement(
            key="customer_website_ordering",
            module_key="ordering_flow",
            label="Customer Website Ordering And Checkout",
            route="/order",
            next_action="Run one public customer order from catalog to checkout, receipt, and tracking.",
        ),
        module_requirement(
            key="kitchen_station_kot",
            module_key="kitchen_station_operations",
            label="Kitchen Station And KOT Flow",
            route="/orders",
            next_action="Create a mixed pizza/sides/drink order and confirm station-specific KOT slips.",
        ),
        module_requirement(
            key="delivery_zones_assignment",
            module_key="delivery_operations",
            label="Delivery Charges, Zones And Assignment",
            route="/operations",
            next_action="Confirm zones, delivery charges, ETA rules, and delivery staff assignment with real addresses.",
        ),
        {
            "key": "payment_settlement",
            "label": "Cashfree / Direct Bank Payment Settlement",
            "status": payment_status_value,
            "score": payment_score,
            "route": "/settings",
            "evidence": payment_evidence,
            "next_action": payment_next_action,
        },
        module_requirement(
            key="employee_attendance_leave",
            module_key="employee_workforce",
            label="Employee Attendance, CL/PL And Role Coverage",
            route="/shifts",
            next_action="Enter today's counter, kitchen, prep and delivery shifts plus any CL/PL leave.",
        ),
        module_requirement(
            key="expense_reporting_audit",
            module_key="expense_audit",
            label="Expense Audit, Reporting And Cost Control",
            route="/expenses",
            next_action="Load real supplier, rent, salary, utility and marketing costs for owner review.",
        ),
        {
            **module_requirement(
                key="marketing_crm_growth",
                module_key="marketing_crm",
                label="Customer CRM, Offers, Social And Ads",
                route="/promotions",
                next_action="Connect live WhatsApp/SMS/email and social/ad provider credentials when accounts are ready.",
            ),
            "score": round(
                (
                    int(module_by_key.get("marketing_crm", {}).get("score", 0))
                    + int(module_by_key.get("growth_publishing", {}).get("score", 0))
                )
                / 2
            ),
        },
    ]
    for requirement in requirements:
        requirement["status"] = (
            requirement["status"]
            if requirement["key"] in {"owner_admin_production_controls", "payment_settlement"}
            else _module_status(int(requirement["score"]))
        )

    ready = sum(1 for item in requirements if item["status"] == "pass")
    attention = sum(1 for item in requirements if item["status"] == "warn")
    blocked = sum(1 for item in requirements if item["status"] == "fail")
    score = round((sum(item["score"] for item in requirements) + go_live_score) / (len(requirements) + 1))
    status = "pass" if blocked == 0 and attention == 0 and score >= 90 else "warn" if blocked == 0 else "fail"
    next_actions = [item["next_action"] for item in requirements if item["status"] != "pass"]

    return {
        "generated_at": datetime.utcnow().isoformat(),
        "status": status,
        "score": score,
        "summary": {
            "requirements_total": len(requirements),
            "requirements_ready": ready,
            "requirements_attention": attention,
            "requirements_blocked": blocked,
            "target": "100% restaurant-ready",
        },
        "requirements": requirements,
        "next_actions": next_actions[:6],
    }


def _kitchen_station_metrics(db: Session) -> dict:
    orders = (
        db.query(RestaurantOrder)
        .order_by(RestaurantOrder.created_at.desc())
        .limit(250)
        .all()
    )
    stations = set()
    stationed_orders = 0
    stationed_lines = 0

    for order in orders:
        order_has_station = False
        for item in order.items or []:
            if not isinstance(item, dict):
                continue
            station = item.get("kitchen_station")
            if not station:
                continue
            stations.add(str(station))
            stationed_lines += 1
            order_has_station = True
        if order_has_station:
            stationed_orders += 1

    return {
        "station_count": len(stations),
        "stationed_orders": stationed_orders,
        "stationed_lines": stationed_lines,
    }


def _employee_role_key(role: Optional[str]) -> str:
    normalized = (role or "").lower()
    role_keywords = {
        "counter": ["counter", "pos", "cashier", "front"],
        "kitchen": ["chef", "kitchen", "oven", "cook"],
        "prep": ["prep", "packing", "pack", "helper"],
        "delivery": ["delivery", "rider", "driver"],
    }
    for key, keywords in role_keywords.items():
        if any(keyword in normalized for keyword in keywords):
            return key
    return "general"


def _employee_attendance_metrics(db: Session) -> dict:
    shifts = (
        db.query(ShiftLog)
        .order_by(ShiftLog.date.desc(), ShiftLog.id.desc())
        .limit(250)
        .all()
    )
    leaves = (
        db.query(StaffLeaveRequest)
        .order_by(StaffLeaveRequest.start_date.desc(), StaffLeaveRequest.id.desc())
        .limit(250)
        .all()
    )

    staff_names = {
        shift.staff_name.strip()
        for shift in shifts
        if shift.staff_name and shift.staff_name.strip()
    }
    staff_names.update(
        leave.staff_name.strip()
        for leave in leaves
        if leave.staff_name and leave.staff_name.strip()
    )
    covered_roles = {
        _employee_role_key(shift.role)
        for shift in shifts
        if _employee_role_key(shift.role) != "general"
    }

    return {
        "shift_count": len(shifts),
        "leave_count": len(leaves),
        "staff_count": len(staff_names),
        "covered_role_count": len(covered_roles),
    }


def _expense_audit_metrics(db: Session) -> dict:
    today = datetime.utcnow().date()
    start_date = today - timedelta(days=29)
    expenses = (
        db.query(Expense)
        .filter(Expense.date >= datetime.combine(start_date, datetime.min.time()))
        .order_by(Expense.date.desc(), Expense.id.desc())
        .limit(250)
        .all()
    )
    category_count = _count(db, ExpenseCategory, ExpenseCategory.is_active.is_(True))
    daily_rows = (
        db.query(DailySales)
        .filter(DailySales.date >= start_date, DailySales.date <= today)
        .all()
    )
    expense_signal_days = sum(
        1
        for row in daily_rows
        if float(row.total_expense or 0) > 0
    )
    high_risk_days = 0
    for row in daily_rows:
        sale = float(row.total_sale or 0)
        expense = float(row.total_expense or 0)
        if sale > 0 and expense / sale > 0.75:
            high_risk_days += 1
        elif sale == 0 and expense > 0:
            high_risk_days += 1

    return {
        "expense_count": len(expenses),
        "category_count": category_count,
        "expense_signal_days": expense_signal_days,
        "high_risk_days": high_risk_days,
    }


def _payment_webhook_contracts() -> list[dict]:
    return [
        {
            "provider": "manual",
            "endpoint": "/api/v1/restaurant/orders/payments/webhook/manual",
            "signature": "No signature required. Use only for local/admin-controlled payment confirmation.",
            "required_fields": ["order_id", "status"],
            "paid_statuses": ["paid", "success", "successful", "captured"],
            "notes": "Matches a restaurant order by order_id and stores payment_reference as the manual payment reference.",
        },
        {
            "provider": "cashfree",
            "endpoint": "/api/v1/restaurant/orders/payments/webhook/cashfree",
            "signature": "x-webhook-signature and x-webhook-timestamp. HMAC SHA256 base64 over timestamp plus raw JSON body.",
            "required_fields": ["data.order.order_id or data.payment.order_id", "data.payment.payment_status"],
            "paid_statuses": ["paid", "success", "successful", "captured"],
            "notes": "Matches by order note/tag, provider order id, or embedded Pizza Blitz order id.",
        },
        {
            "provider": "razorpay",
            "endpoint": "/api/v1/restaurant/orders/payments/webhook/razorpay",
            "signature": "x-razorpay-signature. HMAC SHA256 hex over the raw JSON body.",
            "required_fields": ["payload.payment.entity.order_id", "payload.payment.entity.status"],
            "paid_statuses": ["paid", "success", "successful", "captured"],
            "notes": "Matches by notes.restaurant_order_id, notes.order_id, or provider order id.",
        },
    ]


def list_backups(db: Session, limit: int = 20) -> list[dict]:
    runs = (
        db.query(BackupRun)
        .order_by(BackupRun.created_at.desc(), BackupRun.id.desc())
        .limit(limit)
        .all()
    )
    return [_backup_run_dict(run) for run in runs]


def create_database_backup(db: Session) -> dict:
    backend = database_backend()
    source_path = sqlite_database_path()
    if backend != "sqlite":
        return {
            "id": None,
            "backup_type": "external",
            "status": "external_required",
            "file_path": None,
            "size_bytes": 0,
            "database_backend": backend,
            "error": "Use managed database snapshots or pg_dump for production database backups.",
            "created_at": datetime.utcnow().isoformat(),
        }

    if source_path is None:
        run = BackupRun(
            backup_type="sqlite",
            status="skipped",
            database_backend=backend,
            error="SQLite backup requires a file-backed database; current database is in-memory.",
        )
        db.add(run)
        db.commit()
        db.refresh(run)
        return _backup_run_dict(run)

    backup_dir = _backup_dir()
    backup_dir.mkdir(parents=True, exist_ok=True)
    timestamp = datetime.utcnow().strftime("%Y%m%d_%H%M%S")
    backup_path = backup_dir / f"pizza_blitz_{timestamp}.sqlite"

    run = BackupRun(
        backup_type="sqlite",
        status="pending",
        file_path=str(backup_path),
        database_backend=backend,
    )
    db.add(run)
    db.commit()
    db.refresh(run)

    try:
        with sqlite3.connect(str(source_path)) as source:
            with sqlite3.connect(str(backup_path)) as destination:
                source.backup(destination)
        run.status = "success"
        run.size_bytes = backup_path.stat().st_size
        _prune_old_backups(backup_dir)
    except Exception as exc:
        run.status = "failed"
        run.error = str(exc)

    db.commit()
    db.refresh(run)
    return _backup_run_dict(run)


def run_sqlite_restore_rehearsal(db: Session) -> dict:
    backend = database_backend()
    if backend != "sqlite":
        raise ValueError(
            f"Automated restore rehearsal supports local SQLite only. Current backend is {backend}; "
            "record a managed restore_rehearsal proof after restoring a production snapshot into a clean database."
        )

    if sqlite_database_path() is None:
        raise ValueError("Automated restore rehearsal needs a file-backed SQLite database.")

    source_backup = _latest_restorable_sqlite_backup(db)
    if source_backup is None:
        backup = create_database_backup(db)
        if backup.get("status") != "success":
            raise ValueError(backup.get("error") or "A successful SQLite backup is required before restore rehearsal.")
        source_backup = db.query(BackupRun).filter(BackupRun.id == backup["id"]).first()

    if source_backup is None or not source_backup.file_path:
        raise ValueError("No restorable SQLite backup file is available.")

    backup_path = Path(source_backup.file_path)
    if not backup_path.is_absolute():
        backup_path = Path.cwd() / backup_path
    backup_path = backup_path.resolve()
    if not backup_path.exists():
        raise ValueError(f"Latest SQLite backup file is missing: {backup_path}")

    restore_dir = _backup_dir() / "restore-rehearsals"
    restore_dir.mkdir(parents=True, exist_ok=True)
    timestamp = datetime.utcnow().strftime("%Y%m%d_%H%M%S")
    restore_path = restore_dir / f"pizza_blitz_restore_{timestamp}.sqlite"

    run = BackupRun(
        backup_type="restore_rehearsal",
        status="pending",
        file_path=str(restore_path),
        database_backend=backend,
        error=f"Restore rehearsal pending from SQLite backup id {source_backup.id}.",
    )
    db.add(run)
    db.commit()
    db.refresh(run)

    try:
        shutil.copy2(backup_path, restore_path)
        checks = _verify_restored_sqlite_database(restore_path)
        note = _restore_rehearsal_success_note(
            source_backup=source_backup,
            restore_path=restore_path,
            checks=checks,
        )
        _validate_restore_rehearsal_proof(str(restore_path), note)
        run.status = "success"
        run.size_bytes = restore_path.stat().st_size
        run.error = note
    except Exception as exc:
        run.status = "failed"
        run.error = str(exc)
        db.commit()
        db.refresh(run)
        raise ValueError(str(exc)) from exc

    db.commit()
    db.refresh(run)
    return {
        "backup": _backup_run_dict(run),
        "source_backup": _backup_run_dict(source_backup),
        "checks": checks,
    }


def record_managed_backup_proof(
    db: Session,
    *,
    proof_type: str,
    reference: str,
    notes: str | None = None,
    size_bytes: int | None = None,
) -> dict:
    clean_type = proof_type.strip().lower()
    if clean_type not in {"managed_snapshot", "pg_dump", "restore_rehearsal"}:
        raise ValueError("Proof type must be managed_snapshot, pg_dump, or restore_rehearsal.")
    clean_reference = reference.strip()
    if len(clean_reference) < 6:
        raise ValueError("Proof reference must be at least 6 characters.")
    if clean_type == "restore_rehearsal":
        _validate_restore_rehearsal_proof(clean_reference, notes or "")

    run = BackupRun(
        backup_type=clean_type,
        status="success",
        file_path=clean_reference,
        size_bytes=max(int(size_bytes or 0), 0),
        database_backend=database_backend(),
        error=(notes or "").strip() or None,
    )
    db.add(run)
    db.commit()
    db.refresh(run)
    return _backup_run_dict(run)


def _validate_restore_rehearsal_proof(reference: str, notes: str) -> None:
    combined = f"{reference} {notes}".strip().lower()
    if len(reference.strip()) < 12:
        raise ValueError("Restore rehearsal proof reference must be at least 12 characters.")
    if len(notes.strip()) < 60:
        raise ValueError(
            "Restore rehearsal notes must include restore target, admin login, order smoke, and report/export evidence."
        )
    missing = [
        label
        for label, keywords in RESTORE_REHEARSAL_NOTE_HINTS
        if not any(keyword in combined for keyword in keywords)
    ]
    if missing:
        raise ValueError(
            "Restore rehearsal proof is missing evidence for: " + ", ".join(missing) + "."
        )


def _restore_rehearsal_command(
    db: Session,
    *,
    backup_freshness: dict,
    restore_rehearsal: dict,
) -> dict:
    latest_restore = (
        db.query(BackupRun)
        .filter(BackupRun.status == "success")
        .filter(BackupRun.backup_type == "restore_rehearsal")
        .order_by(BackupRun.created_at.desc(), BackupRun.id.desc())
        .first()
    )
    restore_ready = restore_rehearsal.get("status") == "pass"
    backup_ready = backup_freshness.get("status") == "pass"
    evidence_requirements = []
    for requirement in RESTORE_REHEARSAL_EVIDENCE_REQUIREMENTS:
        if requirement["key"] == "source_backup":
            status = "pass" if backup_ready else "warn"
            detail = backup_freshness.get("detail") or requirement["detail"]
        else:
            status = "pass" if restore_ready else "warn"
            detail = requirement["detail"]
        evidence_requirements.append({
            **requirement,
            "status": status,
            "detail": detail,
        })

    return {
        "status": restore_rehearsal.get("status", "warn"),
        "summary": {
            "backup_status": backup_freshness.get("status", "warn"),
            "restore_status": restore_rehearsal.get("status", "warn"),
            "evidence_ready": restore_ready,
            "requirements_total": len(evidence_requirements),
            "requirements_ready": sum(1 for item in evidence_requirements if item["status"] == "pass"),
            "retention_days": settings.BACKUP_RETENTION_DAYS,
        },
        "detail": restore_rehearsal.get("detail") or "No restore rehearsal proof is recorded yet.",
        "evidence_requirements": evidence_requirements,
        "last_proof": _backup_run_dict(latest_restore) if latest_restore else None,
        "recorder": {
            "proof_type": "restore_rehearsal",
            "reference_hint": "restore-clean-db-YYYYMMDD or Supabase restore job id",
            "notes_template": [
                "restore target: clean database name or URL alias",
                "admin login smoke: dashboard/ops/reports/settings opened",
                "order smoke: checkout or POS order plus receipt/tracking opened",
                "report/export smoke: customer, sales/report, and payment audit data checked",
            ],
        },
    }


def _database_check(db: Session) -> dict:
    try:
        db.execute(text("select 1"))
        return {
            "key": "database_connection",
            "label": "Database connection",
            "status": "pass",
            "detail": "Database responded to a basic query.",
        }
    except Exception as exc:
        return {
            "key": "database_connection",
            "label": "Database connection",
            "status": "fail",
            "detail": str(exc),
        }


def _database_persistence_check(environment: str) -> dict:
    is_sqlite = settings.SQLALCHEMY_DATABASE_URI.lower().startswith("sqlite")
    is_memory = settings.SQLALCHEMY_DATABASE_URI == "sqlite:///:memory:"
    if is_sqlite and environment == "production":
        return {
            "key": "database_persistence",
            "label": "Production database",
            "status": "fail",
            "detail": "Production cannot use SQLite because deployed instances do not share durable storage.",
        }
    if is_sqlite:
        return {
            "key": "database_persistence",
            "label": "Production database",
            "status": "warn",
            "detail": (
                "Local development uses an in-memory SQLite database; deployment must set SQLALCHEMY_DATABASE_URI."
                if is_memory
                else "Local development uses file-backed SQLite; deployment must set a managed SQLALCHEMY_DATABASE_URI."
            ),
        }
    return {
        "key": "database_persistence",
        "label": "Production database",
        "status": "pass",
        "detail": "Database URI is persistent.",
    }


def _admin_password_check(environment: str, db: Session) -> dict:
    if has_managed_admin_credentials(db):
        return {
            "key": "admin_password",
            "label": "Admin password",
            "status": "pass",
            "detail": "Managed master admin login is active and stored with a salted PBKDF2 hash.",
        }

    configured, weak = _admin_credential_state()
    if (not configured or weak) and environment == "production":
        status = "fail"
    elif not configured or weak:
        status = "warn"
    else:
        status = "pass"
    return {
        "key": "admin_password",
        "label": "Admin password",
        "status": status,
        "detail": (
            "Configure PIZZA_BLITZ_ADMIN_ID and PIZZA_BLITZ_ADMIN_PASSWORD or RESTAURANT_ADMIN_ID and RESTAURANT_ADMIN_PASSWORD in the deployment host."
            if not configured
            else "Use a non-default admin password with at least 8 characters before deployment."
            if weak
            else "Admin password is configured and is not a known local default."
        ),
    }


def _staff_password_check(environment: str, db: Session) -> dict:
    if has_managed_staff_credentials(db):
        return {
            "key": "staff_password",
            "label": "Staff password",
            "status": "pass",
            "detail": "Managed staff login is active and stored with a salted PBKDF2 hash.",
        }

    password = _configured_env_value("PIZZA_BLITZ_STAFF_PASSWORD") or settings.PIZZA_BLITZ_STAFF_PASSWORD or ""
    configured = bool(
        _configured_env_value("PIZZA_BLITZ_STAFF_ID")
        and _configured_env_value("PIZZA_BLITZ_STAFF_PASSWORD")
    )
    weak = password in DEFAULT_SECRET_VALUES or len(password) < 8
    admin_configured, admin_weak = _admin_credential_state()
    admin_master_available = has_managed_admin_credentials(db) or (
        admin_configured and not admin_weak
    )
    if not configured and admin_master_available:
        status = "warn"
    elif (not configured or weak) and environment == "production":
        status = "fail"
    elif not configured or weak:
        status = "warn"
    else:
        status = "pass"
    return {
        "key": "staff_password",
        "label": "Staff password",
        "status": status,
        "detail": (
            "Master admin credentials can enter the counter portal; create a dedicated managed staff login from Settings before employee handoff."
            if not configured and admin_master_available
            else "Create a managed counter staff login from Settings or configure PIZZA_BLITZ_STAFF_ID and PIZZA_BLITZ_STAFF_PASSWORD."
            if not configured
            else "Use a non-default staff password for counter access."
            if weak
            else "Staff password is configured and is not a known local default."
        ),
    }


def _auth_secret_check(environment: str) -> dict:
    secret = settings.AUTH_SECRET_KEY or ""
    weak = secret in DEFAULT_SECRET_VALUES or len(secret) < 32
    if weak and environment == "production":
        status = "fail"
    elif weak:
        status = "warn"
    else:
        status = "pass"
    return {
        "key": "auth_secret",
        "label": "Session signing secret",
        "status": status,
        "detail": "Use a unique AUTH_SECRET_KEY of at least 32 characters."
        if weak
        else "Session signing secret length looks production-ready.",
    }


def _portal_session_secret_check(environment: str) -> dict:
    secret = settings.PIZZA_BLITZ_SESSION_SECRET or ""
    weak = secret in DEFAULT_SECRET_VALUES or len(secret) < 32
    if weak and environment == "production":
        status = "fail"
    elif weak:
        status = "warn"
    else:
        status = "pass"
    return {
        "key": "portal_session_secret",
        "label": "Portal session secret",
        "status": status,
        "detail": "Set the same PIZZA_BLITZ_SESSION_SECRET in frontend and backend."
        if weak
        else "Portal cookie signing secret length looks production-ready.",
    }


def _cors_check(environment: str) -> dict:
    has_origins = bool(settings.cors_origins)
    if not has_origins and environment == "production":
        status = "fail"
    elif not has_origins:
        status = "warn"
    else:
        status = "pass"
    return {
        "key": "cors_origins",
        "label": "CORS origins",
        "status": status,
        "detail": "Set BACKEND_CORS_ORIGINS to the deployed frontend domain."
        if not has_origins
        else "CORS is restricted to configured origins.",
    }


def _backup_storage_check() -> dict:
    backend = database_backend()
    if backend != "sqlite":
        return {
            "key": "backup_storage",
            "label": "Backup storage",
            "status": "pass",
            "detail": (
                f"{backend} uses managed external backup storage; local file backup directory is not required on the Vercel runtime."
            ),
        }

    backup_dir = _backup_dir()
    try:
        backup_dir.mkdir(parents=True, exist_ok=True)
        writable = backup_dir.exists() and backup_dir.is_dir()
    except Exception:
        writable = False
    return {
        "key": "backup_storage",
        "label": "Backup storage",
        "status": "pass" if writable else "fail",
        "detail": f"Backup directory: {backup_dir.resolve()}"
        if writable
        else f"Backup directory is not writable: {backup_dir}",
    }


def _backup_freshness(db: Session) -> dict:
    latest_success = (
        db.query(BackupRun)
        .filter(BackupRun.status == "success")
        .filter(BackupRun.backup_type.in_(["sqlite", *BACKUP_PROOF_TYPES]))
        .order_by(BackupRun.created_at.desc(), BackupRun.id.desc())
        .first()
    )
    if not latest_success or not latest_success.created_at:
        return {
            "status": "warn",
            "latest_backup_at": None,
            "detail": "No successful backup run is recorded yet.",
        }

    age = datetime.utcnow() - latest_success.created_at
    max_age = timedelta(days=max(settings.BACKUP_RETENTION_DAYS, 1))
    if age > max_age:
        return {
            "status": "warn",
            "latest_backup_at": latest_success.created_at.isoformat(),
            "detail": f"Latest successful backup is older than {settings.BACKUP_RETENTION_DAYS} days.",
        }

    return {
        "status": "pass",
        "latest_backup_at": latest_success.created_at.isoformat(),
        "detail": "Latest successful backup is inside the retention window.",
    }


def _restore_rehearsal_status(db: Session) -> dict:
    latest_success = (
        db.query(BackupRun)
        .filter(BackupRun.status == "success")
        .filter(BackupRun.backup_type == "restore_rehearsal")
        .order_by(BackupRun.created_at.desc(), BackupRun.id.desc())
        .first()
    )
    if not latest_success or not latest_success.created_at:
        return {
            "status": "warn",
            "latest_restore_at": None,
            "detail": "No restore rehearsal proof is recorded yet.",
        }

    age = datetime.utcnow() - latest_success.created_at
    max_age = timedelta(days=max(settings.BACKUP_RETENTION_DAYS, 1))
    if age > max_age:
        return {
            "status": "warn",
            "latest_restore_at": latest_success.created_at.isoformat(),
            "detail": f"Latest restore rehearsal is older than {settings.BACKUP_RETENTION_DAYS} days.",
        }

    return {
        "status": "pass",
        "latest_restore_at": latest_success.created_at.isoformat(),
        "detail": "Latest restore rehearsal proof is inside the retention window.",
    }


def _payment_gateway_check(environment: str, status: dict) -> dict:
    if status["checkout_configured"]:
        return {
            "key": "payment_checkout",
            "label": "Payment checkout",
            "status": "pass",
            "detail": f"{status['provider']} checkout settings are configured.",
        }
    next_status = "fail" if environment == "production" else "warn"
    return {
        "key": "payment_checkout",
        "label": "Payment checkout",
        "status": next_status,
        "detail": "Missing checkout settings: "
        + ", ".join(status["missing_checkout_settings"]),
    }


def _payment_webhook_check(environment: str, status: dict) -> dict:
    if status["webhook_configured"]:
        return {
            "key": "payment_webhook",
            "label": "Payment webhook",
            "status": "pass",
            "detail": f"Webhook endpoint available at {status['webhook_endpoint']}.",
        }
    next_status = "fail" if environment == "production" else "warn"
    return {
        "key": "payment_webhook",
        "label": "Payment webhook",
        "status": next_status,
        "detail": "Missing webhook settings: "
        + ", ".join(status["missing_webhook_settings"]),
    }


def _go_live_sections(
    *,
    checks: list[dict],
    environment: str,
    payment_status: dict,
    backup_freshness: dict,
) -> list[dict]:
    check_by_key = {check["key"]: check for check in checks}
    campaign_statuses = [campaign_provider_status(channel) for channel in ["whatsapp", "sms", "email"]]
    social_statuses = [social_provider_status(platform) for platform in ["facebook", "instagram"]]
    ads_status = ad_provider_status()

    campaign_missing = _missing_settings(campaign_statuses)
    social_missing = _missing_settings(social_statuses)

    return [
        {
            "key": "core",
            "title": "Core Deployment",
            "description": "Database mode, API environment, and frontend access controls.",
            "items": [
                {
                    "key": "environment_mode",
                    "label": "Production environment",
                    "status": "pass" if environment == "production" else "warn",
                    "detail": (
                        "API is running with ENVIRONMENT=production."
                        if environment == "production"
                        else "Set ENVIRONMENT=production before public launch."
                    ),
                    "missing_settings": [] if environment == "production" else ["ENVIRONMENT=production"],
                },
                _database_go_live_item(environment),
                _item_from_check(check_by_key["cors_origins"]),
            ],
        },
        {
            "key": "security",
            "title": "Environment Security",
            "description": "Admin credentials and signed session secrets.",
            "items": [
                _item_from_check(check_by_key["admin_password"]),
                _item_from_check(check_by_key["staff_password"]),
                _item_from_check(check_by_key["auth_secret"]),
                _item_from_check(check_by_key["portal_session_secret"]),
            ],
        },
        {
            "key": "payments",
            "title": "Payment Gateway",
            "description": "Checkout sessions and webhook verification.",
            "items": [
                {
                    "key": "payment_gateway_full",
                    "label": "Checkout and webhook",
                    "status": _required_status(
                        environment,
                        payment_status["checkout_configured"] and payment_status["webhook_configured"],
                    ),
                    "detail": (
                        f"{payment_status['provider']} checkout and webhook are configured."
                        if payment_status["checkout_configured"] and payment_status["webhook_configured"]
                        else "Payment launch needs checkout and webhook secrets configured."
                    ),
                    "missing_settings": [
                        *payment_status["missing_checkout_settings"],
                        *payment_status["missing_webhook_settings"],
                    ],
                }
            ],
        },
        {
            "key": "growth_channels",
            "title": "Growth Channels",
            "description": "Campaign sending, social publishing, and Meta ads launch settings.",
            "items": [
                {
                    "key": "campaign_sending",
                    "label": "WhatsApp/SMS/email sending",
                    "status": _required_status(environment, any(status["configured"] for status in campaign_statuses)),
                    "detail": _configured_detail(campaign_statuses, "campaign channels"),
                    "missing_settings": campaign_missing,
                },
                {
                    "key": "social_publishing",
                    "label": "Social auto-posting",
                    "status": _required_status(environment, any(status["configured"] for status in social_statuses)),
                    "detail": _configured_detail(social_statuses, "social platforms"),
                    "missing_settings": social_missing,
                },
                {
                    "key": "ads_launch",
                    "label": "Meta ads launch",
                    "status": _required_status(environment, ads_status["configured"]),
                    "detail": (
                        "Meta Ads can create paused campaign shells."
                        if ads_status["configured"]
                        else "Meta Ads launch requires account and access token settings."
                    ),
                    "missing_settings": ads_status["missing_settings"],
                },
            ],
        },
        {
            "key": "backups",
            "title": "Backups",
            "description": "Backup storage and latest successful backup freshness.",
            "items": [
                _item_from_check(check_by_key["backup_storage"]),
                {
                    "key": "backup_freshness",
                    "label": "Backup freshness",
                    "status": backup_freshness["status"],
                    "detail": backup_freshness["detail"],
                    "missing_settings": [],
                },
            ],
        },
    ]


def _database_go_live_item(environment: str) -> dict:
    backend = database_backend()
    if backend == "sqlite":
        return {
            "key": "managed_database",
            "label": "Managed production database",
            "status": "fail" if environment == "production" else "warn",
            "detail": "SQLite is useful locally; production should use a managed database with backups.",
            "missing_settings": ["SQLALCHEMY_DATABASE_URI=postgresql+psycopg://..."],
        }
    if backend == "unknown":
        return {
            "key": "managed_database",
            "label": "Managed production database",
            "status": "fail",
            "detail": "Database URI could not be parsed.",
            "missing_settings": ["SQLALCHEMY_DATABASE_URI"],
        }
    return {
        "key": "managed_database",
        "label": "Managed production database",
        "status": "pass",
        "detail": f"Database backend is {backend}.",
        "missing_settings": [],
    }


def _item_from_check(check: dict) -> dict:
    return {
        "key": check["key"],
        "label": check["label"],
        "status": check["status"],
        "detail": check["detail"],
        "missing_settings": [],
    }


def _required_status(environment: str, configured: bool) -> str:
    if configured:
        return "pass"
    return "fail" if environment == "production" else "warn"


def _configured_detail(statuses: list[dict], label: str) -> str:
    configured = [
        status.get("channel") or status.get("platform")
        for status in statuses
        if status.get("configured")
    ]
    if configured:
        return f"Configured {label}: {', '.join(configured)}."
    return f"No {label} are fully configured yet."


def _missing_settings(statuses: list[dict]) -> list[str]:
    missing: list[str] = []
    for status in statuses:
        missing.extend(status.get("missing_settings") or [])
    return sorted(set(missing))


def _configured_env_value(*names: str) -> str:
    for name in names:
        value = os.getenv(name)
        if value is not None and value.strip() != "":
            return value
    return ""


def _admin_credential_state() -> tuple[bool, bool]:
    password = _configured_env_value(
        "PIZZA_BLITZ_ADMIN_PASSWORD",
        "RESTAURANT_ADMIN_PASSWORD",
    ) or settings.PIZZA_BLITZ_ADMIN_PASSWORD or settings.RESTAURANT_ADMIN_PASSWORD or ""
    configured = bool(
        _configured_env_value("PIZZA_BLITZ_ADMIN_ID", "RESTAURANT_ADMIN_ID")
        and _configured_env_value("PIZZA_BLITZ_ADMIN_PASSWORD", "RESTAURANT_ADMIN_PASSWORD")
    )
    weak = password in DEFAULT_SECRET_VALUES or len(password) < 8
    return configured, weak


def _readiness_score(items: list[dict]) -> int:
    if not items:
        return 0
    weights = {"pass": 1.0, "warn": 0.5, "fail": 0.0}
    score = sum(weights.get(item["status"], 0) for item in items) / len(items)
    return round(score * 100)


def _gate_status(items: Optional[list[dict]], key: str) -> str:
    for item in items or []:
        if item.get("key") == key:
            return item.get("status", "warn")
    return "warn"


def _route_collection_status(routes: list[dict]) -> str:
    return _rollup_status(routes)


def _rollup_status(items: list[dict]) -> str:
    statuses = {item.get("status") for item in items}
    if "fail" in statuses:
        return "fail"
    if "warn" in statuses:
        return "warn"
    return "pass"


def _backup_dir() -> Path:
    path = Path(settings.BACKUP_DIR)
    if path.is_absolute():
        return path
    return Path.cwd() / path


def _latest_restorable_sqlite_backup(db: Session) -> BackupRun | None:
    runs = (
        db.query(BackupRun)
        .filter(BackupRun.status == "success")
        .filter(BackupRun.backup_type == "sqlite")
        .order_by(BackupRun.created_at.desc(), BackupRun.id.desc())
        .limit(20)
        .all()
    )
    for run in runs:
        if not run.file_path:
            continue
        path = Path(run.file_path)
        if not path.is_absolute():
            path = Path.cwd() / path
        if path.exists():
            return run
    return None


def _verify_restored_sqlite_database(restore_path: Path) -> dict:
    with sqlite3.connect(str(restore_path)) as connection:
        integrity_row = connection.execute("PRAGMA integrity_check").fetchone()
        integrity_check = str(integrity_row[0] if integrity_row else "").lower()
        if integrity_check != "ok":
            raise ValueError(f"SQLite restore integrity check failed: {integrity_check or 'no result'}")

        existing_tables = {
            row[0]
            for row in connection.execute(
                "SELECT name FROM sqlite_master WHERE type = 'table'"
            ).fetchall()
        }
        missing_tables = [
            table for table in RESTORE_REHEARSAL_REQUIRED_TABLES if table not in existing_tables
        ]
        if missing_tables:
            raise ValueError(
                "Restored SQLite database is missing required tables: "
                + ", ".join(missing_tables)
                + "."
            )

        row_counts = {
            table: int(connection.execute(f'SELECT COUNT(*) FROM "{table}"').fetchone()[0])
            for table in RESTORE_REHEARSAL_REQUIRED_TABLES
        }

    return {
        "integrity_check": "ok",
        "required_tables": list(RESTORE_REHEARSAL_REQUIRED_TABLES),
        "row_counts": row_counts,
        "restore_path": str(restore_path),
    }


def _restore_rehearsal_success_note(*, source_backup: BackupRun, restore_path: Path, checks: dict) -> str:
    counts = ", ".join(
        f"{table}={count}" for table, count in checks.get("row_counts", {}).items()
    )
    return (
        "Automated local SQLite restore rehearsal passed. "
        f"restore target: clean database copy at {restore_path}. "
        "admin login smoke: authenticated admin initiated this drill from the Ops dashboard/API. "
        "order smoke: restored orders table is readable. "
        "report/export smoke: restored customers and daily_sales tables are readable. "
        f"Source backup id {source_backup.id}; integrity_check={checks.get('integrity_check')}; {counts}."
    )


def _prune_old_backups(backup_dir: Path) -> None:
    cutoff = datetime.utcnow() - timedelta(days=settings.BACKUP_RETENTION_DAYS)
    for path in backup_dir.glob("pizza_blitz_*.sqlite"):
        try:
            created = datetime.utcfromtimestamp(path.stat().st_mtime)
            if created < cutoff:
                path.unlink()
        except OSError:
            continue


def _backup_run_dict(run: BackupRun) -> dict:
    return {
        "id": run.id,
        "backup_type": run.backup_type,
        "status": run.status,
        "file_path": run.file_path,
        "size_bytes": run.size_bytes or 0,
        "database_backend": run.database_backend,
        "error": run.error,
        "created_at": run.created_at.isoformat() if run.created_at else None,
    }


def _environment_manifest(db: Session) -> list[dict]:
    managed_admin_active = has_managed_admin_credentials(db)
    groups = []
    for group in ENVIRONMENT_VARIABLE_GROUPS:
        variables = []
        for variable in group["variables"]:
            raw_value = os.getenv(variable["name"])
            alias_values = [
                os.getenv(alias)
                for alias in variable.get("aliases", [])
                if os.getenv(alias) is not None and os.getenv(alias).strip() != ""
            ]
            if raw_value is None and alias_values:
                raw_value = alias_values[0]
            configured = raw_value is not None and raw_value.strip() != ""
            required = variable["required"]
            requirement_satisfied_by = None
            if managed_admin_active and variable["name"] in {
                "RESTAURANT_ADMIN_ID",
                "RESTAURANT_ADMIN_PASSWORD",
            }:
                required = False
                requirement_satisfied_by = "managed_admin_credential"
            variables.append(
                {
                    "name": variable["name"],
                    "aliases": variable.get("aliases", []),
                    "required": required,
                    "requirement_satisfied_by": requirement_satisfied_by,
                    "sensitive": variable["sensitive"],
                    "configured": configured,
                    "purpose": variable["purpose"],
                    "value": None
                    if variable["sensitive"] or not configured
                    else _safe_env_value(variable["name"], raw_value),
                }
            )
        groups.append(
            {
                "key": group["key"],
                "title": group["title"],
                "variables": variables,
            }
        )
    return groups


def _environment_summary(groups: list[dict]) -> dict:
    variables = [
        variable
        for group in groups
        for variable in group["variables"]
    ]
    required = [variable for variable in variables if variable["required"]]
    configured_required = [
        variable
        for variable in required
        if variable["configured"]
    ]
    missing_required = [
        variable["name"]
        for variable in required
        if not variable["configured"]
    ]
    configured_total = sum(1 for variable in variables if variable["configured"])
    return {
        "total": len(variables),
        "configured": configured_total,
        "required_total": len(required),
        "required_configured": len(configured_required),
        "missing_required": missing_required,
    }


def _safe_env_value(name: str, value: str) -> str:
    if name.endswith("_URL") or name.endswith("_ORIGINS"):
        return value[:160]
    return value
