import json
from dataclasses import dataclass
from typing import Any, Optional
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import Request, urlopen

from app.core.config import settings


@dataclass
class SocialPublishResult:
    provider: str
    status: str
    external_id: Optional[str] = None
    response_payload: Optional[dict[str, Any]] = None
    error: Optional[str] = None


def social_provider_status(platform: str) -> dict:
    platform = platform.lower()
    provider = _provider_name(platform)
    missing_settings: list[str] = []
    unsupported = False

    if not settings.SOCIAL_PUBLISH_ENABLED:
        missing_settings.append("SOCIAL_PUBLISH_ENABLED=true")

    if platform == "facebook":
        if not settings.FACEBOOK_PAGE_ID:
            missing_settings.append("FACEBOOK_PAGE_ID")
        if not settings.FACEBOOK_PAGE_ACCESS_TOKEN:
            missing_settings.append("FACEBOOK_PAGE_ACCESS_TOKEN")
    elif platform == "instagram":
        if not settings.INSTAGRAM_BUSINESS_ACCOUNT_ID:
            missing_settings.append("INSTAGRAM_BUSINESS_ACCOUNT_ID")
        if not settings.INSTAGRAM_ACCESS_TOKEN:
            missing_settings.append("INSTAGRAM_ACCESS_TOKEN")
    else:
        unsupported = True

    return {
        "platform": platform,
        "provider": provider,
        "enabled": settings.SOCIAL_PUBLISH_ENABLED,
        "configured": bool(not unsupported and not missing_settings),
        "unsupported": unsupported,
        "missing_settings": missing_settings,
    }


def publish_social_post(
    *,
    platform: str,
    message: str,
    link_url: Optional[str] = None,
    image_url: Optional[str] = None,
) -> SocialPublishResult:
    platform = platform.lower()
    status = social_provider_status(platform)
    if not status["configured"]:
        return SocialPublishResult(
            provider=status["provider"],
            status="skipped",
            error=f"Provider not configured: {', '.join(status['missing_settings']) or 'unsupported platform'}",
            response_payload={"provider_status": status},
        )

    if platform == "facebook":
        return _publish_facebook_page(message=message, link_url=link_url, image_url=image_url)
    if platform == "instagram":
        return _publish_instagram_media(message=message, image_url=image_url)

    return SocialPublishResult(
        provider=status["provider"],
        status="failed",
        error=f"Unsupported social platform: {platform}",
        response_payload={"provider_status": status},
    )


def _publish_facebook_page(
    *,
    message: str,
    link_url: Optional[str],
    image_url: Optional[str],
) -> SocialPublishResult:
    if image_url:
        response = _post_form(
            f"https://graph.facebook.com/{settings.META_GRAPH_VERSION}/{settings.FACEBOOK_PAGE_ID}/photos",
            {
                "access_token": settings.FACEBOOK_PAGE_ACCESS_TOKEN or "",
                "url": image_url,
                "caption": message,
            },
        )
        return _result_from_response("meta-facebook", response, lambda body: body.get("post_id") or body.get("id"))

    payload = {
        "access_token": settings.FACEBOOK_PAGE_ACCESS_TOKEN or "",
        "message": message,
    }
    if link_url:
        payload["link"] = link_url
    response = _post_form(
        f"https://graph.facebook.com/{settings.META_GRAPH_VERSION}/{settings.FACEBOOK_PAGE_ID}/feed",
        payload,
    )
    return _result_from_response("meta-facebook", response, lambda body: body.get("id"))


def _publish_instagram_media(*, message: str, image_url: Optional[str]) -> SocialPublishResult:
    if not image_url:
        return SocialPublishResult(
            provider="meta-instagram",
            status="skipped",
            error="Instagram publishing requires an image_url.",
        )

    create_response = _post_form(
        (
            f"https://graph.facebook.com/{settings.META_GRAPH_VERSION}/"
            f"{settings.INSTAGRAM_BUSINESS_ACCOUNT_ID}/media"
        ),
        {
            "access_token": settings.INSTAGRAM_ACCESS_TOKEN or "",
            "image_url": image_url,
            "caption": message,
        },
    )
    create_status, create_body, create_error = create_response
    if not 200 <= create_status < 300 or create_error:
        return _result_from_response("meta-instagram", create_response, lambda body: body.get("id"))

    creation_id = create_body.get("id")
    publish_response = _post_form(
        (
            f"https://graph.facebook.com/{settings.META_GRAPH_VERSION}/"
            f"{settings.INSTAGRAM_BUSINESS_ACCOUNT_ID}/media_publish"
        ),
        {
            "access_token": settings.INSTAGRAM_ACCESS_TOKEN or "",
            "creation_id": creation_id,
        },
    )
    result = _result_from_response("meta-instagram", publish_response, lambda body: body.get("id"))
    if result.response_payload is None:
        result.response_payload = {}
    result.response_payload["container_id"] = creation_id
    return result


def _provider_name(platform: str) -> str:
    if platform == "facebook":
        return "meta-facebook"
    if platform == "instagram":
        return "meta-instagram"
    return "unsupported"


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
    external_id_getter,
) -> SocialPublishResult:
    status_code, body, error = response
    if 200 <= status_code < 300 and not error:
        return SocialPublishResult(
            provider=provider,
            status="published",
            external_id=external_id_getter(body),
            response_payload=body,
        )
    return SocialPublishResult(
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
