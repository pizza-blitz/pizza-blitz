import unittest
from types import SimpleNamespace

from app.api.api_v1.endpoints.stats import weekly_whatsapp_summary


class _Result:
    def __init__(self, row):
        self.row = row

    def fetchone(self):
        return self.row


class _WeeklySummaryNoSalesDb:
    def __init__(self):
        self.calls = 0

    def execute(self, *_args, **_kwargs):
        self.calls += 1
        if self.calls == 1:
            return _Result(SimpleNamespace(rev=0, profit=0))
        if self.calls == 2:
            return _Result(SimpleNamespace(rev=0))
        return _Result(None)


class WeeklyWhatsappSummaryTest(unittest.TestCase):
    def test_no_sales_week_returns_shareable_summary(self):
        payload = weekly_whatsapp_summary(_WeeklySummaryNoSalesDb())

        self.assertEqual(payload["this_week_revenue"], 0)
        self.assertEqual(payload["wow_change"], 0)
        self.assertIn("Best Day:", payload["message"])
        self.assertIn("N/A", payload["message"])
        self.assertIn("whatsapp_url", payload)


if __name__ == "__main__":
    unittest.main()
