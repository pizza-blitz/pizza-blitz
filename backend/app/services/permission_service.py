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
