from apscheduler.schedulers.asyncio import AsyncIOScheduler
import logging

logger = logging.getLogger(__name__)

scheduler = AsyncIOScheduler()

def sync_job():
    """Refresh the last linked Google Sheet when scheduled sync is enabled.

    The sheet sync is normally user-triggered from Settings; this job only runs
    when SHEET_AUTO_SYNC_ENABLED is on, and it re-imports the most recently
    linked spreadsheet so existing daily rows are updated instead of guessed.
    """
    from app.core.config import settings

    if not settings.SHEET_AUTO_SYNC_ENABLED:
        return

    from app.db.session import SessionLocal
    from app.models.domain import GoogleSheetSync
    from app.services.sheets_service import SheetsService

    session = SessionLocal()
    try:
        last_sync = (
            session.query(GoogleSheetSync)
            .filter(GoogleSheetSync.sheet_id.isnot(None))
            .order_by(GoogleSheetSync.last_synced_at.desc())
            .first()
        )
        if last_sync is None or not last_sync.sheet_id:
            logger.info("Scheduled sheet sync skipped: no linked Google Sheet yet")
            return
        summary = SheetsService().process_and_import(
            session,
            f"https://docs.google.com/spreadsheets/d/{last_sync.sheet_id}/edit",
        )
        logger.info("Scheduled sheet sync summary: %s", summary)
    except Exception:
        logger.exception("Scheduled sheet sync failed")
    finally:
        session.close()


def social_publish_job():
    from app.services.social_autopublish_service import publish_due_social_posts

    try:
        summary = publish_due_social_posts()
        logger.info("Social auto-publish summary: %s", summary)
    except Exception:
        logger.exception("Social auto-publish job failed")


def campaign_schedule_job():
    from app.db.session import SessionLocal
    from app.services.campaign_schedule_service import activate_due_scheduled_campaigns

    session = SessionLocal()
    try:
        promotions = activate_due_scheduled_campaigns(session)
        if promotions:
            logger.info(
                "Activated due scheduled campaigns: %s",
                [promotion.id for promotion in promotions],
            )
    except Exception:
        logger.exception("Scheduled campaign activation job failed")
    finally:
        session.close()


def saved_reports_job():
    from app.db.session import SessionLocal
    from app.services.report_builder_service import deliver_due_saved_reports

    session = SessionLocal()
    try:
        delivered = deliver_due_saved_reports(session)
        if delivered:
            logger.info("Delivered scheduled reports: %s", delivered)
    except Exception:
        logger.exception("Scheduled report delivery job failed")
    finally:
        session.close()


def aggregator_outbound_job():
    from app.db.session import SessionLocal
    from app.services.aggregator_service import deliver_aggregator_events

    session = SessionLocal()
    try:
        summary = deliver_aggregator_events(session)
        if summary["processed"]:
            logger.info("Aggregator outbound summary: %s", summary)
    except Exception:
        logger.exception("Aggregator outbound delivery job failed")
    finally:
        session.close()


def journey_runner_job():
    from app.db.session import SessionLocal
    from app.services.journey_service import process_due

    session = SessionLocal()
    try:
        summary = process_due(session)
        if summary["processed"]:
            logger.info("Journey runner summary: %s", summary)
    except Exception:
        logger.exception("Journey runner failed")
    finally:
        session.close()


def offer_reminder_job():
    from app.db.session import SessionLocal
    from app.services.offer_service import run_offer_reminders

    session = SessionLocal()
    try:
        summary = run_offer_reminders(session)
        if summary["sent"] or summary["skipped"]:
            logger.info("Offer reminder summary: %s", summary)
    except Exception:
        logger.exception("Offer reminder job failed")
    finally:
        session.close()


def support_sla_job():
    from app.db.session import SessionLocal
    from app.services.support_service import run_sla_notifications

    session = SessionLocal()
    try:
        summary = run_sla_notifications(session)
        if summary["created"]:
            logger.info("Support SLA notification summary: %s", summary)
    except Exception:
        logger.exception("Support SLA notification job failed")
    finally:
        session.close()


def support_pager_resolve_job():
    from app.db.session import SessionLocal
    from app.services.support_alert_delivery import retry_pending_pager_resolutions

    session = SessionLocal()
    try:
        summary = retry_pending_pager_resolutions(session)
        if summary["pending"]:
            logger.info("Support pager resolve retry summary: %s", summary)
    except Exception:
        logger.exception("Support pager resolve retry job failed")
    finally:
        session.close()


def support_sla_retry_job():
    from app.db.session import SessionLocal
    from app.services.support_alert_delivery import retry_due_alerts

    session = SessionLocal()
    try:
        summary = retry_due_alerts(session)
        if summary["attempted"]:
            logger.info("Support SLA retry summary: %s", summary)
    except Exception:
        logger.exception("Support SLA retry job failed")
    finally:
        session.close()
    support_pager_resolve_job()


# Run every 24 hours
scheduler.add_job(sync_job, "interval", hours=24)
scheduler.add_job(
    social_publish_job,
    "interval",
    minutes=5,
    id="social_auto_publish",
    replace_existing=True,
)
scheduler.add_job(
    campaign_schedule_job,
    "interval",
    minutes=10,
    id="campaign_schedule_activation",
    replace_existing=True,
)
scheduler.add_job(
    saved_reports_job,
    "interval",
    minutes=5,
    id="saved_report_delivery",
    replace_existing=True,
)
scheduler.add_job(
    aggregator_outbound_job,
    "interval",
    minutes=1,
    id="aggregator_outbound_delivery",
    replace_existing=True,
)
scheduler.add_job(
    journey_runner_job,
    "interval",
    minutes=1,
    id="marketing_journey_runner",
    replace_existing=True,
)
scheduler.add_job(
    support_sla_job,
    "interval",
    minutes=15,
    id="support_sla_notifications",
    replace_existing=True,
)
scheduler.add_job(
    support_sla_retry_job,
    "interval",
    minutes=5,
    id="support_sla_retries",
    replace_existing=True,
)
scheduler.add_job(
    offer_reminder_job,
    "interval",
    hours=6,
    id="offer_reminders",
    replace_existing=True,
)

def start_scheduler():
    if not scheduler.running:
        scheduler.start()
