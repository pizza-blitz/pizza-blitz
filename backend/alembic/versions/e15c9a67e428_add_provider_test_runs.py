"""Add provider test runs

Revision ID: e15c9a67e428
Revises: 60acf85674e9
Create Date: 2026-05-28 17:10:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "e15c9a67e428"
down_revision: Union[str, Sequence[str], None] = "60acf85674e9"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "provider_test_runs",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("test_id", sa.String(length=120), nullable=False),
        sa.Column("channel", sa.String(length=50), nullable=False),
        sa.Column("provider", sa.String(length=80), nullable=True),
        sa.Column("recipient_masked", sa.String(length=255), nullable=True),
        sa.Column("message_preview", sa.String(), nullable=True),
        sa.Column("queued", sa.Boolean(), nullable=True),
        sa.Column("live_send_blocked", sa.Boolean(), nullable=True),
        sa.Column("response_payload", sa.JSON(), nullable=True),
        sa.Column("generated_at", sa.DateTime(), nullable=True),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_provider_test_runs_channel"), "provider_test_runs", ["channel"], unique=False)
    op.create_index(op.f("ix_provider_test_runs_generated_at"), "provider_test_runs", ["generated_at"], unique=False)
    op.create_index(op.f("ix_provider_test_runs_id"), "provider_test_runs", ["id"], unique=False)
    op.create_index(op.f("ix_provider_test_runs_test_id"), "provider_test_runs", ["test_id"], unique=True)


def downgrade() -> None:
    op.drop_index(op.f("ix_provider_test_runs_test_id"), table_name="provider_test_runs")
    op.drop_index(op.f("ix_provider_test_runs_id"), table_name="provider_test_runs")
    op.drop_index(op.f("ix_provider_test_runs_generated_at"), table_name="provider_test_runs")
    op.drop_index(op.f("ix_provider_test_runs_channel"), table_name="provider_test_runs")
    op.drop_table("provider_test_runs")
