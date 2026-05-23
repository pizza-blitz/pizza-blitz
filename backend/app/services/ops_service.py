import sqlite3
from datetime import datetime, timedelta
from pathlib import Path
from typing import Optional

from sqlalchemy import text
from sqlalchemy.engine.url import make_url
from sqlalchemy.orm import Session

from app.core.config import settings
from app.models.domain import BackupRun
from app.services.ad_campaign_service import ad_provider_status
from app.services.campaign_dispatch_service import campaign_provider_status
from app.services.payment_gateway import payment_provider_status
from app.services.social_publish_service import social_provider_status


DEFAULT_SECRET_VALUES = {
    "",
    "admin123",
    "change-me",
    "change-this-long-random-secret",
    "pizza-blitz-local-secret",
}

PAYMENT_PROVIDER_ORDER = ("manual", "cashfree", "razorpay")


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
        _auth_secret_check(environment),
        _cors_check(environment),
        _payment_gateway_check(environment, payment_status),
        _payment_webhook_check(environment, payment_status),
        _backup_storage_check(),
    ]
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
        "backup_freshness": backup_freshness,
        "readiness_score": _readiness_score(go_live_items),
        "launch_blockers": launch_blockers,
        "setup_actions": setup_actions,
        "go_live_sections": go_live_sections,
        "overall": overall,
        "failed_checks": failed,
        "warning_checks": warnings,
        "checks": checks,
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


def _cors_check(environment: str) -> dict:
    has_origins = bool(settings.BACKEND_CORS_ORIGINS)
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
                _item_from_check(check_by_key["auth_secret"]),
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
