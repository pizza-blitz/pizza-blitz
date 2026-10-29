from typing import Callable, Generator

from fastapi import Depends, HTTPException, Request, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.orm import Session

from app.db.session import SessionLocal
from app.services.auth_service import (
    AuthError,
    decode_access_token,
    decode_portal_session_token,
)
from app.services.department_service import (
    department_permissions,
    get_department,
    hr_access_state as build_hr_access_state,
    is_admin_session,
    member_for_department,
)
from app.services.permission_service import permission_enabled


bearer_scheme = HTTPBearer(auto_error=False)
PORTAL_SESSION_COOKIES = (
    "pb_admin_session",
    "pb_staff_session",
    "pb_customer_session",
)


def get_db() -> Generator:
    try:
        db = SessionLocal()
        yield db
    finally:
        db.close()


def session_from_request(
    request: Request,
    credentials: HTTPAuthorizationCredentials | None = None,
) -> dict:
    auth_errors: list[str] = []
    if credentials and credentials.scheme.lower() == "bearer":
        try:
            return decode_access_token(credentials.credentials)
        except AuthError as exc:
            auth_errors.append(str(exc))

    auth_header = request.headers.get("authorization") or ""
    if auth_header.lower().startswith("bearer "):
        try:
            return decode_access_token(auth_header.split(" ", 1)[1].strip())
        except AuthError as exc:
            auth_errors.append(str(exc))

    for cookie_name in PORTAL_SESSION_COOKIES:
        token = request.cookies.get(cookie_name)
        if not token:
            continue
        try:
            return decode_portal_session_token(token)
        except AuthError as exc:
            auth_errors.append(str(exc))

    detail = auth_errors[0] if auth_errors else "Authentication is required."
    raise HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail=detail,
    )


def get_current_session(
    request: Request,
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer_scheme),
) -> dict:
    return session_from_request(request, credentials)


def get_optional_session(
    request: Request,
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer_scheme),
) -> dict | None:
    """Return the caller's session when one is present, otherwise None.

    Used by endpoints that are public but expose more data to a verified
    owner or staff session than to an anonymous caller.
    """
    try:
        return session_from_request(request, credentials)
    except HTTPException:
        return None


def customer_subject_phone(session: dict | None) -> str:
    """Return the phone number carried by a customer session subject, if any."""
    subject = str((session or {}).get("subject") or "")
    if subject.startswith("customer:"):
        return subject.split("customer:", 1)[1].strip()
    return ""


def require_roles(*roles: str) -> Callable:
    allowed_roles = set(roles)

    def _dependency(session: dict = Depends(get_current_session)) -> dict:
        if session["role"] not in allowed_roles:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="This account does not have access to that resource.",
            )
        return session

    return _dependency


def require_permission(permission: str) -> Callable:
    """Allow admins and staff whose role permission is enabled."""

    def _dependency(
        session: dict = Depends(require_roles("admin", "staff")),
        db: Session = Depends(get_db),
    ) -> dict:
        if not permission_enabled(db, session["role"], permission):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"This account lacks the {permission} permission.",
            )
        return session

    return _dependency


def _session_staff_id(session: dict) -> str:
    subject = str(session.get("subject") or "")
    if subject.startswith("staff:"):
        return subject.split("staff:", 1)[1].strip()
    return ""


def require_department_permission(department_key: str, *permissions: str) -> Callable:
    """Allow admins, or members of the department with one of the permissions.

    Department members with an explicit scoped role use that role's grants.
    Members without a scoped role keep the legacy global staff-permission
    fallback so existing POS and HR toggles continue to work.
    """

    def _dependency(
        session: dict = Depends(get_current_session),
        db: Session = Depends(get_db),
    ) -> dict:
        if is_admin_session(session):
            return session
        if session.get("role") != "staff":
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="This account does not have access to that department.",
            )
        department = get_department(db, department_key)
        if department is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Department not found.",
            )
        granted = department_permissions(db, session, department)
        requested = set(permissions)
        if requested and not (granted & requested):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=(
                    "This account lacks the "
                    f"{' or '.join(sorted(requested))} permission."
                ),
            )
        enriched = dict(session)
        enriched["department_key"] = department.key
        enriched["department_id"] = department.id
        staff_id = _session_staff_id(session)
        member = (
            member_for_department(db, staff_id, department) if staff_id else None
        )
        if member is not None:
            enriched["department_role"] = member.role
            enriched["department_role_id"] = member.department_role_id
        return enriched

    return _dependency


def require_hr_permission(permission: str) -> Callable:
    """Backwards-compatible HR gate built on department permissions."""

    def _dependency(
        session: dict = Depends(require_department_permission("hr", permission)),
    ) -> dict:
        if session.get("department_role"):
            session = dict(session)
            session["hr_member_role"] = session["department_role"]
        return session

    return _dependency


def hr_access_state(db: Session, session: dict) -> dict:
    """Describe the caller's HR membership and effective permissions."""
    return build_hr_access_state(db, session)
