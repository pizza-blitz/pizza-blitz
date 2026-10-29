"""add company department os

Revision ID: fd0857690f39
Revises: 6af4edc5bec4
Create Date: 2026-10-27 12:00:58.902654

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'fd0857690f39'
down_revision: Union[str, Sequence[str], None] = '6af4edc5bec4'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _sqlite_batch(name: str):
    """Batch-alter a table; SQLite needs a rebuild for foreign keys."""
    recreate = "always" if op.get_bind().dialect.name == "sqlite" else "auto"
    return op.batch_alter_table(name, recreate=recreate)


def upgrade() -> None:
    """Upgrade schema."""
    op.create_table('approvals',
    sa.Column('id', sa.Integer(), nullable=False),
    sa.Column('department_id', sa.Integer(), nullable=False),
    sa.Column('kind', sa.String(length=40), nullable=False),
    sa.Column('title', sa.String(length=200), nullable=False),
    sa.Column('amount', sa.Float(), nullable=True),
    sa.Column('currency', sa.String(length=8), nullable=False),
    sa.Column('status', sa.String(length=20), nullable=False),
    sa.Column('requested_by', sa.String(length=160), nullable=True),
    sa.Column('decided_by', sa.String(length=160), nullable=True),
    sa.Column('decided_at', sa.DateTime(), nullable=True),
    sa.Column('note', sa.Text(), nullable=True),
    sa.Column('source_type', sa.String(length=60), nullable=True),
    sa.Column('source_id', sa.String(length=120), nullable=True),
    sa.Column('store_id', sa.Integer(), nullable=True),
    sa.Column('metadata_json', sa.JSON(), nullable=True),
    sa.Column('created_at', sa.DateTime(), nullable=True),
    sa.Column('updated_at', sa.DateTime(), nullable=True),
    sa.ForeignKeyConstraint(['department_id'], ['business_departments.id'], ),
    sa.ForeignKeyConstraint(['store_id'], ['stores.id'], ),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_index(op.f('ix_approvals_created_at'), 'approvals', ['created_at'], unique=False)
    op.create_index(op.f('ix_approvals_department_id'), 'approvals', ['department_id'], unique=False)
    op.create_index(op.f('ix_approvals_id'), 'approvals', ['id'], unique=False)
    op.create_index(op.f('ix_approvals_kind'), 'approvals', ['kind'], unique=False)
    op.create_index(op.f('ix_approvals_source_id'), 'approvals', ['source_id'], unique=False)
    op.create_index(op.f('ix_approvals_source_type'), 'approvals', ['source_type'], unique=False)
    op.create_index(op.f('ix_approvals_status'), 'approvals', ['status'], unique=False)
    op.create_index(op.f('ix_approvals_store_id'), 'approvals', ['store_id'], unique=False)
    op.create_table('department_roles',
    sa.Column('id', sa.Integer(), nullable=False),
    sa.Column('department_id', sa.Integer(), nullable=False),
    sa.Column('key', sa.String(length=40), nullable=False),
    sa.Column('name', sa.String(length=80), nullable=False),
    sa.Column('description', sa.String(length=240), nullable=True),
    sa.Column('level', sa.String(length=20), nullable=False),
    sa.Column('is_default', sa.Boolean(), server_default='0', nullable=False),
    sa.Column('created_at', sa.DateTime(), nullable=True),
    sa.Column('updated_at', sa.DateTime(), nullable=True),
    sa.ForeignKeyConstraint(['department_id'], ['business_departments.id'], ),
    sa.PrimaryKeyConstraint('id'),
    sa.UniqueConstraint('department_id', 'key', name='uq_department_role')
    )
    op.create_index(op.f('ix_department_roles_department_id'), 'department_roles', ['department_id'], unique=False)
    op.create_index(op.f('ix_department_roles_id'), 'department_roles', ['id'], unique=False)
    op.create_table('staff_notifications',
    sa.Column('id', sa.Integer(), nullable=False),
    sa.Column('staff_id', sa.String(length=120), nullable=False),
    sa.Column('department_id', sa.Integer(), nullable=True),
    sa.Column('kind', sa.String(length=40), nullable=False),
    sa.Column('title', sa.String(length=200), nullable=False),
    sa.Column('body', sa.Text(), nullable=True),
    sa.Column('link', sa.String(length=240), nullable=True),
    sa.Column('read_at', sa.DateTime(), nullable=True),
    sa.Column('created_at', sa.DateTime(), nullable=True),
    sa.ForeignKeyConstraint(['department_id'], ['business_departments.id'], ),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_index(op.f('ix_staff_notifications_created_at'), 'staff_notifications', ['created_at'], unique=False)
    op.create_index(op.f('ix_staff_notifications_department_id'), 'staff_notifications', ['department_id'], unique=False)
    op.create_index(op.f('ix_staff_notifications_id'), 'staff_notifications', ['id'], unique=False)
    op.create_index(op.f('ix_staff_notifications_staff_id'), 'staff_notifications', ['staff_id'], unique=False)
    op.create_table('work_items',
    sa.Column('id', sa.Integer(), nullable=False),
    sa.Column('department_id', sa.Integer(), nullable=False),
    sa.Column('title', sa.String(length=200), nullable=False),
    sa.Column('description', sa.Text(), nullable=True),
    sa.Column('kind', sa.String(length=30), nullable=False),
    sa.Column('status', sa.String(length=30), nullable=False),
    sa.Column('priority', sa.String(length=20), nullable=False),
    sa.Column('owner_staff_id', sa.String(length=120), nullable=True),
    sa.Column('created_by', sa.String(length=160), nullable=True),
    sa.Column('due_at', sa.DateTime(), nullable=True),
    sa.Column('source_type', sa.String(length=60), nullable=True),
    sa.Column('source_id', sa.String(length=120), nullable=True),
    sa.Column('store_id', sa.Integer(), nullable=True),
    sa.Column('metadata_json', sa.JSON(), nullable=True),
    sa.Column('completed_at', sa.DateTime(), nullable=True),
    sa.Column('created_at', sa.DateTime(), nullable=True),
    sa.Column('updated_at', sa.DateTime(), nullable=True),
    sa.ForeignKeyConstraint(['department_id'], ['business_departments.id'], ),
    sa.ForeignKeyConstraint(['store_id'], ['stores.id'], ),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_index(op.f('ix_work_items_created_at'), 'work_items', ['created_at'], unique=False)
    op.create_index(op.f('ix_work_items_department_id'), 'work_items', ['department_id'], unique=False)
    op.create_index(op.f('ix_work_items_due_at'), 'work_items', ['due_at'], unique=False)
    op.create_index(op.f('ix_work_items_id'), 'work_items', ['id'], unique=False)
    op.create_index(op.f('ix_work_items_owner_staff_id'), 'work_items', ['owner_staff_id'], unique=False)
    op.create_index(op.f('ix_work_items_priority'), 'work_items', ['priority'], unique=False)
    op.create_index(op.f('ix_work_items_status'), 'work_items', ['status'], unique=False)
    op.create_index(op.f('ix_work_items_store_id'), 'work_items', ['store_id'], unique=False)
    op.create_table('approval_steps',
    sa.Column('id', sa.Integer(), nullable=False),
    sa.Column('approval_id', sa.Integer(), nullable=False),
    sa.Column('step_order', sa.Integer(), nullable=False),
    sa.Column('approver_department_id', sa.Integer(), nullable=True),
    sa.Column('approver_staff_id', sa.String(length=120), nullable=True),
    sa.Column('status', sa.String(length=20), nullable=False),
    sa.Column('decided_at', sa.DateTime(), nullable=True),
    sa.Column('note', sa.Text(), nullable=True),
    sa.Column('created_at', sa.DateTime(), nullable=True),
    sa.ForeignKeyConstraint(['approval_id'], ['approvals.id'], ),
    sa.ForeignKeyConstraint(['approver_department_id'], ['business_departments.id'], ),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_index(op.f('ix_approval_steps_approval_id'), 'approval_steps', ['approval_id'], unique=False)
    op.create_index(op.f('ix_approval_steps_approver_department_id'), 'approval_steps', ['approver_department_id'], unique=False)
    op.create_index(op.f('ix_approval_steps_approver_staff_id'), 'approval_steps', ['approver_staff_id'], unique=False)
    op.create_index(op.f('ix_approval_steps_id'), 'approval_steps', ['id'], unique=False)
    op.create_table('department_role_permissions',
    sa.Column('id', sa.Integer(), nullable=False),
    sa.Column('role_id', sa.Integer(), nullable=False),
    sa.Column('permission_key', sa.String(length=80), nullable=False),
    sa.Column('enabled', sa.Boolean(), server_default='1', nullable=False),
    sa.ForeignKeyConstraint(['role_id'], ['department_roles.id'], ),
    sa.PrimaryKeyConstraint('id'),
    sa.UniqueConstraint('role_id', 'permission_key', name='uq_department_role_permission')
    )
    op.create_index(op.f('ix_department_role_permissions_id'), 'department_role_permissions', ['id'], unique=False)
    op.create_index(op.f('ix_department_role_permissions_permission_key'), 'department_role_permissions', ['permission_key'], unique=False)
    op.create_index(op.f('ix_department_role_permissions_role_id'), 'department_role_permissions', ['role_id'], unique=False)
    op.create_table('work_item_comments',
    sa.Column('id', sa.Integer(), nullable=False),
    sa.Column('work_item_id', sa.Integer(), nullable=False),
    sa.Column('author_staff_id', sa.String(length=120), nullable=True),
    sa.Column('author_name', sa.String(length=160), nullable=True),
    sa.Column('body', sa.Text(), nullable=False),
    sa.Column('created_at', sa.DateTime(), nullable=True),
    sa.ForeignKeyConstraint(['work_item_id'], ['work_items.id'], ),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_index(op.f('ix_work_item_comments_created_at'), 'work_item_comments', ['created_at'], unique=False)
    op.create_index(op.f('ix_work_item_comments_id'), 'work_item_comments', ['id'], unique=False)
    op.create_index(op.f('ix_work_item_comments_work_item_id'), 'work_item_comments', ['work_item_id'], unique=False)

    with _sqlite_batch('business_departments') as batch:
        batch.add_column(sa.Column('parent_id', sa.Integer(), nullable=True))
        batch.add_column(sa.Column('head_staff_id', sa.String(length=120), nullable=True))
        batch.add_column(sa.Column('kind', sa.String(length=20), server_default='functional', nullable=False))
        batch.add_column(sa.Column('store_id', sa.Integer(), nullable=True))
        batch.add_column(sa.Column('cost_center', sa.String(length=60), nullable=True))
        batch.create_index(op.f('ix_business_departments_kind'), ['kind'], unique=False)
        batch.create_index(op.f('ix_business_departments_parent_id'), ['parent_id'], unique=False)
        batch.create_index(op.f('ix_business_departments_store_id'), ['store_id'], unique=False)
        batch.create_foreign_key(
            'fk_business_departments_parent',
            'business_departments',
            ['parent_id'],
            ['id'],
        )
        batch.create_foreign_key(
            'fk_business_departments_store',
            'stores',
            ['store_id'],
            ['id'],
        )

    with _sqlite_batch('department_members') as batch:
        batch.add_column(sa.Column('title', sa.String(length=120), nullable=True))
        batch.add_column(sa.Column('reports_to_staff_id', sa.String(length=120), nullable=True))
        batch.add_column(sa.Column('employee_id', sa.Integer(), nullable=True))
        batch.add_column(sa.Column('department_role_id', sa.Integer(), nullable=True))
        batch.add_column(sa.Column('store_id', sa.Integer(), nullable=True))
        batch.add_column(sa.Column('effective_from', sa.Date(), nullable=True))
        batch.add_column(sa.Column('effective_to', sa.Date(), nullable=True))
        batch.create_index(op.f('ix_department_members_department_role_id'), ['department_role_id'], unique=False)
        batch.create_index(op.f('ix_department_members_employee_id'), ['employee_id'], unique=False)
        batch.create_index(op.f('ix_department_members_store_id'), ['store_id'], unique=False)
        batch.create_foreign_key(
            'fk_department_members_store', 'stores', ['store_id'], ['id']
        )
        batch.create_foreign_key(
            'fk_department_members_role',
            'department_roles',
            ['department_role_id'],
            ['id'],
        )
        batch.create_foreign_key(
            'fk_department_members_employee',
            'hr_employees',
            ['employee_id'],
            ['id'],
        )

    with _sqlite_batch('department_modules') as batch:
        batch.add_column(sa.Column('description', sa.String(length=240), nullable=True))
        batch.add_column(sa.Column('icon', sa.String(length=40), nullable=True))
        batch.add_column(sa.Column('permission_key', sa.String(length=80), nullable=True))
        batch.add_column(sa.Column('nav_group', sa.String(length=80), nullable=True))
        batch.add_column(sa.Column('nav_order', sa.Integer(), server_default='100', nullable=False))
        batch.add_column(sa.Column('is_owner', sa.Boolean(), server_default='1', nullable=False))
        batch.add_column(sa.Column('is_shared', sa.Boolean(), server_default='0', nullable=False))
        batch.create_index(op.f('ix_department_modules_permission_key'), ['permission_key'], unique=False)

    with _sqlite_batch('operational_audit_events') as batch:
        batch.add_column(sa.Column('department_id', sa.Integer(), nullable=True))
        batch.add_column(sa.Column('store_id', sa.Integer(), nullable=True))
        batch.create_index(op.f('ix_operational_audit_events_department_id'), ['department_id'], unique=False)
        batch.create_index(op.f('ix_operational_audit_events_store_id'), ['store_id'], unique=False)
        batch.create_foreign_key(
            'fk_audit_events_store', 'stores', ['store_id'], ['id']
        )
        batch.create_foreign_key(
            'fk_audit_events_department',
            'business_departments',
            ['department_id'],
            ['id'],
        )


def downgrade() -> None:
    """Downgrade schema."""
    with _sqlite_batch('operational_audit_events') as batch:
        batch.drop_constraint('fk_audit_events_department', type_='foreignkey')
        batch.drop_constraint('fk_audit_events_store', type_='foreignkey')
        batch.drop_index(op.f('ix_operational_audit_events_store_id'))
        batch.drop_index(op.f('ix_operational_audit_events_department_id'))
        batch.drop_column('store_id')
        batch.drop_column('department_id')

    with _sqlite_batch('department_modules') as batch:
        batch.drop_index(op.f('ix_department_modules_permission_key'))
        batch.drop_column('is_shared')
        batch.drop_column('is_owner')
        batch.drop_column('nav_order')
        batch.drop_column('nav_group')
        batch.drop_column('permission_key')
        batch.drop_column('icon')
        batch.drop_column('description')

    with _sqlite_batch('department_members') as batch:
        batch.drop_constraint('fk_department_members_employee', type_='foreignkey')
        batch.drop_constraint('fk_department_members_role', type_='foreignkey')
        batch.drop_constraint('fk_department_members_store', type_='foreignkey')
        batch.drop_index(op.f('ix_department_members_store_id'))
        batch.drop_index(op.f('ix_department_members_employee_id'))
        batch.drop_index(op.f('ix_department_members_department_role_id'))
        batch.drop_column('effective_to')
        batch.drop_column('effective_from')
        batch.drop_column('store_id')
        batch.drop_column('department_role_id')
        batch.drop_column('employee_id')
        batch.drop_column('reports_to_staff_id')
        batch.drop_column('title')

    with _sqlite_batch('business_departments') as batch:
        batch.drop_constraint('fk_business_departments_store', type_='foreignkey')
        batch.drop_constraint('fk_business_departments_parent', type_='foreignkey')
        batch.drop_index(op.f('ix_business_departments_store_id'))
        batch.drop_index(op.f('ix_business_departments_parent_id'))
        batch.drop_index(op.f('ix_business_departments_kind'))
        batch.drop_column('cost_center')
        batch.drop_column('store_id')
        batch.drop_column('kind')
        batch.drop_column('head_staff_id')
        batch.drop_column('parent_id')

    op.drop_index(op.f('ix_work_item_comments_work_item_id'), table_name='work_item_comments')
    op.drop_index(op.f('ix_work_item_comments_id'), table_name='work_item_comments')
    op.drop_index(op.f('ix_work_item_comments_created_at'), table_name='work_item_comments')
    op.drop_table('work_item_comments')
    op.drop_index(op.f('ix_department_role_permissions_role_id'), table_name='department_role_permissions')
    op.drop_index(op.f('ix_department_role_permissions_permission_key'), table_name='department_role_permissions')
    op.drop_index(op.f('ix_department_role_permissions_id'), table_name='department_role_permissions')
    op.drop_table('department_role_permissions')
    op.drop_index(op.f('ix_approval_steps_id'), table_name='approval_steps')
    op.drop_index(op.f('ix_approval_steps_approver_staff_id'), table_name='approval_steps')
    op.drop_index(op.f('ix_approval_steps_approver_department_id'), table_name='approval_steps')
    op.drop_index(op.f('ix_approval_steps_approval_id'), table_name='approval_steps')
    op.drop_table('approval_steps')
    op.drop_index(op.f('ix_work_items_store_id'), table_name='work_items')
    op.drop_index(op.f('ix_work_items_status'), table_name='work_items')
    op.drop_index(op.f('ix_work_items_priority'), table_name='work_items')
    op.drop_index(op.f('ix_work_items_owner_staff_id'), table_name='work_items')
    op.drop_index(op.f('ix_work_items_id'), table_name='work_items')
    op.drop_index(op.f('ix_work_items_due_at'), table_name='work_items')
    op.drop_index(op.f('ix_work_items_department_id'), table_name='work_items')
    op.drop_index(op.f('ix_work_items_created_at'), table_name='work_items')
    op.drop_table('work_items')
    op.drop_index(op.f('ix_staff_notifications_staff_id'), table_name='staff_notifications')
    op.drop_index(op.f('ix_staff_notifications_id'), table_name='staff_notifications')
    op.drop_index(op.f('ix_staff_notifications_department_id'), table_name='staff_notifications')
    op.drop_index(op.f('ix_staff_notifications_created_at'), table_name='staff_notifications')
    op.drop_table('staff_notifications')
    op.drop_index(op.f('ix_department_roles_id'), table_name='department_roles')
    op.drop_index(op.f('ix_department_roles_department_id'), table_name='department_roles')
    op.drop_table('department_roles')
    op.drop_index(op.f('ix_approvals_store_id'), table_name='approvals')
    op.drop_index(op.f('ix_approvals_status'), table_name='approvals')
    op.drop_index(op.f('ix_approvals_source_type'), table_name='approvals')
    op.drop_index(op.f('ix_approvals_source_id'), table_name='approvals')
    op.drop_index(op.f('ix_approvals_kind'), table_name='approvals')
    op.drop_index(op.f('ix_approvals_id'), table_name='approvals')
    op.drop_index(op.f('ix_approvals_department_id'), table_name='approvals')
    op.drop_index(op.f('ix_approvals_created_at'), table_name='approvals')
    op.drop_table('approvals')
