from apscheduler.schedulers.asyncio import AsyncIOScheduler
import logging

logger = logging.getLogger(__name__)

scheduler = AsyncIOScheduler()

def sync_job():
    logger.info("Executing scheduled Google Sheets Sync (Placeholder)")
    # Logic to fetch the configured sheet URL from DB or env and sync it.
    pass


def social_publish_job():
    from app.services.social_autopublish_service import publish_due_social_posts

    try:
        summary = publish_due_social_posts()
        logger.info("Social auto-publish summary: %s", summary)
    except Exception:
        logger.exception("Social auto-publish job failed")


# Run every 24 hours
scheduler.add_job(sync_job, "interval", hours=24)
scheduler.add_job(
    social_publish_job,
    "interval",
    minutes=5,
    id="social_auto_publish",
    replace_existing=True,
)

def start_scheduler():
    if not scheduler.running:
        scheduler.start()
