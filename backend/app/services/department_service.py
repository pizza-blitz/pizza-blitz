"""Admin-domain departments: a reusable registry for Operations, HR, Finance.

Departments are business units under the admin domain. They own a curated set of
modules and staff members. New departments are created from the module catalogue,
so adding a department never requires a new database table or route.
"""

import re

from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.models.domain import (
    BusinessDepartment,
    DepartmentMember,
    DepartmentModule,
    StaffCredential,
)

MODULE_CATALOG = [
    {
        "key": "overview",
        "label": "Department overview",
        "category": "core",
        "description": "Team, modules and integration status.",
        "route_template": "/departments/{key}",
        "default_status": "active",
    },
    {
        "key": "shifts",
        "label": "Shift roster & labour",
        "category": "operations",
        "description": "Weekly roster, attendance and labour-vs-sales.",
        "route_template": "/shifts",
        "default_status": "active",
    },
    {
        "key": "kitchen",
        "label": "Kitchen operations",
        "category": "operations",
        "description": "Station board, dispatch and handoff.",
        "route_template": "/operations",
        "default_status": "active",
    },
    {
        "key": "inventory",
        "label": "Inventory & supply",
        "category": "operations",
        "description": "Stock, purchase orders, vendors and waste.",
        "route_template": "/inventory",
        "default_status": "active",
    },
    {
        "key": "reports",
        "label": "Reports & audit",
        "category": "core",
        "description": "Comparisons, exports and audit trail.",
        "route_template": "/reports",
        "default_status": "active",
    },
    {
        "key": "people",
        "label": "People directory",
        "category": "hr",
        "description": "Employee master, org chart and documents.",
        "route_template": "/departments/{key}/people",
        "default_status": "planned",
    },
    {
        "key": "leave",
        "label": "Leave & holidays",
        "category": "hr",
        "description": "Balances, requests, approvals and holiday calendar.",
        "route_template": "/departments/{key}/leave",
        "default_status": "planned",
    },
    {
        "key": "attendance",
        "label": "HR attendance",
        "category": "hr",
        "description": "Geofenced clock-in/out and regularisation.",
        "route_template": "/departments/{key}/attendance",
        "default_status": "planned",
    },
    {
        "key": "payroll",
        "label": "Payroll & payslips",
        "category": "hr",
        "description": "Salary structures, statutory deductions and payslips.",
        "route_template": "/departments/{key}/payroll",
        "default_status": "planned",
    },
    {
        "key": "onboarding",
        "label": "Onboarding",
        "category": "hr",
        "description": "Candidate forms, reminders and HR review.",
        "route_template": "/departments/{key}/onboarding",
        "default_status": "planned",
    },
    {
        "key": "documents",
        "label": "HR documents",
        "category": "hr",
        "description": "Document vault, templates and letters.",
        "route_template": "/departments/{key}/documents",
        "default_status": "planned",
    },
    {
        "key": "exits",
        "label": "Exits & settlement",
        "category": "hr",
        "description": "Resignation, clearance and full-and-final settlement.",
        "route_template": "/departments/{key}/exits",
        "default_status": "planned",
    },
    {
        "key": "accounting",
        "label": "Accounting & GST",
        "category": "finance",
        "description": "GST summary, expenses and Tally-ready exports.",
        "route_template": "/accounting",
        "default_status": "active",
    },
    {
        "key": "customers",
        "label": "Customers & CRM",
        "category": "growth",
        "description": "Profiles, consent, segments and feedback.",
        "route_template": "/customers",
        "default_status": "active",
    },
    {
        "key": "marketing",
        "label": "Marketing",
        "category": "growth",
        "description": "Campaigns, promotions, social and ads.",
        "route_template": "/communications",
        "default_status": "active",
    },
]
MODULE_BY_KEY = {item["key"]: item for item in MODULE_CATALOG}

DEFAULT_DEPARTMENTS = [
    {
        "key": "operations",
        "name": "Restaurant Operations",
        "description": "Service floor, kitchen, supply and daily restaurant execution.",
        "color": "#f97316",
        "icon": "utensils",
        "sort_order": 10,
        "modules": ["overview", "shifts", "kitchen", "inventory", "reports"],
    },
    {
        "key": "hr",
        "name": "People & HR",
        "description": "Employee records, leave, attendance, payroll and HR compliance.",
        "color": "#0f766e",
        "icon": "users",
        "sort_order": 20,
        "external_system": "Euron Open HRMS",
        "integration_status": "pilot",
        "modules": [
            "overview",
            "people",
            "leave",
            "attendance",
            "payroll",
            "onboarding",
            "documents",
            "exits",
        ],
    },
]


def slugify(value: str) -> str:
    slug = re.sub(r"[^a-z0-9]+", "-", str(value or "").strip().lower()).strip("-")
    return slug[:60]


def module_payload(department: BusinessDepartment) -> list[dict]:
    return [
        {
            "key": module.module_key,
            "label": module.label,
            "route": module.route,
            "status": module.status,
            "sort_order": module.sort_order,
        }
        for module in sorted(department.modules, key=lambda row: (row.sort_order, row.id))
    ]


def member_payload(member: DepartmentMember, staff: StaffCredential | None) -> dict:
    return {
        "staff_id": member.staff_id,
        "display_name": staff.display_name if staff else member.staff_id,
        "role": member.role,
        "created_at": member.created_at.isoformat() if member.created_at else None,
    }


def serialize_department(
    department: BusinessDepartment,
    staff_by_id: dict[str, StaffCredential] | None = None,
    include_detail: bool = False,
) -> dict:
    data = {
        "id": department.id,
        "key": department.key,
        "name": department.name,
        "description": department.description,
        "color": department.color,
        "icon": department.icon,
        "status": department.status,
        "sort_order": department.sort_order,
        "external_system": department.external_system,
        "external_url": department.external_url,
        "integration_status": department.integration_status,
        "member_count": len(department.members or []),
        "module_count": len(department.modules or []),
        "created_at": department.created_at.isoformat()
        if department.created_at
        else None,
    }
    if include_detail:
        catalog = staff_by_id or {}
        data["modules"] = module_payload(department)
        data["members"] = [
            member_payload(member, catalog.get(member.staff_id))
            for member in sorted(department.members, key=lambda row: row.id)
        ]
    return data


def get_department(db: Session, key_or_id: str) -> BusinessDepartment | None:
    if str(key_or_id).isdigit():
        return (
            db.query(BusinessDepartment)
            .filter(BusinessDepartment.id == int(key_or_id))
            .first()
        )
    return (
        db.query(BusinessDepartment)
        .filter(BusinessDepartment.key == key_or_id)
        .first()
    )


def add_module(
    db: Session,
    department: BusinessDepartment,
    module_key: str,
    route_override: str | None = None,
    status_override: str | None = None,
) -> DepartmentModule:
    definition = MODULE_BY_KEY.get(module_key)
    if definition is None:
        raise ValueError(f"Unknown department module: {module_key}.")
    existing = next(
        (row for row in department.modules if row.module_key == module_key), None
    )
    if existing is not None:
        return existing
    module = DepartmentModule(
        department_id=department.id,
        module_key=module_key,
        label=definition["label"],
        route=route_override
        or definition["route_template"].replace("{key}", department.key),
        status=status_override or definition["default_status"],
        sort_order=MODULE_CATALOG.index(definition) + 1,
    )
    db.add(module)
    return module


def create_department(db: Session, payload: dict) -> BusinessDepartment:
    name = str(payload.get("name") or "").strip()
    if not name:
        raise ValueError("Department name is required.")
    key = slugify(payload.get("key") or name)
    if not key:
        raise ValueError("Department key is required.")
    if (
        db.query(BusinessDepartment)
        .filter(BusinessDepartment.key == key)
        .first()
        is not None
    ):
        raise ValueError(f"A department with key '{key}' already exists.")
    requested_modules = payload.get("modules") or ["overview"]
    unknown = [key for key in requested_modules if key not in MODULE_BY_KEY]
    if unknown:
        raise ValueError(f"Unknown department modules: {', '.join(unknown)}.")
    department = BusinessDepartment(
        key=key,
        name=name[:120],
        description=(str(payload.get("description") or "").strip() or None),
        color=str(payload.get("color") or "#f97316")[:20],
        icon=str(payload.get("icon") or "building")[:40],
        status="active",
        sort_order=int(payload.get("sort_order") or 100),
        external_system=(str(payload.get("external_system") or "").strip() or None),
        external_url=(str(payload.get("external_url") or "").strip() or None),
        integration_status=str(payload.get("integration_status") or "not_connected"),
    )
    db.add(department)
    db.flush()
    for module_key in dict.fromkeys(["overview", *requested_modules]):
        add_module(db, department, module_key)
    try:
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise ValueError("That department key is already in use.") from exc
    db.refresh(department)
    return department


def update_department(
    db: Session, department: BusinessDepartment, payload: dict
) -> BusinessDepartment:
    if payload.get("name") is not None:
        name = str(payload["name"]).strip()
        if not name:
            raise ValueError("Department name cannot be empty.")
        department.name = name[:120]
    if payload.get("description") is not None:
        department.description = str(payload["description"]).strip() or None
    if payload.get("color") is not None:
        department.color = str(payload["color"])[:20]
    if payload.get("icon") is not None:
        department.icon = str(payload["icon"])[:40]
    if payload.get("status") is not None:
        status = str(payload["status"]).strip().lower()
        if status not in {"active", "planned", "archived"}:
            raise ValueError("Status must be active, planned or archived.")
        department.status = status
    if payload.get("external_system") is not None:
        department.external_system = (
            str(payload["external_system"]).strip() or None
        )
    if payload.get("external_url") is not None:
        url = str(payload["external_url"]).strip()
        if url and not re.match(r"^https?://", url):
            raise ValueError("External URL must start with http:// or https://.")
        department.external_url = url or None
    if payload.get("integration_status") is not None:
        status = str(payload["integration_status"]).strip().lower()
        if status not in {
            "not_connected",
            "pilot",
            "connected",
            "disabled",
        }:
            raise ValueError("Unknown integration status.")
        department.integration_status = status
    if payload.get("modules") is not None:
        requested = list(dict.fromkeys(payload["modules"]))
        unknown = [key for key in requested if key not in MODULE_BY_KEY]
        if unknown:
            raise ValueError(f"Unknown department modules: {', '.join(unknown)}.")
        existing = {row.module_key for row in department.modules}
        for module_key in requested:
            if module_key not in existing:
                add_module(db, department, module_key)
    try:
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise ValueError("Department could not be saved.") from exc
    db.refresh(department)
    return department


def add_member(
    db: Session, department: BusinessDepartment, staff_id: str, role: str
) -> DepartmentMember:
    staff = (
        db.query(StaffCredential)
        .filter(StaffCredential.staff_id == staff_id)
        .first()
    )
    if staff is None:
        raise ValueError(f"Staff credential '{staff_id}' does not exist.")
    if role not in {"head", "manager", "member"}:
        raise ValueError("Member role must be head, manager or member.")
    if any(member.staff_id == staff_id for member in department.members):
        raise ValueError("That staff member is already in this department.")
    member = DepartmentMember(
        department_id=department.id, staff_id=staff_id, role=role
    )
    db.add(member)
    try:
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise ValueError("That staff member is already in this department.") from exc
    db.refresh(member)
    return member


def remove_member(
    db: Session, department: BusinessDepartment, staff_id: str
) -> bool:
    member = next(
        (row for row in department.members if row.staff_id == staff_id), None
    )
    if member is None:
        return False
    db.delete(member)
    db.commit()
    return True


def delete_department(db: Session, department: BusinessDepartment) -> None:
    if department.key in {"operations", "hr"}:
        raise ValueError("Base departments cannot be deleted; archive them instead.")
    db.delete(department)
    db.commit()


def ensure_departments(db: Session) -> None:
    """Seed the two base departments without overwriting later admin edits."""
    existing = {
        row.key: row for row in db.query(BusinessDepartment).all()
    }
    for spec in DEFAULT_DEPARTMENTS:
        department = existing.get(spec["key"])
        if department is None:
            department = BusinessDepartment(
                key=spec["key"],
                name=spec["name"],
                description=spec["description"],
                color=spec["color"],
                icon=spec["icon"],
                status="active",
                sort_order=spec["sort_order"],
                external_system=spec.get("external_system"),
                integration_status=spec.get("integration_status", "not_connected"),
            )
            db.add(department)
            db.flush()
        for module_key in spec["modules"]:
            if not any(
                row.module_key == module_key for row in department.modules
            ):
                add_module(db, department, module_key)
        if department.key == "hr":
            active_routes = {
                "people": "/departments/hr/people",
                "leave": "/departments/hr/leave",
                "attendance": "/departments/hr/attendance",
            }
            for module_key, route in active_routes.items():
                module = next(
                    (
                        row
                        for row in department.modules
                        if row.module_key == module_key
                    ),
                    None,
                )
                if module is not None:
                    module.route = route
                    module.status = "active"
    try:
        db.commit()
    except IntegrityError:
        # Another worker may have seeded the same base departments at startup.
        db.rollback()


def catalog_payload() -> list[dict]:
    return [
        {
            "key": item["key"],
            "label": item["label"],
            "category": item["category"],
            "description": item["description"],
            "default_status": item["default_status"],
        }
        for item in MODULE_CATALOG
    ]
