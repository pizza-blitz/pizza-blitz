"""Custom report builder and saved/scheduled report delivery."""

import csv
import io
import re
from datetime import date, datetime, time, timedelta, timezone

from sqlalchemy import func
from sqlalchemy.orm import Session

from app.core.clock import business_today, business_zone
from app.models.domain import RestaurantOrder, SavedReport
from app.services.campaign_dispatch_service import send_campaign_message

METRIC_LABELS = {
    "revenue": "Revenue",
    "orders": "Orders",
    "avg_order_value": "Avg order value",
    "tax": "Tax",
    "discount": "Discount",
    "tips": "Tips",
    "refunds": "Refunds",
}

DIMENSION_LABELS = {
    "day": "Day",    "order_type": "Order type",
    "payment_method": "Payment method",
    "status": "Status",
}
SCHEDULES = {"none", "daily", "weekly", "monthly"}
FILTERS = {"order_type", "payment_method", "status"}
EMAIL_PATTERN = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")


class ReportValidationError(ValueError):
    """The report definition cannot be run."""


def validate_config(metrics: list[str], dimensions: list[str]) -> None:
    if not metrics:
        raise ReportValidationError("Choose at least one metric.")
    unknown_metrics = [metric for metric in metrics if metric not in METRIC_LABELS]
    if unknown_metrics:
        raise ReportValidationError(
            f"Unknown metric: {', '.join(unknown_metrics)}."
        )
    unknown_dimensions = [
        dimension for dimension in dimensions if dimension not in DIMENSION_LABELS
    ]
    if unknown_dimensions:
        raise ReportValidationError(
            f"Unknown dimension: {', '.join(unknown_dimensions)}."
        )
    if len(set(dimensions)) != len(dimensions):
        raise ReportValidationError("Choose each dimension once.")


def parse_recipients(value: str | None) -> list[str]:
    recipients = [
        part.strip() for part in str(value or "").split(",") if part.strip()
    ]
    invalid = [email for email in recipients if not EMAIL_PATTERN.match(email)]
    if invalid:
        raise ReportValidationError(
            f"Enter valid email recipients: {', '.join(invalid)}."
        )
    return recipients


def validate_schedule(schedule: str, recipients: str | None) -> str:
    normalized = (schedule or "none").strip().lower()
    if normalized not in SCHEDULES:
        raise ReportValidationError("Schedule must be none, daily, weekly, or monthly.")
    if normalized != "none" and not parse_recipients(recipients):
        raise ReportValidationError("Add at least one recipient for a scheduled report.")
    return normalized


def _bounds(start_date: date, end_date: date) -> tuple[datetime, datetime]:
    if end_date < start_date:
        raise ReportValidationError("End date must be on or after the start date.")
    if (end_date - start_date).days > 366:
        raise ReportValidationError("Choose a range of 366 days or less.")
    zone = business_zone()
    start_local = datetime.combine(start_date, time.min, tzinfo=zone)
    end_local = datetime.combine(end_date + timedelta(days=1), time.min, tzinfo=zone)
    return (
        start_local.astimezone(timezone.utc).replace(tzinfo=None),
        end_local.astimezone(timezone.utc).replace(tzinfo=None),
    )


def _metric_expression(metric: str):
    if metric == "revenue":
        return func.coalesce(func.sum(RestaurantOrder.total_amount), 0.0)
    if metric == "orders":
        return func.count(RestaurantOrder.id)
    if metric == "tax":
        return func.coalesce(func.sum(RestaurantOrder.tax_amount), 0.0)
    if metric == "discount":
        return func.coalesce(func.sum(RestaurantOrder.discount_amount), 0.0)
    if metric == "tips":
        return func.coalesce(func.sum(RestaurantOrder.tip_amount), 0.0)
    if metric == "refunds":
        return func.coalesce(func.sum(RestaurantOrder.refunded_amount), 0.0)
    raise ReportValidationError(f"Unknown metric: {metric}.")


def _dimension_expression(dimension: str):
    if dimension == "day":
        return RestaurantOrder.date
    if dimension == "order_type":
        return RestaurantOrder.order_type
    if dimension == "payment_method":
        return RestaurantOrder.payment_method
    if dimension == "status":
        return RestaurantOrder.status
    raise ReportValidationError(f"Unknown dimension: {dimension}.")


def _clean(value):
    if isinstance(value, datetime):
        return value.isoformat()
    if isinstance(value, date):
        return value.isoformat()
    if isinstance(value, float):
        return round(value, 2)
    return value


def build_report(
    db: Session,
    *,
    start_date: date,
    end_date: date,
    metrics: list[str],
    dimensions: list[str],
    filters: dict | None = None,
) -> dict:
    validate_config(metrics, dimensions)
    filters = filters or {}
    unknown_filters = [key for key in filters if key not in FILTERS]
    if unknown_filters:
        raise ReportValidationError(
            f"Unknown filter: {', '.join(unknown_filters)}."
        )

    selected_metrics = list(dict.fromkeys(metrics))
    internal_metrics = [
        metric
        for metric in dict.fromkeys(selected_metrics + ["revenue", "orders"])
        if metric != "avg_order_value"
    ]
    start_at, end_at = _bounds(start_date, end_date)

    query = db.query(
        *[_dimension_expression(dimension).label(dimension) for dimension in dimensions],
        *[_metric_expression(metric).label(metric) for metric in internal_metrics],
    ).filter(
        RestaurantOrder.created_at >= start_at,
        RestaurantOrder.created_at < end_at,
        func.coalesce(RestaurantOrder.status, "") != "cancelled",
    )
    for key, value in filters.items():
        if value is None or str(value).strip() == "":
            continue
        query = query.filter(getattr(RestaurantOrder, key) == str(value).strip())
    if dimensions:
        query = query.group_by(
            *[_dimension_expression(dimension) for dimension in dimensions]
        ).order_by(*[_dimension_expression(dimension) for dimension in dimensions])
    rows = query.all()

    records: list[dict] = []
    for row in rows:
        record = {dimension: _clean(getattr(row, dimension)) for dimension in dimensions}
        revenue = float(row._mapping.get("revenue") or 0)
        orders = int(row._mapping.get("orders") or 0)
        record["_revenue"] = revenue
        record["_orders"] = orders
        for metric in selected_metrics:
            if metric == "avg_order_value":
                record[metric] = round(revenue / orders, 2) if orders else 0.0
            else:
                record[metric] = _clean(row._mapping.get(metric))
        records.append(record)

    if not dimensions and not records:
        records = []

    totals: dict = {}
    for metric in selected_metrics:
        if metric == "avg_order_value":
            total_revenue = sum(float(record.get("_revenue", 0)) for record in records)
            total_orders = sum(int(record.get("_orders", 0)) for record in records)
            totals[metric] = (
                round(total_revenue / total_orders, 2) if total_orders else 0.0
            )
        else:
            totals[metric] = round(
                sum(float(record.get(metric) or 0) for record in records), 2
            )

    for record in records:
        record.pop("_revenue", None)
        record.pop("_orders", None)

    return {
        "start_date": start_date.isoformat(),
        "end_date": end_date.isoformat(),
        "columns": dimensions + selected_metrics,
        "dimensions": dimensions,
        "metrics": selected_metrics,
        "rows": records,
        "totals": totals,
        "row_count": len(records),
        "generated_at": datetime.utcnow().isoformat(),
    }


def report_csv(report: dict) -> str:
    buffer = io.StringIO()
    writer = csv.writer(buffer)
    writer.writerow(report["columns"])
    for row in report["rows"]:
        writer.writerow([row.get(column, "") for column in report["columns"]])
    writer.writerow([])
    writer.writerow(["Totals"])
    for metric in report["metrics"]:
        writer.writerow([metric, report["totals"].get(metric, 0)])
    return buffer.getvalue()


def next_run_at(schedule: str, now: datetime | None = None) -> datetime | None:
    current = now or datetime.utcnow()
    if schedule == "daily":
        return current + timedelta(days=1)
    if schedule == "weekly":
        return current + timedelta(days=7)
    if schedule == "monthly":
        return current + timedelta(days=30)
    return None


def run_saved_report(
    db: Session, saved: SavedReport, *, deliver: bool = False
) -> dict:
    end_date = business_today()
    start_date = end_date - timedelta(days=max(int(saved.range_days or 1), 1) - 1)
    report = build_report(
        db,
        start_date=start_date,
        end_date=end_date,
        metrics=list(saved.metrics or []),
        dimensions=list(saved.dimensions or []),
        filters=dict(saved.filters or {}),
    )
    saved.last_run_at = datetime.utcnow()
    saved.next_run_at = next_run_at(saved.schedule)
    if deliver:
        recipients = parse_recipients(saved.recipients)
        if not recipients:
            saved.last_delivery_status = "skipped"
            saved.last_delivery_error = "No recipients configured."
        else:
            subject = f"Pizza Blitz report: {saved.name}"
            lines = [
                f"{report['start_date']} to {report['end_date']}",
                f"Rows: {report['row_count']}",
                "Totals: "
                + ", ".join(
                    f"{METRIC_LABELS.get(metric, metric)} {value}"
                    for metric, value in report["totals"].items()
                ),
                "",
            ]
            for row in report["rows"][:20]:
                lines.append(
                    " | ".join(str(row.get(column, "")) for column in report["columns"])
                )
            lines.append("")
            lines.append("Open Reports in Pizza Blitz to download the full CSV.")
            result = send_campaign_message(
                channel="email",
                destination=recipients[0],
                subject=subject,
                message="\n".join(lines),
            )
            saved.last_delivery_status = result.status
            saved.last_delivery_error = result.error
            for extra in recipients[1:]:
                send_campaign_message(
                    channel="email",
                    destination=extra,
                    subject=subject,
                    message="\n".join(lines),
                )
    db.commit()
    return report


def deliver_due_saved_reports(db: Session) -> list[int]:
    now = datetime.utcnow()
    due = (
        db.query(SavedReport)
        .filter(
            SavedReport.status == "active",
            SavedReport.schedule != "none",
            SavedReport.next_run_at.isnot(None),
            SavedReport.next_run_at <= now,
        )
        .order_by(SavedReport.next_run_at.asc())
        .all()
    )
    delivered: list[int] = []
    for saved in due:
        try:
            run_saved_report(db, saved, deliver=True)
            delivered.append(saved.id)
        except Exception as exc:  # noqa: BLE001 - one bad report must not stop the batch
            db.rollback()
            saved.last_delivery_status = "failed"
            saved.last_delivery_error = str(exc)[:500]
            saved.next_run_at = next_run_at(saved.schedule)
            db.commit()
    return delivered
