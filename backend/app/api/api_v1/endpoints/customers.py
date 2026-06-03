import csv
import io
import re
from collections import defaultdict
from datetime import datetime, timedelta
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field
from sqlalchemy import func, or_
from sqlalchemy.orm import Session

from app.api.deps import get_db, require_roles
from app.models.domain import Customer

router = APIRouter()

VALID_CUSTOMER_SEGMENTS = {
    "all",
    "marketing_opt_in",
    "opted_out",
    "repeat_customers",
    "high_spenders",
    "with_email",
    "missing_email",
    "new_guests",
    "regular_guests",
    "vip_guests",
    "active_customers",
    "comeback_customers",
    "win_back_customers",
}

CUSTOMER_SEGMENT_REPORTS = [
    ("vip_guests", "VIP Guests", "Protect high-value loyalty and premium bundles."),
    ("regular_guests", "Regular Guests", "Move frequent buyers toward VIP behavior."),
    ("new_guests", "New Guests", "Nudge second and third orders before habits fade."),
    ("active_customers", "Active This Week", "Upsell recent buyers while intent is warm."),
    ("comeback_customers", "Comeback Due", "Bring recent lapsing customers back with a light offer."),
    ("win_back_customers", "Win-back Priority", "Recover quiet customers with a stronger reason to return."),
    ("repeat_customers", "Repeat Customers", "Reward customers who have already shown a habit."),
    ("high_spenders", "High Spenders", "Convert larger-ticket guests into repeat premium buyers."),
    ("marketing_opt_in", "Marketing Opt-in", "Reach consented contacts across campaign channels."),
    ("missing_email", "Missing Email", "Clean contact data before richer offer campaigns."),
]


class CustomerCreate(BaseModel):
    name: Optional[str] = None
    phone: str
    email: Optional[str] = None
    opt_in_marketing: bool = True
    notes: Optional[str] = None


class CustomerUpdate(BaseModel):
    name: Optional[str] = None
    email: Optional[str] = None
    opt_in_marketing: Optional[bool] = None
    notes: Optional[str] = None


class CustomerSelfUpdate(BaseModel):
    name: Optional[str] = None
    email: Optional[str] = None
    opt_in_marketing: Optional[bool] = None


class CustomerCsvDryRunRequest(BaseModel):
    csv_text: str = Field(min_length=1, max_length=1_000_000)


CUSTOMER_CSV_HEADER_ALIASES = {
    "customer_name": "name",
    "full_name": "name",
    "mobile": "phone",
    "mobile_number": "phone",
    "phone_number": "phone",
    "contact": "phone",
    "contact_number": "phone",
    "opt_in_marketing": "marketing_opt_in",
    "marketing_consent": "marketing_opt_in",
}
CUSTOMER_CSV_ALLOWED_COLUMNS = {
    "id",
    "name",
    "phone",
    "email",
    "marketing_opt_in",
    "total_orders",
    "total_spend",
    "first_seen_at",
    "last_order_at",
    "notes",
}
CUSTOMER_CSV_TRUE_VALUES = {"1", "true", "yes", "y", "on", "opt_in", "opted_in"}
CUSTOMER_CSV_FALSE_VALUES = {"0", "false", "no", "n", "off", "opt_out", "opted_out", ""}


def normalized_customer_csv_header(value: str) -> str:
    key = re.sub(r"[^a-z0-9]+", "_", (value or "").strip().lower()).strip("_")
    return CUSTOMER_CSV_HEADER_ALIASES.get(key, key)


def canonical_customer_phone(value: str) -> str:
    return re.sub(r"\D", "", (value or "").strip())


def customer_csv_opt_in(value: str) -> tuple[Optional[bool], Optional[str]]:
    normalized = (value or "").strip().lower()
    if normalized in CUSTOMER_CSV_TRUE_VALUES:
        return True, None
    if normalized in CUSTOMER_CSV_FALSE_VALUES:
        return False, None
    return None, "marketing_opt_in must be yes/no, true/false, or 1/0."


def serialize_customer(customer: Customer) -> dict:
    return {
        "id": customer.id,
        "name": customer.name,
        "phone": customer.phone,
        "email": customer.email,
        "opt_in_marketing": customer.opt_in_marketing,
        "total_orders": customer.total_orders,
        "total_spend": customer.total_spend,
        "first_seen_at": customer.first_seen_at.isoformat() if customer.first_seen_at else None,
        "last_order_at": customer.last_order_at.isoformat() if customer.last_order_at else None,
        "notes": customer.notes,
    }


def days_since(value: Optional[datetime]) -> Optional[int]:
    if not value:
        return None
    return max((datetime.utcnow() - value).days, 0)


def customer_tier(customer: Customer) -> tuple[str, str, int, int]:
    total_orders = int(customer.total_orders or 0)
    total_spend = float(customer.total_spend or 0)
    if total_orders >= 10 or total_spend >= 5000:
        return "VIP Slice Club", "Top tier", 100, 0
    if total_orders >= 3 or total_spend >= 1200:
        progress = min(round((total_orders / 10) * 100), 100)
        return "Regular Guest", "VIP Slice Club", progress, max(10 - total_orders, 0)
    progress = min(round((total_orders / 3) * 100), 100)
    return "New Guest", "Regular Guest", progress, max(3 - total_orders, 0)


def customer_cadence(customer: Customer) -> tuple[str, int]:
    age = days_since(customer.last_order_at)
    if age is None:
        return "No order yet", 50
    if age <= 7:
        return "Active this week", 35
    if age <= 30:
        return "Comeback offer due", 75
    return "Win-back priority", 95


def customer_recommended_action(customer: Customer, tier: str, cadence: str) -> str:
    if not customer.opt_in_marketing:
        return "Ask for marketing consent at next order"
    if not customer.email:
        return "Capture email for richer offers"
    if cadence == "Win-back priority":
        return "Send win-back coupon"
    if cadence == "Comeback offer due":
        return "Send comeback reminder"
    if tier == "VIP Slice Club":
        return "Invite to VIP party pack"
    if tier == "Regular Guest":
        return "Send loyalty bundle"
    return "Nudge second or third order"


def serialize_customer_retention(customer: Customer) -> dict:
    tier, next_tier, progress, orders_to_next = customer_tier(customer)
    cadence, priority_score = customer_cadence(customer)
    average_order_value = (
        round(float(customer.total_spend or 0) / int(customer.total_orders or 0), 2)
        if int(customer.total_orders or 0)
        else 0
    )
    if tier == "VIP Slice Club":
        segment = "vip"
    elif tier == "Regular Guest":
        segment = "regular"
    else:
        segment = "new"
    if cadence == "Win-back priority":
        segment = "win_back"
    elif cadence == "Comeback offer due":
        segment = "comeback"
    elif cadence == "Active this week":
        segment = "active"

    if not customer.opt_in_marketing:
        priority_score += 10
    if not customer.email:
        priority_score += 5
    if tier == "VIP Slice Club":
        priority_score += 10

    return {
        **serialize_customer(customer),
        "tier": tier,
        "next_tier": next_tier,
        "tier_progress_percent": progress,
        "orders_to_next_tier": orders_to_next,
        "average_order_value": average_order_value,
        "days_since_last_order": days_since(customer.last_order_at),
        "cadence": cadence,
        "retention_segment": segment,
        "recommended_action": customer_recommended_action(customer, tier, cadence),
        "priority_score": min(priority_score, 100),
    }


def customer_has_email(customer: Customer) -> bool:
    return bool((customer.email or "").strip())


def customer_has_phone(customer: Customer) -> bool:
    return bool((customer.phone or "").strip())


def customer_segment_action(segment: str, row: dict) -> str:
    if row["reachable_count"] == 0:
        return "Clean consent and contact details before launching."
    if segment == "vip_guests":
        return "Send a VIP bundle or early-access offer."
    if segment == "regular_guests":
        return "Send a loyalty bundle to push VIP progress."
    if segment == "new_guests":
        return "Send a second-order nudge."
    if segment == "active_customers":
        return "Upsell add-ons while the order memory is fresh."
    if segment == "comeback_customers":
        return "Send a comeback reminder with a modest coupon."
    if segment == "win_back_customers":
        return "Send a win-back coupon with a stronger hook."
    if segment == "missing_email":
        return "Capture email before email-led campaigns."
    if segment == "high_spenders":
        return "Offer a premium party pack or combo."
    return "Use this segment for the next targeted campaign."


def customer_segment_report_row(
    segment: str,
    label: str,
    intent: str,
    customers: list[Customer],
    total_spend_all: float,
) -> dict:
    customer_count = len(customers)
    order_count = sum(int(customer.total_orders or 0) for customer in customers)
    total_spend = round(sum(float(customer.total_spend or 0) for customer in customers), 2)
    opted_in_count = sum(1 for customer in customers if customer.opt_in_marketing)
    email_ready_count = sum(1 for customer in customers if customer.opt_in_marketing and customer_has_email(customer))
    phone_ready_count = sum(1 for customer in customers if customer.opt_in_marketing and customer_has_phone(customer))
    reachable_count = sum(
        1
        for customer in customers
        if customer.opt_in_marketing and (customer_has_phone(customer) or customer_has_email(customer))
    )
    email_gap_count = max(customer_count - email_ready_count, 0)
    phone_gap_count = max(customer_count - phone_ready_count, 0)
    average_order_value = round(total_spend / order_count, 2) if order_count else 0
    average_customer_value = round(total_spend / customer_count, 2) if customer_count else 0
    readiness_percent = round((reachable_count / customer_count) * 100, 2) if customer_count else 0
    revenue_share_percent = round((total_spend / total_spend_all) * 100, 2) if total_spend_all else 0
    if reachable_count == 0:
        recommended_channel = "cleanup"
    elif phone_ready_count >= email_ready_count:
        recommended_channel = "whatsapp"
    else:
        recommended_channel = "email"
    opportunity_score = round(
        (average_customer_value * 0.25)
        + (reachable_count * 12)
        + (order_count * 4)
        + (readiness_percent * 1.5)
        + (15 if segment in {"comeback_customers", "win_back_customers", "vip_guests"} else 0),
        2,
    )
    row = {
        "segment": segment,
        "label": label,
        "intent": intent,
        "customer_count": customer_count,
        "order_count": order_count,
        "total_spend": total_spend,
        "average_order_value": average_order_value,
        "average_customer_value": average_customer_value,
        "opted_in_count": opted_in_count,
        "reachable_count": reachable_count,
        "email_ready_count": email_ready_count,
        "phone_ready_count": phone_ready_count,
        "email_gap_count": email_gap_count,
        "phone_gap_count": phone_gap_count,
        "readiness_percent": readiness_percent,
        "revenue_share_percent": revenue_share_percent,
        "recommended_channel": recommended_channel,
        "opportunity_score": opportunity_score,
        "customer_list_url": f"/customers?segment={segment}",
    }
    row["recommended_action"] = customer_segment_action(segment, row)
    return row


def retention_counts(customers: list[Customer]) -> dict:
    counts = {
        "new_guests": 0,
        "regular_guests": 0,
        "vip_guests": 0,
        "active_customers": 0,
        "comeback_customers": 0,
        "win_back_customers": 0,
    }
    for customer in customers:
        tier, _, _, _ = customer_tier(customer)
        cadence, _ = customer_cadence(customer)
        if tier == "VIP Slice Club":
            counts["vip_guests"] += 1
        elif tier == "Regular Guest":
            counts["regular_guests"] += 1
        else:
            counts["new_guests"] += 1
        if cadence == "Active this week":
            counts["active_customers"] += 1
        elif cadence == "Comeback offer due":
            counts["comeback_customers"] += 1
        elif cadence == "Win-back priority":
            counts["win_back_customers"] += 1
    return counts


def apply_customer_segment(query, segment: str):
    now = datetime.utcnow()
    comeback_after = now - timedelta(days=7)
    win_back_after = now - timedelta(days=30)
    if segment == "marketing_opt_in":
        return query.filter(Customer.opt_in_marketing.is_(True))
    if segment == "opted_out":
        return query.filter(Customer.opt_in_marketing.is_(False))
    if segment == "repeat_customers":
        return query.filter(Customer.total_orders >= 2)
    if segment == "high_spenders":
        return query.filter(Customer.total_spend >= 500)
    if segment == "with_email":
        return query.filter(Customer.email.isnot(None), Customer.email != "")
    if segment == "missing_email":
        return query.filter(or_(Customer.email.is_(None), Customer.email == ""))
    if segment == "new_guests":
        return query.filter(Customer.total_orders < 3, Customer.total_spend < 1200)
    if segment == "regular_guests":
        return query.filter(
            or_(Customer.total_orders >= 3, Customer.total_spend >= 1200),
            Customer.total_orders < 10,
            Customer.total_spend < 5000,
        )
    if segment == "vip_guests":
        return query.filter(or_(Customer.total_orders >= 10, Customer.total_spend >= 5000))
    if segment == "active_customers":
        return query.filter(Customer.last_order_at >= comeback_after)
    if segment == "comeback_customers":
        return query.filter(
            Customer.last_order_at < comeback_after,
            Customer.last_order_at >= win_back_after,
        )
    if segment == "win_back_customers":
        return query.filter(or_(Customer.last_order_at < win_back_after, Customer.last_order_at.is_(None)))
    return query


def filtered_customer_query(db: Session, segment: str = "all", q: Optional[str] = None):
    if segment not in VALID_CUSTOMER_SEGMENTS:
        raise HTTPException(status_code=422, detail="Unsupported customer segment.")

    query = apply_customer_segment(db.query(Customer), segment)
    if q:
        search = f"%{q.strip()}%"
        query = query.filter(
            or_(
                Customer.name.ilike(search),
                Customer.phone.ilike(search),
                Customer.email.ilike(search),
                Customer.notes.ilike(search),
            )
        )
    return query


@router.get("/")
def list_customers(
    q: Optional[str] = None,
    segment: str = Query("all"),
    db: Session = Depends(get_db),
    session: dict = Depends(require_roles("admin", "staff")),
):
    query = filtered_customer_query(db, segment=segment, q=q)
    customers = query.order_by(Customer.last_order_at.desc().nullslast(), Customer.id.desc()).limit(200).all()
    return [serialize_customer(customer) for customer in customers]


@router.post("/")
def create_or_update_customer(
    payload: CustomerCreate,
    db: Session = Depends(get_db),
    session: dict = Depends(require_roles("admin", "staff")),
):
    phone = payload.phone.strip()
    if not phone:
        raise HTTPException(status_code=422, detail="Phone is required.")

    customer = db.query(Customer).filter(Customer.phone == phone).first()
    if customer is None:
        customer = Customer(phone=phone, first_seen_at=datetime.utcnow())
        db.add(customer)

    customer.name = payload.name
    customer.email = payload.email
    customer.opt_in_marketing = payload.opt_in_marketing
    customer.notes = payload.notes

    db.commit()
    db.refresh(customer)
    return serialize_customer(customer)


@router.get("/summary")
def customer_summary(
    db: Session = Depends(get_db),
    session: dict = Depends(require_roles("admin", "staff")),
):
    total_customers = db.query(func.count(Customer.id)).scalar() or 0
    opted_in = db.query(func.count(Customer.id)).filter(Customer.opt_in_marketing.is_(True)).scalar() or 0
    total_spend = db.query(func.coalesce(func.sum(Customer.total_spend), 0)).scalar() or 0
    repeat_customers = db.query(func.count(Customer.id)).filter(Customer.total_orders > 1).scalar() or 0
    high_spenders = db.query(func.count(Customer.id)).filter(Customer.total_spend >= 500).scalar() or 0
    with_email = (
        db.query(func.count(Customer.id))
        .filter(Customer.email.isnot(None), Customer.email != "")
        .scalar()
        or 0
    )
    customers = db.query(Customer).all()

    return {
        "total_customers": total_customers,
        "opted_in_customers": opted_in,
        "opted_out_customers": max(total_customers - opted_in, 0),
        "repeat_customers": repeat_customers,
        "high_spenders": high_spenders,
        "email_ready_customers": with_email,
        "missing_email_customers": max(total_customers - with_email, 0),
        "recorded_spend": float(total_spend or 0),
        "retention_segments": retention_counts(customers),
    }


@router.get("/segments/report")
def customer_segment_report(
    db: Session = Depends(get_db),
    session: dict = Depends(require_roles("admin", "staff")),
):
    all_customers = db.query(Customer).all()
    total_spend_all = round(sum(float(customer.total_spend or 0) for customer in all_customers), 2)
    total_customers = len(all_customers)
    total_reachable = sum(
        1
        for customer in all_customers
        if customer.opt_in_marketing and (customer_has_phone(customer) or customer_has_email(customer))
    )
    total_email_ready = sum(1 for customer in all_customers if customer.opt_in_marketing and customer_has_email(customer))
    total_phone_ready = sum(1 for customer in all_customers if customer.opt_in_marketing and customer_has_phone(customer))
    rows = []
    for segment, label, intent in CUSTOMER_SEGMENT_REPORTS:
        customers = apply_customer_segment(db.query(Customer), segment).all()
        rows.append(customer_segment_report_row(segment, label, intent, customers, total_spend_all))
    rows.sort(
        key=lambda row: (
            row["opportunity_score"],
            row["total_spend"],
            row["customer_count"],
        ),
        reverse=True,
    )
    strongest_value = max(rows, key=lambda row: row["total_spend"], default=None)
    largest_gap = max(rows, key=lambda row: row["email_gap_count"] + row["phone_gap_count"], default=None)
    return {
        "generated_at": datetime.utcnow().isoformat(),
        "summary": {
            "segment_count": len(rows),
            "total_customers": total_customers,
            "total_spend": total_spend_all,
            "reachable_customers": total_reachable,
            "readiness_percent": round((total_reachable / total_customers) * 100, 2) if total_customers else 0,
            "email_ready_customers": total_email_ready,
            "phone_ready_customers": total_phone_ready,
            "email_gap_customers": max(total_customers - total_email_ready, 0),
            "phone_gap_customers": max(total_customers - total_phone_ready, 0),
        },
        "top_segment": rows[0] if rows else None,
        "strongest_value_segment": strongest_value,
        "largest_cleanup_segment": largest_gap,
        "segments": rows,
    }


@router.get("/export.csv")
def export_customers_csv(
    q: Optional[str] = None,
    segment: str = Query("all"),
    db: Session = Depends(get_db),
    session: dict = Depends(require_roles("admin", "staff")),
):
    customers = (
        filtered_customer_query(db, segment=segment, q=q)
        .order_by(Customer.last_order_at.desc().nullslast(), Customer.id.desc())
        .all()
    )
    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow(
        [
            "id",
            "name",
            "phone",
            "email",
            "marketing_opt_in",
            "total_orders",
            "total_spend",
            "first_seen_at",
            "last_order_at",
            "notes",
        ]
    )
    for customer in customers:
        writer.writerow(
            [
                customer.id,
                customer.name or "",
                customer.phone or "",
                customer.email or "",
                "yes" if customer.opt_in_marketing else "no",
                customer.total_orders or 0,
                round(float(customer.total_spend or 0), 2),
                customer.first_seen_at.isoformat() if customer.first_seen_at else "",
                customer.last_order_at.isoformat() if customer.last_order_at else "",
                customer.notes or "",
            ]
        )

    suffix = segment if segment != "all" else "all"
    return StreamingResponse(
        iter([output.getvalue()]),
        media_type="text/csv",
        headers={"Content-Disposition": f"attachment; filename=customers_{suffix}_export.csv"},
    )


@router.post("/import/validate")
def validate_customer_csv_import(
    payload: CustomerCsvDryRunRequest,
    db: Session = Depends(get_db),
    session: dict = Depends(require_roles("admin")),
):
    csv_text = payload.csv_text.lstrip("\ufeff")
    reader = csv.DictReader(io.StringIO(csv_text))
    if not reader.fieldnames:
        raise HTTPException(status_code=422, detail="CSV header row is required.")

    headers = {
        original: normalized_customer_csv_header(original)
        for original in reader.fieldnames
        if original is not None
    }
    normalized_headers = list(headers.values())
    duplicate_headers = sorted({
        header
        for header in normalized_headers
        if normalized_headers.count(header) > 1
    })
    if duplicate_headers:
        raise HTTPException(
            status_code=422,
            detail=f"CSV contains duplicate mapped header(s): {', '.join(duplicate_headers)}.",
        )
    if "phone" not in normalized_headers:
        raise HTTPException(status_code=422, detail="CSV must include a phone column.")

    ignored_columns = sorted({
        header
        for header in normalized_headers
        if header not in CUSTOMER_CSV_ALLOWED_COLUMNS
    })
    rows = []
    phone_rows: dict[str, list[int]] = defaultdict(list)
    for row_number, source_row in enumerate(reader, start=2):
        normalized_row = {
            headers[key]: (value or "").strip()
            for key, value in source_row.items()
            if key in headers
        }
        if not any(normalized_row.values()):
            continue

        errors = []
        warnings = []
        raw_phone = normalized_row.get("phone", "")
        phone = canonical_customer_phone(raw_phone)
        if not phone:
            errors.append("Phone is required.")
        elif len(phone) < 10 or len(phone) > 15:
            errors.append("Phone must contain 10 to 15 digits.")
        else:
            phone_rows[phone].append(row_number)

        email = normalized_row.get("email", "")
        if email and not re.fullmatch(r"[^@\s]+@[^@\s]+\.[^@\s]+", email):
            errors.append("Email format is invalid.")

        opt_in, opt_in_error = customer_csv_opt_in(
            normalized_row.get("marketing_opt_in", "")
        )
        if opt_in_error:
            errors.append(opt_in_error)
        if "marketing_opt_in" not in normalized_headers:
            warnings.append("Marketing consent column is absent; consent defaults to no.")

        rows.append(
            {
                "row_number": row_number,
                "name": normalized_row.get("name") or None,
                "phone": phone or raw_phone,
                "email": email or None,
                "marketing_opt_in": bool(opt_in),
                "valid": not errors,
                "errors": errors,
                "warnings": warnings,
                "existing_customer_id": None,
            }
        )
        if len(rows) > 5000:
            raise HTTPException(status_code=422, detail="CSV dry-run supports up to 5000 customer rows.")

    candidate_phones = set(phone_rows)
    existing_by_phone = {}
    if candidate_phones:
        for customer in db.query(Customer).all():
            phone = canonical_customer_phone(customer.phone or "")
            if phone in candidate_phones:
                existing_by_phone[phone] = customer.id

    for row in rows:
        row["existing_customer_id"] = existing_by_phone.get(row["phone"])

    duplicate_phone_groups = [
        {"phone": phone, "row_numbers": row_numbers}
        for phone, row_numbers in sorted(phone_rows.items())
        if len(row_numbers) > 1
    ]
    invalid_rows = [row for row in rows if not row["valid"]]
    existing_matches = sum(1 for row in rows if row["existing_customer_id"] is not None)
    ready_for_review = bool(rows) and not invalid_rows and not duplicate_phone_groups

    return {
        "dry_run": True,
        "writes_performed": 0,
        "ready_for_review": ready_for_review,
        "summary": {
            "rows_total": len(rows),
            "rows_valid": len(rows) - len(invalid_rows),
            "rows_invalid": len(invalid_rows),
            "duplicate_phone_groups": len(duplicate_phone_groups),
            "existing_customer_matches": existing_matches,
            "new_customer_candidates": max(len(rows) - existing_matches, 0),
        },
        "headers": {
            "detected": normalized_headers,
            "ignored": ignored_columns,
        },
        "duplicate_phone_groups": duplicate_phone_groups,
        "rows_preview": rows[:20],
        "rollback_plan": "Dry-run only: no records were written. Export customers and create a fresh backup before any future controlled import.",
    }


@router.get("/retention")
def customer_retention(
    limit: int = Query(50, ge=1, le=200),
    db: Session = Depends(get_db),
    session: dict = Depends(require_roles("admin", "staff")),
):
    customers = (
        db.query(Customer)
        .order_by(Customer.last_order_at.desc().nullslast(), Customer.id.desc())
        .limit(500)
        .all()
    )
    retention_rows = [serialize_customer_retention(customer) for customer in customers]
    retention_rows.sort(
        key=lambda customer: (
            customer["priority_score"],
            customer["last_order_at"] or "",
            customer["total_spend"] or 0,
        ),
        reverse=True,
    )
    counts = retention_counts(customers)
    return {
        "generated_at": datetime.utcnow().isoformat(),
        "counts": counts,
        "campaign_ready_count": sum(
            1 for customer in customers if customer.opt_in_marketing and customer.phone
        ),
        "average_order_value": (
            round(
                sum(float(customer.total_spend or 0) for customer in customers)
                / sum(int(customer.total_orders or 0) for customer in customers),
                2,
            )
            if sum(int(customer.total_orders or 0) for customer in customers)
            else 0
        ),
        "customers": retention_rows[:limit],
    }


@router.patch("/profile")
def update_customer_profile(
    payload: CustomerSelfUpdate,
    db: Session = Depends(get_db),
    session: dict = Depends(require_roles("customer")),
):
    phone = (session.get("phone") or "").strip()
    if not phone and str(session.get("subject") or "").startswith("customer:"):
        phone = str(session["subject"]).split("customer:", 1)[1].strip()
    if not phone:
        raise HTTPException(status_code=401, detail="Customer session phone is required.")

    customer = db.query(Customer).filter(Customer.phone == phone).first()
    if customer is None:
        raise HTTPException(status_code=404, detail="Customer profile was not found.")

    updates = (
        payload.model_dump(exclude_unset=True)
        if hasattr(payload, "model_dump")
        else payload.dict(exclude_unset=True)
    )
    if "name" in updates:
        customer.name = updates["name"].strip() if updates["name"] else None
    if "email" in updates:
        customer.email = updates["email"].strip() if updates["email"] else None
    if "opt_in_marketing" in updates:
        customer.opt_in_marketing = bool(updates["opt_in_marketing"])

    db.commit()
    db.refresh(customer)
    return serialize_customer(customer)


@router.patch("/{customer_id}")
def update_customer(
    customer_id: int,
    payload: CustomerUpdate,
    db: Session = Depends(get_db),
    session: dict = Depends(require_roles("admin", "staff")),
):
    customer = db.query(Customer).filter(Customer.id == customer_id).first()
    if customer is None:
        raise HTTPException(status_code=404, detail="Customer not found.")

    updates = (
        payload.model_dump(exclude_unset=True)
        if hasattr(payload, "model_dump")
        else payload.dict(exclude_unset=True)
    )

    if "name" in updates:
        customer.name = updates["name"].strip() if updates["name"] else None
    if "email" in updates:
        customer.email = updates["email"].strip() if updates["email"] else None
    if "opt_in_marketing" in updates:
        customer.opt_in_marketing = bool(updates["opt_in_marketing"])
    if "notes" in updates:
        customer.notes = updates["notes"].strip() if updates["notes"] else None

    db.commit()
    db.refresh(customer)
    return serialize_customer(customer)
