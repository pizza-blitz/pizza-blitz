"""Scheduled pickup/delivery orders.

Slots are aligned to the restaurant timezone, capacity-checked against open
orders, and validated against the store's opening hours. Scheduled times are
stored as naive UTC (like every other timestamp) and rendered back in the
business timezone.
"""

from datetime import date, datetime, time, timedelta, timezone as dt_timezone

from sqlalchemy.orm import Session

from app.core.clock import business_now, business_zone
from app.models.domain import RestaurantOrder, StoreProfile
from app.services.store_profile_service import DAY_KEYS, is_open_at

SLOT_MINUTES = 15
LEAD_MINUTES = 20
DAYS_AHEAD = 14
SLOT_CAPACITY = 6

# Used only when the store has not configured opening hours (24/7 mode) so the
# scheduler still offers a sensible service window.
DEFAULT_OPEN = "11:00"
DEFAULT_CLOSE = "23:00"


def _minutes(value: str) -> int:
    hours, minutes = str(value).split(":", 1)
    return int(hours) * 60 + int(minutes)


def _default_hours() -> dict[str, dict[str, str]]:
    return {
        day: {"open": DEFAULT_OPEN, "close": DEFAULT_CLOSE} for day in DAY_KEYS
    }


def _windows_for(profile: StoreProfile, target: date) -> list[tuple[int, int]]:
    hours = profile.opening_hours
    if hours is None:
        hours = _default_hours()
    window = hours.get(DAY_KEYS[target.weekday()])
    if not window:
        return []
    open_minutes = _minutes(window.get("open"))
    close_minutes = _minutes(window.get("close"))
    if open_minutes == close_minutes:
        return []
    if open_minutes < close_minutes:
        return [(open_minutes, close_minutes)]
    # Overnight window: offer the evening and the early-morning part on the
    # selected calendar date.
    return [(open_minutes, 24 * 60), (0, close_minutes)]


def slot_capacity_used(db: Session, slot_start_utc: datetime) -> int:
    slot_end = slot_start_utc + timedelta(minutes=SLOT_MINUTES)
    return (
        db.query(RestaurantOrder)
        .filter(
            RestaurantOrder.scheduled_for.isnot(None),
            RestaurantOrder.scheduled_for >= slot_start_utc,
            RestaurantOrder.scheduled_for < slot_end,
            RestaurantOrder.status != "cancelled",
        )
        .count()
    )


def slots_for_date(
    db: Session,
    profile: StoreProfile,
    target: date,
    now: datetime | None = None,
) -> list[dict]:
    now_local = now or business_now()
    today = now_local.date()
    if target < today:
        raise ValueError("Choose today or a future date.")
    if (target - today).days > DAYS_AHEAD:
        raise ValueError(f"Scheduled orders open up to {DAYS_AHEAD} days ahead.")

    earliest = now_local + timedelta(minutes=LEAD_MINUTES)
    slots: list[dict] = []
    for start_minutes, end_minutes in _windows_for(profile, target):
        cursor = start_minutes
        while cursor + SLOT_MINUTES <= end_minutes:
            local_slot = datetime.combine(
                target,
                time(hour=cursor // 60, minute=cursor % 60),
                tzinfo=business_zone(),
            )
            if local_slot >= earliest:
                slot_start_utc = local_slot.astimezone(dt_timezone.utc).replace(tzinfo=None)
                used = slot_capacity_used(db, slot_start_utc)
                remaining = max(SLOT_CAPACITY - used, 0)
                slots.append(
                    {
                        "value": local_slot.isoformat(),
                        "label": local_slot.strftime("%I:%M %p").lstrip("0"),
                        "available": remaining > 0,
                        "remaining": remaining,
                    }
                )
            cursor += SLOT_MINUTES
    return slots


def parse_scheduled_for(
    value: datetime | None,
    profile: StoreProfile,
    now: datetime | None = None,
) -> datetime | None:
    """Validate a requested local time and convert it to naive UTC."""
    if value is None:
        return None

    now_local = now or business_now()
    if value.tzinfo is None:
        local_value = value.replace(tzinfo=business_zone())
    else:
        local_value = value.astimezone(business_zone())

    if local_value.second or local_value.microsecond or local_value.minute % SLOT_MINUTES:
        raise ValueError(f"Choose a {SLOT_MINUTES}-minute pickup or delivery slot.")
    if local_value < now_local + timedelta(minutes=LEAD_MINUTES):
        raise ValueError(
            f"Scheduled orders need at least {LEAD_MINUTES} minutes of preparation time."
        )
    if local_value > now_local + timedelta(days=DAYS_AHEAD):
        raise ValueError(f"Scheduled orders open up to {DAYS_AHEAD} days ahead.")
    if not is_open_at(profile, local_value.replace(tzinfo=None)):
        raise ValueError("The store is outside its opening hours at that time.")

    return local_value.astimezone(dt_timezone.utc).replace(tzinfo=None)


def assert_slot_available(db: Session, scheduled_for_utc: datetime) -> None:
    if slot_capacity_used(db, scheduled_for_utc) >= SLOT_CAPACITY:
        raise ValueError("That time slot is full. Choose another time.")


def to_business_iso(utc_value: datetime | None) -> str | None:
    if utc_value is None:
        return None
    local_value = utc_value.replace(tzinfo=dt_timezone.utc).astimezone(business_zone())
    return local_value.isoformat()


def scheduled_label(utc_value: datetime | None) -> str | None:
    if utc_value is None:
        return None
    local_value = utc_value.replace(tzinfo=dt_timezone.utc).astimezone(business_zone())
    today = business_now().date()
    offset = (local_value.date() - today).days
    if offset == 0:
        prefix = "Today"
    elif offset == 1:
        prefix = "Tomorrow"
    else:
        prefix = local_value.strftime("%a, %d %b")
    clock = local_value.strftime("%I:%M %p").lstrip("0")
    return f"{prefix}, {clock}"
