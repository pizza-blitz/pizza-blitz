"""Granular staff permissions stored as role/permission overrides."""

from sqlalchemy.orm import Session

from app.models.domain import RolePermission

PERMISSIONS = [
    {
        "key": "orders.view",
        "label": "View orders",
        "group": "Service floor",
        "description": "Open the orders board and order detail.",
    },
    {
        "key": "orders.manage",
        "label": "Manage orders",
        "group": "Service floor",
        "description": "Advance status, close orders and edit order details.",
    },
    {
        "key": "kitchen.manage",
        "label": "Kitchen and KDS",
        "group": "Service floor",
        "description": "Bump, recall and move kitchen tickets.",
    },
    {
        "key": "delivery.manage",
        "label": "Delivery dispatch",
        "group": "Service floor",
        "description": "Assign riders, dispatch deliveries and issue rider links.",
    },
    {
        "key": "refunds.manage",
        "label": "Refunds",
        "group": "Money",
        "description": "Record full or partial refunds with reasons.",
    },
    {
        "key": "reports.view",
        "label": "Reports and builders",
        "group": "Money",
        "description": "Open reports, run the builder and export saved reports.",
    },
    {
        "key": "settings.manage",
        "label": "Store settings",
        "group": "Administration",
        "description": "Change store profile, hours and ordering controls.",
    },
    {
        "key": "staff.manage",
        "label": "Staff and access",
        "group": "Administration",
        "description": "Manage staff credentials and permission toggles.",
    },
    {
        "key": "hr.view",
        "label": "HR workspace",
        "group": "People & HR",
        "description": "Open the People & HR department and its overview.",
    },
    {
        "key": "hr.people",
        "label": "HR people directory",
        "group": "People & HR",
        "description": "View and edit employee records and POS links.",
    },
    {
        "key": "hr.leave",
        "label": "HR leave",
        "group": "People & HR",
        "description": "Manage leave types, balances, requests and holidays.",
    },
    {
        "key": "hr.attendance",
        "label": "HR attendance",
        "group": "People & HR",
        "description": "View the roster, clock in/out and regularise attendance.",
    },
    {
        "key": "hr.payroll",
        "label": "HR payroll",
        "group": "People & HR",
        "description": "Manage salary structures, pay runs and payslips.",
    },
    {
        "key": "hr.recruitment",
        "label": "HR recruitment",
        "group": "People & HR",
        "description": "Manage jobs, applicants, interviews and offers.",
    },
    {
        "key": "hr.onboarding",
        "label": "HR onboarding",
        "group": "People & HR",
        "description": "Manage candidates, checklists and employee conversion.",
    },
    {
        "key": "hr.documents",
        "label": "HR documents",
        "group": "People & HR",
        "description": "Upload/delete documents and issue or verify letters.",
    },
    {
        "key": "hr.exits",
        "label": "HR exits",
        "group": "People & HR",
        "description": "Manage exits, clearance and final settlement.",
    },
]
PERMISSION_KEYS = {item["key"] for item in PERMISSIONS}
DEFAULT_STAFF = {
    "orders.view": True,
    "orders.manage": True,
    "kitchen.manage": True,
    "delivery.manage": True,
    "refunds.manage": False,
    "reports.view": False,
    "settings.manage": False,
    "staff.manage": False,
    "hr.view": False,
    "hr.people": False,
    "hr.leave": False,
    "hr.attendance": False,
    "hr.payroll": False,
    "hr.recruitment": False,
    "hr.onboarding": False,
    "hr.documents": False,
    "hr.exits": False,
}


def permission_enabled(db: Session, role: str, permission: str) -> bool:
    if role == "admin":
        return True
    if permission not in PERMISSION_KEYS:
        return False
    override = (
        db.query(RolePermission)
        .filter(
            RolePermission.role == role,
            RolePermission.permission == permission,
        )
        .first()
    )
    if override is not None:
        return bool(override.enabled)
    return bool(DEFAULT_STAFF.get(permission, False))


def staff_permission_state(db: Session) -> list[dict]:
    overrides = {
        row.permission: bool(row.enabled)
        for row in db.query(RolePermission).filter(RolePermission.role == "staff").all()
    }
    return [
        {
            **item,
            "enabled": overrides.get(item["key"], DEFAULT_STAFF.get(item["key"], False)),
            "overridden": item["key"] in overrides,
        }
        for item in PERMISSIONS
    ]


def set_staff_permissions(db: Session, permissions: list[str]) -> list[dict]:
    requested = set(permissions)
    unknown = requested - PERMISSION_KEYS
    if unknown:
        raise ValueError(f"Unknown permission: {', '.join(sorted(unknown))}.")
    existing = {
        row.permission: row
        for row in db.query(RolePermission).filter(RolePermission.role == "staff").all()
    }
    for item in PERMISSIONS:
        row = existing.get(item["key"])
        enabled = item["key"] in requested
        if row is None:
            db.add(
                RolePermission(
                    role="staff",
                    permission=item["key"],
                    enabled=enabled,
                )
            )
        else:
            row.enabled = enabled
    db.commit()
    return staff_permission_state(db)
