"""Activate the Finance budgets and outlet P&L module.

Revision ID: c3e52a7b1f04
Revises: b7c41f2a9d10
Create Date: 2026-10-27
"""

from typing import Sequence, Union

from alembic import op


revision: str = "c3e52a7b1f04"
down_revision: Union[str, None] = "b7c41f2a9d10"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Only flip the untouched planned row so an operator customisation is
    # never overwritten. Missing rows are created by the startup seeder.
    op.execute(
        """
        UPDATE department_modules
        SET route = '/finance/pnl', status = 'active'
        WHERE module_key = 'finance-budgets'
          AND route IS NULL
          AND status = 'planned'
        """
    )


def downgrade() -> None:
    op.execute(
        """
        UPDATE department_modules
        SET route = NULL, status = 'planned'
        WHERE module_key = 'finance-budgets'
          AND route = '/finance/pnl'
          AND status = 'active'
        """
    )
