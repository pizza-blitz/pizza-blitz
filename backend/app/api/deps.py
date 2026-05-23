from typing import Callable, Generator

from fastapi import Depends, HTTPException, Request, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from app.db.session import SessionLocal
from app.services.auth_service import (
    AuthError,
    decode_access_token,
    decode_portal_session_token,
)


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
