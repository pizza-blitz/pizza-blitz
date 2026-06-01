"""Add managed admin credentials

Revision ID: b2a1d6c4e901
Revises: e15c9a67e428
Create Date: 2026-06-01 14:45:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "b2a1d6c4e901"
down_revision: Union[str, Sequence[str], None] = "e15c9a67e428"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "admin_credentials",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("admin_id", sa.String(length=120), nullable=False),
        sa.Column("display_name", sa.String(length=120), nullable=True),
        sa.Column("password_hash", sa.String(length=255), nullable=False),
        sa.Column("is_active", sa.Boolean(), nullable=True),
        sa.Column("must_rotate", sa.Boolean(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=True),
        sa.Column("updated_at", sa.DateTime(), nullable=True),
        sa.Column("last_login_at", sa.DateTime(), nullable=True),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_admin_credentials_admin_id"), "admin_credentials", ["admin_id"], unique=True)
    op.create_index(op.f("ix_admin_credentials_id"), "admin_credentials", ["id"], unique=False)
    op.create_index(op.f("ix_admin_credentials_is_active"), "admin_credentials", ["is_active"], unique=False)


def downgrade() -> None:
    op.drop_index(op.f("ix_admin_credentials_is_active"), table_name="admin_credentials")
    op.drop_index(op.f("ix_admin_credentials_id"), table_name="admin_credentials")
    op.drop_index(op.f("ix_admin_credentials_admin_id"), table_name="admin_credentials")
    op.drop_table("admin_credentials")
