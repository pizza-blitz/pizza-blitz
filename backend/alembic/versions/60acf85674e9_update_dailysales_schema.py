"""Update DailySales schema

Revision ID: 60acf85674e9
Revises: d1d9fbe8f1ba
Create Date: 2026-03-23 01:16:42.741087

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '60acf85674e9'
down_revision: Union[str, Sequence[str], None] = 'd1d9fbe8f1ba'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    with op.batch_alter_table('daily_sales', schema=None) as batch_op:
        batch_op.add_column(sa.Column('cash_collected', sa.Numeric(precision=10, scale=2), nullable=True))
        batch_op.add_column(sa.Column('total_expense', sa.Numeric(precision=10, scale=2), nullable=True))
        batch_op.add_column(sa.Column('total_sale', sa.Numeric(precision=10, scale=2), nullable=True))
        batch_op.add_column(sa.Column('profit', sa.Numeric(precision=10, scale=2), sa.Computed('total_sale - total_expense', ), nullable=True))
        batch_op.add_column(sa.Column('payment_method', sa.String(), nullable=True))
        batch_op.add_column(sa.Column('notes', sa.String(), nullable=True))
        batch_op.alter_column('date',
                   existing_type=sa.DATETIME(),
                   type_=sa.Date(),
                   existing_nullable=True)
        batch_op.drop_column('average_order_value')
        batch_op.drop_column('total_orders')
        batch_op.drop_column('total_revenue')

def downgrade() -> None:
    """Downgrade schema."""
    with op.batch_alter_table('daily_sales', schema=None) as batch_op:
        batch_op.add_column(sa.Column('total_revenue', sa.FLOAT(), nullable=True))
        batch_op.add_column(sa.Column('total_orders', sa.INTEGER(), nullable=True))
        batch_op.add_column(sa.Column('average_order_value', sa.FLOAT(), nullable=True))
        batch_op.alter_column('date',
                   existing_type=sa.Date(),
                   type_=sa.DATETIME(),
                   existing_nullable=True)
        batch_op.drop_column('notes')
        batch_op.drop_column('payment_method')
        batch_op.drop_column('profit')
        batch_op.drop_column('total_sale')
        batch_op.drop_column('total_expense')
        batch_op.drop_column('cash_collected')
    # ### end Alembic commands ###
