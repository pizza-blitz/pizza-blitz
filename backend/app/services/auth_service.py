import base64
import hashlib
import hmac
import json
from datetime import datetime, timedelta
from hmac import compare_digest
from typing import Optional

from jose import JWTError, jwt

from app.core.config import settings


TOKEN_ALGORITHM = "HS256"
SESSION_ROLES = {"admin", "staff", "customer"}


class AuthError(ValueError):
    pass


def _expires_at(minutes: int) -> datetime:
    return datetime.utcnow() + timedelta(minutes=minutes)


def verify_admin_credentials(admin_id: str, password: str) -> bool:
    expected_id = settings.PIZZA_BLITZ_ADMIN_ID or settings.RESTAURANT_ADMIN_ID or "admin"
    expected_password = (
        settings.PIZZA_BLITZ_ADMIN_PASSWORD
        or settings.RESTAURANT_ADMIN_PASSWORD
        or ""
    )
    return compare_digest(admin_id.strip(), expected_id) and compare_digest(
        password,
        expected_password,
    )


def verify_staff_credentials(staff_id: str, password: str) -> bool:
    expected_id = settings.PIZZA_BLITZ_STAFF_ID or "staff"
    expected_password = settings.PIZZA_BLITZ_STAFF_PASSWORD or ""
    return compare_digest(staff_id.strip(), expected_id) and compare_digest(
        password,
        expected_password,
    )


def create_access_token(
    *,
    subject: str,
    role: str,
    display_name: Optional[str] = None,
    phone: Optional[str] = None,
    email: Optional[str] = None,
    expires_minutes: Optional[int] = None,
) -> dict:
    minutes = expires_minutes or settings.AUTH_TOKEN_EXPIRE_MINUTES
    expires_at = _expires_at(minutes)
    payload = {
        "sub": subject,
        "role": role,
        "name": display_name,
        "phone": phone,
        "email": email,
        "exp": expires_at,
        "iat": datetime.utcnow(),
    }
    token = jwt.encode(payload, settings.AUTH_SECRET_KEY, algorithm=TOKEN_ALGORITHM)
    return {
        "access_token": token,
        "token_type": "bearer",
        "expires_at": expires_at.isoformat(),
        "role": role,
        "subject": subject,
        "display_name": display_name,
        "phone": phone,
        "email": email,
    }


def decode_access_token(token: str) -> dict:
    try:
        payload = jwt.decode(
            token,
            settings.AUTH_SECRET_KEY,
            algorithms=[TOKEN_ALGORITHM],
        )
    except JWTError as exc:
        raise AuthError("Invalid or expired authentication token.") from exc

    role = payload.get("role")
    subject = payload.get("sub")
    if role not in SESSION_ROLES or not subject:
        raise AuthError("Authentication token is missing required role information.")
    return {
        "subject": subject,
        "role": role,
        "display_name": payload.get("name"),
        "phone": payload.get("phone"),
        "email": payload.get("email"),
    }


def _session_secret_candidates() -> list[str]:
    candidates = [
        settings.PIZZA_BLITZ_SESSION_SECRET,
        settings.PIZZA_BLITZ_ADMIN_PASSWORD,
        settings.RESTAURANT_ADMIN_PASSWORD,
        "pizza-blitz-local-session-secret",
    ]
    unique: list[str] = []
    for candidate in candidates:
        if candidate and candidate not in unique:
            unique.append(candidate)
    return unique


def _base64_url_decode(value: str) -> bytes:
    padded = value + "=" * ((4 - len(value) % 4) % 4)
    return base64.urlsafe_b64decode(padded.encode("utf-8"))


def _sign_portal_payload(payload_part: str, secret: str) -> str:
    signature = hmac.new(
        secret.encode("utf-8"),
        payload_part.encode("utf-8"),
        hashlib.sha256,
    ).digest()
    return base64.urlsafe_b64encode(signature).decode("utf-8").rstrip("=")


def decode_portal_session_token(
    token: str,
    expected_role: Optional[str] = None,
) -> dict:
    try:
        payload_part, signature_part = token.split(".", 1)
    except ValueError as exc:
        raise AuthError("Invalid portal session token.") from exc

    valid_signature = any(
        compare_digest(signature_part, _sign_portal_payload(payload_part, secret))
        for secret in _session_secret_candidates()
    )
    if not valid_signature:
        raise AuthError("Invalid portal session signature.")

    try:
        payload = json.loads(_base64_url_decode(payload_part).decode("utf-8"))
    except (ValueError, json.JSONDecodeError, UnicodeDecodeError) as exc:
        raise AuthError("Invalid portal session payload.") from exc

    role = payload.get("role")
    subject = payload.get("subject")
    exp = int(payload.get("exp") or 0)
    if role not in SESSION_ROLES or not subject:
        raise AuthError("Portal session is missing required role information.")
    if expected_role and role != expected_role:
        raise AuthError("Portal session role does not match.")
    if exp <= int(datetime.utcnow().timestamp()):
        raise AuthError("Portal session has expired.")

    return {
        "subject": subject,
        "role": role,
        "display_name": payload.get("displayName"),
        "phone": payload.get("phone"),
        "email": payload.get("email"),
        "source": "portal_cookie",
    }
