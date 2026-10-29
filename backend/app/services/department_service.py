"""Company department registry, scoped access and workspace assembly.

Departments are real operating units: they own modules, teams, roles, work
items and approvals. This service keeps the registry as the source of truth for
navigation and access while remaining compatible with the legacy global staff
permission toggles.
"""

from __future__ import annotations

import re
from datetime import date

from sqlalchemy import or_
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.models.domain import (
    BusinessDepartment,
    DepartmentMember,
    DepartmentModule,
    DepartmentRole,
    DepartmentRolePermission,
    StaffCredential,
)
from app.services.company_catalog import (
    DEPARTMENT_BY_KEY,
    DEPARTMENT_SPECS,
    LEGACY_PERMISSION_MAP,
    MODULE_BY_KEY,
    MODULE_CATALOG,
    ROLE_PRESETS,
    SHARED_SERVICE_KEYS,
    SUB_DEPARTMENTS,
    department_root,
    modules_for_department,
    nav_group_for,
    permission_keys_for_department,
    role_permission_keys,
)
from app.services.permission_service import permission_enabled


def slugify(value: str) -> str:
    slug = re.sub(r"[^a-z0-9]+", "-", str(value or "").strip().lower()).strip("-")
    return slug[:60]


def _today() -> date:
    return date.today()


def _active_membership_filter():
    return or_(
        DepartmentMember.effective_from.is_(None),
        DepartmentMember.effective_from <= _today(),
    ), or_(
        DepartmentMember.effective_to.is_(None),
        DepartmentMember.effective_to >= _today(),
    )


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


def department_descendant_keys(db: Session, department: BusinessDepartment) -> set[str]:
    rows = db.query(BusinessDepartment).all()
    children: dict[int, list[BusinessDepartment]] = {}
    for row in rows:
        if row.parent_id:
            children.setdefault(row.parent_id, []).append(row)
    found: set[str] = {department.key}
    stack = [department]
    while stack:
        current = stack.pop()
        for child in children.get(current.id, []):
            if child.key not in found:
                found.add(child.key)
                stack.append(child)
    return found


def department_ancestor_keys(db: Session, department: BusinessDepartment) -> set[str]:
    rows = {row.id: row for row in db.query(BusinessDepartment).all()}
    found: set[str] = {department.key}
    current = department
    guard = 0
    while current.parent_id and guard < 20:
        parent = rows.get(current.parent_id)
        if parent is None:
            break
        found.add(parent.key)
        current = parent
        guard += 1
    return found


def _session_staff_id(session: dict) -> str:
    subject = str(session.get("subject") or "")
    if subject.startswith("staff:"):
        return subject.split("staff:", 1)[1].strip()
    return ""


def is_admin_session(session: dict) -> bool:
    return session.get("role") == "admin"


def member_for_department(
    db: Session, staff_id: str, department: BusinessDepartment
) -> DepartmentMember | None:
    """Return a direct or ancestor membership active today."""
    from_filter, to_filter = _active_membership_filter()
    direct = (
        db.query(DepartmentMember)
        .filter(
            DepartmentMember.staff_id == staff_id,
            DepartmentMember.department_id == department.id,
            from_filter,
            to_filter,
        )
        .first()
    )
    if direct is not None:
        return direct
    ancestor_keys = department_ancestor_keys(db, department)
    ancestors = (
        db.query(BusinessDepartment)
        .filter(BusinessDepartment.key.in_(ancestor_keys))
        .all()
    )
    ancestor_ids = {row.id for row in ancestors}
    if not ancestor_ids:
        return None
    return (
        db.query(DepartmentMember)
        .filter(
            DepartmentMember.staff_id == staff_id,
            DepartmentMember.department_id.in_(ancestor_ids),
            from_filter,
            to_filter,
        )
        .first()
    )


def _role_permission_keys(db: Session, member: DepartmentMember) -> set[str] | None:
    if not member.department_role_id:
        return None
    role = (
        db.query(DepartmentRole)
        .filter(DepartmentRole.id == member.department_role_id)
        .first()
    )
    if role is None:
        return None
    rows = (
        db.query(DepartmentRolePermission)
        .filter(
            DepartmentRolePermission.role_id == role.id,
            DepartmentRolePermission.enabled.is_(True),
        )
        .all()
    )
    return {row.permission_key for row in rows}


def _legacy_permission_keys(db: Session, department: BusinessDepartment) -> set[str]:
    allowed: set[str] = set()
    if permission_enabled(db, "staff", f"{department.key}.view"):
        allowed.add(f"{department.key}.view")
    for module in modules_for_department(department.key):
        permission = module.get("permission_key")
        legacy = module.get("legacy_permission") or LEGACY_PERMISSION_MAP.get(
            permission or ""
        )
        if not permission:
            continue
        if permission_enabled(db, "staff", permission) or (
            legacy and permission_enabled(db, "staff", legacy)
        ):
            allowed.add(permission)
    if allowed:
        allowed.add(f"{department.key}.view")
    return allowed


def department_permissions(
    db: Session, session: dict, department: BusinessDepartment
) -> set[str]:
    """Effective permission keys for a caller in one department.

    Admins bypass. Members with a scoped role use that role. Legacy members
    without a role keep the global staff permission fallback, so existing POS
    toggles and HR grants keep working.
    """
    if is_admin_session(session):
        return set(permission_keys_for_department(department.key))
    staff_id = _session_staff_id(session)
    if not staff_id:
        return set()
    member = member_for_department(db, staff_id, department)
    if member is None:
        return set()
    scoped = _role_permission_keys(db, member)
    if scoped is not None:
        return scoped | {"shared.directory", "shared.work"}
    return (
        _legacy_permission_keys(db, department)
        | {"shared.directory", "shared.work"}
    )


def member_has_permission(
    db: Session,
    session: dict,
    department: BusinessDepartment,
    permission: str,
) -> bool:
    return permission in department_permissions(db, session, department)


def my_departments(db: Session, session: dict) -> list[BusinessDepartment]:
    """Departments visible to the caller, including sub-departments rolled up."""
    if is_admin_session(session):
        return (
            db.query(BusinessDepartment)
            .filter(BusinessDepartment.status != "archived")
            .order_by(BusinessDepartment.sort_order.asc(), BusinessDepartment.id.asc())
            .all()
        )
    staff_id = _session_staff_id(session)
    if not staff_id:
        return []
    from_filter, to_filter = _active_membership_filter()
    memberships = (
        db.query(DepartmentMember)
        .filter(
            DepartmentMember.staff_id == staff_id,
            from_filter,
            to_filter,
        )
        .all()
    )
    visible: dict[str, BusinessDepartment] = {}
    all_departments = db.query(BusinessDepartment).all()
    by_id = {row.id: row for row in all_departments}
    for membership in memberships:
        department = by_id.get(membership.department_id)
        if department is None or department.status == "archived":
            continue
        visible[department.key] = department
    for department in all_departments:
        if department.head_staff_id == staff_id and department.status != "archived":
            visible[department.key] = department
    return sorted(
        visible.values(), key=lambda row: (row.sort_order, row.id)
    )


def visible_department(db: Session, session: dict, key_or_id: str) -> BusinessDepartment | None:
    department = get_department(db, key_or_id)
    if department is None:
        return None
    if is_admin_session(session):
        return department
    return next(
        (row for row in my_departments(db, session) if row.id == department.id),
        None,
    )


def module_payload(
    module: DepartmentModule,
    permissions: set[str] | None = None,
    *,
    is_admin: bool = False,
) -> dict:
    permission = module.permission_key or ""
    can_view = is_admin or not permission or permission in (permissions or set())
    return {
        "key": module.module_key,
        "label": module.label,
        "description": module.description,
        "icon": module.icon,
        "route": module.route,
        "status": module.status,
        "sort_order": module.sort_order,
        "permission_key": module.permission_key,
        "nav_group": module.nav_group,
        "nav_order": module.nav_order,
        "is_owner": bool(module.is_owner),
        "is_shared": bool(module.is_shared),
        "can_view": can_view,
    }


def member_payload(
    member: DepartmentMember,
    staff: StaffCredential | None,
    role: DepartmentRole | None = None,
) -> dict:
    return {
        "staff_id": member.staff_id,
        "display_name": staff.display_name if staff else member.staff_id,
        "role": member.role,
        "title": member.title,
        "reports_to_staff_id": member.reports_to_staff_id,
        "department_role_id": member.department_role_id,
        "department_role": role.key if role else None,
        "department_role_name": role.name if role else None,
        "store_id": member.store_id,
        "effective_from": member.effective_from.isoformat()
        if member.effective_from
        else None,
        "effective_to": member.effective_to.isoformat()
        if member.effective_to
        else None,
        "created_at": member.created_at.isoformat() if member.created_at else None,
    }


def role_payload(role: DepartmentRole) -> dict:
    return {
        "id": role.id,
        "key": role.key,
        "name": role.name,
        "description": role.description,
        "level": role.level,
        "is_default": bool(role.is_default),
        "permissions": sorted(
            row.permission_key
            for row in role.permissions
            if row.enabled
        ),
    }


def serialize_department(
    department: BusinessDepartment,
    staff_by_id: dict[str, StaffCredential] | None = None,
    include_detail: bool = False,
    *,
    permissions: set[str] | None = None,
    is_admin: bool = False,
    session: dict | None = None,
    db: Session | None = None,
) -> dict:
    catalog = staff_by_id or {}
    head = catalog.get(department.head_staff_id or "")
    data = {
        "id": department.id,
        "key": department.key,
        "name": department.name,
        "description": department.description,
        "color": department.color,
        "icon": department.icon,
        "status": department.status,
        "sort_order": department.sort_order,
        "kind": department.kind,
        "parent_id": department.parent_id,
        "parent_key": department.parent.key if department.parent else None,
        "parent_name": department.parent.name if department.parent else None,
        "head_staff_id": department.head_staff_id,
        "head_display_name": head.display_name if head else department.head_staff_id,
        "store_id": department.store_id,
        "cost_center": department.cost_center,
        "external_system": department.external_system,
        "external_url": department.external_url,
        "integration_status": department.integration_status,
        "member_count": len(department.members or []),
        "module_count": len(
            [
                module
                for module in (department.modules or [])
                if module.status != "archived"
            ]
        ),
        "child_count": len(department.children or []),
        "created_at": department.created_at.isoformat()
        if department.created_at
        else None,
    }
    if include_detail:
        role_by_id = {role.id: role for role in (department.roles or [])}
        data["modules"] = [
            module_payload(module, permissions, is_admin=is_admin)
            for module in sorted(
                (
                    module
                    for module in (department.modules or [])
                    if module.status != "archived"
                ),
                key=lambda row: (row.sort_order, row.id),
            )
        ]
        data["members"] = [
            member_payload(
                member,
                catalog.get(member.staff_id),
                role_by_id.get(member.department_role_id or -1),
            )
            for member in sorted(department.members, key=lambda row: row.id)
        ]
        data["roles"] = [
            role_payload(role)
            for role in sorted(department.roles, key=lambda row: row.id)
        ]
        data["children"] = [
            {
                "key": child.key,
                "name": child.name,
                "kind": child.kind,
                "status": child.status,
                "module_count": len(
                    [m for m in child.modules if m.status != "archived"]
                ),
            }
            for child in sorted(
                department.children or [],
                key=lambda row: (row.sort_order, row.id),
            )
        ]
        data["permissions"] = sorted(permissions or [])
        data["access"] = {
            "is_admin": is_admin,
            "is_member": bool(session and not is_admin and permissions),
            "can_view": is_admin or bool(permissions),
            "can_manage_team": is_admin
            or f"{department.key}.manage_team" in (permissions or set()),
            "can_manage_modules": is_admin
            or f"{department.key}.manage_modules" in (permissions or set()),
            "can_approve": is_admin
            or f"{department.key}.approve" in (permissions or set()),
        }
    return data


def _next_module_sort(key: str) -> int:
    try:
        return MODULE_CATALOG.index(MODULE_BY_KEY[key]) + 1
    except ValueError:
        return 100


def add_module(
    db: Session,
    department: BusinessDepartment,
    module_key: str,
    route_override: str | None = None,
    status_override: str | None = None,
    *,
    is_owner: bool | None = None,
) -> DepartmentModule:
    definition = MODULE_BY_KEY.get(module_key)
    if definition is None:
        raise ValueError(f"Unknown department module: {module_key}.")
    existing = next(
        (row for row in department.modules if row.module_key == module_key), None
    )
    if existing is not None:
        return existing
    owner = definition["owner"] == department.key or module_key == "overview"
    module = DepartmentModule(
        department_id=department.id,
        module_key=module_key,
        label=definition["label"],
        description=definition["description"],
        icon=definition["icon"],
        route=route_override
        or (
            definition["route_template"].replace("{key}", department.key)
            if definition["route_template"]
            else None
        ),
        status=status_override or definition["default_status"],
        sort_order=_next_module_sort(module_key),
        permission_key=definition["permission_key"],
        nav_group=nav_group_for(definition),
        nav_order=_next_module_sort(module_key),
        is_owner=owner if is_owner is None else is_owner,
        is_shared=not (owner if is_owner is None else is_owner),
    )
    db.add(module)
    return module


def promote_catalog_modules(
    db: Session, department: BusinessDepartment
) -> None:
    """Bring planned modules online once the catalogue gives them a route.

    A module that was seeded while the feature was still planned keeps its old
    status and empty route forever because ``ensure_departments`` never rewrites
    existing rows. This promotes only planned rows whose catalogue definition is
    now active, so operator edits to active or archived modules are untouched.
    """
    definitions = {
        module["key"]: module for module in modules_for_department(department.key)
    }
    for row in department.modules:
        definition = definitions.get(row.module_key)
        if definition is None:
            continue
        if row.status != "planned" or definition["default_status"] != "active":
            continue
        row.status = "active"
        row.label = definition["label"]
        row.description = definition["description"]
        row.icon = definition["icon"]
        if definition["route_template"]:
            row.route = definition["route_template"].replace(
                "{key}", department.key
            )
        row.permission_key = definition["permission_key"]
        row.nav_group = nav_group_for(definition)


def sync_department_modules(
    db: Session, department: BusinessDepartment, requested_keys: list[str]
) -> None:
    requested = list(dict.fromkeys(requested_keys))
    if "overview" not in requested:
        requested.insert(0, "overview")
    unknown = [key for key in requested if key not in MODULE_BY_KEY]
    if unknown:
        raise ValueError(f"Unknown department modules: {', '.join(unknown)}.")
    existing = {row.module_key: row for row in department.modules}
    for module_key in requested:
        row = existing.get(module_key)
        if row is None:
            add_module(db, department, module_key)
            continue
        if row.status == "archived":
            definition = MODULE_BY_KEY[module_key]
            row.status = definition["default_status"]
    for module_key, row in existing.items():
        if module_key == "overview" or module_key in requested:
            continue
        row.status = "archived"


def _seed_role_permissions(
    db: Session, department: BusinessDepartment, role: DepartmentRole
) -> None:
    existing = {row.permission_key for row in role.permissions}
    for permission in role_permission_keys(department.key, role.key):
        if permission in existing:
            continue
        db.add(
            DepartmentRolePermission(
                role_id=role.id,
                permission_key=permission,
                enabled=True,
            )
        )


def ensure_department_roles(
    db: Session, department: BusinessDepartment
) -> list[DepartmentRole]:
    existing = {role.key: role for role in department.roles}
    roles: list[DepartmentRole] = []
    for preset in ROLE_PRESETS:
        role = existing.get(preset["key"])
        if role is None:
            role = DepartmentRole(
                department_id=department.id,
                key=preset["key"],
                name=preset["name"],
                description=preset["description"],
                level=preset["level"],
                is_default=preset["key"] == "member",
            )
            db.add(role)
            db.flush()
            department.roles.append(role)
        _seed_role_permissions(db, department, role)
        roles.append(role)
    return roles


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
    parent = None
    parent_key = payload.get("parent_key") or payload.get("parent")
    if parent_key:
        parent = get_department(db, str(parent_key))
        if parent is None:
            raise ValueError("Parent department was not found.")
    kind = str(payload.get("kind") or "functional").strip().lower()
    if kind not in {"executive", "functional", "store"}:
        raise ValueError("Department kind must be executive, functional or store.")
    requested_modules = payload.get("modules") or ["overview"]
    if "overview" not in requested_modules:
        requested_modules = ["overview", *requested_modules]
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
        parent_id=parent.id if parent else None,
        head_staff_id=(str(payload.get("head_staff_id") or "").strip() or None),
        kind=kind,
        store_id=payload.get("store_id"),
        cost_center=(str(payload.get("cost_center") or "").strip() or None),
        external_system=(str(payload.get("external_system") or "").strip() or None),
        external_url=(str(payload.get("external_url") or "").strip() or None),
        integration_status=str(payload.get("integration_status") or "not_connected"),
    )
    db.add(department)
    db.flush()
    ensure_department_roles(db, department)
    for module_key in requested_modules:
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
    if payload.get("kind") is not None:
        kind = str(payload["kind"]).strip().lower()
        if kind not in {"executive", "functional", "store"}:
            raise ValueError("Department kind must be executive, functional or store.")
        department.kind = kind
    if payload.get("parent_key") is not None:
        parent_key = str(payload["parent_key"]).strip()
        if not parent_key:
            department.parent_id = None
        else:
            parent = get_department(db, parent_key)
            if parent is None:
                raise ValueError("Parent department was not found.")
            if parent.id == department.id:
                raise ValueError("A department cannot be its own parent.")
            if department.key in department_descendant_keys(db, parent):
                raise ValueError("That parent would create a department cycle.")
            department.parent_id = parent.id
    if payload.get("head_staff_id") is not None:
        department.head_staff_id = (
            str(payload["head_staff_id"]).strip() or None
        )
    if payload.get("store_id") is not None:
        department.store_id = payload["store_id"]
    if payload.get("cost_center") is not None:
        department.cost_center = str(payload["cost_center"]).strip() or None
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
        sync_department_modules(db, department, list(payload["modules"]))
    try:
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise ValueError("Department could not be saved.") from exc
    db.refresh(department)
    return department


def add_member(
    db: Session,
    department: BusinessDepartment,
    staff_id: str,
    role: str = "member",
    *,
    title: str | None = None,
    reports_to_staff_id: str | None = None,
    department_role_id: int | None = None,
    store_id: int | None = None,
    effective_from: date | None = None,
    effective_to: date | None = None,
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
    scoped_role = None
    if department_role_id is not None:
        scoped_role = (
            db.query(DepartmentRole)
            .filter(
                DepartmentRole.id == department_role_id,
                DepartmentRole.department_id == department.id,
            )
            .first()
        )
        if scoped_role is None:
            raise ValueError("That department role does not belong to this department.")
    elif role == "member":
        # Plain members join on the department's seeded default role so they can
        # open their modules immediately. Heads and managers without an explicit
        # scoped role keep the legacy global-permission fallback.
        scoped_role = (
            db.query(DepartmentRole)
            .filter(
                DepartmentRole.department_id == department.id,
                DepartmentRole.is_default.is_(True),
            )
            .first()
        )
    member = DepartmentMember(
        department_id=department.id,
        staff_id=staff_id,
        role=role,
        title=(str(title).strip() or None) if title else None,
        reports_to_staff_id=(str(reports_to_staff_id).strip() or None)
        if reports_to_staff_id
        else None,
        department_role_id=scoped_role.id if scoped_role else None,
        store_id=store_id,
        effective_from=effective_from,
        effective_to=effective_to,
    )
    db.add(member)
    try:
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise ValueError("That staff member is already in this department.") from exc
    db.refresh(member)
    return member


def update_member(
    db: Session,
    department: BusinessDepartment,
    staff_id: str,
    payload: dict,
) -> DepartmentMember:
    member = next(
        (row for row in department.members if row.staff_id == staff_id), None
    )
    if member is None:
        raise ValueError("Department member not found.")
    if payload.get("role") is not None:
        role = str(payload["role"]).strip().lower()
        if role not in {"head", "manager", "member"}:
            raise ValueError("Member role must be head, manager or member.")
        member.role = role
    if payload.get("title") is not None:
        member.title = str(payload["title"]).strip() or None
    if payload.get("reports_to_staff_id") is not None:
        member.reports_to_staff_id = (
            str(payload["reports_to_staff_id"]).strip() or None
        )
    if payload.get("department_role_id") is not None:
        role_id = payload["department_role_id"]
        if role_id in (0, ""):
            member.department_role_id = None
        else:
            scoped_role = (
                db.query(DepartmentRole)
                .filter(
                    DepartmentRole.id == int(role_id),
                    DepartmentRole.department_id == department.id,
                )
                .first()
            )
            if scoped_role is None:
                raise ValueError(
                    "That department role does not belong to this department."
                )
            member.department_role_id = scoped_role.id
    if payload.get("store_id") is not None:
        member.store_id = payload["store_id"]
    if payload.get("effective_from") is not None:
        member.effective_from = payload["effective_from"]
    if payload.get("effective_to") is not None:
        member.effective_to = payload["effective_to"]
    db.commit()
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


def _validated_role_permissions(
    department: BusinessDepartment, permissions: list[str]
) -> list[str]:
    allowed = set(permission_keys_for_department(department.key))
    cleaned = [str(key).strip() for key in permissions if str(key).strip()]
    unknown = sorted({key for key in cleaned if key not in allowed})
    if unknown:
        raise ValueError(
            "Unknown department permissions: " + ", ".join(unknown) + "."
        )
    return list(dict.fromkeys(cleaned))


def create_role(
    db: Session, department: BusinessDepartment, payload: dict
) -> DepartmentRole:
    name = str(payload.get("name") or "").strip()
    if not name:
        raise ValueError("Role name is required.")
    key = slugify(payload.get("key") or name) or "custom"
    if any(role.key == key for role in department.roles):
        raise ValueError(f"A role with key '{key}' already exists.")
    level = str(payload.get("level") or "member").strip().lower()
    if level not in {"head", "manager", "member"}:
        raise ValueError("Role level must be head, manager or member.")
    permissions = _validated_role_permissions(
        department, list(payload.get("permissions") or [])
    )
    role = DepartmentRole(
        department_id=department.id,
        key=key,
        name=name[:80],
        description=(str(payload.get("description") or "").strip() or None),
        level=level,
        is_default=False,
    )
    db.add(role)
    db.flush()
    for permission in permissions:
        db.add(
            DepartmentRolePermission(
                role_id=role.id, permission_key=permission, enabled=True
            )
        )
    try:
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise ValueError("That role key is already in use.") from exc
    db.refresh(role)
    return role


def update_role(
    db: Session, department: BusinessDepartment, role: DepartmentRole, payload: dict
) -> DepartmentRole:
    if payload.get("name") is not None:
        name = str(payload["name"]).strip()
        if not name:
            raise ValueError("Role name cannot be empty.")
        role.name = name[:80]
    if payload.get("description") is not None:
        role.description = str(payload["description"]).strip() or None
    if payload.get("level") is not None:
        level = str(payload["level"]).strip().lower()
        if level not in {"head", "manager", "member"}:
            raise ValueError("Role level must be head, manager or member.")
        role.level = level
    if payload.get("permissions") is not None:
        requested = _validated_role_permissions(
            department, list(payload["permissions"])
        )
        existing = {row.permission_key: row for row in role.permissions}
        for permission in requested:
            row = existing.pop(permission, None)
            if row is None:
                db.add(
                    DepartmentRolePermission(
                        role_id=role.id, permission_key=permission, enabled=True
                    )
                )
            else:
                row.enabled = True
        for row in existing.values():
            db.delete(row)
    db.commit()
    db.refresh(role)
    return role


def delete_role(
    db: Session, department: BusinessDepartment, role: DepartmentRole
) -> None:
    if role.is_default:
        raise ValueError("The default role cannot be deleted.")
    if any(member.department_role_id == role.id for member in department.members):
        raise ValueError("Reassign members before deleting this role.")
    db.delete(role)
    db.commit()


def delete_department(db: Session, department: BusinessDepartment) -> None:
    if department.key in {
        "operations",
        "hr",
        "executive",
        "finance",
        "company",
    }:
        raise ValueError("Base departments cannot be deleted; archive them instead.")
    if department.children:
        raise ValueError("Departments with sub-departments cannot be deleted.")
    db.delete(department)
    db.commit()


def _seed_department(db: Session, spec: dict) -> BusinessDepartment:
    department = (
        db.query(BusinessDepartment)
        .filter(BusinessDepartment.key == spec["key"])
        .first()
    )
    if department is None:
        department = BusinessDepartment(
            key=spec["key"],
            name=spec["name"],
            description=spec["description"],
            color=spec["color"],
            icon=spec["icon"],
            status="active",
            sort_order=spec["sort_order"],
            kind=spec.get("kind", "functional"),
            cost_center=spec.get("cost_center"),
            external_system=spec.get("external_system"),
            integration_status=spec.get("integration_status", "not_connected"),
        )
        db.add(department)
        db.flush()
    else:
        # Backfill registry metadata without overwriting operator edits.
        if not department.kind:
            department.kind = spec.get("kind", "functional")
        if not department.cost_center and spec.get("cost_center"):
            department.cost_center = spec["cost_center"]
    return department


def ensure_departments(db: Session) -> None:
    """Idempotently seed the company registry.

    Only missing departments, modules, roles and permissions are created. Routes
    and statuses of existing modules are never rewritten at startup, apart from
    planned modules that the catalogue has since promoted to active.
    """
    specs = sorted(DEPARTMENT_SPECS, key=lambda row: row["sort_order"])
    departments = {spec["key"]: _seed_department(db, spec) for spec in specs}
    db.flush()
    for spec in specs:
        department = departments[spec["key"]]
        if spec.get("parent") and department.parent_id is None:
            parent = departments.get(spec["parent"])
            if parent is not None:
                department.parent_id = parent.id
        for module_spec in modules_for_department(spec["key"]):
            if any(
                row.module_key == module_spec["key"] for row in department.modules
            ):
                continue
            add_module(db, department, module_spec["key"])
        promote_catalog_modules(db, department)
        ensure_department_roles(db, department)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()


def catalog_payload() -> list[dict]:
    return [
        {
            "key": item["key"],
            "label": item["label"],
            "category": DEPARTMENT_BY_KEY.get(item["owner"], {}).get(
                "name", item["owner"]
            ),
            "description": item["description"],
            "default_status": item["default_status"],
            "route_template": item["route_template"],
            "permission_key": item["permission_key"],
            "owner_department": item["owner"],
            "shared_with": item["shared_with"],
            "icon": item["icon"],
            "nav_group": nav_group_for(item),
        }
        for item in MODULE_CATALOG
    ]


def access_state(db: Session, session: dict) -> dict:
    """Describe the caller's departments, roles and effective permissions."""
    departments = my_departments(db, session)
    is_admin = is_admin_session(session)
    staff_id = _session_staff_id(session)
    items = []
    for department in departments:
        permissions = department_permissions(db, session, department)
        member = (
            member_for_department(db, staff_id, department) if staff_id else None
        )
        role = None
        if member and member.department_role_id:
            role = (
                db.query(DepartmentRole)
                .filter(DepartmentRole.id == member.department_role_id)
                .first()
            )
        items.append(
            {
                "key": department.key,
                "name": department.name,
                "color": department.color,
                "icon": department.icon,
                "kind": department.kind,
                "parent_key": department.parent.key
                if department.parent
                else None,
                "role": member.role if member else ("admin" if is_admin else None),
                "department_role": role.key if role else None,
                "is_head": bool(
                    is_admin
                    or department.head_staff_id == staff_id
                    or (member and member.role == "head")
                ),
                "permissions": sorted(permissions),
            }
        )
    return {
        "is_admin": is_admin,
        "staff_id": staff_id or None,
        "departments": items,
        "permissions": {
            department["key"]: department["permissions"] for department in items
        },
    }


def navigation_payload(db: Session, session: dict) -> dict:
    """Build department-first navigation from the seeded module registry."""
    departments = my_departments(db, session)
    is_admin = is_admin_session(session)
    nav_departments = list(departments)
    company = (
        db.query(BusinessDepartment)
        .filter(BusinessDepartment.key == "company")
        .first()
    )
    if company is not None and all(
        row.id != company.id for row in nav_departments
    ):
        nav_departments.append(company)
    department_by_id = {row.id: row for row in nav_departments}
    department_permissions_map = {
        row.key: department_permissions(db, session, row) for row in departments
    }
    shared_grants = set().union(
        *department_permissions_map.values()
    ) if department_permissions_map else set()
    if company is not None:
        department_permissions_map[company.key] = shared_grants
    rows = (
        db.query(DepartmentModule)
        .filter(
            DepartmentModule.status == "active",
            DepartmentModule.route.isnot(None),
        )
        .all()
    )
    groups: dict[str, dict] = {}
    seen_routes: set[str] = set()
    root_sort = {
        spec["key"]: spec["sort_order"] for spec in DEPARTMENT_SPECS
    }
    for module in rows:
        if module.module_key == "overview":
            continue
        if "[" in (module.route or ""):
            continue
        department = department_by_id.get(module.department_id)
        if department is None:
            continue
        if module.route in seen_routes:
            continue
        permissions = department_permissions_map.get(department.key, set())
        if (
            module.permission_key
            and module.permission_key not in permissions
            and not is_admin
        ):
            continue
        definition = MODULE_BY_KEY.get(module.module_key, {})
        group_title = module.nav_group or nav_group_for(definition)
        group = groups.setdefault(
            group_title,
            {
                "title": group_title,
                "sort_order": root_sort.get(
                    department_root(department.key), 100
                ),
                "items": [],
            },
        )
        group["items"].append(
            {
                "key": module.module_key,
                "name": module.label,
                "href": module.route,
                "icon": module.icon or definition.get("icon") or "building",
                "description": module.description
                or definition.get("description")
                or "",
                "permission_key": module.permission_key,
                "department_key": department.key,
                "department_name": department.name,
                "is_shared": bool(module.is_shared),
                "sort_order": module.nav_order,
            }
        )
        seen_routes.add(module.route)
    shared = groups.pop("Shared services", None)
    access = access_state(db, session)
    access_by_key = {item["key"]: item for item in access["departments"]}
    ordered = [
        groups[key]
        for key in sorted(
            groups,
            key=lambda title: (
                groups[title]["sort_order"],
                groups[title]["title"],
            ),
        )
    ]
    for group in ordered:
        group["items"].sort(key=lambda item: (item["sort_order"], item["name"]))
    if shared is not None:
        shared["items"].sort(key=lambda item: (item["sort_order"], item["name"]))
        ordered.append(shared)
    return {
        "groups": ordered,
        "departments": [
            {
                "key": row.key,
                "name": row.name,
                "color": row.color,
                "icon": row.icon,
                "kind": row.kind,
                "parent_key": row.parent.key if row.parent else None,
                "role": access_by_key.get(row.key, {}).get("role"),
                "is_head": access_by_key.get(row.key, {}).get("is_head", False),
            }
            for row in departments
        ],
    }


def department_workspace(
    db: Session, session: dict, department: BusinessDepartment
) -> dict:
    """Assemble the department home: scores, queue, team and modules."""
    from app.services.company_work_service import (
        approvals_for_department,
        work_items_for_department,
    )
    from app.services.department_kpi_service import kpis_for_department

    staff_by_id = {
        staff.staff_id: staff for staff in db.query(StaffCredential).all()
    }
    permissions = department_permissions(db, session, department)
    data = serialize_department(
        department,
        staff_by_id=staff_by_id,
        include_detail=True,
        permissions=permissions,
        is_admin=is_admin_session(session),
        session=session,
        db=db,
    )
    data["kpis"] = kpis_for_department(db, department.key)
    data["permission_keys"] = permission_keys_for_department(department.key)
    data["catalog"] = catalog_payload()
    data["work_items"] = work_items_for_department(
        db, session, department, status="open", limit=8
    )
    data["approvals"] = approvals_for_department(
        db, session, department, status="pending", limit=8
    )
    data["needs_you_count"] = len(
        [
            item
            for item in data["work_items"] + data["approvals"]
            if item.get("needs_attention", True)
        ]
    )
    data["quick_actions"] = [
        {
            "key": "create-task",
            "label": "Create task",
            "description": "Add a task to this department's queue.",
            "permission": f"{department.key}.view",
        },
        {
            "key": "request-approval",
            "label": "Request approval",
            "description": "Raise an approval for spend, leave or a post.",
            "permission": f"{department.key}.view",
        },
        {
            "key": "invite-member",
            "label": "Add team member",
            "description": "Assign staff and a scoped role.",
            "permission": f"{department.key}.manage_team",
        },
        {
            "key": "manage-modules",
            "label": "Modules",
            "description": "Choose which modules this department owns.",
            "permission": f"{department.key}.manage_modules",
        },
    ]
    return data


def scorecard(
    db: Session, department_keys: set[str] | None = None
) -> dict:
    """Company roll-up across all active departments."""
    from app.services.department_kpi_service import kpis_for_department

    departments = (
        db.query(BusinessDepartment)
        .filter(BusinessDepartment.status == "active")
        .order_by(BusinessDepartment.sort_order.asc(), BusinessDepartment.id.asc())
        .all()
    )
    rows = []
    for department in departments:
        if department.key in SUB_DEPARTMENTS or department.key in SHARED_SERVICE_KEYS:
            continue
        if department_keys is not None and department.key not in department_keys:
            continue
        kpis = kpis_for_department(db, department.key)
        primary = kpis[0] if kpis else None
        attention = [kpi for kpi in kpis if kpi.get("tone") == "alert"]
        rows.append(
            {
                "key": department.key,
                "name": department.name,
                "color": department.color,
                "kind": department.kind,
                "head_staff_id": department.head_staff_id,
                "kpis": kpis,
                "primary": primary,
                "attention_count": len(attention),
                "status": "attention" if attention else "healthy",
            }
        )
    return {
        "generated_at": date.today().isoformat(),
        "departments": rows,
        "attention_total": sum(row["attention_count"] for row in rows),
    }


def hr_access_state(db: Session, session: dict) -> dict:
    """Backwards-compatible HR access payload used by existing HR screens."""
    hr = (
        db.query(BusinessDepartment)
        .filter(BusinessDepartment.key == "hr")
        .first()
    )
    hr_permissions = sorted(
        {
            module["permission_key"]
            for module in modules_for_department("hr")
            if module.get("permission_key", "").startswith("hr.")
        }
    )
    if session.get("role") == "admin":
        return {
            "is_admin": True,
            "is_hr_member": True,
            "hr_role": "admin",
            "permissions": {key: True for key in hr_permissions},
        }
    if hr is None:
        return {
            "is_admin": False,
            "is_hr_member": False,
            "hr_role": None,
            "permissions": {},
        }
    staff_id = _session_staff_id(session)
    member = member_for_department(db, staff_id, hr) if staff_id else None
    granted = department_permissions(db, session, hr) if member else set()
    return {
        "is_admin": False,
        "is_hr_member": member is not None,
        "hr_role": member.role if member else None,
        "permissions": {
            key: key in granted for key in hr_permissions
        },
    }
