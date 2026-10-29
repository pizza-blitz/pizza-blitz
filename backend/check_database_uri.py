"""Prove a production database URL is usable before any deployment.

The application refuses to start in production on SQLite, so the first real
launch step is a Postgres URL. This script checks one before a deploy spends
time on it:

1. the scheme is Postgres, never SQLite;
2. Supabase hosts ask for SSL, because Supabase rejects plain connections;
3. the server answers within ten seconds;
4. an advisory lock can be taken, which the bootstrap needs;
5. the schema is at the Alembic head;
6. the core restaurant tables exist.

It prints the URL with the password hidden, so its output can be pasted into a
ticket or a chat safely.

Usage, from `backend/`:

    python check_database_uri.py
    python check_database_uri.py --file .env.deploy.local

Exit codes: 0 all checks pass, 1 a check failed, 2 the URL could not be read.
"""

from __future__ import annotations

import argparse
import os
import sys
from pathlib import Path
from urllib.parse import urlsplit, urlunsplit

BACKEND_ROOT = Path(__file__).resolve().parent
TRANSACTION_POOLER_PORT = 6543
CORE_TABLES = (
    "orders",
    "menu_items",
    "stores",
    "daily_sales",
    "staff_credentials",
    "alembic_version",
)


def redact(uri: str) -> str:
    """Return the URL with the password replaced, so it is safe to print."""
    parts = urlsplit(uri)
    if parts.password is None:
        return uri
    netloc = parts.netloc.replace(f":{parts.password}@", ":***@")
    return urlunsplit((parts.scheme, netloc, parts.path, parts.query, parts.fragment))


def inspect_uri(uri: str) -> tuple[list[str], list[str]]:
    """Return blocking problems and advisory notes for a database URL.

    Pure function: no network, no exceptions for a merely unusual URL.
    """
    problems: list[str] = []
    notes: list[str] = []
    value = uri.strip()

    if not value:
        return ["SQLALCHEMY_DATABASE_URI is empty."], notes

    lowered = value.lower()
    if lowered.startswith("sqlite"):
        problems.append(
            "SQLite is not a production database here. The server refuses to start "
            "in production on it, because the default SQLite URL keeps orders in RAM. "
            "Use the Supabase Postgres URL."
        )
        return problems, notes

    if not lowered.startswith(("postgresql://", "postgresql+psycopg2://")):
        problems.append(
            "The URL must be a Postgres URL starting with postgresql+psycopg2://. "
            f"Received scheme {value.split(':', 1)[0]!r}."
        )

    if lowered.startswith("postgresql://"):
        notes.append(
            "Scheme is postgresql://; that works, but the deployment docs use "
            "postgresql+psycopg2:// so the driver is explicit."
        )

    parts = urlsplit(value)
    host = parts.hostname or ""
    query = parts.query.lower()

    if "supabase" in host and "sslmode=disable" in query:
        problems.append(
            "Supabase rejects connections with sslmode=disable. Remove it or set "
            "sslmode=require."
        )
    elif "supabase" in host and "sslmode=" not in query:
        notes.append(
            "Supabase requires SSL. Add ?sslmode=require to the URL."
        )

    try:
        port = parts.port
    except ValueError:
        port = None
        problems.append("The URL has a port that is not a number.")

    if port == TRANSACTION_POOLER_PORT:
        notes.append(
            "Port 6543 is Supabase's transaction pooler. This app takes an advisory "
            "lock during bootstrap, so the session pooler on 5432 is the safer choice."
        )

    if not parts.username:
        notes.append("The URL has no username; Supabase pooler URLs need postgres.<project-ref>.")

    return problems, notes


def read_uri(explicit_file: str | None) -> tuple[str, str]:
    """Find the database URL and say where it came from."""
    env_value = os.getenv("SQLALCHEMY_DATABASE_URI", "").strip()
    if env_value:
        return env_value, "environment variable SQLALCHEMY_DATABASE_URI"

    candidates = [Path(explicit_file)] if explicit_file else [
        BACKEND_ROOT / ".env.deploy.local",
        BACKEND_ROOT / ".env",
    ]
    for candidate in candidates:
        if not candidate.is_file():
            continue
        for line in candidate.read_text(encoding="utf-8").splitlines():
            name, _, raw = line.partition("=")
            if name.strip() == "SQLALCHEMY_DATABASE_URI" and raw.strip():
                return raw.strip().strip('"').strip("'"), str(candidate)
    return "", ""


def alembic_head() -> str | None:
    from alembic.config import Config
    from alembic.script import ScriptDirectory

    config = Config(str(BACKEND_ROOT / "alembic.ini"))
    config.set_main_option("script_location", str(BACKEND_ROOT / "alembic"))
    try:
        return ScriptDirectory.from_config(config).get_current_head()
    except Exception:
        return None


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--file",
        help="Read SQLALCHEMY_DATABASE_URI from this env file instead of the default locations.",
    )
    args = parser.parse_args(argv)

    uri, source = read_uri(args.file)
    if not uri:
        print("FAIL: no SQLALCHEMY_DATABASE_URI found.")
        print("")
        print("Set it in the environment, or put it in backend/.env.deploy.local:")
        print("  SQLALCHEMY_DATABASE_URI=postgresql+psycopg2://...?sslmode=require")
        return 2

    print(f"Database URL from {source}: {redact(uri)}")
    problems, notes = inspect_uri(uri)
    for note in notes:
        print(f"NOTE: {note}")
    if problems:
        for problem in problems:
            print(f"FAIL: {problem}")
        return 1

    from sqlalchemy import create_engine, inspect, text

    engine = create_engine(uri, pool_pre_ping=True, connect_args={"connect_timeout": 10})
    try:
        with engine.connect() as connection:
            version = connection.execute(text("SELECT version()")).scalar_one()
            print(f"OK: connected to {str(version).split(',')[0]}")

            locked = connection.execute(text("SELECT pg_try_advisory_xact_lock(4242)")).scalar()
            print(
                "OK: advisory lock available."
                if locked
                else "FAIL: could not take an advisory lock; check the role's permissions."
            )
            connection.rollback()

            tables = set(inspect(connection).get_table_names())
            missing = [name for name in CORE_TABLES if name not in tables]
            if missing:
                print(f"FAIL: missing tables: {', '.join(missing)}")
                print("      Run: python -m alembic upgrade head")
            else:
                print(f"OK: {len(tables)} tables present, including the core set.")

            current = connection.execute(
                text("SELECT version_num FROM alembic_version")
            ).scalar()
            head = alembic_head()
            if current == head:
                print(f"OK: schema at Alembic head {head}.")
            else:
                print(f"FAIL: database at {current or 'no revision'}, head is {head}.")
                print("      Run: python -m alembic upgrade head")

            if missing or current != head:
                return 1
    except Exception as error:  # noqa: BLE001 - the message is the product here
        detail = str(error).strip()
        first_line = detail.splitlines()[0] if detail else type(error).__name__
        print(f"FAIL: could not reach the database: {first_line}")
        print("      Check the host, port, password and ?sslmode=require, then try again.")
        return 1
    finally:
        engine.dispose()

    print("Database URL is ready for deployment.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
