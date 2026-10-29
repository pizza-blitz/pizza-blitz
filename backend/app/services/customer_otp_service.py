"""Customer one-time-passcode login.

Codes are six digits, valid for five minutes, hashed with the auth secret, and
limited to five verification attempts. The ``console`` channel records a sent
code without an external provider; a ``debug_code`` is returned only in an
explicitly local environment (development, local, test) when the debug flag is
enabled, so staging and production never leak a live code.
"""

import hashlib
import hmac
import secrets
from datetime import datetime, timedelta

from sqlalchemy.orm import Session

from app.core.config import settings
from app.models.domain import Customer, CustomerOtp
from app.services.campaign_dispatch_service import send_campaign_message

MAX_ATTEMPTS = 5
PRODUCTION_ENVIRONMENTS = {"production", "prod", "staging"}
DEBUG_ENVIRONMENTS = {"development", "local", "test"}


class OtpError(ValueError):
    """The OTP request or verification cannot proceed."""


def normalize_phone(phone: str | None) -> str:
    digits = "".join(character for character in str(phone or "") if character.isdigit())
    if len(digits) < 10 or len(digits) > 15:
        raise OtpError("Enter a valid phone number with 10 to 15 digits.")
    return digits


def _hash_code(phone: str, code: str) -> str:
    payload = f"{phone}:{code}:{settings.AUTH_SECRET_KEY}".encode("utf-8")
    return hashlib.sha256(payload).hexdigest()


def _is_production() -> bool:
    return (settings.ENVIRONMENT or "").strip().lower() in PRODUCTION_ENVIRONMENTS


def _debug_codes_allowed() -> bool:
    """Only echo OTP codes in an explicitly local environment."""
    environment = (settings.ENVIRONMENT or "").strip().lower()
    return environment in DEBUG_ENVIRONMENTS and settings.CUSTOMER_OTP_DEBUG_ENABLED


def _deliver(phone: str, code: str, channel: str) -> tuple[str, str | None]:
    message = (
        f"Your Pizza Blitz verification code is {code}. "
        f"It expires in {settings.CUSTOMER_OTP_TTL_SECONDS // 60} minutes."
    )
    if channel == "console":
        return "sent", None
    try:
        result = send_campaign_message(
            channel=channel,
            destination=phone,
            message=message,
            subject="Pizza Blitz verification code",
        )
        return (result.status or "failed"), result.error
    except Exception as exc:  # noqa: BLE001 - delivery failures must not create a 500
        return "failed", str(exc)[:500]


def request_customer_otp(db: Session, phone: str) -> dict:
    normalized = normalize_phone(phone)
    channel = (settings.CUSTOMER_OTP_CHANNEL or "sms").strip().lower()
    now = datetime.utcnow()
    code = f"{secrets.randbelow(1_000_000):06d}"

    db.query(CustomerOtp).filter(
        CustomerOtp.phone == normalized,
        CustomerOtp.consumed_at.is_(None),
    ).update({CustomerOtp.consumed_at: now})
    otp = CustomerOtp(
        phone=normalized,
        code_hash=_hash_code(normalized, code),
        channel=channel,
        expires_at=now + timedelta(seconds=settings.CUSTOMER_OTP_TTL_SECONDS),
    )
    db.add(otp)
    db.commit()

    delivery, error = _deliver(normalized, code, channel)
    if delivery == "skipped" and _is_production():
        raise OtpError("Verification messages are not configured right now.")

    payload = {
        "sent": True,
        "channel": channel,
        "expires_in_seconds": settings.CUSTOMER_OTP_TTL_SECONDS,
        "delivery": delivery,
    }
    if _debug_codes_allowed() and (channel == "console" or delivery != "sent"):
        payload["debug_code"] = code
    if error:
        payload["detail"] = error
    return payload


def verify_customer_otp(db: Session, phone: str, code: str) -> Customer:
    normalized = normalize_phone(phone)
    cleaned_code = "".join(character for character in str(code or "") if character.isdigit())
    if len(cleaned_code) != 6:
        raise OtpError("Enter the 6-digit verification code.")

    otp = (
        db.query(CustomerOtp)
        .filter(CustomerOtp.phone == normalized, CustomerOtp.consumed_at.is_(None))
        .order_by(CustomerOtp.created_at.desc(), CustomerOtp.id.desc())
        .first()
    )
    if otp is None:
        raise OtpError("Request a new verification code.")
    if otp.expires_at is not None and otp.expires_at < datetime.utcnow():
        raise OtpError("That code has expired. Request a new one.")
    if int(otp.attempts or 0) >= MAX_ATTEMPTS:
        raise OtpError("Too many attempts. Request a new code.")

    if not hmac.compare_digest(otp.code_hash, _hash_code(normalized, cleaned_code)):
        otp.attempts = int(otp.attempts or 0) + 1
        db.commit()
        raise OtpError("That verification code is not correct.")

    otp.consumed_at = datetime.utcnow()
    customer = db.query(Customer).filter(Customer.phone == normalized).first()
    if customer is None:
        customer = Customer(
            phone=normalized,
            name=None,
            total_orders=0,
            total_spend=0.0,
        )
        db.add(customer)
    db.commit()
    db.refresh(customer)
    return customer
