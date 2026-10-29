"""Remember a returning guest's own words, so they only say them once.

The concierge is stateless between visits unless something stores the guest's
details. This module owns that storage: allergies, dietary preferences, usual
fulfilment style and the last order summary, keyed by the phone number the guest
already uses at checkout and which the order-history proof verifies.

Design rules, in order of importance:

1. Nothing is inferred as medical fact. Allergies are stored exactly as the guest
   phrased them and echoed back unchanged.
2. Nothing is written without a verified phone. The API layer enforces the proof;
   this module assumes the caller already checked it.
3. Consent is explicit and revocable. Withdrawing it deletes the row.
"""

from __future__ import annotations

import re

from sqlalchemy.orm import Session

from app.models.domain import CustomerMemory, RestaurantOrder
from app.services.customer_otp_service import normalize_phone

MAX_LIST_ITEMS = 20
MAX_ITEM_LENGTH = 80

ALLERGEN_VOCABULARY = {
    "peanut", "peanuts", "nut", "nuts", "tree nuts", "almond", "almonds",
    "cashew", "cashews", "pistachio", "pistachios", "walnut", "walnuts",
    "dairy", "milk", "lactose", "gluten", "wheat", "egg", "eggs", "soy", "soya",
    "sesame", "shellfish", "prawn", "prawns", "shrimp", "fish", "mustard",
    "celery", "sulphites", "sulfites", "mushroom", "mushrooms", "onion",
    "onions", "garlic", "cheese", "paneer", "tomato", "tomatoes", "corn",
    "honey", "coconut",
}

ALLERGY_PATTERNS = (
    re.compile(r"\ballergic to ([a-z0-9 ,&'\-]{2,120})", re.IGNORECASE),
    re.compile(r"\ballerg(?:y|ies) (?:to |: )?([a-z0-9 ,&'\-]{2,120})", re.IGNORECASE),
    re.compile(r"\bcannot (?:eat|have) ([a-z0-9 ,&'\-]{2,120})", re.IGNORECASE),
)

# "no peanuts" and "without dairy" only count when the word is on the allergen
# list. A bare "no thanks" or a free-for-all would poison the memory with words
# the guest never meant as a restriction.
NEGATION_PATTERN = re.compile(
    r"\b(?:no|without)\s+([a-z][a-z ]{1,60})", re.IGNORECASE
)

DIETARY_WORDS = {
    "vegan": "vegan",
    "vegetarian": "vegetarian",
    "jain": "jain",
    "gluten free": "gluten free",
    "gluten-free": "gluten free",
    "dairy free": "dairy free",
    "dairy-free": "dairy free",
    "eggetarian": "eggetarian",
}

_STOP_AFTER = re.compile(r"[.;\n!?]")
_SPLIT_ALLERGY = re.compile(r"\s*(?:,|&|\band\b|\bor\b)\s*", re.IGNORECASE)
# One sentence can hold two facts: "I'm allergic to peanuts and I prefer
# vegetarian food." The allergy capture is deliberately broad, so cut it at the
# next first-person subject before splitting. Otherwise the preference becomes
# an allergy and later triggers a false menu warning.
_CLAUSE_BREAK = re.compile(
    r"(?:^|\s+)(?:(?:and|but|also)\s+)?"
    r"(?:i(?:'m|’m| am)?|we(?:'re| are)?|my|me)\b.*$",
    re.IGNORECASE,
)


def _is_dietary_only(phrase: str) -> bool:
    """Reject preference phrases that broad allergy matching swept in."""
    lowered = (phrase or "").lower()
    if not any(word in lowered for word in DIETARY_WORDS):
        return False
    words = set(re.findall(r"[a-z]+", lowered))
    return not (words & ALLERGEN_VOCABULARY)


def _split_allergy_phrase(phrase: str) -> list[str]:
    """Turn "peanuts, shellfish and dairy" into three separate notes."""
    parts = [
        " ".join(part.split()).strip(" ,.;")
        for part in _SPLIT_ALLERGY.split(phrase or "")
    ]
    return [part[:MAX_ITEM_LENGTH] for part in parts if len(part) >= 2]


def normalise_phone_or_empty(phone: str | None) -> str:
    try:
        return normalize_phone(phone) or ""
    except Exception:
        return ""


def _clean_list(values: list[str] | None) -> list[str]:
    cleaned: list[str] = []
    for raw in values or []:
        text = " ".join(str(raw).split()).strip(" ,.;")
        if not text:
            continue
        text = text[:MAX_ITEM_LENGTH]
        if any(text.lower() == existing.lower() for existing in cleaned):
            continue
        cleaned.append(text)
        if len(cleaned) >= MAX_LIST_ITEMS:
            break
    return cleaned


def serialize_memory(row: CustomerMemory | None) -> dict:
    if row is None or not row.consent_granted:
        return {
            "known": False,
            "display_name": None,
            "allergies": [],
            "dietary_preferences": [],
            "favourite_items": [],
            "usual_fulfillment": None,
            "last_order_summary": None,
        }
    return {
        "known": True,
        "display_name": row.display_name,
        "allergies": _clean_list(row.allergies),
        "dietary_preferences": _clean_list(row.dietary_preferences),
        "favourite_items": _clean_list(row.favourite_items),
        "usual_fulfillment": row.usual_fulfillment,
        "last_order_summary": row.last_order_summary,
    }


def get_memory(db: Session, phone: str | None) -> CustomerMemory | None:
    normalized = normalise_phone_or_empty(phone)
    if not normalized:
        return None
    return db.query(CustomerMemory).filter(CustomerMemory.phone == normalized).first()


def upsert_memory(
    db: Session,
    phone: str,
    *,
    display_name: str | None = None,
    allergies: list[str] | None = None,
    dietary_preferences: list[str] | None = None,
    favourite_items: list[str] | None = None,
    usual_fulfillment: str | None = None,
    last_order_summary: str | None = None,
    notes: str | None = None,
    consent_granted: bool = True,
) -> dict:
    """Create or update the memory row and return the safe serialization.

    A withdrawal of consent deletes the row instead of flagging it, so there is
    no hidden copy left behind.
    """
    normalized = normalise_phone_or_empty(phone)
    if not normalized:
        raise ValueError("A valid phone number is required to store a customer memory.")

    row = db.query(CustomerMemory).filter(CustomerMemory.phone == normalized).first()
    if not consent_granted:
        if row is not None:
            db.delete(row)
            db.commit()
        return serialize_memory(None)

    if row is None:
        row = CustomerMemory(phone=normalized)
        db.add(row)

    if display_name is not None:
        row.display_name = " ".join(display_name.split())[:255] or None
    if allergies is not None:
        row.allergies = _clean_list(allergies)
    if dietary_preferences is not None:
        row.dietary_preferences = _clean_list(dietary_preferences)
    if favourite_items is not None:
        row.favourite_items = _clean_list(favourite_items)
    if usual_fulfillment in {"delivery", "pickup"}:
        row.usual_fulfillment = usual_fulfillment
    if last_order_summary is not None:
        row.last_order_summary = " ".join(last_order_summary.split())[:500] or None
    if notes is not None:
        row.notes = notes[:1000] or None
    row.consent_granted = True

    db.commit()
    db.refresh(row)
    return serialize_memory(row)


def _mentions(message: str) -> tuple[list[str], list[str]]:
    """Extract allergy and dietary phrases from one turn, conservatively."""
    text = message or ""
    allergies: list[str] = []
    seen: set[str] = set()

    def add(phrase: str) -> None:
        trimmed = _CLAUSE_BREAK.sub("", phrase or "").strip(" ,.;&")
        for part in _split_allergy_phrase(trimmed):
            if _is_dietary_only(part):
                continue
            key = part.lower()
            if key and key not in seen:
                seen.add(key)
                allergies.append(part)

    for pattern in ALLERGY_PATTERNS:
        for match in pattern.finditer(text):
            add(_STOP_AFTER.split(match.group(1))[0])
    for match in NEGATION_PATTERN.finditer(text):
        chunk = " " + " ".join(match.group(1).lower().split())
        for term in sorted(ALLERGEN_VOCABULARY, key=len, reverse=True):
            if re.search(rf"(?<![a-z]){re.escape(term)}(?![a-z])", chunk):
                add(term)
    lowered = text.lower()
    preferences = list(
        dict.fromkeys(
            DIETARY_WORDS[word] for word in DIETARY_WORDS if word in lowered
        )
    )
    return _clean_list(allergies), _clean_list(preferences)


def remember_from_turn(
    db: Session,
    phone: str,
    message: str,
    *,
    display_name: str | None = None,
) -> dict:
    """Merge anything the guest just said into their memory.

    Returns the payload with a ``changed`` list so the assistant can say what it
    stored instead of claiming memory silently.
    """
    allergies, preferences = _mentions(message)
    row = get_memory(db, phone)
    existing_allergies = _clean_list(row.allergies) if row else []
    existing_preferences = _clean_list(row.dietary_preferences) if row else []
    merged_allergies = _clean_list(existing_allergies + allergies)
    merged_preferences = _clean_list(existing_preferences + preferences)
    if not merged_allergies and not merged_preferences and row is None:
        return {"memory": serialize_memory(None), "changed": []}

    changed: list[str] = []
    if set(item.lower() for item in merged_allergies) != set(
        item.lower() for item in existing_allergies
    ):
        changed.append("allergies")
    if set(item.lower() for item in merged_preferences) != set(
        item.lower() for item in existing_preferences
    ):
        changed.append("dietary_preferences")
    if not changed:
        return {"memory": serialize_memory(row), "changed": []}

    return {
        "memory": upsert_memory(
            db,
            phone,
            display_name=display_name,
            allergies=merged_allergies,
            dietary_preferences=merged_preferences,
        ),
        "changed": changed,
    }


def apply_latest_order(db: Session, phone: str | None, memory: dict) -> dict:
    """Add the guest's latest real order to a memory payload that was proved.

    The order is read, not copied into the memory row: checkout already keeps
    the order, and copying it here would create a second, independently writable
    profile from an unverified phone box. The caller has already proved the phone
    with a signed session or a real order id, so showing the latest order is the
    same disclosure as order history. A guest with no consented memory row stays
    unknown and gets nothing.
    """
    if not memory or not memory.get("known"):
        return memory
    normalized = normalise_phone_or_empty(phone)
    if not normalized:
        return memory

    order = (
        db.query(RestaurantOrder)
        .filter(RestaurantOrder.customer_phone == normalized)
        .order_by(RestaurantOrder.id.desc())
        .first()
    )
    if order is None:
        return memory

    lines: list[str] = []
    names: list[str] = []
    for item in order.items or []:
        name = " ".join(str(item.get("name") or "").split())
        try:
            quantity = int(item.get("quantity") or 0)
        except (TypeError, ValueError):
            quantity = 0
        if not name or quantity <= 0:
            continue
        lines.append(f"{quantity}x {name}")
        if name.lower() not in {existing.lower() for existing in names}:
            names.append(name)
    if not lines:
        return memory

    kind = (order.order_type or "").strip().lower()
    if kind == "delivery":
        fulfilment = "delivery"
    elif kind in {"pickup", "takeaway"}:
        fulfilment = "pickup"
    else:
        fulfilment = None
    shown = ", ".join(lines[:3])
    if len(lines) > 3:
        shown = f"{shown} +{len(lines) - 3} more"

    enriched = dict(memory)
    enriched["last_order_summary"] = (
        f"{shown} · Rs {float(order.total_amount or 0):.2f} · {fulfilment or kind or 'order'}"[:500]
    )
    enriched["usual_fulfillment"] = fulfilment or memory.get("usual_fulfillment")
    enriched["favourite_items"] = _clean_list(
        names + list(memory.get("favourite_items") or [])
    )
    return enriched


def allergen_conflict(item_allergens: list[str] | None, allergies: list[str]) -> str | None:
    """Return the saved allergy that a menu item declares, if any."""
    if not item_allergens or not allergies:
        return None
    haystack = " ".join(str(value).lower() for value in item_allergens)
    for allergy in allergies:
        needle = allergy.lower().strip()
        if len(needle) < 3:
            continue
        if needle in haystack or any(
            word in haystack for word in needle.split() if len(word) >= 4
        ):
            return allergy
    return None


def filter_recommendations(
    recommendations: list[dict], allergies: list[str]
) -> tuple[list[dict], list[dict]]:
    """Split recommendations into safe suggestions and withheld ones."""
    if not allergies:
        return recommendations, []
    safe: list[dict] = []
    withheld: list[dict] = []
    for item in recommendations:
        conflict = allergen_conflict(item.get("allergens"), allergies)
        if conflict:
            withheld.append({**item, "withheld_for": conflict})
        else:
            safe.append(item)
    return safe, withheld
