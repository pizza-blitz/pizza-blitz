import base64
import json
from dataclasses import dataclass
from typing import Any, Optional
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import Request, urlopen

from app.core.config import settings
from app.services.provider_settings_service import effective_config


@dataclass
class CampaignProviderResult:
    provider: str
    status: str
    external_id: Optional[str] = None
    response_payload: Optional[dict[str, Any]] = None
    error: Optional[str] = None


def campaign_provider_status(channel: str, db=None) -> dict:
    channel = channel.lower()
    provider = _provider_name(channel)
    config = effective_config(_provider_key(channel), db)
    values = config["values"]
    missing_settings: list[str] = []
    unsupported = provider == "unsupported"

    if not config["enabled"]:
        missing_settings.append("CAMPAIGN_SEND_ENABLED=true")
        missing_settings.append("Enable this provider in Settings > Providers")

    if channel == "email":
        if provider != "resend":
            unsupported = True
        if not values.get("RESEND_API_KEY"):
            missing_settings.append("RESEND_API_KEY")
        if not values.get("RESEND_FROM_EMAIL"):
            missing_settings.append("RESEND_FROM_EMAIL")
    elif channel == "sms":
        if provider != "twilio":
            unsupported = True
        if not values.get("TWILIO_ACCOUNT_SID"):
            missing_settings.append("TWILIO_ACCOUNT_SID")
        if not values.get("TWILIO_AUTH_TOKEN"):
            missing_settings.append("TWILIO_AUTH_TOKEN")
        if not values.get("TWILIO_FROM_NUMBER") and not values.get(
            "TWILIO_MESSAGING_SERVICE_SID"
        ):
            missing_settings.append("TWILIO_FROM_NUMBER or TWILIO_MESSAGING_SERVICE_SID")
    elif channel == "whatsapp":
        if provider != "meta":
            unsupported = True
        if not values.get("WHATSAPP_ACCESS_TOKEN"):
            missing_settings.append("WHATSAPP_ACCESS_TOKEN")
        if not values.get("WHATSAPP_PHONE_NUMBER_ID"):
            missing_settings.append("WHATSAPP_PHONE_NUMBER_ID")
    else:
        unsupported = True

    return {
        "channel": channel,
        "provider": provider,
        "enabled": config["enabled"],
        "source": config["source"],
        "configured": bool(not unsupported and not missing_settings),
        "unsupported": unsupported,
        "missing_settings": missing_settings,
    }


def send_campaign_message(
    *,
    channel: str,
    destination: str,
    message: str,
    subject: str,
    db=None,
    html_extra: str = "",
) -> CampaignProviderResult:
    status = campaign_provider_status(channel, db)
    if not status["configured"]:
        return CampaignProviderResult(
            provider=status["provider"],
            status="skipped",
            error=f"Provider not configured: {', '.join(status['missing_settings']) or 'unsupported channel'}",
            response_payload={"provider_status": status},
        )

    config = effective_config(_provider_key(channel), db)["values"]
    if channel == "email":
        return _send_resend_email(
            destination=destination,
            subject=subject,
            message=message,
            config=config,
            html_extra=html_extra,
        )
    if channel == "sms":
        return _send_twilio_sms(destination=destination, message=message, config=config)
    if channel == "whatsapp":
        return _send_meta_whatsapp(
            destination=destination, message=message, config=config
        )
    return CampaignProviderResult(
        provider=status["provider"],
        status="failed",
        error=f"Unsupported campaign channel: {channel}",
    )


def normalize_campaign_destination(channel: str, destination: Optional[str]) -> Optional[str]:
    if not destination:
        return None
    if channel == "email":
        return destination.strip()
    if channel == "sms":
        return _e164_phone(destination)
    if channel == "whatsapp":
        phone = _e164_phone(destination)
        return phone[1:] if phone.startswith("+") else phone
    return destination.strip()


def _provider_key(channel: str) -> str:
    return {"email": "email", "sms": "sms", "whatsapp": "whatsapp"}.get(
        channel, "email"
    )


def _provider_name(channel: str) -> str:
    if channel == "email":
        return settings.EMAIL_PROVIDER.lower()
    if channel == "sms":
        return settings.SMS_PROVIDER.lower()
    if channel == "whatsapp":
        return settings.WHATSAPP_PROVIDER.lower()
    return "unsupported"


def _send_resend_email(
    *,
    destination: str,
    subject: str,
    message: str,
    config: dict,
    html_extra: str = "",
) -> CampaignProviderResult:
    payload = {
        "from": config.get("RESEND_FROM_EMAIL"),
        "to": [destination],
        "subject": subject,
        "text": message,
        "html": (
            f"<p>{_html_escape(message).replace(chr(10), '<br />')}</p>{html_extra}"
        ),
    }
    response = _post_json(
        "https://api.resend.com/emails",
        payload,
        {"Authorization": f"Bearer {config.get('RESEND_API_KEY', '')}"},
    )
    return _result_from_response("resend", response, lambda body: body.get("id"))


def _send_twilio_sms(
    *, destination: str, message: str, config: dict
) -> CampaignProviderResult:
    payload = {
        "To": _e164_phone(destination),
        "Body": message,
    }
    if config.get("TWILIO_MESSAGING_SERVICE_SID"):
        payload["MessagingServiceSid"] = config["TWILIO_MESSAGING_SERVICE_SID"]
    else:
        payload["From"] = config.get("TWILIO_FROM_NUMBER") or ""

    credentials = (
        f"{config.get('TWILIO_ACCOUNT_SID', '')}:{config.get('TWILIO_AUTH_TOKEN', '')}"
    ).encode("utf-8")
    auth_header = base64.b64encode(credentials).decode("ascii")
    response = _post_form(
        f"https://api.twilio.com/2010-04-01/Accounts/{config.get('TWILIO_ACCOUNT_SID', '')}/Messages.json",
        payload,
        {"Authorization": f"Basic {auth_header}"},
    )
    return _result_from_response("twilio", response, lambda body: body.get("sid"))


def _send_meta_whatsapp(
    *, destination: str, message: str, config: dict
) -> CampaignProviderResult:
    to_number = normalize_campaign_destination("whatsapp", destination)
    if config.get("WHATSAPP_TEMPLATE_NAME"):
        payload: dict[str, Any] = {
            "messaging_product": "whatsapp",
            "to": to_number,
            "type": "template",
            "template": {
                "name": config["WHATSAPP_TEMPLATE_NAME"],
                "language": {
                    "code": config.get("WHATSAPP_TEMPLATE_LANGUAGE") or "en_US"
                },
                "components": [
                    {
                        "type": "body",
                        "parameters": [{"type": "text", "text": message}],
                    }
                ],
            },
        }
    else:
        payload = {
            "messaging_product": "whatsapp",
            "recipient_type": "individual",
            "to": to_number,
            "type": "text",
            "text": {"preview_url": False, "body": message},
        }

    response = _post_json(
        (
            f"https://graph.facebook.com/{config.get('WHATSAPP_GRAPH_VERSION') or 'v25.0'}/"
            f"{config.get('WHATSAPP_PHONE_NUMBER_ID', '')}/messages"
        ),
        payload,
        {"Authorization": f"Bearer {config.get('WHATSAPP_ACCESS_TOKEN', '')}"},
    )
    return _result_from_response(
        "meta-whatsapp",
        response,
        lambda body: (body.get("messages") or [{}])[0].get("id"),
    )


def _post_json(url: str, payload: dict, headers: dict[str, str]) -> tuple[int, dict[str, Any], Optional[str]]:
    request = Request(
        url,
        data=json.dumps(payload).encode("utf-8"),
        headers={
            "Content-Type": "application/json",
            **headers,
        },
        method="POST",
    )
    return _open_request(request)


def _post_form(url: str, payload: dict, headers: dict[str, str]) -> tuple[int, dict[str, Any], Optional[str]]:
    request = Request(
        url,
        data=urlencode(payload).encode("utf-8"),
        headers={
            "Content-Type": "application/x-www-form-urlencoded",
            **headers,
        },
        method="POST",
    )
    return _open_request(request)


def _open_request(request: Request) -> tuple[int, dict[str, Any], Optional[str]]:
    try:
        with urlopen(request, timeout=20) as response:
            payload = _parse_response(response.read().decode("utf-8"))
            return response.status, payload, None
    except HTTPError as exc:
        payload = _parse_response(exc.read().decode("utf-8"))
        return exc.code, payload, payload.get("message") or payload.get("error") or str(exc)
    except URLError as exc:
        return 0, {}, str(exc.reason)
    except TimeoutError as exc:
        return 0, {}, str(exc)


def _parse_response(raw: str) -> dict[str, Any]:
    if not raw:
        return {}
    try:
        parsed = json.loads(raw)
        return parsed if isinstance(parsed, dict) else {"response": parsed}
    except json.JSONDecodeError:
        return {"raw": raw}


def _result_from_response(
    provider: str,
    response: tuple[int, dict[str, Any], Optional[str]],
    external_id_getter,
) -> CampaignProviderResult:
    status_code, body, error = response
    if 200 <= status_code < 300 and not error:
        return CampaignProviderResult(
            provider=provider,
            status="sent",
            external_id=external_id_getter(body),
            response_payload=body,
        )
    return CampaignProviderResult(
        provider=provider,
        status="failed",
        response_payload={"status_code": status_code, **body},
        error=_provider_error_message(body, error),
    )


def _provider_error_message(body: dict[str, Any], fallback: Optional[str]) -> str:
    error = body.get("error")
    if isinstance(error, dict):
        return str(error.get("message") or error.get("code") or fallback or "Provider request failed")
    if isinstance(error, str):
        return error
    return fallback or body.get("message") or "Provider request failed"


def _e164_phone(value: str) -> str:
    trimmed = value.strip()
    digits = "".join(character for character in trimmed if character.isdigit())
    if not digits:
        return ""
    if trimmed.startswith("+"):
        return f"+{digits}"
    country_code = "".join(
        character for character in settings.CAMPAIGN_DEFAULT_COUNTRY_CODE if character.isdigit()
    )
    if country_code and len(digits) == 10:
        return f"+{country_code}{digits}"
    return f"+{digits}"


def _html_escape(value: str) -> str:
    return (
        value.replace("&", "&amp;")
        .replace("<", "&lt;")
        .replace(">", "&gt;")
        .replace('"', "&quot;")
        .replace("'", "&#x27;")
    )
