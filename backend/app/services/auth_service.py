import base64
import hashlib
import hmac
import json
import os
import secrets
from datetime import datetime, timedelta
from hmac import compare_digest
from typing import Optional

from jose import JWTError, jwt
from sqlalchemy.orm import Session

from app.core.config import settings
from app.models.domain import AdminCredential, StaffCredential


TOKEN_ALGORITHM = "HS256"  # noqa: S105 - algorithm name, not a secret
SESSION_ROLES = {"admin", "staff", "customer"}
PASSWORD_SCHEME = "pbkdf2_sha256"  # noqa: S105 - hashing scheme name, not a secret
PASSWORD_ITERATIONS = 260000


class AuthError(ValueError):
    pass


def _is_cloud_runtime() -> bool:
    return settings.ENVIRONMENT.lower() not in {"development", "local", "test"} or os.getenv("VERCEL") == "1"


def _expires_at(minutes: int) -> datetime:
    return datetime.utcnow() + timedelta(minutes=minutes)


def verify_admin_credentials(admin_id: str, password: str, db: Session | None = None) -> bool:
    if db is not None and verify_managed_admin_credentials(
        admin_id=admin_id,
        password=password,
        db=db,
    ):
        return True

    if _is_cloud_runtime() and not (
        os.getenv("PIZZA_BLITZ_ADMIN_ID") and os.getenv("PIZZA_BLITZ_ADMIN_PASSWORD")
    ):
        return False
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


def _hash_password(password: str, salt: str | None = None) -> str:
    selected_salt = salt or secrets.token_hex(16)
    digest = hashlib.pbkdf2_hmac(
        "sha256",
        password.encode("utf-8"),
        selected_salt.encode("utf-8"),
        PASSWORD_ITERATIONS,
    ).hex()
    return f"{PASSWORD_SCHEME}${PASSWORD_ITERATIONS}${selected_salt}${digest}"


def _verify_password(password: str, stored_hash: str) -> bool:
    try:
        scheme, iterations, salt, expected_digest = stored_hash.split("$", 3)
        if scheme != PASSWORD_SCHEME:
            return False
        digest = hashlib.pbkdf2_hmac(
            "sha256",
            password.encode("utf-8"),
            salt.encode("utf-8"),
            int(iterations),
        ).hex()
        return compare_digest(digest, expected_digest)
    except (ValueError, TypeError):
        return False


def has_managed_admin_credentials(db: Session) -> bool:
    return (
        db.query(AdminCredential)
        .filter(AdminCredential.is_active.is_(True))
        .first()
        is not None
    )


def managed_admin_credential_status(db: Session) -> dict:
    credential = (
        db.query(AdminCredential)
        .order_by(AdminCredential.is_active.desc(), AdminCredential.updated_at.desc())
        .first()
    )
    if credential is None:
        return {
            "configured": False,
            "source": "environment",
            "admin_id": settings.PIZZA_BLITZ_ADMIN_ID,
            "display_name": settings.PIZZA_BLITZ_ADMIN_NAME,
            "is_active": False,
            "must_rotate": False,
            "updated_at": None,
            "last_login_at": None,
            "password_policy": "Minimum 8 characters. Store only a salted PBKDF2 hash.",
            "next_action": "Save a master admin ID and password to activate managed rotation.",
        }
    return {
        "configured": bool(credential.is_active),
        "source": "managed",
        "admin_id": credential.admin_id,
        "display_name": credential.display_name,
        "is_active": bool(credential.is_active),
        "must_rotate": bool(credential.must_rotate),
        "updated_at": credential.updated_at.isoformat() if credential.updated_at else None,
        "last_login_at": credential.last_login_at.isoformat() if credential.last_login_at else None,
        "password_policy": "Minimum 8 characters. Store only a salted PBKDF2 hash.",
        "next_action": "The master admin can sign in with this managed ID. Keep environment credentials as recovery access.",
    }


def upsert_managed_admin_credential(
    *,
    db: Session,
    admin_id: str,
    password: str,
    display_name: str = "Restaurant Admin",
    is_active: bool = True,
) -> AdminCredential:
    clean_admin_id = admin_id.strip()
    clean_display_name = display_name.strip() or "Restaurant Admin"
    credential = (
        db.query(AdminCredential)
        .order_by(AdminCredential.is_active.desc(), AdminCredential.updated_at.desc())
        .first()
    )
    if credential is None:
        credential = AdminCredential(admin_id=clean_admin_id)
        db.add(credential)
    else:
        credential.admin_id = clean_admin_id
    credential.display_name = clean_display_name
    credential.password_hash = _hash_password(password)
    credential.is_active = is_active
    credential.must_rotate = False
    credential.updated_at = datetime.utcnow()
    db.commit()
    db.refresh(credential)
    return credential


def verify_managed_admin_credentials(
    *,
    admin_id: str,
    password: str,
    db: Session,
    mark_login: bool = False,
) -> AdminCredential | None:
    credential = (
        db.query(AdminCredential)
        .filter(
            AdminCredential.admin_id == admin_id.strip(),
            AdminCredential.is_active.is_(True),
        )
        .first()
    )
    if credential is None:
        return None
    if not _verify_password(password, credential.password_hash):
        return None
    if mark_login:
        credential.last_login_at = datetime.utcnow()
        db.commit()
        db.refresh(credential)
    return credential


def has_managed_staff_credentials(db: Session) -> bool:
    return (
        db.query(StaffCredential)
        .filter(StaffCredential.is_active.is_(True))
        .first()
        is not None
    )


def managed_staff_credential_status(db: Session) -> dict:
    credential = (
        db.query(StaffCredential)
        .order_by(StaffCredential.is_active.desc(), StaffCredential.updated_at.desc())
        .first()
    )
    if credential is None:
        return {
            "configured": False,
            "source": "managed",
            "staff_id": None,
            "display_name": None,
            "is_active": False,
            "must_rotate": False,
            "updated_at": None,
            "last_login_at": None,
            "password_policy": "Minimum 8 characters. Store only a salted PBKDF2 hash.",
            "next_action": "Create a counter staff ID and password from Settings.",
        }
    return {
        "configured": bool(credential.is_active),
        "source": "managed",
        "staff_id": credential.staff_id,
        "display_name": credential.display_name,
        "is_active": bool(credential.is_active),
        "must_rotate": bool(credential.must_rotate),
        "updated_at": credential.updated_at.isoformat() if credential.updated_at else None,
        "last_login_at": credential.last_login_at.isoformat() if credential.last_login_at else None,
        "password_policy": "Minimum 8 characters. Store only a salted PBKDF2 hash.",
        "next_action": "Counter staff can sign in from the staff login once active.",
    }


def upsert_managed_staff_credential(
    *,
    db: Session,
    staff_id: str,
    password: str,
    display_name: str = "Counter Staff",
    is_active: bool = True,
) -> StaffCredential:
    clean_staff_id = staff_id.strip()
    clean_display_name = display_name.strip() or "Counter Staff"
    credential = (
        db.query(StaffCredential)
        .filter(StaffCredential.staff_id == clean_staff_id)
        .first()
    )
    if credential is None:
        credential = StaffCredential(staff_id=clean_staff_id)
        db.add(credential)
    credential.display_name = clean_display_name
    credential.password_hash = _hash_password(password)
    credential.is_active = is_active
    credential.must_rotate = False
    credential.updated_at = datetime.utcnow()
    db.commit()
    db.refresh(credential)
    return credential


def verify_managed_staff_credentials(
    *,
    staff_id: str,
    password: str,
    db: Session,
    mark_login: bool = False,
) -> StaffCredential | None:
    credential = (
        db.query(StaffCredential)
        .filter(
            StaffCredential.staff_id == staff_id.strip(),
            StaffCredential.is_active.is_(True),
        )
        .first()
    )
    if credential is None:
        return None
    if not _verify_password(password, credential.password_hash):
        return None
    if mark_login:
        credential.last_login_at = datetime.utcnow()
        db.commit()
        db.refresh(credential)
    return credential


def verify_staff_credentials(staff_id: str, password: str, db: Session | None = None) -> bool:
    if db is not None and verify_managed_staff_credentials(
        staff_id=staff_id,
        password=password,
        db=db,
    ):
        return True

    if _is_cloud_runtime() and not (
        os.getenv("PIZZA_BLITZ_STAFF_ID") and os.getenv("PIZZA_BLITZ_STAFF_PASSWORD")
    ):
        return False
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
    purpose: Optional[str] = None,
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
    if purpose:
        payload["purpose"] = purpose
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


def decode_access_token(
    token: str, *, allow_two_factor_challenge: bool = False
) -> dict:
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
    purpose = payload.get("purpose")
    if purpose == "2fa" and not allow_two_factor_challenge:
        raise AuthError("Two-factor verification is required.")
    return {
        "subject": subject,
        "role": role,
        "display_name": payload.get("name"),
        "phone": payload.get("phone"),
        "email": payload.get("email"),
        "purpose": purpose,
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
