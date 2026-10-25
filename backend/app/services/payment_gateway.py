import base64
import hashlib
import hmac
import json
import re
from datetime import datetime
from typing import Any, Mapping, Optional
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

from app.core.config import settings
from app.services.billing_settings_service import active_payment_provider
from app.services.provider_settings_service import payment_values


SUPPORTED_PAYMENT_PROVIDERS = {"manual", "direct_bank", "cashfree", "razorpay"}
ZERO_DECIMAL_CURRENCIES = {
    "BIF",
    "CLP",
    "DJF",
    "GNF",
    "JPY",
    "KMF",
    "KRW",
    "MGA",
    "PYG",
    "RWF",
    "UGX",
    "VND",
    "VUV",
    "XAF",
    "XOF",
    "XPF",
}


class PaymentWebhookError(ValueError):
    pass


def _configured(provider: str) -> bool:
    values = payment_values()
    if provider == "manual":
        return True
    if provider == "direct_bank":
        has_upi = bool(values.get("DIRECT_BANK_UPI_ID"))
        has_bank_account = bool(
            values.get("DIRECT_BANK_ACCOUNT_NAME")
            and values.get("DIRECT_BANK_ACCOUNT_NUMBER")
            and values.get("DIRECT_BANK_IFSC")
        )
        return has_upi or has_bank_account
    if provider == "cashfree":
        return bool(values.get("CASHFREE_APP_ID") and values.get("CASHFREE_SECRET_KEY"))
    if provider == "razorpay":
        return bool(values.get("RAZORPAY_KEY_ID") and values.get("RAZORPAY_KEY_SECRET"))
    return False


def payment_provider_status(provider: Optional[str] = None) -> dict[str, Any]:
    selected_provider = (provider or active_payment_provider() or "manual").strip().lower()
    if selected_provider not in SUPPORTED_PAYMENT_PROVIDERS:
        selected_provider = "manual"

    checkout_settings = {
        "manual": [],
        "direct_bank": [],
        "cashfree": ["CASHFREE_APP_ID", "CASHFREE_SECRET_KEY"],
        "razorpay": ["RAZORPAY_KEY_ID", "RAZORPAY_KEY_SECRET"],
    }[selected_provider]
    webhook_settings = {
        "manual": [],
        "direct_bank": [],
        "cashfree": ["CASHFREE_WEBHOOK_SECRET"],
        "razorpay": ["RAZORPAY_WEBHOOK_SECRET"],
    }[selected_provider]
    stored_values = payment_values()
    values = {
        "CASHFREE_APP_ID": stored_values.get("CASHFREE_APP_ID"),
        "CASHFREE_SECRET_KEY": stored_values.get("CASHFREE_SECRET_KEY"),
        "CASHFREE_WEBHOOK_SECRET": stored_values.get("CASHFREE_WEBHOOK_SECRET"),
        "RAZORPAY_KEY_ID": stored_values.get("RAZORPAY_KEY_ID"),
        "RAZORPAY_KEY_SECRET": stored_values.get("RAZORPAY_KEY_SECRET"),
        "RAZORPAY_WEBHOOK_SECRET": stored_values.get("RAZORPAY_WEBHOOK_SECRET"),
        "DIRECT_BANK_UPI_ID": stored_values.get("DIRECT_BANK_UPI_ID"),
        "DIRECT_BANK_ACCOUNT_NAME": stored_values.get("DIRECT_BANK_ACCOUNT_NAME"),
        "DIRECT_BANK_ACCOUNT_NUMBER": stored_values.get("DIRECT_BANK_ACCOUNT_NUMBER"),
        "DIRECT_BANK_IFSC": stored_values.get("DIRECT_BANK_IFSC"),
    }
    if selected_provider == "direct_bank":
        has_upi = bool(values["DIRECT_BANK_UPI_ID"])
        has_bank_account = bool(
            values["DIRECT_BANK_ACCOUNT_NAME"]
            and values["DIRECT_BANK_ACCOUNT_NUMBER"]
            and values["DIRECT_BANK_IFSC"]
        )
        if not has_upi and not has_bank_account:
            checkout_settings = ["DIRECT_BANK_UPI_ID or DIRECT_BANK_ACCOUNT_NAME + DIRECT_BANK_ACCOUNT_NUMBER + DIRECT_BANK_IFSC"]
    missing_checkout = [name for name in checkout_settings if not values.get(name)]
    missing_webhook = [name for name in webhook_settings if not values.get(name)]

    return {
        "provider": selected_provider,
        "currency": settings.PAYMENT_CURRENCY,
        "environment": provider_environment(selected_provider),
        "return_url": settings.PAYMENT_RETURN_URL,
        "checkout_configured": selected_provider == "manual" or not missing_checkout,
        "webhook_configured": selected_provider == "manual" or not missing_webhook,
        "missing_checkout_settings": missing_checkout,
        "missing_webhook_settings": missing_webhook,
        "session_endpoint": "/api/v1/restaurant/orders/{order_id}/payment-session",
        "webhook_endpoint": f"/api/v1/restaurant/orders/payments/webhook/{selected_provider}",
        "mode": "manual"
        if selected_provider == "manual"
        else "staff_verified_bank_transfer"
        if selected_provider == "direct_bank"
        else "provider_order_creation",
    }


def public_payment_checkout_status(provider: Optional[str] = None) -> dict[str, Any]:
    provider_status = payment_provider_status(provider)
    selected_provider = provider_status["provider"]
    prepaid_available = (
        selected_provider in {"direct_bank", "cashfree", "razorpay"}
        and provider_status["checkout_configured"]
        and provider_status["webhook_configured"]
    )

    if not prepaid_available:
        return {
            "cash_available": True,
            "prepaid_available": False,
            "provider": None,
            "mode": "cash_only",
            "label": "Online payment activating",
            "message": "Online payment is activating. Please pay by cash at pickup or delivery.",
        }

    if selected_provider == "direct_bank":
        return {
            "cash_available": True,
            "prepaid_available": True,
            "provider": selected_provider,
            "mode": "staff_verified_bank_transfer",
            "label": "Bank transfer",
            "message": "Bank transfer is available. The store team verifies the payment reference before settlement.",
        }

    return {
        "cash_available": True,
        "prepaid_available": True,
        "provider": selected_provider,
        "mode": "online_gateway",
        "label": "Pay online",
        "message": "Secure online prepaid checkout is available.",
    }


def provider_environment(provider: str) -> str:
    values = payment_values()
    if provider == "cashfree":
        return (values.get("CASHFREE_ENVIRONMENT") or "sandbox").strip().lower()
    if provider == "razorpay":
        return "live_or_test_key"
    if provider == "direct_bank":
        return "restaurant_bank_account"
    return "local_manual"


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
    values = payment_values()
    return values.get("CASHFREE_WEBHOOK_SECRET") or values.get("CASHFREE_SECRET_KEY")


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
    secret = payment_values().get("RAZORPAY_WEBHOOK_SECRET")
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
    match = re.search(r"(?:pb|order|cashfree|razorpay|manual|bank|upi)[_-]?(\d+)", str(value), re.I)
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
        "provider": str(payload.get("provider") or "manual").strip().lower() or "manual",
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
    if selected_provider == "direct_bank":
        event = _normalize_manual_webhook(payload)
        event["provider"] = "direct_bank"
        event["event_type"] = payload.get("event") or "direct_bank.payment.updated"
        return event
    if selected_provider == "cashfree":
        return _normalize_cashfree_webhook(payload)
    return _normalize_razorpay_webhook(payload)


def _safe_provider_order_id(prefix: str, order_id: int, created_at: datetime) -> str:
    raw_value = f"{prefix}_{order_id}_{int(created_at.timestamp())}"
    return re.sub(r"[^A-Za-z0-9_-]", "_", raw_value)[:45]


def _customer_id(order_id: int, customer_phone: Optional[str]) -> str:
    digits = re.sub(r"\D", "", customer_phone or "")
    return f"PB{digits[-10:]}" if digits else f"PB_GUEST_{order_id}"


def _customer_phone(customer_phone: Optional[str]) -> str:
    digits = re.sub(r"\D", "", customer_phone or "")
    if len(digits) >= 10:
        return digits[-10:]
    return "9999999999"


def _provider_error_message(provider: str, status_code: int, payload: Any) -> str:
    if isinstance(payload, dict):
        for key in ("message", "error_description", "error", "reason"):
            value = payload.get(key)
            if value:
                return f"{provider.title()} returned {status_code}: {value}"
        nested_error = payload.get("error")
        if isinstance(nested_error, dict):
            description = nested_error.get("description") or nested_error.get("message")
            if description:
                return f"{provider.title()} returned {status_code}: {description}"
    if isinstance(payload, str) and payload.strip():
        return f"{provider.title()} returned {status_code}: {payload.strip()[:220]}"
    if status_code <= 0:
        return f"{provider.title()} could not be reached."
    return f"{provider.title()} returned HTTP {status_code}."


def _post_json(url: str, payload: dict[str, Any], headers: dict[str, str]) -> tuple[int, Any]:
    request = Request(
        url,
        data=json.dumps(payload).encode("utf-8"),
        headers={"Content-Type": "application/json", **headers},
        method="POST",
    )
    try:
        with urlopen(request, timeout=20) as response:
            raw_body = response.read().decode("utf-8")
            return response.status, json.loads(raw_body) if raw_body else {}
    except HTTPError as exc:
        raw_body = exc.read().decode("utf-8", errors="replace")
        try:
            return exc.code, json.loads(raw_body) if raw_body else {}
        except json.JSONDecodeError:
            return exc.code, raw_body
    except (URLError, TimeoutError) as exc:
        return 0, {"message": str(exc)}


def _cashfree_base_url() -> str:
    configured_url = (settings.CASHFREE_BASE_URL or "").strip().rstrip("/")
    if configured_url:
        return configured_url
    environment = (payment_values().get("CASHFREE_ENVIRONMENT") or "sandbox").strip().lower()
    if environment == "production":
        return "https://api.cashfree.com/pg"
    return "https://sandbox.cashfree.com/pg"


def _amount_in_subunits(amount: float, currency: str) -> int:
    normalized_currency = (currency or "INR").strip().upper()
    multiplier = 1 if normalized_currency in ZERO_DECIMAL_CURRENCIES else 100
    return int(round(float(amount or 0) * multiplier))


def _base_session(
    *,
    provider: str,
    order_id: int,
    amount: float,
    customer_name: Optional[str],
    customer_phone: Optional[str],
    created_at: datetime,
    session_id: str,
    return_url: Optional[str],
) -> dict[str, Any]:
    return {
        "provider": provider,
        "session_id": session_id,
        "provider_order_id": session_id,
        "payment_session_id": session_id,
        "checkout_url": return_url,
        "checkout_payload": None,
        "status": "ready",
        "currency": settings.PAYMENT_CURRENCY,
        "amount": round(float(amount or 0), 2),
        "order_id": order_id,
        "customer_name": customer_name,
        "customer_phone": customer_phone,
        "created_at": created_at.isoformat(),
        "message": "Manual payment session ready.",
    }


def _configuration_required_session(
    *,
    provider: str,
    order_id: int,
    amount: float,
    customer_name: Optional[str],
    customer_phone: Optional[str],
    created_at: datetime,
    session_id: str,
) -> dict[str, Any]:
    session = _base_session(
        provider=provider,
        order_id=order_id,
        amount=amount,
        customer_name=customer_name,
        customer_phone=customer_phone,
        created_at=created_at,
        session_id=session_id,
        return_url=None,
    )
    session.update(
        {
            "checkout_url": None,
            "payment_session_id": None,
            "status": "configuration_required",
            "message": f"{provider.title()} credentials are not configured.",
        }
    )
    return session


def _provider_error_session(
    *,
    provider: str,
    order_id: int,
    amount: float,
    customer_name: Optional[str],
    customer_phone: Optional[str],
    created_at: datetime,
    session_id: str,
    status_code: int,
    response_payload: Any,
) -> dict[str, Any]:
    session = _base_session(
        provider=provider,
        order_id=order_id,
        amount=amount,
        customer_name=customer_name,
        customer_phone=customer_phone,
        created_at=created_at,
        session_id=session_id,
        return_url=None,
    )
    session.update(
        {
            "checkout_url": None,
            "payment_session_id": None,
            "status": "provider_error",
            "provider_status_code": status_code,
            "message": _provider_error_message(provider, status_code, response_payload),
        }
    )
    return session


def _create_direct_bank_session(
    *,
    order_id: int,
    amount: float,
    customer_name: Optional[str],
    customer_phone: Optional[str],
    created_at: datetime,
    return_url: Optional[str],
) -> dict[str, Any]:
    session_id = _safe_provider_order_id("BANK", order_id, created_at)
    values = payment_values()
    session = _base_session(
        provider="direct_bank",
        order_id=order_id,
        amount=amount,
        customer_name=customer_name,
        customer_phone=customer_phone,
        created_at=created_at,
        session_id=session_id,
        return_url=return_url,
    )
    session.update(
        {
            "checkout_url": None,
            "checkout_payload": {
                "provider": "direct_bank",
                "mode": "staff_verified_bank_transfer",
                "upi_id": values.get("DIRECT_BANK_UPI_ID"),
                "account_name": values.get("DIRECT_BANK_ACCOUNT_NAME"),
                "account_number": values.get("DIRECT_BANK_ACCOUNT_NUMBER"),
                "ifsc": values.get("DIRECT_BANK_IFSC"),
                "qr_url": values.get("DIRECT_BANK_QR_URL"),
                "instructions": (
                    "Pay by UPI or bank transfer, then share the reference with the counter team. "
                    "The order is marked paid only after staff verification."
                ),
            },
            "message": "Direct bank payment instructions ready. Staff verification is required before settlement.",
        }
    )
    return session


def _create_cashfree_session(
    *,
    order_id: int,
    amount: float,
    customer_name: Optional[str],
    customer_phone: Optional[str],
    created_at: datetime,
    return_url: Optional[str],
) -> dict[str, Any]:
    provider_order_id = _safe_provider_order_id("PB", order_id, created_at)
    values = payment_values()
    payload: dict[str, Any] = {
        "order_id": provider_order_id,
        "order_amount": round(float(amount or 0), 2),
        "order_currency": settings.PAYMENT_CURRENCY,
        "customer_details": {
            "customer_id": _customer_id(order_id, customer_phone),
            "customer_phone": _customer_phone(customer_phone),
        },
        "order_meta": {
            "return_url": return_url or settings.PAYMENT_RETURN_URL,
        },
        "order_note": str(order_id),
        "order_tags": {
            "order_id": str(order_id),
            "source": "pizza_blitz",
        },
    }
    if customer_name:
        payload["customer_details"]["customer_name"] = customer_name

    status_code, response_payload = _post_json(
        f"{_cashfree_base_url()}/orders",
        payload,
        {
            "x-api-version": settings.CASHFREE_API_VERSION,
            "x-client-id": values.get("CASHFREE_APP_ID", ""),
            "x-client-secret": values.get("CASHFREE_SECRET_KEY", ""),
        },
    )
    if not (200 <= status_code < 300) or not isinstance(response_payload, dict):
        return _provider_error_session(
            provider="cashfree",
            order_id=order_id,
            amount=amount,
            customer_name=customer_name,
            customer_phone=customer_phone,
            created_at=created_at,
            session_id=provider_order_id,
            status_code=status_code,
            response_payload=response_payload,
        )

    payment_session_id = response_payload.get("payment_session_id")
    if not payment_session_id:
        return _provider_error_session(
            provider="cashfree",
            order_id=order_id,
            amount=amount,
            customer_name=customer_name,
            customer_phone=customer_phone,
            created_at=created_at,
            session_id=provider_order_id,
            status_code=status_code,
            response_payload=response_payload,
        )

    session = _base_session(
        provider="cashfree",
        order_id=order_id,
        amount=amount,
        customer_name=customer_name,
        customer_phone=customer_phone,
        created_at=created_at,
        session_id=str(response_payload.get("order_id") or provider_order_id),
        return_url=response_payload.get("payment_link"),
    )
    session.update(
        {
            "provider_order_id": str(response_payload.get("order_id") or provider_order_id),
            "payment_session_id": str(payment_session_id),
            "checkout_payload": {
                "provider": "cashfree",
                "mode": provider_environment("cashfree"),
                "payment_session_id": str(payment_session_id),
                "provider_order_id": str(response_payload.get("order_id") or provider_order_id),
            },
            "message": "Cashfree order created.",
        }
    )
    return session


def _create_razorpay_session(
    *,
    order_id: int,
    amount: float,
    customer_name: Optional[str],
    customer_phone: Optional[str],
    created_at: datetime,
) -> dict[str, Any]:
    currency = settings.PAYMENT_CURRENCY
    values = payment_values()
    amount_subunits = _amount_in_subunits(amount, currency)
    receipt = _safe_provider_order_id("PB", order_id, created_at)
    payload: dict[str, Any] = {
        "amount": amount_subunits,
        "currency": currency,
        "receipt": receipt,
        "notes": {
            "order_id": str(order_id),
            "restaurant_order_id": str(order_id),
            "source": "pizza_blitz",
        },
    }
    auth_token = base64.b64encode(
        f"{values.get('RAZORPAY_KEY_ID', '')}:{values.get('RAZORPAY_KEY_SECRET', '')}".encode("utf-8")
    ).decode("utf-8")
    base_url = (settings.RAZORPAY_BASE_URL or "https://api.razorpay.com").rstrip("/")
    status_code, response_payload = _post_json(
        f"{base_url}/v1/orders",
        payload,
        {"Authorization": f"Basic {auth_token}"},
    )
    if not (200 <= status_code < 300) or not isinstance(response_payload, dict):
        return _provider_error_session(
            provider="razorpay",
            order_id=order_id,
            amount=amount,
            customer_name=customer_name,
            customer_phone=customer_phone,
            created_at=created_at,
            session_id=receipt,
            status_code=status_code,
            response_payload=response_payload,
        )

    provider_order_id = response_payload.get("id")
    if not provider_order_id:
        return _provider_error_session(
            provider="razorpay",
            order_id=order_id,
            amount=amount,
            customer_name=customer_name,
            customer_phone=customer_phone,
            created_at=created_at,
            session_id=receipt,
            status_code=status_code,
            response_payload=response_payload,
        )

    session = _base_session(
        provider="razorpay",
        order_id=order_id,
        amount=amount,
        customer_name=customer_name,
        customer_phone=customer_phone,
        created_at=created_at,
        session_id=str(provider_order_id),
        return_url=None,
    )
    session.update(
        {
            "provider_order_id": str(provider_order_id),
            "payment_session_id": str(provider_order_id),
            "checkout_url": None,
            "checkout_payload": {
                "provider": "razorpay",
                "key": values.get("RAZORPAY_KEY_ID"),
                "amount": response_payload.get("amount") or amount_subunits,
                "currency": response_payload.get("currency") or currency,
                "name": "Pizza Blitz",
                "description": f"Order #{order_id}",
                "order_id": str(provider_order_id),
                "prefill": {
                    "name": customer_name or "",
                    "contact": _customer_phone(customer_phone),
                },
            },
            "message": "Razorpay order created.",
        }
    )
    return session


def verify_razorpay_checkout_signature(
    *,
    provider_order_id: str,
    provider_payment_id: str,
    provider_signature: str,
) -> bool:
    values = payment_values()
    secret = values.get("RAZORPAY_KEY_SECRET")
    if not secret:
        return False
    signed_value = f"{provider_order_id}|{provider_payment_id}"
    expected = hmac.new(
        secret.encode("utf-8"),
        signed_value.encode("utf-8"),
        hashlib.sha256,
    ).hexdigest()
    return _secure_compare(provider_signature, expected)


def create_payment_session(
    *,
    order_id: int,
    amount: float,
    customer_name: Optional[str],
    customer_phone: Optional[str],
    provider: Optional[str] = None,
    return_url: Optional[str] = None,
) -> dict:
    selected_provider = (provider or active_payment_provider() or "manual").lower()
    if selected_provider not in SUPPORTED_PAYMENT_PROVIDERS:
        selected_provider = "manual"

    created_at = datetime.utcnow()
    session_id = f"{selected_provider}_{order_id}_{int(created_at.timestamp())}"
    callback_url = return_url or settings.PAYMENT_RETURN_URL
    is_configured = _configured(selected_provider)

    if selected_provider == "manual":
        return _base_session(
            provider=selected_provider,
            order_id=order_id,
            amount=amount,
            customer_name=customer_name,
            customer_phone=customer_phone,
            created_at=created_at,
            session_id=session_id,
            return_url=callback_url,
        )

    if not is_configured:
        return _configuration_required_session(
            provider=selected_provider,
            order_id=order_id,
            amount=amount,
            customer_name=customer_name,
            customer_phone=customer_phone,
            created_at=created_at,
            session_id=session_id,
        )

    if selected_provider == "direct_bank":
        return _create_direct_bank_session(
            order_id=order_id,
            amount=amount,
            customer_name=customer_name,
            customer_phone=customer_phone,
            created_at=created_at,
            return_url=callback_url,
        )

    if selected_provider == "cashfree":
        return _create_cashfree_session(
            order_id=order_id,
            amount=amount,
            customer_name=customer_name,
            customer_phone=customer_phone,
            created_at=created_at,
            return_url=callback_url,
        )

    return _create_razorpay_session(
        order_id=order_id,
        amount=amount,
        customer_name=customer_name,
        customer_phone=customer_phone,
        created_at=created_at,
    )
