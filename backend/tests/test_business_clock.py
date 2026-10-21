"""Tests for the restaurant business clock.

These guard the day boundary used by sales, orders, promotions, and readiness:
the API must follow the configured restaurant timezone even when the host runs
in UTC.
"""

import os
import unittest
from datetime import datetime
from zoneinfo import ZoneInfo

os.environ.setdefault("PYTHONDONTWRITEBYTECODE", "1")

from app.core.clock import business_now, business_today, business_zone
from app.core.config import settings


class BusinessClockTest(unittest.TestCase):
    def test_business_zone_uses_configured_timezone(self):
        self.assertEqual(business_zone().key, settings.RESTAURANT_TIMEZONE)

    def test_business_today_follows_configured_zone(self):
        expected = datetime.now(ZoneInfo(settings.RESTAURANT_TIMEZONE)).date()
        self.assertEqual(business_today(), expected)

    def test_business_now_carries_timezone_information(self):
        self.assertIsNotNone(business_now().tzinfo)

    def test_unknown_timezone_falls_back_to_utc(self):
        original = settings.RESTAURANT_TIMEZONE
        try:
            settings.RESTAURANT_TIMEZONE = "Not/AZone"
            self.assertEqual(business_zone().key, "UTC")
        finally:
            settings.RESTAURANT_TIMEZONE = original


if __name__ == "__main__":
    unittest.main()
