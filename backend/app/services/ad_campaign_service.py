import json
from dataclasses import dataclass
from typing import Any, Optional
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import Request, urlopen

from app.services.provider_settings_service import effective_config


META_OBJECTIVES = {
    "awareness": "OUTCOME_AWARENESS",
    "traffic": "OUTCOME_TRAFFIC",
    "engagement": "OUTCOME_ENGAGEMENT",
    "leads": "OUTCOME_LEADS",
    "sales": "OUTCOME_SALES",
}


@dataclass
class AdProviderResult:
    provider: str
    status: str
    external_campaign_id: Optional[str] = None
    response_payload: Optional[dict[str, Any]] = None
    error: Optional[str] = None


def ad_provider_status(db=None) -> dict:
    config = effective_config("ads", db)
    values = config["values"]
    missing_settings: list[str] = []
    if not config["enabled"]:
        missing_settings.append("ADS_LAUNCH_ENABLED=true")
    if not values.get("META_AD_ACCOUNT_ID"):
        missing_settings.append("META_AD_ACCOUNT_ID")
    if not values.get("META_AD_ACCESS_TOKEN"):
        missing_settings.append("META_AD_ACCESS_TOKEN")

    return {
        "provider": "meta-ads",
        "enabled": config["enabled"],
        "source": config["source"],
        "configured": not missing_settings,
        "missing_settings": missing_settings,
        "launch_mode": "paused_campaign",
    }


def launch_meta_campaign(
    *,
    name: str,
    objective: str,
    daily_budget: float,
    lifetime_budget: float,
    db=None,
) -> AdProviderResult:
    status = ad_provider_status(db)
    if not status["configured"]:
        return AdProviderResult(
            provider="meta-ads",
            status="skipped",
            error=f"Provider not configured: {', '.join(status['missing_settings'])}",
            response_payload={"provider_status": status},
        )
    config = effective_config("ads", db)["values"]

    payload: dict[str, Any] = {
        "access_token": config.get("META_AD_ACCESS_TOKEN", ""),
        "name": name,
        "objective": META_OBJECTIVES.get(objective, "OUTCOME_TRAFFIC"),
        "status": "PAUSED",
        "buying_type": "AUCTION",
        "special_ad_categories": "[]",
    }
    if daily_budget > 0:
        payload["daily_budget"] = _minor_units(daily_budget)
    if lifetime_budget > 0:
        payload["lifetime_budget"] = _minor_units(lifetime_budget)

    account_id = _ad_account_id(config.get("META_AD_ACCOUNT_ID", ""))
    response = _post_form(
        f"https://graph.facebook.com/{config.get('META_GRAPH_VERSION') or 'v25.0'}/{account_id}/campaigns",
        payload,
    )
    return _result_from_response("meta-ads", response)


def _ad_account_id(value: str) -> str:
    cleaned = value.strip()
    return cleaned if cleaned.startswith("act_") else f"act_{cleaned}"


def _minor_units(value: float) -> int:
    return int(round(max(value, 0) * 100))


def _post_form(url: str, payload: dict[str, Any]) -> tuple[int, dict[str, Any], Optional[str]]:
    request = Request(
        url,
        data=urlencode(payload).encode("utf-8"),
        headers={"Content-Type": "application/x-www-form-urlencoded"},
        method="POST",
    )
    try:
        with urlopen(request, timeout=25) as response:
            return response.status, _parse_response(response.read().decode("utf-8")), None
    except HTTPError as exc:
        body = _parse_response(exc.read().decode("utf-8"))
        return exc.code, body, _provider_error_message(body, str(exc))
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
) -> AdProviderResult:
    status_code, body, error = response
    if 200 <= status_code < 300 and not error:
        return AdProviderResult(
            provider=provider,
            status="launched",
            external_campaign_id=body.get("id"),
            response_payload=body,
        )
    return AdProviderResult(
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
