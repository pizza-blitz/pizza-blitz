from datetime import datetime, timedelta
from hmac import compare_digest
from typing import Optional

from jose import JWTError, jwt

from app.core.config import settings


TOKEN_ALGORITHM = "HS256"


class AuthError(ValueError):
    pass


def _expires_at(minutes: int) -> datetime:
    return datetime.utcnow() + timedelta(minutes=minutes)


def verify_admin_credentials(admin_id: str, password: str) -> bool:
    expected_id = settings.RESTAURANT_ADMIN_ID or "admin"
    expected_password = settings.RESTAURANT_ADMIN_PASSWORD or ""
    return compare_digest(admin_id.strip(), expected_id) and compare_digest(
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
    if role not in {"admin", "customer"} or not subject:
        raise AuthError("Authentication token is missing required role information.")
    return {
        "subject": subject,
        "role": role,
        "display_name": payload.get("name"),
        "phone": payload.get("phone"),
        "email": payload.get("email"),
    }
