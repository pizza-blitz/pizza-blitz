"""TOTP two-factor authentication and recovery codes."""

import base64
import hashlib
import hmac
import secrets
import time
from datetime import datetime
from urllib.parse import quote

from sqlalchemy.orm import Session

from app.models.domain import TwoFactorCredential

TOTP_DIGITS = 6
TOTP_STEP_SECONDS = 30
TOTP_WINDOW = 1
RECOVERY_CODE_COUNT = 8


class TwoFactorError(ValueError):
    """The two-factor request cannot be completed."""


def generate_secret() -> str:
    return base64.b32encode(secrets.token_bytes(20)).decode("ascii").rstrip("=")


def _hotp(secret: str, counter: int) -> str:
    padding = "=" * ((8 - len(secret) % 8) % 8)
    key = base64.b32decode(secret.upper() + padding)
    digest = hmac.new(key, counter.to_bytes(8, "big"), hashlib.sha1).digest()
    offset = digest[-1] & 0x0F
    value = (
        ((digest[offset] & 0x7F) << 24)
        | ((digest[offset + 1] & 0xFF) << 16)
        | ((digest[offset + 2] & 0xFF) << 8)
        | (digest[offset + 3] & 0xFF)
    )
    return f"{value % 10**TOTP_DIGITS:0{TOTP_DIGITS}d}"


def totp_now(secret: str, timestamp: float | None = None) -> str:
    counter = int((timestamp if timestamp is not None else time.time()) // TOTP_STEP_SECONDS)
    return _hotp(secret, counter)


def verify_totp(secret: str, code: str, window: int = TOTP_WINDOW) -> bool:
    normalized = "".join(character for character in str(code or "") if character.isdigit())
    if len(normalized) != TOTP_DIGITS:
        return False
    counter = int(time.time() // TOTP_STEP_SECONDS)
    return any(
        hmac.compare_digest(_hotp(secret, counter + offset), normalized)
        for offset in range(-window, window + 1)
    )


def provisioning_uri(secret: str, account: str, issuer: str = "Pizza Blitz") -> str:
    label = quote(f"{issuer}:{account}")
    return (
        f"otpauth://totp/{label}?secret={secret}"
        f"&issuer={quote(issuer)}&algorithm=SHA1&digits={TOTP_DIGITS}"
        f"&period={TOTP_STEP_SECONDS}"
    )


def _hash_recovery(code: str) -> str:
    return hashlib.sha256(code.strip().upper().encode("utf-8")).hexdigest()


def generate_recovery_codes(count: int = RECOVERY_CODE_COUNT) -> list[str]:
    return [
        f"{secrets.token_hex(2).upper()}-{secrets.token_hex(2).upper()}"
        for _ in range(count)
    ]


def credential_for(db: Session, user_id: str) -> TwoFactorCredential | None:
    return (
        db.query(TwoFactorCredential)
        .filter(TwoFactorCredential.user_id == user_id)
        .first()
    )


def two_factor_required(db: Session, user_id: str) -> bool:
    credential = credential_for(db, user_id)
    return bool(credential and credential.enabled)


def status(db: Session, user_id: str) -> dict:
    credential = credential_for(db, user_id)
    return {
        "enabled": bool(credential and credential.enabled),
        "confirmed_at": credential.confirmed_at.isoformat()
        if credential and credential.confirmed_at
        else None,
        "recovery_codes_remaining": len(credential.recovery_codes or [])
        if credential and credential.enabled
        else 0,
    }


def start_setup(db: Session, user_id: str) -> dict:
    credential = credential_for(db, user_id)
    if credential and credential.enabled:
        raise TwoFactorError("Two-factor authentication is already enabled.")
    secret = generate_secret()
    if credential is None:
        credential = TwoFactorCredential(
            user_id=user_id,
            secret=secret,
            enabled=False,
            recovery_codes=[],
        )
        db.add(credential)
    else:
        credential.secret = secret
        credential.recovery_codes = []
        credential.confirmed_at = None
    db.commit()
    return {
        "secret": secret,
        "otpauth_uri": provisioning_uri(secret, user_id),
        "issuer": "Pizza Blitz",
        "account": user_id,
        "digits": TOTP_DIGITS,
        "period_seconds": TOTP_STEP_SECONDS,
    }


def confirm_setup(db: Session, user_id: str, code: str) -> list[str]:
    credential = credential_for(db, user_id)
    if credential is None:
        raise TwoFactorError("Start two-factor setup first.")
    if credential.enabled:
        raise TwoFactorError("Two-factor authentication is already enabled.")
    if not verify_totp(credential.secret, code):
        raise TwoFactorError("That authenticator code is not valid.")
    recovery_codes = generate_recovery_codes()
    credential.recovery_codes = [_hash_recovery(item) for item in recovery_codes]
    credential.enabled = True
    credential.confirmed_at = datetime.utcnow()
    db.commit()
    return recovery_codes


def verify_login_code(db: Session, user_id: str, code: str) -> bool:
    credential = credential_for(db, user_id)
    if credential is None or not credential.enabled:
        return True
    if verify_totp(credential.secret, code):
        return True
    normalized = str(code or "").strip().upper()
    hashes = list(credential.recovery_codes or [])
    for stored in hashes:
        if hmac.compare_digest(stored, _hash_recovery(normalized)):
            hashes.remove(stored)
            credential.recovery_codes = hashes
            db.commit()
            return True
    return False


def disable(db: Session, user_id: str, code: str) -> None:
    credential = credential_for(db, user_id)
    if credential is None or not credential.enabled:
        raise TwoFactorError("Two-factor authentication is not enabled.")
    if not verify_login_code(db, user_id, code):
        raise TwoFactorError("That authenticator or recovery code is not valid.")
    db.delete(credential)
    db.commit()
