"""Business-date helpers.

Restaurant day boundaries follow the configured restaurant timezone rather than
the host clock: a 00:30 order in India belongs to the local calendar day even
when the server (for example Cloud Run) runs in UTC. Every "today" comparison
in the API goes through here so reports, orders, promotions, and readiness all
agree on what day it is.
"""

from datetime import date, datetime
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from app.core.config import settings

FALLBACK_TIMEZONE = "UTC"


def business_zone() -> ZoneInfo:
    """Return the configured restaurant timezone, falling back to UTC."""
    try:
        return ZoneInfo(settings.RESTAURANT_TIMEZONE)
    except (ZoneInfoNotFoundError, ValueError):
        return ZoneInfo(FALLBACK_TIMEZONE)


def business_now() -> datetime:
    """Current time in the restaurant timezone."""
    return datetime.now(business_zone())


def business_today() -> date:
    """Current calendar date in the restaurant timezone."""
    return business_now().date()
