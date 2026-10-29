"""Conversational ordering concierge.

The assistant is deliberately grounded in the same data the storefront uses:
the live menu, public promotions, delivery zones, billing settings, and the
store's opening state. It can answer questions and return executable cart
actions (add, remove, coupon, fulfilment, checkout) that the public site
applies locally.

Gemini is optional. When ``GEMINI_API_KEY`` is present it answers genuinely
open-ended questions; every ordering action still comes from the deterministic
engine, so the concierge keeps working when the model is unavailable.
"""

from __future__ import annotations

import hashlib
import json
import os
import re
from datetime import datetime
from typing import Any, Iterable
from zoneinfo import ZoneInfo

from fastapi import HTTPException
from sqlalchemy.orm import Session

from app.core.clock import business_today
from app.core.config import settings
from app.models.domain import MenuItem, Promotion
from app.services.billing_settings_service import calculate_charges
from app.services.customer_memory_service import (
    allergen_conflict,
    filter_recommendations,
)
from app.services.gemini_service import generate_text
from app.services.menu_customization_service import calculate_customized_item_price
from app.services.payment_gateway import public_payment_checkout_status
from app.services.store_profile_service import (
    get_store_profile,
    serialize_public_profile,
    store_status,
)
from app.api.api_v1.endpoints.storefront import (
    public_delivery_zones,
    public_promotions,
)

MAX_MESSAGE_LENGTH = 500
MAX_CART_LINES = 30
MAX_LINE_QUANTITY = 20
MAX_HISTORY_TURNS = 10
LLM_MAX_OUTPUT_CHARS = 700

STOPWORDS = {
    "a",
    "an",
    "and",
    "any",
    "are",
    "as",
    "at",
    "be",
    "can",
    "do",
    "for",
    "from",
    "get",
    "give",
    "have",
    "i",
    "i'd",
    "i'll",
    "in",
    "is",
    "it",
    "me",
    "my",
    "of",
    "on",
    "one",
    "or",
    "order",
    "please",
    "some",
    "that",
    "the",
    "to",
    "want",
    "we",
    "what",
    "with",
    "would",
    "you",
    "your",
}

NUMBER_WORDS = {
    "a": 1,
    "an": 1,
    "one": 1,
    "two": 2,
    "three": 3,
    "four": 4,
    "five": 5,
    "six": 6,
    "seven": 7,
    "eight": 8,
    "nine": 9,
    "ten": 10,
    "eleven": 11,
    "twelve": 12,
    "couple": 2,
    "pair": 2,
    "dozen": 12,
}

SIZE_WORDS = {
    "r": "R",
    "regular": "R",
    "small": "R",
    "m": "M",
    "medium": "M",
    "mid": "M",
    "l": "L",
    "large": "L",
    "big": "L",
    "family": "L",
    "party": "L",
}

GENERIC_TOKENS = {
    "pizza",
    "pizzas",
    "burger",
    "burgers",
    "sandwich",
    "sandwiches",
    "side",
    "sides",
    "drink",
    "drinks",
    "beverage",
    "beverages",
    "dessert",
    "desserts",
    "food",
    "item",
    "items",
}

FILTER_TERMS = {
    "pizza": {"category": "Pizza"},
    "burger": {"category": "Burgers"},
    "burgers": {"category": "Burgers"},
    "sandwich": {"category": "Sandwiches"},
    "sandwiches": {"category": "Sandwiches"},
    "side": {"category": "Sides"},
    "sides": {"category": "Sides"},
    "drink": {"category": "Beverages"},
    "drinks": {"category": "Beverages"},
    "beverage": {"category": "Beverages"},
    "coffee": {"category": "Beverages"},
    "shake": {"category": "Beverages"},
    "dessert": {"category": "Desserts"},
    "desserts": {"category": "Desserts"},
    "sweet": {"category": "Desserts"},
    "veg": {"vegetarian": True},
    "vegetarian": {"vegetarian": True},
    "vegan": {"vegan": True},
    "spicy": {"spicy": True},
    "hot": {"spicy": True},
}

UPSELL_PRIORITY = {
    "Pizza": ["Sides", "Beverages", "Desserts"],
    "Burgers": ["Sides", "Beverages", "Desserts"],
    "Sandwiches": ["Sides", "Beverages", "Desserts"],
    "Sides": ["Beverages", "Desserts", "Pizza"],
    "Beverages": ["Desserts", "Sides", "Pizza"],
    "Desserts": ["Beverages", "Pizza", "Sides"],
}

GREETING_REPLY = (
    "Hey, I'm Blaze — your Pizza Blitz concierge. Tell me what you're craving, "
    "ask about offers, or say something like \"two margherita pizzas and garlic bread\" "
    "and I'll build the cart for you."
)

# "Repeat my usual" only counts when the words clearly ask for the guest's own
# past order. A bare "again" is too ambiguous to rebuild a cart from.
REPEAT_ORDER_PATTERN = re.compile(
    r"\b(repeat (my |the )?(last |usual )?(order|one)|my usual|the usual|"
    r"order (my |the )?usual|same (as|like) (last time|before)|same order|"
    r"same please|re-?order|order (it |that )?again|my last order|"
    r"last order again)\b"
)

# A message that only picks a fulfilment channel, usually from the
# "Use delivery" / "Use pickup" chip. It has to be acknowledged and move the
# conversation forward, never answered with the delivery-zone list again.
FULFILMENT_ONLY_PATTERN = re.compile(
    r"(?:(?:please\s+)?(?:use|choose|set|switch to|make it|i want|i'd like|id like)\s+)?"
    r"(delivery|pickup|pick up|takeaway|take away|collect)(?:\s+please)?"
)


def _normalise(value: str | None) -> str:
    text = (value or "").lower().replace("₹", " rs ")
    text = re.sub(r"[^a-z0-9\s.'-]", " ", text)
    return re.sub(r"\s+", " ", text).strip()


def _money(value: float | int | None) -> str:
    amount = float(value or 0)
    if amount.is_integer():
        return f"Rs {int(amount):,}"
    return f"Rs {amount:,.2f}"


def _render_option_label(options: Iterable[dict]) -> str:
    names = [str(option.get("option_name") or "") for option in options]
    meaningful = [name for name in names if name and name != "No Combo"]
    return ", ".join(meaningful)


def _line_id(menu_item_id: int, selected_options: list[dict]) -> str:
    """Stable key for one cart line.

    The digest only de-duplicates cart lines inside a conversation, so it is
    explicitly not a security hash.
    """
    payload = json.dumps(selected_options or [], sort_keys=True, default=str)
    digest = hashlib.sha256(payload.encode("utf-8")).hexdigest()[:8]
    return f"{menu_item_id}-{digest}"


def _channel_price_row(item: MenuItem, channel: str):
    for row in item.channel_prices or []:
        if row.channel == channel:
            return row
    return None


def _channel_base_price(item: MenuItem, channel: str) -> float | None:
    """Return the public price for a channel, or None when it is hidden."""
    row = _channel_price_row(item, channel)
    if row is not None:
        if not row.is_available or not row.is_visible:
            return None
        return round(float(row.price or 0), 2)
    return round(float(item.selling_price or 0), 2)


def _price_menu_item(
    db: Session, item: MenuItem, channel: str, selected_options: list[dict] | None = None
) -> dict | None:
    if not item.is_available:
        return None
    base_price = _channel_base_price(item, channel)
    if base_price is None:
        return None
    try:
        priced = calculate_customized_item_price(
            db,
            item,
            selected_options or [],
            base_price_override=base_price,
        )
    except HTTPException:
        return None
    return {
        "id": item.id,
        "name": item.name,
        "category": item.category,
        "base_price": round(float(priced["base_price"]), 2),
        "unit_price": round(float(priced["unit_price"]), 2),
        "customization_total": round(float(priced["customization_total"]), 2),
        "selected_options": priced["selected_options"],
        "image_url": item.image_url,
        "image_alt": item.image_alt,
        "dietary_tags": list(item.dietary_tags or []),
        "allergens": list(item.allergens or []),
        "calories": item.calories,
    }


def _available_menu(db: Session, channel: str) -> list[dict]:
    items = db.query(MenuItem).order_by(MenuItem.name.asc()).all()
    priced: list[dict] = []
    for item in items:
        row = _price_menu_item(db, item, channel)
        if row is not None:
            priced.append(row)
    return priced


def _normalise_cart(
    db: Session, raw_cart: list[dict], channel: str
) -> tuple[list[dict], list[str]]:
    lines: dict[str, dict] = {}
    notices: list[str] = []
    for raw in (raw_cart or [])[:MAX_CART_LINES]:
        if not isinstance(raw, dict):
            continue
        try:
            menu_item_id = int(raw.get("menu_item_id") or 0)
            quantity = int(raw.get("quantity") or 0)
        except (TypeError, ValueError):
            continue
        if menu_item_id <= 0 or quantity <= 0:
            continue
        item = db.query(MenuItem).filter(MenuItem.id == menu_item_id).first()
        if item is None:
            notices.append("An item in the cart is no longer on the menu and was removed.")
            continue
        options = raw.get("selected_options") if isinstance(raw.get("selected_options"), list) else []
        priced = _price_menu_item(db, item, channel, options)
        if priced is None:
            notices.append(f"{item.name} is not available right now and was removed.")
            continue
        quantity = min(quantity, MAX_LINE_QUANTITY)
        line_key = _line_id(item.id, priced["selected_options"])
        existing = lines.get(line_key)
        if existing:
            existing["quantity"] = min(existing["quantity"] + quantity, MAX_LINE_QUANTITY)
            continue
        lines[line_key] = {
            "line_id": line_key,
            "menu_item_id": item.id,
            "name": item.name,
            "category": item.category,
            "quantity": quantity,
            "unit_price": priced["unit_price"],
            "line_total": round(priced["unit_price"] * quantity, 2),
            "selected_options": priced["selected_options"],
            "option_label": _render_option_label(priced["selected_options"]),
            "image_url": item.image_url,
            "image_alt": item.image_alt,
            "dietary_tags": list(item.dietary_tags or []),
            "allergens": list(item.allergens or []),
            "calories": item.calories,
        }
    return list(lines.values()), notices


def _cart_totals(db: Session, lines: list[dict], coupon_code: str | None = None) -> dict:
    subtotal = round(sum(float(line["line_total"]) for line in lines), 2)
    discount = 0.0
    coupon = None
    if coupon_code:
        promo = (
            db.query(Promotion)
            .filter(Promotion.code == coupon_code.strip().upper())
            .first()
        )
        today = business_today()
        if (
            promo
            and promo.start_date <= today <= promo.end_date
            and promo.status in {"active", "scheduled"}
            and (promo.audience or "").strip().lower() == "all_customers"
        ):
            if promo.discount_type == "percentage":
                discount = subtotal * (float(promo.discount_value or 0) / 100)
            else:
                discount = float(promo.discount_value or 0)
            discount = round(min(max(discount, 0), subtotal), 2)
            coupon = {"code": promo.code, "name": promo.name, "discount": discount}
    taxable = max(round(subtotal - discount, 2), 0)
    charges = calculate_charges(db, taxable)
    return {
        "subtotal": subtotal,
        "discount": discount,
        "coupon": coupon,
        "service_charge": charges["service_charge"],
        "tax": charges["tax"],
        "tax_rate": charges["tax_rate"],
        "tax_inclusive": charges["tax_inclusive"],
        "total": charges["total"],
        "count": sum(int(line["quantity"]) for line in lines),
    }


def _items_in_cart(lines: list[dict]) -> set[int]:
    return {int(line["menu_item_id"]) for line in lines}


def _cart_summary(db: Session, lines: list[dict], coupon_code: str | None = None) -> dict:
    totals = _cart_totals(db, lines, coupon_code)
    return {"lines": lines, **totals}


def _find_line_for_text(lines: list[dict], message: str) -> dict | None:
    normalised = _normalise(message)
    best: tuple[float, dict] | None = None
    for line in lines:
        name = _normalise(line["name"])
        base = _normalise(re.sub(r"\([^)]*\)", "", line["name"]))
        if name and name in normalised:
            return line
        tokens = [token for token in re.split(r"\s+", base) if token and token not in STOPWORDS]
        if not tokens:
            continue
        score = sum(1 for token in tokens if re.search(rf"\b{re.escape(token)}", normalised))
        score = score / len(tokens)
        if score >= 0.6 and (best is None or score > best[0]):
            best = (score, line)
    return best[1] if best else None


def _match_item(message: str, available: list[dict]) -> tuple[dict | None, float]:
    normalised = _normalise(message)
    if not normalised:
        return None, 0.0
    size_hint = None
    for word, label in SIZE_WORDS.items():
        if re.search(rf"\b{re.escape(word)}\b", normalised):
            size_hint = label
            break
    token_sets: dict[int, list[str]] = {}
    document_frequency: dict[str, int] = {}
    for item in available:
        base_name = _normalise(re.sub(r"\([^)]*\)", "", item["name"]))
        tokens = [
            token
            for token in re.split(r"\s+", base_name)
            if token and token not in STOPWORDS and len(token) > 1
        ]
        token_sets[item["id"]] = tokens
        for token in set(tokens):
            document_frequency[token] = document_frequency.get(token, 0) + 1
    best: tuple[dict | None, float] = (None, 0.0)
    for item in available:
        full_name = _normalise(item["name"])
        base_name = _normalise(re.sub(r"\([^)]*\)", "", item["name"]))
        tokens = token_sets.get(item["id"], [])
        if not tokens:
            continue
        score = 0.0
        exact_match = bool(full_name and full_name in normalised) or bool(
            base_name and base_name in normalised
        )
        if score == 0.0 and full_name and full_name in normalised:
            score = 1.4
        if base_name and base_name in normalised:
            score = max(score, 1.05)
        if not exact_match:
            matched_tokens = [
                token
                for token in tokens
                if re.search(rf"\b{re.escape(token)}", normalised)
            ]
            distinctive = [token for token in matched_tokens if token not in GENERIC_TOKENS]
            primary = next((token for token in tokens if token not in GENERIC_TOKENS), "")
            if not distinctive and not (primary and primary in normalised):
                continue
            if matched_tokens:
                score = 0.72 * (len(matched_tokens) / len(tokens))
                if len(matched_tokens) == len(tokens):
                    score += 0.22
                if any(document_frequency.get(token) == 1 for token in matched_tokens):
                    score += 0.25
            if primary and len(primary) >= 4 and re.search(
                rf"\b{re.escape(primary)}", normalised
            ):
                score = max(score, 0.9)
        category = _normalise(item.get("category") or "")
        if category and re.search(rf"\b{re.escape(category.rstrip('s'))}s?\b", normalised):
            score += 0.12
        variant = re.search(r"\(([^)]*)\)", item["name"])
        primary_hit = any(
            token not in GENERIC_TOKENS
            and len(token) >= 4
            and re.search(rf"\b{re.escape(token)}", normalised)
            for token in tokens
        )
        if variant and (exact_match or primary_hit or (tokens and all(token in normalised for token in tokens))):
            variant_code = str(variant.group(1)).strip().upper()
            if size_hint and variant_code == size_hint:
                score += 0.28
            elif not size_hint and variant_code == "R":
                score += 0.16
        if score > best[1]:
            best = (item, score)
    if best[1] < 0.58:
        return None, best[1]
    return best


def _extract_quantity(message: str, item_name: str) -> int:
    normalised = _normalise(message)
    blocked = r"(?:people|persons?|guests?|rs|rupees|minutes?|mins?|percent|%)"
    name_tokens = [
        token
        for token in re.split(r"\s+", _normalise(re.sub(r"\([^)]*\)", "", item_name)))
        if token and token not in STOPWORDS and len(token) > 1
    ]
    first_token = name_tokens[0] if name_tokens else ""
    if first_token:
        match = re.search(rf"\b(\d+)\s*(?:x\s*)?(?:[a-z]+\s+){{0,3}}{re.escape(first_token)}", normalised)
        if match and not re.search(rf"\b{re.escape(match.group(1))}\s+{blocked}", normalised):
            return max(1, min(int(match.group(1)), MAX_LINE_QUANTITY))
        word_pattern = "|".join(sorted(NUMBER_WORDS, key=len, reverse=True))
        word_match = re.search(
            rf"\b({word_pattern})\s+(?:[a-z]+\s+){{0,3}}{re.escape(first_token)}",
            normalised,
        )
        if word_match:
            return max(1, min(NUMBER_WORDS[word_match.group(1)], MAX_LINE_QUANTITY))
    leading = re.search(r"\b(\d+)\s*(?:x\b|\b)", normalised)
    if leading and re.search(r"\b(?:add|order|get|bring|send|want|need)\b", normalised):
        if not re.search(rf"\b{re.escape(leading.group(1))}\s+{blocked}", normalised):
            return max(1, min(int(leading.group(1)), MAX_LINE_QUANTITY))
    return 1


def _extract_budget(message: str) -> float | None:
    normalised = _normalise(message)
    match = re.search(
        r"(?:under|below|less than|within|budget(?: of)?|upto|up to|around)\s*(?:rs\s*)?(\d{2,5})",
        normalised,
    )
    if match:
        return float(match.group(1))
    return None


def _message_filters(message: str) -> dict[str, Any]:
    normalised = _normalise(message)
    filters: dict[str, Any] = {}
    for term, rule in FILTER_TERMS.items():
        if re.search(rf"\b{re.escape(term)}\b", normalised):
            filters.update(rule)
    return filters


def _is_vegetarian(item: dict) -> bool:
    tags = [str(tag).lower() for tag in item.get("dietary_tags") or []]
    if any("non" in tag and "veg" in tag for tag in tags):
        return False
    if any("veg" in tag for tag in tags):
        return True
    non_veg_markers = ("chicken", "pepperoni", "meat", "bacon", "fish", "prawn", "mutton")
    name = str(item.get("name") or "").lower()
    return not any(marker in name for marker in non_veg_markers)


def _recommendations(
    available: list[dict],
    message: str,
    lines: list[dict],
    limit: int = 3,
) -> list[dict]:
    filters = _message_filters(message)
    budget = _extract_budget(message)
    in_cart = _items_in_cart(lines)
    categories_in_cart = {str(line.get("category") or "") for line in lines}
    want_vegan = bool(filters.get("vegan"))
    candidates: list[tuple[float, dict, list[str]]] = []
    for item in available:
        if item["id"] in in_cart:
            continue
        reasons: list[str] = []
        score = 0.0
        if "category" in filters and item["category"] != filters["category"]:
            continue
        if filters.get("vegetarian") and not _is_vegetarian(item):
            continue
        if want_vegan:
            tags = " ".join(str(tag).lower() for tag in item.get("dietary_tags") or [])
            if "vegan" not in tags:
                continue
        price = float(item["unit_price"])
        if budget is not None:
            if price > budget:
                continue
            score += 0.8
            reasons.append(f"fits your {_money(budget)} budget")
        if filters.get("category"):
            score += 0.7
            reasons.append(item["category"].lower())
        if filters.get("vegetarian") and _is_vegetarian(item):
            score += 0.5
            reasons.append("vegetarian")
        if filters.get("spicy"):
            name = item["name"].lower()
            if any(word in name for word in ("peri", "jalapeno", "schezwan", "tikka")):
                score += 0.5
                reasons.append("brings the heat")
        complement_categories = UPSELL_PRIORITY.get(next(iter(categories_in_cart), ""), [])
        if item["category"] in complement_categories:
            score += 0.45
            reasons.append(f"pairs well with your {next(iter(categories_in_cart)).lower()}")
        if item["category"] == "Pizza":
            score += 0.2
        if item.get("image_url"):
            score += 0.03
        candidates.append((score, item, reasons))
    if not candidates and budget is not None:
        # A tight budget should still get a useful answer rather than silence.
        for item in available:
            if item["id"] not in in_cart:
                candidates.append((0.1, item, []))
    candidates.sort(key=lambda row: (row[0], -float(row[1]["unit_price"])), reverse=True)
    picks: list[dict] = []
    used_categories: set[str] = set()
    for _score, item, reasons in candidates:
        if len(picks) >= limit:
            break
        if item["category"] in used_categories and len(candidates) > limit:
            continue
        used_categories.add(item["category"])
        reason = ", ".join(reasons) if reasons else f"a menu favourite at {_money(item['unit_price'])}"
        picks.append(
            {
                **_public_item_for_id(item),
                "price": item["unit_price"],
                "selling_price": item["unit_price"],
                "reason": reason[0].upper() + reason[1:],
            }
        )
    if not picks:
        picks = [
            {
                **_public_item_for_id(item),
                "price": item["unit_price"],
                "selling_price": item["unit_price"],
                "reason": "available right now",
            }
            for item in available[:limit]
        ]
    return picks


def _public_item_for_id(item: dict) -> dict:
    return {
        "id": item["id"],
        "name": item["name"],
        "category": item["category"],
        "image_url": item.get("image_url"),
        "image_alt": item.get("image_alt"),
        "dietary_tags": item.get("dietary_tags") or [],
        "allergens": item.get("allergens") or [],
        "calories": item.get("calories"),
    }


def _upsell(available: list[dict], lines: list[dict]) -> dict | None:
    if not lines:
        return None
    in_cart = _items_in_cart(lines)
    categories_in_cart = [str(line.get("category") or "") for line in lines]
    priorities: list[str] = []
    for category in categories_in_cart:
        priorities.extend(UPSELL_PRIORITY.get(category, []))
    for category in priorities:
        for item in available:
            if item["category"] == category and item["id"] not in in_cart:
                return item
    return None


def _offer_label(promo: dict) -> str:
    value = float(promo.get("discount_value") or 0)
    if promo.get("discount_type") == "percentage":
        return f"{value:g}% off"
    return f"{_money(value)} off"


def _best_offer(promotions: list[dict], subtotal: float) -> dict | None:
    best: tuple[float, dict] | None = None
    for promo in promotions:
        if not promo.get("code"):
            continue
        if promo.get("discount_type") == "percentage":
            discount = subtotal * (float(promo.get("discount_value") or 0) / 100)
        else:
            discount = float(promo.get("discount_value") or 0)
        discount = min(max(discount, 0), subtotal)
        if best is None or discount > best[0]:
            best = (discount, promo)
    return best[1] if best and best[0] > 0 else None


def _hours_summary(profile) -> str:
    hours = profile.opening_hours
    if hours is None:
        return "open 24/7"
    if not hours:
        return "closed every day"
    try:
        weekday = datetime.now(ZoneInfo(settings.RESTAURANT_TIMEZONE)).strftime("%a").lower()
    except Exception:
        weekday = datetime.now().strftime("%a").lower()
    today = hours.get(weekday)
    if not today:
        return "closed today"
    return f"today {today.get('open', '')}–{today.get('close', '')}"


def _store_facts(db: Session) -> dict:
    profile = get_store_profile(db)
    public_profile = serialize_public_profile(profile)
    return {
        "profile": public_profile,
        "status": store_status(profile),
        "hours_summary": _hours_summary(profile),
    }


def _store_block(db: Session) -> dict:
    facts = _store_facts(db)
    profile = facts["profile"]
    return {
        "name": profile.get("name"),
        "tagline": profile.get("tagline"),
        "phone": profile.get("phone"),
        "email": profile.get("email"),
        "address_line": profile.get("address_line"),
        "map_url": profile.get("map_url"),
        "instagram_url": profile.get("instagram_url"),
        "prep_time_minutes": profile.get("prep_time_minutes"),
        "hours_summary": facts["hours_summary"],
        "status": facts["status"],
    }


def _quick_replies(options: Iterable[str]) -> list[str]:
    seen: set[str] = set()
    replies: list[str] = []
    for option in options:
        value = str(option).strip()
        if not value or value.lower() in seen:
            continue
        seen.add(value.lower())
        replies.append(value)
    return replies[:4]


def _checkout_blockers(status: dict, paused: bool) -> str | None:
    if paused:
        return "Online ordering is paused right now, but I can still prepare your cart for when it reopens."
    if not status.get("accepting_orders"):
        return "The kitchen is closed right now. I can load the cart and checkout will show the next available time."
    return None


def _llm_enabled() -> bool:
    if os.getenv("ASSISTANT_LLM_ENABLED", "true").strip().lower() in {"0", "false", "no", "off"}:
        return False
    return bool(os.getenv("GEMINI_API_KEY"))


def _llm_model() -> str:
    return os.getenv("GEMINI_ASSISTANT_MODEL", "gemini-2.5-flash")


def _llm_answer(
    *,
    message: str,
    history: list[dict],
    store_block: dict,
    available: list[dict],
    promotions: list[dict],
    cart: dict,
) -> str | None:
    if not _llm_enabled():
        return None
    menu_lines = "\n".join(
        f"- {item['name']} | {item['category']} | {_money(item['unit_price'])}"
        for item in available[:30]
    )
    offer_lines = "\n".join(
        f"- {promo.get('code') or 'no code'}: {promo.get('name')} ({_offer_label(promo)})"
        for promo in promotions
    ) or "- No public offers are running."
    cart_lines = "\n".join(
        f"- {line['quantity']} x {line['name']} = {_money(line['line_total'])}"
        for line in cart.get("lines") or []
    ) or "- Cart is empty."
    conversation = "\n".join(
        f"{turn.get('role', 'user')}: {str(turn.get('content') or '')[:240]}"
        for turn in (history or [])[-6:]
    )
    prompt = (
        "You are Blaze, the in-store ordering concierge for a pizza restaurant. "
        "Reply warmly and directly in at most 55 words. Only use the facts below. "
        "Never invent menu items, prices, offers, opening hours, delivery promises or allergens. "
        "If the answer is not covered, say you are not sure and offer to connect the guest to the store. "
        "Do not mention that you are an AI or a language model.\n\n"
        f"STORE\nName: {store_block.get('name')}\nStatus: {store_block.get('status', {}).get('message')}\n"
        f"Hours: {store_block.get('hours_summary')}\nPhone: {store_block.get('phone') or 'not published'}\n"
        f"Address: {store_block.get('address_line') or 'not published'}\n\n"
        f"MENU (name | category | price)\n{menu_lines}\n\n"
        f"OFFERS\n{offer_lines}\n\n"
        f"CURRENT CART\n{cart_lines}\nSubtotal: {_money(cart.get('subtotal'))}\n\n"
        f"RECENT CONVERSATION\n{conversation or 'None'}\n\n"
        f"GUEST QUESTION: {message[:MAX_MESSAGE_LENGTH]}\n"
        "Answer:"
    )
    try:
        text = generate_text(
            model=_llm_model(),
            contents=prompt,
            missing_key_detail="Assistant is not configured.",
            timeout_ms=9000,
        )
    except Exception:
        return None
    cleaned = re.sub(r"\s+", " ", (text or "").strip())
    if not cleaned:
        return None
    return cleaned[:LLM_MAX_OUTPUT_CHARS]


def _add_lines(
    db: Session,
    lines: list[dict],
    item: dict,
    quantity: int,
    channel: str,
    options: list[dict] | None = None,
) -> tuple[list[dict], dict | None]:
    menu_item = db.query(MenuItem).filter(MenuItem.id == item["id"]).first()
    if menu_item is None:
        return lines, None
    priced = _price_menu_item(db, menu_item, channel, options)
    if priced is None:
        return lines, None
    quantity = max(1, min(int(quantity), MAX_LINE_QUANTITY))
    line_key = _line_id(priced["id"], priced["selected_options"])
    merged = {line["line_id"]: dict(line) for line in lines}
    if line_key in merged:
        merged[line_key]["quantity"] = min(
            int(merged[line_key]["quantity"]) + quantity, MAX_LINE_QUANTITY
        )
        merged[line_key]["line_total"] = round(
            float(merged[line_key]["unit_price"]) * int(merged[line_key]["quantity"]), 2
        )
    else:
        merged[line_key] = {
            "line_id": line_key,
            "menu_item_id": priced["id"],
            "name": priced["name"],
            "category": priced["category"],
            "quantity": quantity,
            "unit_price": priced["unit_price"],
            "line_total": round(priced["unit_price"] * quantity, 2),
            "selected_options": priced["selected_options"],
            "option_label": _render_option_label(priced["selected_options"]),
            "image_url": priced["image_url"],
            "image_alt": priced["image_alt"],
            "dietary_tags": priced["dietary_tags"],
            "allergens": priced["allergens"],
            "calories": priced["calories"],
        }
    return list(merged.values()), merged.get(line_key)


def _handle_add(
    db: Session,
    message: str,
    available: list[dict],
    lines: list[dict],
    channel: str,
) -> tuple[str, list[dict], list[dict], list[str]] | None:
    normalised = _normalise(message)
    add_verbs = re.search(
        r"\b(add|order|get|bring|send|want|need|have|take|include|i'd like|i would like|i'll have|give me)\b",
        normalised,
    )
    if not add_verbs and re.search(
        r"\b(what|which|how|is|are|do|does|can|could|would|tell|show|recommend|suggest|any|menu|price|prices|cost|spicy|veg|vegetarian|vegan|allergen|allergens|contain|contains|calorie|calories|open|close|hours|delivery|track)\b",
        normalised,
    ):
        # "Is the margherita spicy?" is a question, not an order.
        return None
    segments = [
        segment.strip()
        for segment in re.split(r"\s+(?:and|plus|with)\s+|,", normalised)
        if segment.strip()
    ]
    matches: list[tuple[dict, int]] = []
    for segment in segments:
        item, score = _match_item(segment, available)
        if item is None:
            continue
        quantity = _extract_quantity(message if len(segments) == 1 else segment, item["name"])
        matches.append((item, quantity))
    if not matches:
        return None
    if not add_verbs and len(segments) == 1 and len(matches) == 1:
        # A bare item name only confirms an order when a quantity is present.
        if not re.search(
            r"\b(\d+|one|two|three|four|five|six|seven|eight|nine|ten|a|an)\b",
            normalised,
        ):
            return None
    # Do not add the same item twice when a split produced a repeat.
    deduped: list[tuple[dict, int]] = []
    seen: set[int] = set()
    for item, quantity in matches:
        if item["id"] in seen:
            continue
        seen.add(item["id"])
        deduped.append((item, quantity))
    actions: list[dict] = []
    added_labels: list[str] = []
    for item, quantity in deduped[:4]:
        lines, line = _add_lines(db, lines, item, quantity, channel)
        if line is None:
            continue
        actions.append(
            {
                "type": "add_item",
                "quantity": quantity,
                "item": {
                    "menu_item_id": item["id"],
                    "name": item["name"],
                    "unit_price": item["unit_price"],
                    "selected_options": line["selected_options"],
                },
            }
        )
        added_labels.append(f"{quantity} × {item['name']}")
    if not actions:
        return None
    totals = _cart_totals(db, lines)
    reply = f"Added {', '.join(added_labels)}. Your cart is {_money(totals['total'])} for {totals['count']} item{'s' if totals['count'] != 1 else ''}."
    return reply, lines, actions, added_labels


def _handle_remove(
    db: Session,
    message: str,
    lines: list[dict],
) -> tuple[str, list[dict], list[dict]] | None:
    normalised = _normalise(message)
    if not re.search(r"\b(remove|delete|drop|take out|cancel|clear)\b", normalised):
        return None
    if re.search(r"\b(clear|empty|start over|reset)\b", normalised) and re.search(
        r"\b(cart|order|basket)\b", normalised
    ):
        return "Cleared your cart. What would you like instead?", [], [{"type": "clear_cart"}]
    line = _find_line_for_text(lines, normalised)
    if line is None:
        if re.search(r"\bcancel (my |the )?order\b", normalised):
            return (
                "I can't cancel a placed order from chat. Open Track Order and the store will help.",
                lines,
                [{"type": "open_tracking"}],
            )
        return (
            "I couldn't find that item in your cart. Right now it has "
            + (", ".join(f"{row['quantity']} × {row['name']}" for row in lines) or "nothing")
            + ".",
            lines,
            [],
        )
    remaining = [row for row in lines if row["line_id"] != line["line_id"]]
    totals = _cart_totals(db, remaining)
    reply = f"Removed {line['name']}. Your cart is now {_money(totals['total'])}."
    return reply, remaining, [{"type": "remove_item", "menu_item_id": line["menu_item_id"]}]


def assistant_config(db: Session) -> dict:
    status = store_status(get_store_profile(db))
    return {
        "name": "Blaze",
        "greeting": GREETING_REPLY,
        "llm_configured": _llm_enabled(),
        "store": _store_block(db),
        "quick_replies": _quick_replies(
            [
                "Recommend something",
                "Show me offers",
                "What's vegetarian?",
                "Track my order",
            ]
        ),
        "status": status,
    }


def _memory_remark(memory: dict | None) -> str:
    """One sentence that proves the concierge actually remembers the guest."""
    if not memory or not memory.get("known"):
        return ""
    bits: list[str] = []
    allergies = [str(value) for value in memory.get("allergies") or [] if str(value).strip()]
    preferences = [
        str(value) for value in memory.get("dietary_preferences") or [] if str(value).strip()
    ]
    if allergies:
        bits.append("I remember you avoid: " + ", ".join(allergies) + ".")
    if preferences:
        bits.append("You usually go for " + ", ".join(preferences) + ".")
    last_order = str(memory.get("last_order_summary") or "").strip()
    if last_order:
        if len(last_order) > 160:
            last_order = last_order[:157].rstrip() + "…"
        bits.append(f"Last time: {last_order}.")
        bits.append("Want the same, or something new?")
    if not bits:
        name = str(memory.get("display_name") or "").strip()
        if name:
            bits.append(f"Good to see you again, {name}.")
    return " ".join(bits)


def _active_order_line(active_order: dict | None) -> str:
    """One grounded sentence about the guest's live order, or empty."""
    if not active_order or not active_order.get("id"):
        return ""
    order_id = active_order["id"]
    next_action = str(active_order.get("next_action") or "").strip()
    bits = [f"Order #{order_id}: {next_action}" if next_action else f"Order #{order_id} is in progress."]
    eta_window = str(active_order.get("eta_window") or "").strip()
    # Only a duration reads as an ETA; states like "On the way" or "Ready now"
    # are already carried by the next action and would sound wrong after "ETA".
    if eta_window and re.search(r"\d", eta_window) and eta_window.lower() not in next_action.lower():
        bits.append(f"ETA {eta_window}.")
    rider = str(active_order.get("rider") or "").strip()
    if rider:
        bits.append(f"Your rider is {rider}.")
    bits.append("Tap Track my order to follow it live.")
    return " ".join(bits)


def _repeat_order_flow(
    db: Session,
    repeat_order: dict,
    available: list[dict],
    lines: list[dict],
    channel: str,
    coupon: str | None,
) -> tuple[str, list[dict], list[dict], list[str]]:
    """Rebuild the guest's own past order at live menu prices.

    The API layer has already proved the phone and read the order; this only
    turns those lines into cart actions. An item that is gone, hidden for the
    chosen channel, or otherwise unavailable is named and skipped rather than
    guessed at. A saved customisation that no longer exists falls back to the
    standard build, and the reply says so.
    """
    by_id = {int(item["id"]): item for item in available}
    by_name = {_normalise(item["name"]): item for item in available}
    actions: list[dict] = []
    added: list[str] = []
    missing: list[str] = []
    refreshed: list[str] = []
    for wanted in repeat_order.get("items") or []:
        try:
            wanted_id = int(wanted.get("menu_item_id") or 0)
            quantity = int(wanted.get("quantity") or 1)
        except (TypeError, ValueError):
            continue
        target = by_id.get(wanted_id) or by_name.get(_normalise(str(wanted.get("name") or "")))
        if target is None:
            missing.append(str(wanted.get("name") or "an item"))
            continue
        options = wanted.get("selected_options")
        if not isinstance(options, list):
            options = []
        next_lines, line = _add_lines(db, lines, target, quantity, channel, options)
        if line is None and options:
            next_lines, line = _add_lines(db, lines, target, quantity, channel, [])
            if line is not None:
                refreshed.append(target["name"])
        if line is None:
            missing.append(str(target.get("name") or wanted.get("name") or "an item"))
            continue
        lines = next_lines
        actions.append(
            {
                "type": "add_item",
                "quantity": quantity,
                "item": {
                    "menu_item_id": target["id"],
                    "name": target["name"],
                    "unit_price": line["unit_price"],
                    "selected_options": line["selected_options"],
                },
            }
        )
        added.append(f"{quantity} × {target['name']}")
    order_id = repeat_order.get("id")
    if added:
        totals = _cart_totals(db, lines, coupon)
        reply = (
            f"Repeating Order #{order_id}: {', '.join(added)}. "
            f"Your cart is {_money(totals['total'])} with tax — checkout when you're ready."
        )
        if refreshed:
            reply += (
                f" The old customisation for {', '.join(refreshed)} is no longer offered, "
                "so I used the standard build."
            )
        if missing:
            reply += (
                f" I left out {', '.join(missing)} because it is not on the menu right now."
            )
        suggestions = ["Checkout", "What's in my cart?", "Show me offers"]
    else:
        reply = (
            f"I found Order #{order_id}, but none of its items are available right now. "
            "Tell me what you'd like and I'll build a fresh cart."
        )
        suggestions = ["Recommend something", "Show me the menu", "Show me offers"]
    return reply, lines, actions, suggestions


def assistant_chat(
    db: Session,
    *,
    message: str,
    cart: list[dict] | None = None,
    fulfillment: str = "pickup",
    history: list[dict] | None = None,
    coupon_code: str | None = None,
    memory: dict | None = None,
    memory_changed: list[str] | None = None,
    active_order: dict | None = None,
    repeat_order: dict | None = None,
    customer_verified: bool = False,
) -> dict:
    """Return a grounded concierge reply and executable cart actions.

    ``memory`` is the guest's own saved profile, already verified by the API
    layer. It is used in exactly three ways: a greeting that proves the memory,
    filtering recommendations that list a saved allergen, and warning about a
    cart add that lists one. Nothing is inferred beyond what the guest said.
    ``active_order`` is likewise only filled after the API layer proved the
    phone; it lets the guest ask "where is my order?" and get their real state
    instead of a lookup form. ``repeat_order`` follows the same proof and carries
    only the guest's own past lines, so "repeat my usual" rebuilds a cart at
    today's prices without retyping anything.
    """
    text = (message or "").strip()[:MAX_MESSAGE_LENGTH]
    history = (history or [])[-MAX_HISTORY_TURNS:]
    memory_allergies = [
        str(value) for value in (memory or {}).get("allergies") or [] if str(value).strip()
    ]
    effective_fulfillment = "delivery" if fulfillment == "delivery" else "pickup"
    channel = "delivery" if effective_fulfillment == "delivery" else "takeaway"
    normalised = _normalise(text)

    facts = _store_facts(db)
    status = facts["status"]
    profile = facts["profile"]
    paused = bool(profile.get("status", {}).get("state") == "paused")
    available = _available_menu(db, channel)
    lines, notices = _normalise_cart(db, cart or [], channel)
    promotions = public_promotions(db, limit=8)
    coupon = (coupon_code or "").strip().upper() or None

    actions: list[dict] = []
    recommendations: list[dict] = []
    suggestions: list[str] = []
    intent = "fallback"
    source = "rules"

    # Fulfilment switching is applied before totals are computed.
    bare_fulfilment_choice = bool(FULFILMENT_ONLY_PATTERN.fullmatch(normalised))
    if re.search(r"\bdelivery\b", normalised) and not re.search(
        r"\b(deliver|delivery) (area|areas|zone|zones|fee|fees|time|times|address|addresses)\b",
        normalised,
    ):
        already_delivery = effective_fulfillment == "delivery"
        effective_fulfillment = "delivery"
        channel = "delivery"
        lines, notices = _normalise_cart(db, cart or [], channel)
        if (
            not already_delivery
            and not bare_fulfilment_choice
            and not re.search(r"\b(show|what|which|where|do you|how)\b", normalised)
        ):
            actions.append({"type": "set_fulfillment", "order_type": "delivery"})
    elif re.search(r"\b(pickup|pick up|collect|takeaway|take away)\b", normalised):
        if not re.search(r"\b(show|what|which|where|do you|how)\b", normalised):
            already_pickup = effective_fulfillment == "pickup"
            effective_fulfillment = "pickup"
            channel = "takeaway"
            lines, notices = _normalise_cart(db, cart or [], channel)
            if not already_pickup and not bare_fulfilment_choice:
                actions.append({"type": "set_fulfillment", "order_type": "pickup"})

    # 1. Opening greeting (also used by the avatar on first open).
    if not text:
        intent = "greeting"
        reply = GREETING_REPLY
        if paused:
            reply = (
                "Hey, I'm Blaze — your Pizza Blitz concierge. Online ordering is paused right now, "
                "but I can still help you plan a cart and answer questions."
            )
        elif not status.get("accepting_orders"):
            reply = (
                "Hey, I'm Blaze — your Pizza Blitz concierge. The kitchen is closed at the moment, "
                "but I can help you plan an order for the next available slot."
            )
        remark = _memory_remark(memory)
        if remark:
            reply = f"{remark} {reply}"
        if active_order:
            order_line = _active_order_line(active_order)
            if order_line:
                reply = f"{reply} {order_line}"
        recommendations = _recommendations(available, "popular", lines)
        suggestions = _quick_replies(
            ["Repeat my usual", "Recommend something", "Show me offers", "Track my order"]
            if repeat_order
            else ["Recommend something", "Show me offers", "Track my order"]
        )
    # 2. Order tracking.
    elif re.search(r"\b(track|tracking|where is my order|order status|status of my order)\b", normalised):
        intent = "tracking"
        order_line = _active_order_line(active_order)
        if order_line:
            reply = order_line
            actions.append(
                {
                    "type": "open_tracking",
                    "order_id": active_order["id"],
                    "href": active_order.get("tracking_href") or "/track",
                }
            )
        else:
            reply = (
                "I can open live tracking. You'll need the order id and the phone number used at checkout."
            )
            actions.append({"type": "open_tracking"})
        suggestions = ["Show me offers", "Start a new order", "Call the store"]
    # 2b. Repeat the guest's own last order (only after the phone proof).
    elif REPEAT_ORDER_PATTERN.search(normalised):
        intent = "repeat_order"
        if not repeat_order:
            if customer_verified:
                reply = (
                    "I don't have a past order on this number yet, so there's nothing "
                    "to repeat. Tell me what you'd like and I'll build the cart."
                )
                recommendations = _recommendations(available, "popular", lines)
                suggestions = ["Recommend something", "Show me the menu", "Show me offers"]
            else:
                reply = (
                    "I can repeat your last order once I confirm your phone. Sign in "
                    "from your account, or provide the phone and order id used at checkout."
                )
                actions.append({"type": "open_url", "url": "/account", "label": "Sign in"})
                suggestions = ["Start a new order", "Show me the menu", "Track my order"]
        else:
            kind = repeat_order.get("order_type")
            # Follow the last order's fulfilment unless the guest just named one.
            if not re.search(r"\b(delivery|pickup|pick up|collect|takeaway|take away)\b", normalised):
                if kind == "delivery" and effective_fulfillment != "delivery":
                    effective_fulfillment = "delivery"
                    channel = "delivery"
                    lines, notices = _normalise_cart(db, cart or [], channel)
                    actions.append({"type": "set_fulfillment", "order_type": "delivery"})
                elif kind in {"pickup", "takeaway"} and effective_fulfillment != "pickup":
                    effective_fulfillment = "pickup"
                    channel = "takeaway"
                    lines, notices = _normalise_cart(db, cart or [], channel)
                    actions.append({"type": "set_fulfillment", "order_type": "pickup"})
            reply, lines, repeat_actions, suggestions = _repeat_order_flow(
                db, repeat_order, available, lines, channel, coupon
            )
            actions.extend(repeat_actions)
    # 3. Store hours, address, contact, status.
    elif re.search(
        r"\b(hours?|open now|are you open|closing|closed|opening time|address|located|location|where are you|phone|contact|email)\b",
        normalised,
    ) and not re.search(r"\b(add|order|remove|cart)\b", normalised):
        intent = "store_info"
        status_message = status.get("message") or "Online ordering is available."
        bits = [f"We're {facts['hours_summary']}. {status_message}"]
        if profile.get("address_line"):
            bits.append(f"Find us at {profile['address_line']}.")
        if profile.get("phone"):
            bits.append(f"Call {profile['phone']} if you need the kitchen.")
        reply = " ".join(bits)
        if profile.get("map_url"):
            actions.append({"type": "open_url", "url": profile["map_url"], "label": "Open in maps"})
        if profile.get("phone"):
            actions.append({"type": "call_store", "phone": profile["phone"]})
        suggestions = ["Show me the menu", "What offers are on?", "Delivery areas"]
    # 4. Payment methods.
    elif re.search(r"\b(payment|pay|card|cash|upi|online payment|prepaid)\b", normalised):
        intent = "payments"
        payment = public_payment_checkout_status()
        methods = []
        if payment.get("cash_available"):
            methods.append("cash at pickup or delivery")
        if payment.get("prepaid_available"):
            methods.append("secure online prepayment")
        reply = (
            "You can pay with " + " or ".join(methods) + ". The exact options appear at checkout."
            if methods
            else "Payment options are confirmed at checkout by the store."
        )
        suggestions = ["Start my order", "What offers are on?", "Delivery areas"]
    # 5. Offers and coupons.
    elif re.search(r"\b(offer|offers|discount|discounts|coupon|coupons|promo|promos|deal|deals|save)\b", normalised):
        intent = "offers"
        coded = [promo for promo in promotions if promo.get("code")]
        if not coded:
            reply = (
                "No public coupon is running this minute. Prices are still calculated server-side at checkout."
            )
            suggestions = ["Recommend something", "Show me the menu", "Start my order"]
        else:
            offer_text = "; ".join(
                f"{promo['code']} — {_offer_label(promo)} ({promo.get('description') or promo.get('name')})"
                for promo in coded[:3]
            )
            best = _best_offer(coded, _cart_totals(db, lines)["subtotal"]) if lines else None
            if best:
                reply = f"Best live offer for your cart: {best['code']} — {_offer_label(best)}. I can apply it. Others: {offer_text}."
                actions.append(
                    {
                        "type": "apply_coupon",
                        "code": best["code"],
                        "label": _offer_label(best),
                    }
                )
                coupon = coupon or best["code"]
                suggestions = [f"Apply {best['code']}", "Add a dessert", "Checkout"]
            else:
                reply = f"Live offers: {offer_text}. Add items and I'll apply the best code for you."
                suggestions = [f"Apply {coded[0]['code']}", "Recommend something", "Start my order"]
                if coded[0].get("code"):
                    actions.append(
                        {
                            "type": "apply_coupon",
                            "code": coded[0]["code"],
                            "label": _offer_label(coded[0]),
                        }
                    )
    # 6. Allergens and dietary questions.
    elif re.search(r"\b(allerg|gluten|vegan|dairy|nut|nuts|calorie|calories|ingredient|ingredients)\b", normalised):
        intent = "dietary"
        item, _ = _match_item(normalised, available)
        if item and item.get("allergens"):
            reply = (
                f"{item['name']} lists these allergens: {', '.join(item['allergens'])}. "
                "Our kitchen uses shared equipment, so please confirm with the store before ordering."
            )
        elif item:
            reply = (
                f"We don't have a confirmed allergen list for {item['name']} in the menu data. "
                "Our kitchen handles wheat, dairy, soy, and nuts, so please call the store before ordering."
            )
        elif "calorie" in normalised:
            with_calories = [row for row in available if row.get("calories")]
            if with_calories:
                reply = "Calories on the menu: " + "; ".join(
                    f"{row['name']} {row['calories']} kcal" for row in with_calories[:5]
                ) + "."
            else:
                reply = "The kitchen hasn't published calorie counts yet. Ask the store for current nutrition details."
        elif "vegan" in normalised:
            vegan_items = [
                row
                for row in available
                if any("vegan" in str(tag).lower() for tag in row.get("dietary_tags") or [])
            ]
            reply = (
                "Vegan options right now: " + ", ".join(row["name"] for row in vegan_items) + "."
                if vegan_items
                else "We don't list a guaranteed vegan item right now. Please check with the store before ordering."
            )
        elif "gluten" in normalised:
            reply = (
                "Our kitchen handles wheat on shared equipment, so we can't promise a gluten-free item. "
                "Please call the store before ordering."
            )
        else:
            reply = (
                "Our kitchen handles wheat, dairy, soy, and nuts on shared equipment. "
                "Tell me the item and I'll share what the menu data lists, or call the store to confirm."
            )
        suggestions = ["Show me vegetarian picks", "What offers are on?", "Call the store"]
    # 6b. A bare fulfilment choice ("Delivery, please") confirms the channel.
    # This is what the "Use delivery" / "Use pickup" chip sends. It must move
    # the conversation on; answering with the zone list again read as stuck.
    elif bare_fulfilment_choice:
        intent = "set_fulfillment"
        chosen = "delivery" if "delivery" in normalised else "pickup"
        effective_fulfillment = chosen
        channel = "delivery" if chosen == "delivery" else "takeaway"
        lines, notices = _normalise_cart(db, cart or [], channel)
        totals = _cart_totals(db, lines, coupon)
        label = "Delivery" if chosen == "delivery" else "Pickup"
        if lines:
            reply = (
                f"{label} it is — {totals['count']} item"
                f"{'s' if totals['count'] != 1 else ''} at {_money(totals['total'])}. "
                'Say "checkout" when you are ready, or tell me what else to add.'
            )
            actions.append({"type": "start_checkout", "order_type": chosen})
            suggestions = _quick_replies(["Checkout", "What's in my cart?", "Show me offers"])
        else:
            reply = f"{label} it is. Tell me what you'd like and I'll add it to the cart."
            recommendations = _recommendations(available, "popular", lines, limit=3)
            suggestions = _quick_replies(
                ["Recommend something", "Show me the menu", "Show me offers"]
            )
    # 7. Delivery areas, fees and minimums.
    elif re.search(r"\b(deliver|delivery|delivery areas?|zones?|minimum|delivery fee|how far)\b", normalised):
        # "Two margheritas for delivery" is an order with a channel, not a
        # question about zones. Try the cart parser first so the items land.
        if re.search(r"\b(deliver|delivery)\b", normalised) and channel != "delivery":
            effective_fulfillment = "delivery"
            channel = "delivery"
            lines, notices = _normalise_cart(db, cart or [], channel)
        add_result = _handle_add(db, normalised, available, lines, channel)
        if add_result is not None:
            intent = "add_item"
            reply, lines, add_actions, _ = add_result
            actions.extend(add_actions)
            upsell = _upsell(available, lines)
            if upsell:
                reply += f" Want {upsell['name']} with that?"
                suggestions.append(f"Add {upsell['name']}")
            suggestions.extend(["Checkout", "Show me offers"])
            recommendations = _recommendations(available, normalised, lines, limit=2)
        else:
            intent = "delivery"
            zones = public_delivery_zones(db)
            if not zones:
                reply = "No delivery zones are published right now. Pickup is still available at checkout."
            else:
                labels = []
                for zone in zones[:5]:
                    eta = zone.get("eta_window") or (
                        f"{zone.get('eta_min_minutes')}–{zone.get('eta_max_minutes')} min"
                        if zone.get("eta_max_minutes")
                        else "ETA at checkout"
                    )
                    labels.append(
                        f"{zone.get('name')} ({_money(zone.get('delivery_fee'))} fee, {eta})"
                    )
                reply = (
                    "We deliver to " + "; ".join(labels) + ". "
                    "The exact fee and minimum are confirmed against your address at checkout."
                )
            actions.append({"type": "set_fulfillment", "order_type": "delivery"})
            suggestions = ["Start my order", "Show me the menu", "What offers are on?"]
    # 8. Checkout.
    elif re.search(
        r"\b(checkout|check out|place (the |my )?order|place it|pay now|finalize|finalise|confirm order|that's all|thats all|i'm done|im done)\b",
        normalised,
    ):
        intent = "checkout"
        totals = _cart_totals(db, lines, coupon)
        blocker = _checkout_blockers(status, paused)
        if not lines:
            reply = "Your cart is empty. Tell me what you'd like and I'll add it, then I can start checkout."
            suggestions = _quick_replies(["Recommend something", "Show me offers", "Show me the menu"])
        else:
            reply = (
                f"Your cart is {_money(totals['total'])} for {totals['count']} item"
                f"{'s' if totals['count'] != 1 else ''}. I've opened checkout with it preloaded — "
                "add your name, phone, and payment to place the order."
            )
            if blocker:
                reply = f"{blocker} I've loaded the cart so nothing is lost."
            actions.append({"type": "start_checkout", "order_type": effective_fulfillment})
            if coupon:
                actions.append({"type": "apply_coupon", "code": coupon})
            suggestions = ["Track an order", "Show me offers", "Add a drink"]
    # 9. Cart review.
    elif re.search(r"\b(what'?s in my (cart|order)|show (me )?my (cart|order)|my cart|cart summary)\b", normalised):
        intent = "cart_review"
        totals = _cart_totals(db, lines, coupon)
        if not lines:
            reply = "Your cart is empty. Tell me what sounds good and I'll add it."
            suggestions = _quick_replies(["Recommend something", "Show me offers", "Show me the menu"])
        else:
            lines_text = "; ".join(
                f"{line['quantity']} × {line['name']}"
                + (f" ({line['option_label']})" if line.get("option_label") else "")
                for line in lines
            )
            reply = (
                f"Your cart has {lines_text}. Subtotal {_money(totals['subtotal'])}, "
                f"total with tax {_money(totals['total'])}."
            )
            upsell = _upsell(available, lines)
            if upsell:
                reply += f" Want {upsell['name']} to go with it?"
                suggestions.append(f"Add {upsell['name']}")
            suggestions.extend(["Checkout", "Show me offers"])
    # 10. Remove items, then add items, then recommendations and open questions.
    else:
        removal = _handle_remove(db, normalised, lines)
        if removal is not None:
            intent = "remove_item"
            reply, lines, remove_actions = removal
            actions.extend(remove_actions)
            recommendations = _recommendations(available, normalised, lines)
            suggestions = ["Checkout", "Show me offers", "Add a dessert"]
        else:
            add_result = _handle_add(db, normalised, available, lines, channel)
            if add_result is not None:
                intent = "add_item"
                reply, lines, add_actions, _ = add_result
                actions.extend(add_actions)
                upsell = _upsell(available, lines)
                totals = _cart_totals(db, lines)
                if upsell:
                    reply += f" Want {upsell['name']} with that?"
                    suggestions.append(f"Add {upsell['name']}")
                suggestions.extend(["Checkout", "Show me offers"])
                recommendations = _recommendations(available, normalised, lines, limit=2)
            else:
                # Recommendations and open-ended questions.
                clarification = re.search(
                    r"\b(add|get me|bring|send|i want|i'd like|i'll have|give me|i would like)\b",
                    normalised,
                )
                asks_for_help = re.search(
                    r"\b(recommend|suggest|what should|what's good|whats good|best|popular|favourite|favorite|hungry|mood|something|menu|options?|spicy|sweet|veg|vegetarian|vegan|drink|dessert|side|pizza|burger|sandwich|coffee|under|below|budget)\b",
                    normalised,
                )
                asks_for_veg = re.search(r"\b(veg|vegetarian|vegan)\b", normalised)
                if clarification and not (asks_for_help or asks_for_veg):
                    intent = "add_item"
                    recommendations = _recommendations(available, normalised, lines)
                    reply = (
                        "I couldn't match that exact item on the live menu. "
                        + (
                            f"Closest picks are {recommendations[0]['name']} and {recommendations[1]['name']}. "
                            if len(recommendations) > 1
                            else f"The closest pick is {recommendations[0]['name']}. "
                            if recommendations
                            else "Try the full menu and I can search by name. "
                        )
                        + "Say \"add\" plus the item name and I'll put it straight in the cart."
                    )
                    suggestions = _quick_replies(
                        [f"Add {row['name']}" for row in recommendations[:2]]
                        + ["Show me the menu", "Show me offers"]
                    )
                elif asks_for_help or asks_for_veg:
                    intent = "recommend"
                    recommendations = _recommendations(available, normalised, lines)
                    filters = _message_filters(normalised)
                    budget = _extract_budget(normalised)
                    qualifier = []
                    if filters.get("vegetarian"):
                        qualifier.append("vegetarian")
                    if filters.get("category"):
                        qualifier.append(str(filters["category"]).lower())
                    if budget:
                        qualifier.append(f"under {_money(budget)}")
                    label = (" " + " ".join(qualifier)) if qualifier else ""
                    if recommendations:
                        reply = (
                            f"Here are my{label} picks. Tap one or say \"add {recommendations[0]['name']}\" "
                            "and I'll build the cart."
                        )
                    else:
                        reply = (
                            f"I couldn't find a{label} match right now. Try a broader budget or ask me for the full menu."
                        )
                    suggestions = _quick_replies(
                        [
                            f"Add {recommendations[0]['name']}" if recommendations else "Show me the menu",
                            "What offers are on?",
                            "Start my order",
                        ]
                    )
                elif re.search(r"\b(hi|hello|hey|good morning|good evening|namaste)\b", normalised) and len(normalised) < 40:
                    intent = "greeting"
                    reply = GREETING_REPLY
                    remark = _memory_remark(memory)
                    if remark:
                        reply = f"{remark} {reply}"
                    recommendations = _recommendations(available, "popular", lines, limit=3)
                    suggestions = _quick_replies(
                        ["Recommend something", "Show me offers", "Track my order"]
                    )
                elif re.search(r"\b(thanks|thank you|thankyou|great|awesome|perfect)\b", normalised):
                    intent = "thanks"
                    reply = "Happy to help. Your cart is saved — say \"checkout\" whenever you're ready."
                    suggestions = ["Checkout", "Show me offers", "Add a dessert"]
                else:
                    # Let Gemini answer genuinely open-ended questions, grounded
                    # in the same live facts, then fall back to a useful menu reply.
                    llm_reply = _llm_answer(
                        message=text,
                        history=history,
                        store_block=_store_block(db),
                        available=available,
                        promotions=promotions,
                        cart=_cart_summary(db, lines, coupon),
                    )
                    if llm_reply:
                        intent = "question"
                        source = "gemini"
                        reply = llm_reply
                        suggestions = _quick_replies(
                            ["Show me offers", "Recommend something", "Start my order"]
                        )
                    else:
                        intent = "fallback"
                        reply = (
                            "I can build your order, find live offers, explain the menu, "
                            "check delivery areas, or open order tracking. Try \"add two margherita pizzas\" "
                            "or \"what's vegetarian?\"."
                        )
                        recommendations = _recommendations(available, normalised, lines)
                        suggestions = _quick_replies(
                            ["Recommend something", "Show me offers", "Show me the menu"]
                        )

    # Coupon selection from an explicit message, e.g. "apply FAMILY20".
    if intent != "offers" and text:
        upper_text = text.upper()
        for promo in promotions:
            requested = str(promo.get("code") or "")
            if not requested:
                continue
            if not re.search(rf"\b{re.escape(requested)}\b", upper_text):
                continue
            coupon = requested
            if not any(
                action.get("type") == "apply_coupon" and action.get("code") == requested
                for action in actions
            ):
                actions.append(
                    {
                        "type": "apply_coupon",
                        "code": requested,
                        "label": _offer_label(promo),
                    }
                )
            if intent in {"fallback", "greeting"}:
                intent = "offers"
                reply = f"Applied {requested} — {_offer_label(promo)}. Your discount is calculated at checkout."
            break

    # A saved allergy only earns its keep if it changes what is offered.
    withheld: list[dict] = []
    if memory_allergies and recommendations:
        recommendations, withheld = filter_recommendations(
            recommendations, memory_allergies
        )
        if withheld and not recommendations:
            names = ", ".join(
                str(item.get("name") or "an item") for item in withheld[:3]
            )
            reply += (
                f" I held back {names} because the menu lists your saved allergy."
            )

    # The guest can still order what they ask for, but never silently.
    added_ids = set()
    for action in actions:
        if action.get("type") != "add_item":
            continue
        item = action.get("item") if isinstance(action.get("item"), dict) else {}
        menu_item_id = int(item.get("menu_item_id") or action.get("menu_item_id") or 0)
        if menu_item_id:
            added_ids.add(menu_item_id)
    if memory_allergies and added_ids:
        for item in available:
            if int(item.get("id") or 0) not in added_ids:
                continue
            conflict = allergen_conflict(item.get("allergens"), memory_allergies)
            if conflict:
                reply += (
                    f" Heads up: {item['name']} lists {conflict}, which is on your saved "
                    "food note. Tell me to remove it if that is not safe for you."
                )
                break

    if memory_changed:
        labels = {"allergies": "allergies", "dietary_preferences": "dietary preferences"}
        saved = " and ".join(
            labels.get(name, name.replace("_", " ")) for name in memory_changed
        )
        reply += f" I saved your {saved} for next time."

    cart_block = _cart_summary(db, lines, coupon)
    notices = list(dict.fromkeys(notices))
    if notices:
        reply = f"{reply} ({' '.join(notices)})"

    return {
        "reply": reply,
        "intent": intent,
        "source": source,
        "actions": actions,
        "recommendations": recommendations,
        "suggestions": suggestions,
        "cart": cart_block,
        "fulfillment": effective_fulfillment,
        "store": _store_block(db),
        "memory": memory or {"known": False},
        "memory_changed": list(memory_changed or []),
        "llm": {"configured": _llm_enabled(), "used": source == "gemini"},
    }
