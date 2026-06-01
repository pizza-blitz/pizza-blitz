from __future__ import annotations

import argparse
from pathlib import Path

from alembic import command
from alembic.config import Config
from sqlalchemy import inspect

from app.db.base import Base
from app.db.session import engine
from app.main import bootstrap_database
from app.models import domain  # noqa: F401 - imports the complete SQLAlchemy metadata


def expected_columns() -> dict[str, set[str]]:
    return {
        table_name: {column.name for column in table.columns}
        for table_name, table in Base.metadata.tables.items()
    }


def schema_gaps() -> tuple[list[str], dict[str, list[str]]]:
    inspector = inspect(engine)
    actual_tables = set(inspector.get_table_names())
    expected = expected_columns()
    missing_tables = sorted(set(expected) - actual_tables)
    missing_columns = {
        table_name: sorted(columns - {column["name"] for column in inspector.get_columns(table_name)})
        for table_name, columns in expected.items()
        if table_name in actual_tables
        and columns - {column["name"] for column in inspector.get_columns(table_name)}
    }
    return missing_tables, missing_columns


def stamp_alembic_head() -> None:
    config = Config(str(Path(__file__).with_name("alembic.ini")))
    command.stamp(config, "head")


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Bootstrap and validate the Pizza Blitz managed production database."
    )
    parser.add_argument(
        "--allow-sqlite",
        action="store_true",
        help="Allow a local SQLite verification run. Production should use PostgreSQL.",
    )
    parser.add_argument(
        "--stamp-alembic",
        action="store_true",
        help="Stamp the validated schema at the current Alembic head.",
    )
    args = parser.parse_args()

    backend = engine.dialect.name
    if backend != "postgresql" and not args.allow_sqlite:
        print(f"Refusing managed bootstrap for database backend '{backend}'. Expected PostgreSQL.")
        return 2

    print(f"Bootstrapping Pizza Blitz schema on database backend '{backend}'...")
    bootstrap_database()
    missing_tables, missing_columns = schema_gaps()
    if missing_tables or missing_columns:
        if missing_tables:
            print(f"Missing tables after bootstrap: {', '.join(missing_tables)}")
        for table_name, columns in missing_columns.items():
            print(f"Missing columns in {table_name}: {', '.join(columns)}")
        return 1

    table_count = len(Base.metadata.tables)
    print(f"Validated {table_count} application tables.")
    if args.stamp_alembic:
        stamp_alembic_head()
        print("Stamped the validated schema at the current Alembic head.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
