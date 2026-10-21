"""In-process rate limiting for sensitive public endpoints.

This is a per-instance guard: it raises the cost of phone/order-id enumeration,
credential brute force, and order spam without requiring external
infrastructure. A horizontally scaled deployment should also configure a shared
limiter (Redis) or a provider WAF rule at the edge; this module deliberately
does not pretend to be that.
"""

import time
from collections import deque
from threading import Lock

from fastapi import HTTPException, Request

from app.core.config import settings

WINDOW_SECONDS = 60.0
MAX_TRACKED_BUCKETS = 4096

_buckets: dict[tuple[str, str], deque[float]] = {}
_lock = Lock()


def client_key(request: Request) -> str:
    """Best-effort client identity behind a proxy or direct connection."""
    forwarded = request.headers.get("x-forwarded-for")
    if forwarded:
        return forwarded.split(",")[0].strip() or "unknown"
    return request.client.host if request.client else "unknown"


def enforce_rate_limit(
    request: Request,
    bucket: str,
    limit: int,
    window_seconds: float = WINDOW_SECONDS,
) -> None:
    """Raise 429 once ``limit`` requests hit one bucket in the window."""
    if not settings.RATE_LIMIT_ENABLED:
        return

    now = time.monotonic()
    cutoff = now - window_seconds
    key = (bucket, client_key(request))
    with _lock:
        timestamps = _buckets.setdefault(key, deque())
        while timestamps and timestamps[0] < cutoff:
            timestamps.popleft()
        if len(timestamps) >= limit:
            retry_after = max(1, int(window_seconds - (now - timestamps[0])) + 1)
            raise HTTPException(
                status_code=429,
                detail="Too many requests. Please try again shortly.",
                headers={"Retry-After": str(retry_after)},
            )
        timestamps.append(now)
        if len(_buckets) > MAX_TRACKED_BUCKETS:
            for stale_key in [name for name, values in _buckets.items() if not values]:
                _buckets.pop(stale_key, None)


def reset_rate_limits() -> None:
    """Clear all buckets (tests and maintenance)."""
    with _lock:
        _buckets.clear()
