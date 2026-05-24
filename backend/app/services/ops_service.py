import os
import sqlite3
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
    MenuCustomizationGroup,
    MenuCustomizationOption,
    MenuItem,
    Promotion,
    RestaurantOrder,
    SocialPost,
    SocialPostDelivery,
)
from app.services.ad_campaign_service import ad_provider_status
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

PAYMENT_PROVIDER_ORDER = ("manual", "cashfree", "razorpay")

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
                "required": True,
                "sensitive": False,
                "purpose": "Configure the admin login id.",
            },
            {
                "name": "RESTAURANT_ADMIN_PASSWORD",
                "required": True,
                "sensitive": True,
                "purpose": "Configure a strong admin password.",
            },
            {
                "name": "PIZZA_BLITZ_STAFF_PASSWORD",
                "required": True,
                "sensitive": True,
                "purpose": "Configure a strong staff password.",
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
        "key": "delivery_ops",
        "label": "Delivery Operations",
        "route": "/operations",
        "module_key": "delivery_operations",
        "proof": "verify-delivery-order-e2e.cjs",
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


def readiness_report(db: Session) -> dict:
    environment = settings.ENVIRONMENT.lower()
    payment_status = payment_provider_status()
    payment_providers = [payment_provider_status(provider) for provider in PAYMENT_PROVIDER_ORDER]
    backup_freshness = _backup_freshness(db)
    checks = [
        _database_check(db),
        _database_persistence_check(environment),
        _admin_password_check(environment),
        _staff_password_check(environment),
        _auth_secret_check(environment),
        _portal_session_secret_check(environment),
        _cors_check(environment),
        _payment_gateway_check(environment, payment_status),
        _payment_webhook_check(environment, payment_status),
        _backup_storage_check(),
    ]
    environment_manifest = _environment_manifest()
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
        "production_database_plan": _production_database_plan(
            environment=environment,
            backup_freshness=backup_freshness,
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
    latest_backup = db.query(BackupRun).order_by(BackupRun.created_at.desc(), BackupRun.id.desc()).first()

    customer_status = "pass" if duplicate_phone_count == 0 and with_phone == total_customers else "warn"
    reach_status = "pass" if total_customers and reachable / total_customers >= 0.8 else "warn" if reachable else "fail"
    report_status = "pass" if daily_rows else "warn"
    backup_status = backup_freshness.get("status", "warn")
    import_status = "warn"
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
            "status": backup_status,
            "detail": backup_freshness.get("detail") or "Backup status is not available.",
        },
        {
            "key": "import_controls",
            "label": "Import controls",
            "status": import_status,
            "detail": "Sheets and PDF import endpoints exist; customer CSV import still needs a dry-run validator before live bulk uploads.",
        },
    ]
    score = _readiness_score(checks)
    next_actions = [
        "Run customer CSV export before any bulk cleanup.",
        "Run sales/report CSV export and attach it to the daily manager review.",
        "Create or verify a fresh backup, then rehearse restore before importing production data.",
        "Add a customer CSV import dry-run validator before accepting bulk uploads.",
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
                "status": "warn",
                "endpoint": None,
                "detail": "Customer CSV export is ready; bulk customer import still needs validator, duplicate preview and rollback plan.",
            },
        ],
        "backup_restore": {
            "latest_status": latest_backup.status if latest_backup else "none",
            "latest_backup_at": latest_backup.created_at.isoformat() if latest_backup and latest_backup.created_at else None,
            "latest_size_bytes": latest_backup.size_bytes if latest_backup else 0,
            "freshness": backup_freshness,
            "restore_rehearsal": {
                "status": "warn",
                "detail": "Restore a backup into a clean database and run login, customer export, sales export and order smoke proof.",
            },
        },
        "next_actions": next_actions,
    }


def launch_candidate_report(db: Session) -> dict:
    readiness = readiness_report(db)
    data_quality = data_quality_report(db)
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


def _production_database_plan(*, environment: str, backup_freshness: dict) -> dict:
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
                "label": "Run Alembic migrations",
                "status": "warn",
                "detail": "Run alembic upgrade head against the managed database before importing menu, customers or orders.",
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
                "status": "warn",
                "detail": "Restore a backup into a clean database and run the admin/order/report smoke proof before public launch.",
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
    active_zones = _count(db, DeliveryZone, DeliveryZone.is_active.is_(True))
    delivery_assignments = _count(db, DeliveryAssignment)
    customers = _count(db, Customer)
    opted_in_customers = _count(db, Customer, Customer.opt_in_marketing.is_(True))
    promotions = _count(db, Promotion)
    campaign_deliveries = _count(db, CampaignDelivery)
    social_posts = _count(db, SocialPost)
    social_deliveries = _count(db, SocialPostDelivery)
    ad_campaigns = _count(db, AdCampaign)
    ad_launches = _count(db, AdCampaignLaunch)
    daily_sales = _count(db, DailySales)
    successful_backups = _count(db, BackupRun, BackupRun.status == "success")

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
    finance_score = (
        (30 if daily_sales else 10)
        + (25 if order_count else 0)
        + (25 if backup_freshness["status"] == "pass" else 10)
        + 20
    )
    production_score = round(
        (_readiness_score(go_live_items) * 0.75)
        + (25 if successful_backups else 10)
    )

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
            detail="Campaign sending, social auto-posting, and ad campaign launch controls are represented.",
            metrics=[
                {"label": "Campaign sends", "value": str(campaign_deliveries)},
                {"label": "Social posts", "value": str(social_posts)},
                {"label": "Ad campaigns", "value": str(ad_campaigns)},
            ],
            next_actions=[
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
                {"label": "Backup status", "value": backup_freshness["status"]},
            ],
            next_actions=[
                "Move from local SQLite to managed production database.",
                "Schedule backups and store deployment secrets outside the repository.",
            ],
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
        run = BackupRun(
            backup_type="external",
            status="external_required",
            database_backend=backend,
            error="Use managed database snapshots or pg_dump for production database backups.",
        )
        db.add(run)
        db.commit()
        db.refresh(run)
        return _backup_run_dict(run)

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
    is_memory = settings.SQLALCHEMY_DATABASE_URI == "sqlite:///:memory:"
    if is_memory and environment == "production":
        return {
            "key": "database_persistence",
            "label": "Production database",
            "status": "fail",
            "detail": "Production cannot use sqlite:///:memory: because data disappears on restart.",
        }
    if is_memory:
        return {
            "key": "database_persistence",
            "label": "Production database",
            "status": "warn",
            "detail": "Local tests use an in-memory database; deployment must set SQLALCHEMY_DATABASE_URI.",
        }
    return {
        "key": "database_persistence",
        "label": "Production database",
        "status": "pass",
        "detail": "Database URI is persistent.",
    }


def _admin_password_check(environment: str) -> dict:
    password = settings.RESTAURANT_ADMIN_PASSWORD or ""
    weak = password in DEFAULT_SECRET_VALUES or len(password) < 12
    if weak and environment == "production":
        status = "fail"
    elif weak:
        status = "warn"
    else:
        status = "pass"
    return {
        "key": "admin_password",
        "label": "Admin password",
        "status": status,
        "detail": "Use a long non-default admin password before deployment."
        if weak
        else "Admin password is not a known local default.",
    }


def _staff_password_check(environment: str) -> dict:
    password = settings.PIZZA_BLITZ_STAFF_PASSWORD or ""
    weak = password in DEFAULT_SECRET_VALUES or len(password) < 10
    if weak and environment == "production":
        status = "fail"
    elif weak:
        status = "warn"
    else:
        status = "pass"
    return {
        "key": "staff_password",
        "label": "Staff password",
        "status": status,
        "detail": "Use a non-default staff password for counter access."
        if weak
        else "Staff password is not a known local default.",
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


def _environment_manifest() -> list[dict]:
    groups = []
    for group in ENVIRONMENT_VARIABLE_GROUPS:
        variables = []
        for variable in group["variables"]:
            raw_value = os.getenv(variable["name"])
            configured = raw_value is not None and raw_value.strip() != ""
            variables.append(
                {
                    "name": variable["name"],
                    "required": variable["required"],
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
