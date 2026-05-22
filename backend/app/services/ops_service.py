import sqlite3
from datetime import datetime, timedelta
from pathlib import Path
from typing import Optional

from sqlalchemy import text
from sqlalchemy.engine.url import make_url
from sqlalchemy.orm import Session

from app.core.config import settings
from app.models.domain import BackupRun
from app.services.payment_gateway import payment_provider_status


DEFAULT_SECRET_VALUES = {
    "",
    "admin123",
    "change-me",
    "change-this-long-random-secret",
    "pizza-blitz-local-secret",
}


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
        "overall": overall,
        "failed_checks": failed,
        "warning_checks": warnings,
        "checks": checks,
    }


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
