import base64
import hashlib
import hmac
import json
import re
from datetime import datetime
from typing import Any, Mapping, Optional

from app.core.config import settings


SUPPORTED_PAYMENT_PROVIDERS = {"manual", "cashfree", "razorpay"}


class PaymentWebhookError(ValueError):
    pass


def _configured(provider: str) -> bool:
    if provider == "manual":
        return True
    if provider == "cashfree":
        return bool(settings.CASHFREE_APP_ID and settings.CASHFREE_SECRET_KEY)
    if provider == "razorpay":
        return bool(settings.RAZORPAY_KEY_ID and settings.RAZORPAY_KEY_SECRET)
    return False


def _header_value(headers: Mapping[str, str], key: str) -> Optional[str]:
    lowered_key = key.lower()
    for header_key, value in headers.items():
        if header_key.lower() == lowered_key:
            return value
    return None


def _secure_compare(actual: Optional[str], expected: Optional[str]) -> bool:
    if not actual or not expected:
        return False
    return hmac.compare_digest(actual.strip(), expected.strip())


def _json_payload(raw_body: bytes) -> dict[str, Any]:
    try:
        payload = json.loads(raw_body.decode("utf-8"))
    except (json.JSONDecodeError, UnicodeDecodeError) as exc:
        raise PaymentWebhookError("Webhook body must be valid JSON.") from exc
    if not isinstance(payload, dict):
        raise PaymentWebhookError("Webhook body must be a JSON object.")
    return payload


def _cashfree_webhook_secret() -> Optional[str]:
    return settings.CASHFREE_WEBHOOK_SECRET or settings.CASHFREE_SECRET_KEY


def _verify_cashfree_signature(raw_body: bytes, headers: Mapping[str, str]) -> None:
    secret = _cashfree_webhook_secret()
    if not secret:
        raise PaymentWebhookError("Cashfree webhook secret is not configured.")

    signature = _header_value(headers, "x-webhook-signature")
    timestamp = _header_value(headers, "x-webhook-timestamp")
    if not signature or not timestamp:
        raise PaymentWebhookError("Cashfree webhook signature headers are missing.")

    signed_payload = timestamp.encode("utf-8") + raw_body
    expected = base64.b64encode(
        hmac.new(secret.encode("utf-8"), signed_payload, hashlib.sha256).digest()
    ).decode("utf-8")
    if not _secure_compare(signature, expected):
        raise PaymentWebhookError("Cashfree webhook signature is invalid.")


def _verify_razorpay_signature(raw_body: bytes, headers: Mapping[str, str]) -> None:
    secret = settings.RAZORPAY_WEBHOOK_SECRET
    if not secret:
        raise PaymentWebhookError("Razorpay webhook secret is not configured.")

    signature = _header_value(headers, "x-razorpay-signature")
    if not signature:
        raise PaymentWebhookError("Razorpay webhook signature header is missing.")

    expected = hmac.new(secret.encode("utf-8"), raw_body, hashlib.sha256).hexdigest()
    if not _secure_compare(signature, expected):
        raise PaymentWebhookError("Razorpay webhook signature is invalid.")


def _coerce_float(value: Any) -> Optional[float]:
    if value is None or value == "":
        return None
    try:
        return round(float(value), 2)
    except (TypeError, ValueError):
        return None


def _coerce_int(value: Any) -> Optional[int]:
    if value is None or value == "":
        return None
    try:
        return int(value)
    except (TypeError, ValueError):
        return None


def _nested_value(payload: dict[str, Any], path: list[str]) -> Any:
    current: Any = payload
    for key in path:
        if not isinstance(current, dict):
            return None
        current = current.get(key)
    return current


def _extract_order_id_from_text(value: Any) -> Optional[int]:
    if value is None:
        return None
    match = re.search(r"(?:pb|order|cashfree|razorpay|manual)[_-]?(\d+)", str(value), re.I)
    if match:
        return int(match.group(1))
    return None


def _normalize_status(value: Any) -> str:
    status = str(value or "").strip().lower()
    paid_statuses = {"captured", "paid", "success", "successful"}
    failed_statuses = {"cancelled", "canceled", "expired", "failed", "failure"}
    if status in paid_statuses or status.endswith(".captured") or status.endswith(".success"):
        return "paid"
    if status in failed_statuses:
        return "failed"
    if status in {"authorized", "pending", "created", "attempted"}:
        return status
    return status or "unknown"


def _normalize_manual_webhook(payload: dict[str, Any]) -> dict[str, Any]:
    return {
        "provider": "manual",
        "event_type": payload.get("event") or "manual.payment.updated",
        "status": _normalize_status(payload.get("status") or payload.get("payment_status")),
        "order_id": _coerce_int(payload.get("order_id")),
        "provider_order_id": payload.get("provider_order_id") or payload.get("payment_session_id"),
        "provider_payment_id": payload.get("payment_reference") or payload.get("payment_id"),
        "paid_amount": _coerce_float(payload.get("paid_amount") or payload.get("amount")),
        "raw": payload,
    }


def _normalize_cashfree_webhook(payload: dict[str, Any]) -> dict[str, Any]:
    order = _nested_value(payload, ["data", "order"]) or {}
    payment = _nested_value(payload, ["data", "payment"]) or {}
    provider_order_id = (
        order.get("order_id")
        or payment.get("order_id")
        or _nested_value(payload, ["data", "order_id"])
        or payload.get("order_id")
    )
    internal_order_id = (
        _coerce_int(order.get("order_note"))
        or _coerce_int(order.get("order_tags", {}).get("order_id") if isinstance(order.get("order_tags"), dict) else None)
        or _extract_order_id_from_text(provider_order_id)
        or _coerce_int(payload.get("restaurant_order_id"))
    )
    paid_amount = _coerce_float(
        payment.get("payment_amount")
        or order.get("order_amount")
        or _nested_value(payload, ["data", "payment_amount"])
        or payload.get("paid_amount")
        or payload.get("amount")
    )
    raw_status = (
        payment.get("payment_status")
        or _nested_value(payload, ["data", "payment_status"])
        or payload.get("payment_status")
        or payload.get("type")
        or payload.get("event")
    )
    return {
        "provider": "cashfree",
        "event_type": payload.get("type") or payload.get("event") or "cashfree.payment.updated",
        "status": _normalize_status(raw_status),
        "order_id": internal_order_id,
        "provider_order_id": provider_order_id,
        "provider_payment_id": (
            payment.get("cf_payment_id")
            or payment.get("payment_id")
            or payload.get("cf_payment_id")
        ),
        "paid_amount": paid_amount,
        "raw": payload,
    }


def _normalize_razorpay_webhook(payload: dict[str, Any]) -> dict[str, Any]:
    payment = _nested_value(payload, ["payload", "payment", "entity"]) or {}
    order = _nested_value(payload, ["payload", "order", "entity"]) or {}
    payment_notes = payment.get("notes") if isinstance(payment.get("notes"), dict) else {}
    order_notes = order.get("notes") if isinstance(order.get("notes"), dict) else {}
    provider_order_id = (
        payment.get("order_id")
        or order.get("id")
        or payload.get("razorpay_order_id")
        or payload.get("order_id")
    )
    internal_order_id = (
        _coerce_int(payment_notes.get("order_id"))
        or _coerce_int(payment_notes.get("restaurant_order_id"))
        or _coerce_int(order_notes.get("order_id"))
        or _coerce_int(order_notes.get("restaurant_order_id"))
        or _extract_order_id_from_text(provider_order_id)
        or _coerce_int(payload.get("restaurant_order_id"))
    )
    amount_subunits = _coerce_float(
        payment.get("amount")
        or order.get("amount_paid")
        or order.get("amount")
    )
    paid_amount = round(amount_subunits / 100, 2) if amount_subunits is not None else _coerce_float(
        payload.get("paid_amount") or payload.get("amount")
    )
    raw_status = payment.get("status") or payload.get("event") or payload.get("status")
    return {
        "provider": "razorpay",
        "event_type": payload.get("event") or "razorpay.payment.updated",
        "status": _normalize_status(raw_status),
        "order_id": internal_order_id,
        "provider_order_id": provider_order_id,
        "provider_payment_id": payment.get("id") or payload.get("razorpay_payment_id"),
        "paid_amount": paid_amount,
        "raw": payload,
    }


def normalize_payment_webhook(
    provider: str,
    raw_body: bytes,
    headers: Mapping[str, str],
) -> dict[str, Any]:
    selected_provider = provider.strip().lower()
    if selected_provider not in SUPPORTED_PAYMENT_PROVIDERS:
        raise PaymentWebhookError("Unsupported payment provider.")

    if selected_provider == "cashfree":
        _verify_cashfree_signature(raw_body, headers)
    elif selected_provider == "razorpay":
        _verify_razorpay_signature(raw_body, headers)

    payload = _json_payload(raw_body)
    if selected_provider == "manual":
        return _normalize_manual_webhook(payload)
    if selected_provider == "cashfree":
        return _normalize_cashfree_webhook(payload)
    return _normalize_razorpay_webhook(payload)


def create_payment_session(
    *,
    order_id: int,
    amount: float,
    customer_name: Optional[str],
    customer_phone: Optional[str],
    provider: Optional[str] = None,
    return_url: Optional[str] = None,
) -> dict:
    selected_provider = (provider or settings.PAYMENT_PROVIDER or "manual").lower()
    if selected_provider not in SUPPORTED_PAYMENT_PROVIDERS:
        selected_provider = "manual"

    created_at = datetime.utcnow()
    session_id = f"{selected_provider}_{order_id}_{int(created_at.timestamp())}"
    callback_url = return_url or settings.PAYMENT_RETURN_URL
    is_configured = _configured(selected_provider)

    if selected_provider == "manual":
        status = "ready"
        checkout_url = callback_url
        message = "Manual payment session ready."
    elif is_configured:
        status = "ready"
        checkout_url = callback_url
        message = (
            f"{selected_provider.title()} credentials are configured. "
            "Replace this adapter with the provider checkout API call."
        )
    else:
        status = "configuration_required"
        checkout_url = None
        message = f"{selected_provider.title()} credentials are not configured."

    return {
        "provider": selected_provider,
        "session_id": session_id,
        "checkout_url": checkout_url,
        "status": status,
        "currency": settings.PAYMENT_CURRENCY,
        "amount": round(float(amount or 0), 2),
        "order_id": order_id,
        "customer_name": customer_name,
        "customer_phone": customer_phone,
        "created_at": created_at.isoformat(),
        "message": message,
    }
