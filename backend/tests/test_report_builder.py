"""Custom report builder and saved report tests."""

import os
import unittest
from datetime import timedelta

os.environ.setdefault("PYTHONDONTWRITEBYTECODE", "1")

from fastapi.testclient import TestClient

from app.core.clock import business_today
from app.core.config import settings
from app.main import app


def order_payload(phone: str, order_type: str = "takeaway") -> dict:
    payload = {
        "order_type": order_type,
        "customer_name": "Report Test Guest",
        "customer_phone": phone,
        "payment_method": "cash",
        "items": [{"name": "Garlic Bread", "quantity": 2, "price": 119}],
    }
    if order_type == "delivery":
        payload["delivery_address"] = "12 Park Street"
    return payload


class ReportBuilderTest(unittest.TestCase):
    def setUp(self):
        self._ctx = TestClient(app)
        self.client = self._ctx.__enter__()
        login = self.client.post(
            "/api/v1/auth/admin/login",
            json={
                "id": settings.PIZZA_BLITZ_ADMIN_ID,
                "password": settings.PIZZA_BLITZ_ADMIN_PASSWORD,
            },
        )
        self.assertEqual(login.status_code, 200, login.text)
        self.headers = {"Authorization": f"Bearer {login.json()['access_token']}"}
        self.today = business_today()

    def tearDown(self):
        self._ctx.__exit__(None, None, None)

    def custom(self, **overrides):
        payload = {
            "start_date": self.today.isoformat(),
            "end_date": self.today.isoformat(),
            "metrics": ["revenue", "orders"],
            "dimensions": [],
            "filters": {},
        }
        payload.update(overrides)
        return self.client.post(
            "/api/v1/restaurant/reports/custom",
            json=payload,
            headers=self.headers,
        )

    def test_custom_report_totals_grouping_and_filters(self):
        before = self.custom()
        self.assertEqual(before.status_code, 200, before.text)
        baseline = before.json()["totals"]

        created = []
        for index, order_type in enumerate(("takeaway", "delivery")):
            response = self.client.post(
                "/api/v1/restaurant/orders/",
                json=order_payload(f"98123458{index}0", order_type),
            )
            self.assertEqual(response.status_code, 200, response.text)
            created.append(response.json())

        after = self.custom()
        self.assertEqual(after.status_code, 200, after.text)
        totals = after.json()["totals"]
        self.assertEqual(totals["orders"], baseline["orders"] + 2)
        self.assertAlmostEqual(
            totals["revenue"],
            baseline["revenue"] + sum(order["total"] for order in created),
            places=2,
        )

        grouped = self.custom(dimensions=["order_type"]).json()
        self.assertIn("order_type", grouped["columns"])
        takeaway = next(
            row for row in grouped["rows"] if row["order_type"] == "takeaway"
        )
        self.assertGreaterEqual(takeaway["orders"], 1)
        self.assertEqual(grouped["row_count"], len(grouped["rows"]))

        filtered = self.custom(filters={"order_type": "delivery"}).json()
        self.assertGreaterEqual(filtered["totals"]["orders"], 1)
        self.assertGreaterEqual(
            filtered["totals"]["revenue"], created[1]["total"] - 0.01
        )

        average = self.custom(
            metrics=["orders", "avg_order_value"], dimensions=["order_type"]
        ).json()
        self.assertIn("avg_order_value", average["totals"])

    def test_custom_report_validation(self):
        self.assertEqual(
            self.custom(metrics=["profit"]).status_code, 422
        )
        self.assertEqual(
            self.custom(dimensions=["customer"]).status_code, 422
        )
        self.assertEqual(
            self.custom(
                start_date=self.today.isoformat(),
                end_date=(self.today - timedelta(days=2)).isoformat(),
            ).status_code,
            422,
        )
        self.assertEqual(
            self.client.post(
                "/api/v1/restaurant/reports/custom",
                json={
                    "start_date": self.today.isoformat(),
                    "end_date": self.today.isoformat(),
                    "metrics": ["revenue"],
                },
            ).status_code,
            401,
        )

    def test_saved_report_crud_run_export_and_delivery(self):
        created = self.client.post(
            "/api/v1/restaurant/reports/saved",
            json={
                "name": "Daily sales board",
                "metrics": ["revenue", "orders", "avg_order_value"],
                "dimensions": ["day"],
                "range_days": 7,
                "schedule": "daily",
                "recipients": "owner@example.com",
            },
            headers=self.headers,
        )
        self.assertEqual(created.status_code, 200, created.text)
        saved = created.json()
        report_id = saved["id"]
        self.assertEqual(saved["schedule"], "daily")
        self.assertIsNotNone(saved["next_run_at"])

        listed = self.client.get(
            "/api/v1/restaurant/reports/saved", headers=self.headers
        )
        self.assertEqual(listed.status_code, 200, listed.text)
        self.assertIn(report_id, [row["id"] for row in listed.json()])

        run = self.client.post(
            f"/api/v1/restaurant/reports/saved/{report_id}/run",
            headers=self.headers,
        )
        self.assertEqual(run.status_code, 200, run.text)
        self.assertIn("day", run.json()["columns"])
        self.assertIsNotNone(run.json()["saved_report"]["last_run_at"])

        exported = self.client.get(
            f"/api/v1/restaurant/reports/saved/{report_id}/export",
            headers=self.headers,
        )
        self.assertEqual(exported.status_code, 200, exported.text)
        self.assertIn("text/csv", exported.headers["content-type"])
        self.assertIn("day", exported.text.splitlines()[0])
        self.assertIn("revenue", exported.text.splitlines()[0])

        delivered = self.client.post(
            f"/api/v1/restaurant/reports/saved/{report_id}/deliver",
            headers=self.headers,
        )
        self.assertEqual(delivered.status_code, 200, delivered.text)
        self.assertIn(
            delivered.json()["delivery_status"], {"skipped", "failed"}
        )

        paused = self.client.patch(
            f"/api/v1/restaurant/reports/saved/{report_id}",
            json={"schedule": "none", "recipients": None},
            headers=self.headers,
        )
        self.assertEqual(paused.status_code, 200, paused.text)
        self.assertIsNone(paused.json()["next_run_at"])

        deleted = self.client.delete(
            f"/api/v1/restaurant/reports/saved/{report_id}", headers=self.headers
        )
        self.assertEqual(deleted.status_code, 200, deleted.text)
        self.assertEqual(
            self.client.get(
                "/api/v1/restaurant/reports/saved", headers=self.headers
            ).json(),
            [],
        )

    def test_saved_report_validation(self):
        no_recipients = self.client.post(
            "/api/v1/restaurant/reports/saved",
            json={
                "name": "Weekly board",
                "metrics": ["revenue"],
                "schedule": "weekly",
            },
            headers=self.headers,
        )
        self.assertEqual(no_recipients.status_code, 422)

        bad_email = self.client.post(
            "/api/v1/restaurant/reports/saved",
            json={
                "name": "Weekly board",
                "metrics": ["revenue"],
                "schedule": "weekly",
                "recipients": "not-an-email",
            },
            headers=self.headers,
        )
        self.assertEqual(bad_email.status_code, 422)


if __name__ == "__main__":
    unittest.main()
