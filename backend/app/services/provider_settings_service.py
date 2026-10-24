"""Encrypted provider credentials with environment fallback.

Stored values override environment variables field by field. A provider with
no database row is reported as using the environment, so existing deployments
keep working unchanged.
"""

import base64
import hashlib
import json
from typing import Any

from cryptography.fernet import Fernet, InvalidToken
from sqlalchemy.orm import Session

from app.core.config import settings
from app.db.session import SessionLocal
from app.models.domain import ProviderSetting

PROVIDERS = {
    "email": {
        "label": "Transactional email",
        "group": "Messaging",
        "description": "Resend email for campaigns, OTPs and receipts.",
        "enabled_env": "CAMPAIGN_SEND_ENABLED",
        "env_enabled": lambda: settings.CAMPAIGN_SEND_ENABLED,
        "fields": [
            {"key": "RESEND_API_KEY", "label": "API key", "secret": True, "required": True},
            {"key": "RESEND_FROM_EMAIL", "label": "From email", "secret": False, "required": True},
        ],
    },
    "sms": {
        "label": "SMS",
        "group": "Messaging",
        "description": "Twilio SMS for campaigns, OTPs and order updates.",
        "enabled_env": "CAMPAIGN_SEND_ENABLED",
        "env_enabled": lambda: settings.CAMPAIGN_SEND_ENABLED,
        "fields": [
            {"key": "TWILIO_ACCOUNT_SID", "label": "Account SID", "secret": False, "required": True},
            {"key": "TWILIO_AUTH_TOKEN", "label": "Auth token", "secret": True, "required": True},
            {"key": "TWILIO_FROM_NUMBER", "label": "From number", "secret": False, "required": False},
            {
                "key": "TWILIO_MESSAGING_SERVICE_SID",
                "label": "Messaging service SID",
                "secret": False,
                "required": False,
            },
        ],
    },
    "whatsapp": {
        "label": "WhatsApp",
        "group": "Messaging",
        "description": "Meta WhatsApp Cloud API for campaigns and message templates.",
        "enabled_env": "CAMPAIGN_SEND_ENABLED",
        "env_enabled": lambda: settings.CAMPAIGN_SEND_ENABLED,
        "fields": [
            {
                "key": "WHATSAPP_ACCESS_TOKEN",
                "label": "Access token",
                "secret": True,
                "required": True,
            },
            {
                "key": "WHATSAPP_PHONE_NUMBER_ID",
                "label": "Phone number ID",
                "secret": False,
                "required": True,
            },
            {
                "key": "WHATSAPP_GRAPH_VERSION",
                "label": "Graph version",
                "secret": False,
                "required": False,
            },
            {
                "key": "WHATSAPP_TEMPLATE_NAME",
                "label": "Default template",
                "secret": False,
                "required": False,
            },
            {
                "key": "WHATSAPP_TEMPLATE_LANGUAGE",
                "label": "Template language",
                "secret": False,
                "required": False,
            },
        ],
    },
    "social": {
        "label": "Meta social publishing",
        "group": "Social",
        "description": "Facebook Page and Instagram Business publishing.",
        "enabled_env": "SOCIAL_PUBLISH_ENABLED",
        "env_enabled": lambda: settings.SOCIAL_PUBLISH_ENABLED,
        "fields": [
            {"key": "FACEBOOK_PAGE_ID", "label": "Facebook Page ID", "secret": False, "required": False},
            {
                "key": "FACEBOOK_PAGE_ACCESS_TOKEN",
                "label": "Facebook Page token",
                "secret": True,
                "required": False,
            },
            {
                "key": "INSTAGRAM_BUSINESS_ACCOUNT_ID",
                "label": "Instagram Business ID",
                "secret": False,
                "required": False,
            },
            {
                "key": "INSTAGRAM_ACCESS_TOKEN",
                "label": "Instagram token",
                "secret": True,
                "required": False,
            },
            {"key": "META_GRAPH_VERSION", "label": "Graph version", "secret": False, "required": False},
        ],
    },
    "ads": {
        "label": "Meta ads",
        "group": "Social",
        "description": "Facebook/Instagram campaign launch and budget sync.",
        "enabled_env": "ADS_LAUNCH_ENABLED",
        "env_enabled": lambda: settings.ADS_LAUNCH_ENABLED,
        "fields": [
            {
                "key": "META_AD_ACCOUNT_ID",
                "label": "Ad account ID",
                "secret": False,
                "required": True,
            },
            {
                "key": "META_AD_ACCESS_TOKEN",
                "label": "Access token",
                "secret": True,
                "required": True,
            },
            {"key": "META_GRAPH_VERSION", "label": "Graph version", "secret": False, "required": False},
        ],
    },
}


def _fernet() -> Fernet:
    digest = hashlib.sha256(settings.AUTH_SECRET_KEY.encode("utf-8")).digest()
    return Fernet(base64.urlsafe_b64encode(digest))


def encrypt_credentials(values: dict[str, str]) -> str:
    payload = json.dumps(values, separators=(",", ":")).encode("utf-8")
    return _fernet().encrypt(payload).decode("utf-8")


def decrypt_credentials(ciphertext: str) -> dict[str, str]:
    try:
        raw = _fernet().decrypt(ciphertext.encode("utf-8"))
    except (InvalidToken, ValueError):
        return {}
    try:
        values = json.loads(raw.decode("utf-8"))
    except (json.JSONDecodeError, UnicodeDecodeError):
        return {}
    return {str(key): str(value) for key, value in values.items()} if isinstance(values, dict) else {}


def _env_values(provider: str) -> dict[str, str]:
    values: dict[str, str] = {}
    for field in PROVIDERS[provider]["fields"]:
        value = getattr(settings, field["key"], None)
        values[field["key"]] = "" if value is None else str(value)
    return values


def effective_config(provider: str, db: Session | None = None) -> dict[str, Any]:
    """Resolve provider fields, source and enabled state."""
    if provider not in PROVIDERS:
        raise ValueError(f"Unknown provider: {provider}")
    opened = db is None
    session = db or SessionLocal()
    try:
        row = (
            session.query(ProviderSetting)
            .filter(ProviderSetting.provider == provider)
            .first()
        )
        env = _env_values(provider)
        stored = decrypt_credentials(row.credentials_encrypted) if row else {}
        merged = {key: (stored.get(key) or env.get(key) or "") for key in env}
        enabled = row.enabled if row else bool(PROVIDERS[provider]["env_enabled"]())
        return {
            "provider": provider,
            "values": merged,
            "enabled": enabled,
            "source": "custom" if row else "environment",
            "has_custom": row is not None,
        }
    finally:
        if opened:
            session.close()


def _missing(provider: str, values: dict[str, str]) -> list[str]:
    missing = []
    for field in PROVIDERS[provider]["fields"]:
        if field["required"] and not values.get(field["key"]):
            missing.append(field["key"])
    if provider == "sms" and not values.get("TWILIO_FROM_NUMBER") and not values.get(
        "TWILIO_MESSAGING_SERVICE_SID"
    ):
        missing.append("TWILIO_FROM_NUMBER or TWILIO_MESSAGING_SERVICE_SID")
    if provider == "social" and not (
        values.get("FACEBOOK_PAGE_ID")
        or values.get("INSTAGRAM_BUSINESS_ACCOUNT_ID")
    ):
        missing.append("FACEBOOK_PAGE_ID or INSTAGRAM_BUSINESS_ACCOUNT_ID")
    return missing


def provider_summary(provider: str, db: Session | None = None) -> dict[str, Any]:
    config = effective_config(provider, db)
    values = config["values"]
    definition = PROVIDERS[provider]
    fields = [
        {
            "key": field["key"],
            "label": field["label"],
            "secret": field["secret"],
            "required": field["required"],
            "value": "" if field["secret"] else values.get(field["key"], ""),
            "configured": bool(values.get(field["key"])),
        }
        for field in definition["fields"]
    ]
    missing = _missing(provider, values)
    return {
        "provider": provider,
        "label": definition["label"],
        "group": definition["group"],
        "description": definition["description"],
        "enabled": config["enabled"],
        "source": config["source"],
        "has_custom": config["has_custom"],
        "configured": bool(config["enabled"] and not missing),
        "missing": missing,
        "fields": fields,
    }


def list_provider_summaries(db: Session) -> list[dict]:
    return [provider_summary(key, db) for key in PROVIDERS]


def save_provider(
    db: Session,
    provider: str,
    *,
    values: dict[str, str],
    enabled: bool,
    updated_by: str = "",
) -> dict:
    if provider not in PROVIDERS:
        raise ValueError(f"Unknown provider: {provider}")
    allowed = {field["key"] for field in PROVIDERS[provider]["fields"]}
    unknown = set(values) - allowed
    if unknown:
        raise ValueError(f"Unknown field for {provider}: {', '.join(sorted(unknown))}")
    existing = (
        db.query(ProviderSetting)
        .filter(ProviderSetting.provider == provider)
        .first()
    )
    current = decrypt_credentials(existing.credentials_encrypted) if existing else {}
    for key, value in values.items():
        clean = str(value).strip()
        if clean:
            current[key] = clean
    if existing is None:
        existing = ProviderSetting(
            provider=provider,
            credentials_encrypted=encrypt_credentials(current),
            enabled=enabled,
            updated_by=updated_by or None,
        )
        db.add(existing)
    else:
        existing.credentials_encrypted = encrypt_credentials(current)
        existing.enabled = enabled
        existing.updated_by = updated_by or None
    db.commit()
    return provider_summary(provider, db)


def reset_provider(db: Session, provider: str) -> dict:
    if provider not in PROVIDERS:
        raise ValueError(f"Unknown provider: {provider}")
    existing = (
        db.query(ProviderSetting)
        .filter(ProviderSetting.provider == provider)
        .first()
    )
    if existing is not None:
        db.delete(existing)
        db.commit()
    return provider_summary(provider, db)
