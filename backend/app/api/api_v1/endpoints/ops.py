from datetime import date, datetime, time, timedelta

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.api.deps import get_db, require_roles
from app.models.domain import DailySales, Expense, OperationalAuditEvent, RestaurantOrder, ShiftLog
from app.services.operational_audit_service import (
    operational_audit_report,
    record_operational_audit_event,
    serialize_operational_audit_event,
)
from app.services.ops_service import (
    beta_delivery_report,
    create_database_backup,
    credential_activation_report,
    data_quality_report,
    final_acceptance_report,
    launch_candidate_report,
    list_backups,
    live_environment_report,
    production_launch_report,
    readiness_report,
    record_managed_backup_proof,
    run_live_deployment_probe,
    run_sqlite_restore_rehearsal,
)

router = APIRouter()


class ManagedBackupProofRequest(BaseModel):
    proof_type: str = Field(pattern="^(managed_snapshot|pg_dump|restore_rehearsal)$")
    reference: str = Field(min_length=6, max_length=500)
    notes: str | None = Field(default=None, max_length=1000)
    size_bytes: int | None = Field(default=None, ge=0)


class OperationalAuditProofRequest(BaseModel):
    event_type: str = Field(default="security", min_length=2, max_length=80)
    action: str = Field(default="settings_audit_probe", min_length=2, max_length=120)
    resource_type: str = Field(default="settings", min_length=2, max_length=80)
    resource_id: str | None = Field(default=None, max_length=120)
    status: str = Field(default="success", max_length=40)
    detail: str | None = Field(default=None, max_length=1000)
    metadata: dict = Field(default_factory=dict)


class DailyCloseProofRequest(BaseModel):
    manager_name: str | None = Field(default=None, max_length=120)
    notes: str | None = Field(default=None, max_length=1000)


PAYMENT_PROOF_METHODS = {"upi", "card", "mixed", "direct_bank"}


def _money(value: float | int | None) -> float:
    return round(float(value or 0), 2)


def _day_window(day: date) -> tuple[datetime, datetime]:
    return datetime.combine(day, time.min), datetime.combine(day, time.max)


def _latest_audit_event(db: Session, *, event_type: str, action: str, resource_id: str):
    return (
        db.query(OperationalAuditEvent)
        .filter(OperationalAuditEvent.event_type == event_type)
        .filter(OperationalAuditEvent.action == action)
        .filter(OperationalAuditEvent.resource_id == resource_id)
        .order_by(OperationalAuditEvent.created_at.desc(), OperationalAuditEvent.id.desc())
        .first()
    )


def daily_close_command_payload(db: Session, close_date: date | None = None) -> dict:
    close_date = close_date or date.today()
    date_key = close_date.isoformat()
    day_start, day_end = _day_window(close_date)

    orders = (
        db.query(RestaurantOrder)
        .filter(RestaurantOrder.date == close_date)
        .order_by(RestaurantOrder.created_at.desc(), RestaurantOrder.id.desc())
        .all()
    )
    active_orders = [order for order in orders if order.status not in {"closed", "cancelled"}]
    closed_orders = [
        order
        for order in orders
        if order.status == "closed" and (order.payment_status or "").lower() == "paid"
    ]
    kitchen_open_orders = [
        order for order in active_orders if order.status in {"open", "preparing"}
    ]
    ready_unclosed_orders = [order for order in active_orders if order.status == "ready"]
    payment_due_orders = [
        order
        for order in active_orders
        if (order.payment_method or "").lower() == "prepaid"
        and (order.payment_status or "").lower() != "paid"
    ]
    proof_required_orders = [
        order
        for order in active_orders
        if (order.payment_method or "").lower() in PAYMENT_PROOF_METHODS
        and (order.payment_status or "").lower() != "paid"
    ]
    delivery_open_orders = [
        order
        for order in active_orders
        if order.delivery_assignment
        and (order.delivery_assignment.status or "").lower() != "delivered"
    ]

    daily_sales = db.query(DailySales).filter(DailySales.date == close_date).first()
    expenses = (
        db.query(Expense)
        .filter(Expense.date >= day_start, Expense.date <= day_end)
        .order_by(Expense.date.desc(), Expense.id.desc())
        .all()
    )
    missing_receipt_count = sum(
        1 for expense in expenses if not (expense.receipt_photo_url or "").strip()
    )
    high_value_receipt_gap_count = sum(
        1
        for expense in expenses
        if float(expense.amount or 0) >= 1000 and not (expense.receipt_photo_url or "").strip()
    )

    shifts = (
        db.query(ShiftLog)
        .filter(ShiftLog.date == close_date)
        .order_by(ShiftLog.shift_start.asc(), ShiftLog.id.asc())
        .all()
    )
    open_shift_count = sum(1 for shift in shifts if not (shift.shift_end or "").strip())

    latest_drawer_close = _latest_audit_event(
        db,
        event_type="cash_drawer",
        action="cash_drawer_close",
        resource_id=date_key,
    )
    orders_after_drawer_close = 0
    drawer_variance = 0.0
    if latest_drawer_close:
        metadata = latest_drawer_close.metadata_json or {}
        drawer_variance = _money((metadata.get("variance_totals") or {}).get("total"))
        if latest_drawer_close.created_at:
            orders_after_drawer_close = sum(
                1
                for order in closed_orders
                if order.closed_at and order.closed_at > latest_drawer_close.created_at
            )

    latest_daily_close = _latest_audit_event(
        db,
        event_type="daily_close",
        action="daily_close_review",
        resource_id=date_key,
    )
    if not closed_orders:
        drawer_status = "no_sales"
        drawer_detail = "No paid closed orders require a drawer close yet."
    elif not latest_drawer_close:
        drawer_status = "needed"
        drawer_detail = "Cash drawer has not been closed for today."
    elif orders_after_drawer_close:
        drawer_status = "stale"
        drawer_detail = f"{orders_after_drawer_close} order(s) closed after the latest drawer close."
    elif abs(drawer_variance) >= 0.01:
        drawer_status = "variance_review"
        drawer_detail = f"Latest drawer close has Rs {drawer_variance:,.2f} variance."
    else:
        drawer_status = "closed"
        drawer_detail = "Cash drawer is closed and balanced."

    checks = [
        {
            "key": "orders_clear",
            "label": "Orders clear",
            "status": "pass" if not active_orders else "fail",
            "count": len(active_orders),
            "detail": f"{len(active_orders)} active order(s) remain open.",
        },
        {
            "key": "payments_clear",
            "label": "Payments clear",
            "status": "pass" if not payment_due_orders and not proof_required_orders else "fail",
            "count": len(payment_due_orders) + len(proof_required_orders),
            "detail": f"{len(payment_due_orders)} prepaid due and {len(proof_required_orders)} proof gap(s).",
        },
        {
            "key": "kitchen_clear",
            "label": "Kitchen clear",
            "status": "pass" if not kitchen_open_orders else "fail",
            "count": len(kitchen_open_orders),
            "detail": f"{len(kitchen_open_orders)} kitchen order(s) are still open/preparing.",
        },
        {
            "key": "delivery_clear",
            "label": "Delivery clear",
            "status": "pass" if not delivery_open_orders else "fail",
            "count": len(delivery_open_orders),
            "detail": f"{len(delivery_open_orders)} delivery order(s) still need completion.",
        },
        {
            "key": "drawer_closed",
            "label": "Drawer closed",
            "status": "pass" if drawer_status in {"closed", "no_sales"} else "fail",
            "count": orders_after_drawer_close,
            "detail": drawer_detail,
        },
        {
            "key": "expense_review",
            "label": "Expense review",
            "status": "pass" if not high_value_receipt_gap_count else "warn",
            "count": high_value_receipt_gap_count,
            "detail": f"{missing_receipt_count} receipt gap(s), including {high_value_receipt_gap_count} high-value gap(s).",
        },
        {
            "key": "staff_handover",
            "label": "Staff handover",
            "status": "pass" if shifts and not open_shift_count else "warn",
            "count": open_shift_count,
            "detail": f"{len(shifts)} shift log(s), {open_shift_count} without end time.",
        },
    ]

    blocker_count = sum(1 for check in checks if check["status"] == "fail")
    warning_count = sum(1 for check in checks if check["status"] == "warn")
    pass_count = sum(1 for check in checks if check["status"] == "pass")
    readiness_score = round((pass_count / len(checks)) * 100, 1) if checks else 0.0

    if latest_daily_close and blocker_count == 0:
        overall_status = "closed"
        next_action = "Daily close is recorded. Keep monitoring late orders or settlement changes."
    elif blocker_count == 0:
        overall_status = "ready_to_close"
        next_action = "Record the manager daily close proof."
    elif drawer_status == "needed":
        overall_status = "drawer_needed"
        next_action = "Close the cash drawer before daily close proof."
    elif active_orders:
        overall_status = "orders_open"
        next_action = "Clear open orders, kitchen items, delivery handoffs, and payment proof gaps."
    else:
        overall_status = "review_needed"
        next_action = "Review failed controls before recording daily close."

    return {
        "generated_at": datetime.utcnow().isoformat(),
        "date": date_key,
        "summary": {
            "overall_status": overall_status,
            "readiness_score": readiness_score,
            "pass_count": pass_count,
            "warning_count": warning_count,
            "blocker_count": blocker_count,
            "today_order_count": len(orders),
            "active_order_count": len(active_orders),
            "closed_order_count": len(closed_orders),
            "closed_sales_total": _money(sum(float(order.total_amount or 0) for order in closed_orders)),
            "ready_unclosed_count": len(ready_unclosed_orders),
            "payment_due_count": len(payment_due_orders),
            "payment_proof_required_count": len(proof_required_orders),
            "drawer_status": drawer_status,
            "drawer_variance": drawer_variance,
            "orders_after_drawer_close": orders_after_drawer_close,
            "expense_count": len(expenses),
            "expense_total": _money(sum(float(expense.amount or 0) for expense in expenses)),
            "missing_receipt_count": missing_receipt_count,
            "shift_count": len(shifts),
            "open_shift_count": open_shift_count,
            "daily_sales_total": _money(daily_sales.total_sale if daily_sales else 0),
            "daily_expense_total": _money(daily_sales.total_expense if daily_sales else 0),
            "daily_profit": _money(daily_sales.profit if daily_sales else 0),
            "next_action": next_action,
        },
        "checks": checks,
        "queues": {
            "active_orders": [
                {
                    "id": order.id,
                    "status": order.status,
                    "payment_status": order.payment_status,
                    "payment_method": order.payment_method,
                    "customer_name": order.customer_name,
                    "total_amount": _money(order.total_amount),
                }
                for order in active_orders[:8]
            ],
            "expense_gaps": [
                {
                    "id": expense.id,
                    "amount": _money(expense.amount),
                    "description": expense.description,
                    "receipt_photo_url": expense.receipt_photo_url,
                }
                for expense in expenses
                if not (expense.receipt_photo_url or "").strip()
            ][:8],
            "open_shifts": [
                {
                    "id": shift.id,
                    "staff_name": shift.staff_name,
                    "role": shift.role,
                    "shift_start": shift.shift_start,
                }
                for shift in shifts
                if not (shift.shift_end or "").strip()
            ][:8],
        },
        "latest_drawer_close": (
            serialize_operational_audit_event(latest_drawer_close)
            if latest_drawer_close
            else None
        ),
        "latest_daily_close": (
            serialize_operational_audit_event(latest_daily_close)
            if latest_daily_close
            else None
        ),
        "next_actions": [next_action],
    }


@router.get("/readiness")
def production_readiness(
    db: Session = Depends(get_db),
    session: dict = Depends(require_roles("admin")),
):
    return readiness_report(db)


@router.get("/data-quality")
def data_quality_readiness(
    db: Session = Depends(get_db),
    session: dict = Depends(require_roles("admin")),
):
    return data_quality_report(db)


@router.get("/launch-candidate")
def launch_candidate_readiness(
    db: Session = Depends(get_db),
    session: dict = Depends(require_roles("admin")),
):
    return launch_candidate_report(db)


@router.get("/final-acceptance")
def final_acceptance_readiness(
    db: Session = Depends(get_db),
    session: dict = Depends(require_roles("admin")),
):
    return final_acceptance_report(db)


@router.get("/beta-delivery")
def beta_delivery_readiness(
    db: Session = Depends(get_db),
    session: dict = Depends(require_roles("admin")),
):
    return beta_delivery_report(db)


@router.get("/production-launch")
def production_launch_readiness(
    db: Session = Depends(get_db),
    session: dict = Depends(require_roles("admin")),
):
    return production_launch_report(db)


@router.get("/live-environment")
def live_environment_readiness(
    db: Session = Depends(get_db),
    session: dict = Depends(require_roles("admin")),
):
    return live_environment_report(db)


@router.post("/live-deployment-proof/run")
def run_live_deployment_proof(
    request: Request,
    db: Session = Depends(get_db),
    session: dict = Depends(require_roles("admin")),
):
    proof = run_live_deployment_probe(db)
    event = record_operational_audit_event(
        db,
        session=session,
        request=request,
        event_type="deployment",
        action="live_deployment_probe",
        resource_type="public_deployment",
        resource_id=proof.get("base_url"),
        status="success" if proof.get("status") == "pass" else "failed",
        detail=(
            "Live deployment proof passed."
            if proof.get("status") == "pass"
            else "Live deployment proof found failing public checks."
        ),
        metadata={"proof": proof},
    )
    return {"proof": proof, "event": serialize_operational_audit_event(event)}


@router.get("/credential-activation")
def credential_activation_readiness(
    db: Session = Depends(get_db),
    session: dict = Depends(require_roles("admin")),
):
    return credential_activation_report(db)


@router.get("/daily-close-command")
def daily_close_command(
    db: Session = Depends(get_db),
    session: dict = Depends(require_roles("admin", "staff")),
):
    del session
    return daily_close_command_payload(db)


@router.post("/daily-close-command/proof")
def record_daily_close_proof(
    payload: DailyCloseProofRequest,
    request: Request,
    db: Session = Depends(get_db),
    session: dict = Depends(require_roles("admin", "staff")),
):
    command = daily_close_command_payload(db)
    status = "closed" if command["summary"]["blocker_count"] == 0 else "blocked_review"
    event = record_operational_audit_event(
        db,
        session=session,
        request=request,
        event_type="daily_close",
        action="daily_close_review",
        resource_type="business_day",
        resource_id=command["date"],
        status=status,
        detail=(
            "Daily close proof recorded."
            if status == "closed"
            else "Daily close review recorded with unresolved blockers."
        ),
        metadata={
            "manager_name": payload.manager_name,
            "notes": payload.notes,
            "summary": command["summary"],
            "checks": command["checks"],
        },
    )
    return {
        "status": status,
        "event": serialize_operational_audit_event(event),
        "command": daily_close_command_payload(db),
    }


@router.get("/backups")
def backup_history(
    limit: int = Query(20, ge=1, le=100),
    db: Session = Depends(get_db),
    session: dict = Depends(require_roles("admin")),
):
    return {"backups": list_backups(db, limit=limit)}


@router.get("/audit-events")
def list_operational_audit_events(
    limit: int = Query(50, ge=1, le=200),
    db: Session = Depends(get_db),
    session: dict = Depends(require_roles("admin")),
):
    del session
    return operational_audit_report(db, limit=limit)


@router.post("/audit-events/proof")
def create_operational_audit_proof(
    payload: OperationalAuditProofRequest,
    request: Request,
    db: Session = Depends(get_db),
    session: dict = Depends(require_roles("admin")),
):
    event = record_operational_audit_event(
        db,
        session=session,
        request=request,
        event_type=payload.event_type,
        action=payload.action,
        resource_type=payload.resource_type,
        resource_id=payload.resource_id,
        status=payload.status,
        detail=payload.detail or "Admin recorded an operational audit proof.",
        metadata=payload.metadata,
    )
    return {"event": serialize_operational_audit_event(event)}


@router.post("/backups/create")
def create_backup(
    request: Request,
    db: Session = Depends(get_db),
    session: dict = Depends(require_roles("admin")),
):
    backup = create_database_backup(db)
    record_operational_audit_event(
        db,
        session=session,
        request=request,
        event_type="backup",
        action="backup_create",
        resource_type="backup_run",
        resource_id=backup.get("id"),
        detail=f"Database backup created with status {backup.get('status')}.",
        metadata={"status": backup.get("status"), "size_bytes": backup.get("size_bytes")},
    )
    return {"backup": backup}


@router.post("/backups/proof")
def record_backup_proof(
    payload: ManagedBackupProofRequest,
    request: Request,
    db: Session = Depends(get_db),
    session: dict = Depends(require_roles("admin")),
):
    try:
        backup = record_managed_backup_proof(
            db,
            proof_type=payload.proof_type,
            reference=payload.reference,
            notes=payload.notes,
            size_bytes=payload.size_bytes,
        )
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    record_operational_audit_event(
        db,
        session=session,
        request=request,
        event_type="backup",
        action="backup_proof_recorded",
        resource_type="backup_run",
        resource_id=backup.get("id"),
        detail=f"{payload.proof_type} proof recorded for backup readiness.",
        metadata={
            "proof_type": payload.proof_type,
            "reference": payload.reference,
            "size_bytes": payload.size_bytes,
        },
    )
    return {"backup": backup}


@router.post("/backups/restore-rehearsal/run")
def run_restore_rehearsal(
    request: Request,
    db: Session = Depends(get_db),
    session: dict = Depends(require_roles("admin")),
):
    try:
        result = run_sqlite_restore_rehearsal(db)
    except ValueError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    backup = result["backup"]
    record_operational_audit_event(
        db,
        session=session,
        request=request,
        event_type="backup",
        action="restore_rehearsal_run",
        resource_type="backup_run",
        resource_id=backup.get("id"),
        status=backup.get("status", "success"),
        detail="Automated local SQLite restore rehearsal completed.",
        metadata={
            "source_backup": result.get("source_backup"),
            "checks": result.get("checks"),
        },
    )
    return result
