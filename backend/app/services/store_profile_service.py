"""Store identity, opening hours, and online-ordering status.

The store profile is a single row. Hours are stored as
``{"mon": {"open": "11:00", "close": "23:00"}, ...}`` where a missing or null
day means closed. An empty ``opening_hours`` map means "24/7 until configured",
which keeps a fresh install (and the test suite) fully orderable.
"""

import re
from datetime import datetime, timedelta

from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.clock import business_now
from app.core.config import settings
from app.models.domain import StoreProfile

DAY_KEYS = ("mon", "tue", "wed", "thu", "fri", "sat", "sun")
DAY_LABELS = {
    "mon": "Monday",
    "tue": "Tuesday",
    "wed": "Wednesday",
    "thu": "Thursday",
    "fri": "Friday",
    "sat": "Saturday",
    "sun": "Sunday",
}
PROFILE_ID = 1
_TIME_PATTERN = re.compile(r"^([01]\d|2[0-3]):([0-5]\d)$")

DEFAULT_PROFILE = {
    "name": "Pizza Blitz",
    "tagline": "Hot pizza. Fast lanes. Zero drama.",
    "phone": None,
    "email": None,
    "address_line": None,
    "map_url": None,
    "instagram_url": None,
    "opening_hours": None,
    "online_ordering_paused": False,
    "pause_message": None,
    "prep_time_minutes": 25,
}


def get_store_profile(db: Session) -> StoreProfile:
    """Return the singleton profile, creating it on first use."""
    profile = db.query(StoreProfile).filter(StoreProfile.id == PROFILE_ID).first()
    if profile is not None:
        return profile

    profile = StoreProfile(id=PROFILE_ID, **DEFAULT_PROFILE)
    db.add(profile)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        profile = db.query(StoreProfile).filter(StoreProfile.id == PROFILE_ID).first()
        if profile is not None:
            return profile
        raise
    db.refresh(profile)
    return profile


def _parse_minutes(value: str) -> int:
    match = _TIME_PATTERN.match(str(value or "").strip())
    if not match:
        raise ValueError("Opening hours must use HH:MM in 24-hour time.")
    return int(match.group(1)) * 60 + int(match.group(2))


def normalize_opening_hours(raw: dict | None) -> dict | None:
    """Validate and normalise an opening-hours mapping.

    ``None`` means the store is 24/7 until hours are configured. An empty dict
    means the store is closed every day.
    """
    if raw is None:
        return None
    if not isinstance(raw, dict):
        raise ValueError("Opening hours must be an object keyed by weekday.")

    normalized: dict[str, dict[str, str]] = {}
    for key, window in raw.items():
        day = str(key).strip().lower()
        if day not in DAY_KEYS:
            raise ValueError(f"Unsupported weekday '{key}'.")
        if window is None:
            continue
        if not isinstance(window, dict):
            raise ValueError(f"Opening hours for {day} must include open and close.")
        open_value = window.get("open")
        close_value = window.get("close")
        _parse_minutes(open_value)
        _parse_minutes(close_value)
        if str(open_value) == str(close_value):
            raise ValueError(f"Opening and closing time cannot match for {day}.")
        normalized[day] = {"open": str(open_value), "close": str(close_value)}
    return normalized


def _window_contains(window: dict, current_minutes: int, previous_day: bool) -> bool:
    open_minutes = _parse_minutes(window.get("open"))
    close_minutes = _parse_minutes(window.get("close"))
    if open_minutes < close_minutes:
        return (not previous_day) and open_minutes <= current_minutes < close_minutes
    # Overnight window, for example 22:00 to 02:00: the evening belongs to the
    # current day, the early morning belongs to the previous day's window.
    if previous_day:
        return current_minutes < close_minutes
    return current_minutes >= open_minutes


def is_open_at(profile: StoreProfile, at: datetime | None = None) -> bool:
    """Whether the kitchen is inside its online ordering hours."""
    hours = profile.opening_hours
    if hours is None:
        # Hours have not been configured: keep ordering available 24/7.
        return True

    moment = at or business_now()
    current = moment.hour * 60 + moment.minute
    today_key = DAY_KEYS[moment.weekday()]
    previous_key = DAY_KEYS[(moment.weekday() - 1) % 7]

    today_window = hours.get(today_key)
    if today_window and _window_contains(today_window, current, previous_day=False):
        return True

    previous_window = hours.get(previous_key)
    if previous_window:
        open_minutes = _parse_minutes(previous_window.get("open"))
        close_minutes = _parse_minutes(previous_window.get("close"))
        if open_minutes >= close_minutes and _window_contains(
            previous_window, current, previous_day=True
        ):
            return True
    return False


def next_opening(profile: StoreProfile, at: datetime | None = None) -> str | None:
    """Human-readable next opening time, or None for 24/7 stores."""
    hours = profile.opening_hours
    if hours is None:
        return None

    moment = at or business_now()
    for offset in range(8):
        candidate_day = moment + timedelta(days=offset)
        key = DAY_KEYS[candidate_day.weekday()]
        window = hours.get(key)
        if not window:
            continue
        open_minutes = _parse_minutes(window.get("open"))
        if offset == 0 and moment.hour * 60 + moment.minute >= open_minutes:
            continue
        day_label = "Today" if offset == 0 else ("Tomorrow" if offset == 1 else DAY_LABELS[key])
        return f"{day_label} at {window['open']}"
    return None


def store_status(profile: StoreProfile, at: datetime | None = None) -> dict:
    paused = bool(profile.online_ordering_paused)
    open_now = is_open_at(profile, at)
    accepting = open_now and not paused
    if paused:
        state = "paused"
        message = (
            profile.pause_message
            or "Online ordering is paused right now. Please try again shortly."
        )
    elif not open_now:
        state = "closed"
        upcoming = next_opening(profile, at)
        message = (
            f"Online ordering opens {upcoming}." if upcoming else "Online ordering is closed right now."
        )
    else:
        state = "open"
        message = "Online ordering is active."

    return {
        "state": state,
        "is_open": open_now,
        "accepting_orders": accepting,
        "message": message,
        "next_opening": None if open_now else next_opening(profile, at),
        "timezone": settings.RESTAURANT_TIMEZONE,
    }


def serialize_public_profile(profile: StoreProfile, at: datetime | None = None) -> dict:
    return {
        "name": profile.name,
        "tagline": profile.tagline,
        "phone": profile.phone,
        "email": profile.email,
        "address_line": profile.address_line,
        "map_url": profile.map_url,
        "instagram_url": profile.instagram_url,
        "opening_hours": profile.opening_hours or {},
        "prep_time_minutes": profile.prep_time_minutes,
        "status": store_status(profile, at),
    }


def serialize_admin_profile(profile: StoreProfile, at: datetime | None = None) -> dict:
    payload = serialize_public_profile(profile, at)
    payload.update(
        {
            # Keep the None (24/7) versus {} (closed every day) distinction for
            # the settings editor.
            "opening_hours": profile.opening_hours,
            "online_ordering_paused": bool(profile.online_ordering_paused),
            "pause_message": profile.pause_message,
            "updated_at": profile.updated_at.isoformat() if profile.updated_at else None,
        }
    )
    return payload
