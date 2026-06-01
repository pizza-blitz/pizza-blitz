from __future__ import annotations

import argparse
import getpass
import sys

from sqlalchemy import inspect
from sqlalchemy.orm import Session

from app.core.config import settings
from app.db.session import SessionLocal, engine
from app.models.domain import AdminCredential
from app.services.auth_service import upsert_managed_admin_credential
from app.services.operational_audit_service import record_operational_audit_event


MINIMUM_PASSWORD_LENGTH = 12


def read_password(*, password_stdin: bool) -> str:
    if password_stdin:
        return sys.stdin.readline().rstrip("\r\n")

    password = getpass.getpass("New master admin password: ")
    confirmation = getpass.getpass("Confirm master admin password: ")
    if password != confirmation:
        raise ValueError("Password confirmation did not match.")
    return password


def configure_master_admin(
    *,
    db: Session,
    admin_id: str,
    display_name: str,
    password: str,
    rotate_existing: bool = False,
) -> AdminCredential:
    clean_admin_id = admin_id.strip()
    clean_display_name = display_name.strip() or "Restaurant Admin"
    if len(clean_admin_id) < 3:
        raise ValueError("Master admin ID must be at least 3 characters.")
    if clean_admin_id.lower() == settings.PIZZA_BLITZ_STAFF_ID.lower():
        raise ValueError("Master admin ID must be separate from the fallback staff ID.")
    if len(password) < MINIMUM_PASSWORD_LENGTH:
        raise ValueError(f"Master admin password must be at least {MINIMUM_PASSWORD_LENGTH} characters.")

    existing = (
        db.query(AdminCredential)
        .filter(AdminCredential.is_active.is_(True))
        .order_by(AdminCredential.updated_at.desc(), AdminCredential.id.desc())
        .first()
    )
    if existing is not None and not rotate_existing:
        raise ValueError(
            "An active managed master admin already exists. Use --rotate-existing only for an intentional credential rotation."
        )

    credential = upsert_managed_admin_credential(
        db=db,
        admin_id=clean_admin_id,
        password=password,
        display_name=clean_display_name,
        is_active=True,
    )
    record_operational_audit_event(
        db,
        session={
            "role": "system",
            "subject": "operator-cli",
            "display_name": "Master Admin Bootstrap CLI",
        },
        event_type="credential",
        action="admin_credential_rotate" if existing is not None else "admin_credential_bootstrap",
        resource_type="admin_credential",
        resource_id=credential.admin_id,
        detail="Managed master admin credential configured through the operator CLI.",
        metadata={
            "source": "operator_cli",
            "rotation": existing is not None,
        },
    )
    return credential


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Initialize or explicitly rotate the Pizza Blitz managed master-admin credential."
    )
    parser.add_argument("--admin-id", required=True, help="Master admin login ID or email.")
    parser.add_argument("--display-name", default="Restaurant Admin", help="Master admin display name.")
    parser.add_argument(
        "--rotate-existing",
        action="store_true",
        help="Explicitly replace an existing managed master-admin credential.",
    )
    parser.add_argument(
        "--allow-sqlite",
        action="store_true",
        help="Allow a local SQLite verification run. Production should use PostgreSQL.",
    )
    parser.add_argument(
        "--password-stdin",
        action="store_true",
        help="Read one password line from stdin for controlled automation. Interactive use prompts securely.",
    )
    args = parser.parse_args()

    backend = engine.dialect.name
    if backend != "postgresql" and not args.allow_sqlite:
        print(f"Refusing master-admin bootstrap for database backend '{backend}'. Expected PostgreSQL.")
        return 2
    if not inspect(engine).has_table(AdminCredential.__tablename__):
        print("Admin credential table is missing. Run bootstrap_managed_database.py before configuring the master admin.")
        return 2

    try:
        password = read_password(password_stdin=args.password_stdin)
        with SessionLocal() as db:
            credential = configure_master_admin(
                db=db,
                admin_id=args.admin_id,
                display_name=args.display_name,
                password=password,
                rotate_existing=args.rotate_existing,
            )
            configured_admin_id = credential.admin_id
    except ValueError as exc:
        print(f"Master-admin bootstrap refused: {exc}")
        return 2

    print(f"Managed master admin '{configured_admin_id}' configured on database backend '{backend}'.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
