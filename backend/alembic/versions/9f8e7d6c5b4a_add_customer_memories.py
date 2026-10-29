"""add customer memories for the concierge

Revision ID: 9f8e7d6c5b4a
Revises: b70420584d8b
Create Date: 2026-10-29 02:20:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '9f8e7d6c5b4a'
down_revision: Union[str, Sequence[str], None] = 'b70420584d8b'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Create the concierge memory table.

    One row per phone number is the whole point: the guest types the same number
    at checkout that the order-history proof already verifies, and the concierge
    reads their allergies back on the next visit.
    """
    op.create_table(
        'customer_memories',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('phone', sa.String(length=30), nullable=False),
        sa.Column('display_name', sa.String(length=255), nullable=True),
        sa.Column('allergies', sa.JSON(), nullable=False),
        sa.Column('dietary_preferences', sa.JSON(), nullable=False),
        sa.Column('favourite_items', sa.JSON(), nullable=False),
        sa.Column('usual_fulfillment', sa.String(length=20), nullable=True),
        sa.Column('last_order_summary', sa.String(length=500), nullable=True),
        sa.Column('notes', sa.Text(), nullable=True),
        sa.Column('consent_granted', sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column('created_at', sa.DateTime(), nullable=True),
        sa.Column('updated_at', sa.DateTime(), nullable=True),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index(
        'ix_customer_memories_phone', 'customer_memories', ['phone'], unique=True
    )


def downgrade() -> None:
    """Drop the concierge memory table."""
    op.drop_index('ix_customer_memories_phone', table_name='customer_memories')
    op.drop_table('customer_memories')
