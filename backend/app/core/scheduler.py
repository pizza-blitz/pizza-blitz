from apscheduler.schedulers.asyncio import AsyncIOScheduler
import logging

logger = logging.getLogger(__name__)

scheduler = AsyncIOScheduler()

def sync_job():
    logger.info("Executing scheduled Google Sheets Sync (Placeholder)")
    # Logic to fetch the configured sheet URL from DB or env and sync it.
    pass

# Run every 24 hours
scheduler.add_job(sync_job, "interval", hours=24)

def start_scheduler():
    scheduler.start()
