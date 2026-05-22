from datetime import datetime
from typing import Optional

from app.core.config import settings


SUPPORTED_PAYMENT_PROVIDERS = {"manual", "cashfree", "razorpay"}


def _configured(provider: str) -> bool:
    if provider == "manual":
        return True
    if provider == "cashfree":
        return bool(settings.CASHFREE_APP_ID and settings.CASHFREE_SECRET_KEY)
    if provider == "razorpay":
        return bool(settings.RAZORPAY_KEY_ID and settings.RAZORPAY_KEY_SECRET)
    return False


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
