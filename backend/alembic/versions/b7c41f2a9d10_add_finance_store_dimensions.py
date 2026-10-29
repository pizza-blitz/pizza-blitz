"""Add store dimensions to finance ledgers.

Revision ID: b7c41f2a9d10
Revises: fd0857690f39
Create Date: 2026-10-27
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "b7c41f2a9d10"
down_revision: Union[str, None] = "fd0857690f39"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    with op.batch_alter_table("daily_sales") as batch:
        batch.add_column(
            sa.Column(
                "store_id",
                sa.Integer(),
                nullable=False,
                server_default="1",
            )
        )
        batch.create_foreign_key(
            "fk_daily_sales_store_id", "stores", ["store_id"], ["id"]
        )
        batch.drop_index("ix_daily_sales_date")
        batch.create_index("ix_daily_sales_date", ["date"], unique=False)
        batch.create_index("ix_daily_sales_store_id", ["store_id"], unique=False)
        batch.create_unique_constraint(
            "uq_daily_sales_store_date", ["store_id", "date"]
        )

    with op.batch_alter_table("expenses") as batch:
        batch.add_column(
            sa.Column(
                "store_id",
                sa.Integer(),
                nullable=False,
                server_default="1",
            )
        )
        batch.create_foreign_key(
            "fk_expenses_store_id", "stores", ["store_id"], ["id"]
        )
        batch.create_index("ix_expenses_store_id", ["store_id"], unique=False)

    with op.batch_alter_table("purchase_orders") as batch:
        batch.add_column(
            sa.Column(
                "store_id",
                sa.Integer(),
                nullable=False,
                server_default="1",
            )
        )
        batch.add_column(sa.Column("received_at", sa.DateTime(), nullable=True))
        batch.create_foreign_key(
            "fk_purchase_orders_store_id", "stores", ["store_id"], ["id"]
        )
        batch.create_index(
            "ix_purchase_orders_store_id", ["store_id"], unique=False
        )

    with op.batch_alter_table("waste_log") as batch:
        batch.add_column(
            sa.Column(
                "store_id",
                sa.Integer(),
                nullable=False,
                server_default="1",
            )
        )
        batch.create_foreign_key(
            "fk_waste_log_store_id", "stores", ["store_id"], ["id"]
        )
        batch.create_index("ix_waste_log_store_id", ["store_id"], unique=False)


def downgrade() -> None:
    with op.batch_alter_table("waste_log") as batch:
        batch.drop_index("ix_waste_log_store_id")
        batch.drop_constraint("fk_waste_log_store_id", type_="foreignkey")
        batch.drop_column("store_id")

    with op.batch_alter_table("purchase_orders") as batch:
        batch.drop_index("ix_purchase_orders_store_id")
        batch.drop_constraint("fk_purchase_orders_store_id", type_="foreignkey")
        batch.drop_column("received_at")
        batch.drop_column("store_id")

    with op.batch_alter_table("expenses") as batch:
        batch.drop_index("ix_expenses_store_id")
        batch.drop_constraint("fk_expenses_store_id", type_="foreignkey")
        batch.drop_column("store_id")

    with op.batch_alter_table("daily_sales") as batch:
        batch.drop_constraint("uq_daily_sales_store_date", type_="unique")
        batch.drop_index("ix_daily_sales_store_id")
        batch.drop_index("ix_daily_sales_date")
        batch.create_index("ix_daily_sales_date", ["date"], unique=True)
        batch.drop_constraint("fk_daily_sales_store_id", type_="foreignkey")
        batch.drop_column("store_id")
