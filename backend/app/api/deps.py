from typing import Callable, Generator

from fastapi import Depends, HTTPException, Request, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.orm import Session

from app.db.session import SessionLocal
from app.models.domain import BusinessDepartment, DepartmentMember
from app.services.auth_service import (
    AuthError,
    decode_access_token,
    decode_portal_session_token,
)
from app.services.permission_service import permission_enabled, staff_permission_state


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


def _hr_membership(db: Session, session: dict) -> DepartmentMember | None:
    subject = str(session.get("subject") or "")
    if not subject.startswith("staff:"):
        return None
    staff_id = subject.split("staff:", 1)[1].strip()
    hr = (
        db.query(BusinessDepartment)
        .filter(BusinessDepartment.key == "hr")
        .first()
    )
    if hr is None:
        return None
    return (
        db.query(DepartmentMember)
        .filter(
            DepartmentMember.department_id == hr.id,
            DepartmentMember.staff_id == staff_id,
        )
        .first()
    )


def require_hr_permission(permission: str) -> Callable:
    """Allow admins, or HR department members with the staff permission."""

    def _dependency(
        session: dict = Depends(get_current_session),
        db: Session = Depends(get_db),
    ) -> dict:
        if session.get("role") == "admin":
            return session
        if session.get("role") != "staff":
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="This account does not have access to the HR department.",
            )
        member = _hr_membership(db, session)
        if member is None:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="You are not a member of the People & HR department.",
            )
        if not permission_enabled(db, "staff", permission):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"This account lacks the {permission} permission.",
            )
        session = dict(session)
        session["hr_member_role"] = member.role
        return session

    return _dependency


def hr_access_state(db: Session, session: dict) -> dict:
    """Describe the caller's HR membership and effective permissions."""
    if session.get("role") == "admin":
        return {
            "is_admin": True,
            "is_hr_member": True,
            "hr_role": "admin",
            "permissions": {
                row["key"]: True for row in staff_permission_state(db)
            },
        }
    member = _hr_membership(db, session)
    permissions = {
        row["key"]: bool(row["enabled"]) for row in staff_permission_state(db)
    }
    return {
        "is_admin": False,
        "is_hr_member": member is not None,
        "hr_role": member.role if member else None,
        "permissions": permissions if member is not None else {},
    }
