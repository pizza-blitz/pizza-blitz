"""Technology workspace: platform overview, data checks and CSV exports."""

import os
import unittest

os.environ.setdefault("PYTHONDONTWRITEBYTECODE", "1")

from fastapi.testclient import TestClient

from app.core.config import settings
from app.main import app

BASE = "/api/v1/restaurant"


class CompanyTechnologyTest(unittest.TestCase):
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

    def tearDown(self):
        self._ctx.__exit__(None, None, None)

    def test_overview_reports_real_counts_checks_and_exports(self):
        response = self.client.get(
            f"{BASE}/company/technology/overview", headers=self.headers
        )
        self.assertEqual(response.status_code, 200, response.text)
        payload = response.json()

        self.assertIn(payload["database"]["engine"], {"sqlite", "postgresql"})
        self.assertGreater(payload["database"]["table_count"], 0)
        self.assertTrue(payload["generated_at"])

        counts = {row["key"]: row for row in payload["counts"]}
        for key in (
            "orders",
            "customers",
            "menu_items",
            "inventory_items",
            "business_departments",
            "media_assets",
            "support_tickets",
            "gift_cards",
        ):
            self.assertIn(key, counts)
            self.assertTrue(counts[key]["label"])
            self.assertGreaterEqual(counts[key]["count"], 0)

        self.assertEqual(len(payload["freshness"]), 4)
        self.assertIn("latest_order_created_at", payload["freshness"])

        checks = {row["key"]: row for row in payload["checks"]}
        for key in (
            "orders_missing_store",
            "zero_value_orders",
            "menu_missing_cost",
            "negative_stock",
            "customers_missing_phone",
            "duplicate_menu_names",
            "unassigned_delivery",
        ):
            self.assertIn(key, checks)
            self.assertIn(checks[key]["status"], {"ok", "warning", "breach"})
            self.assertIsInstance(checks[key]["count"], int)

        datasets = {row["dataset"]: row for row in payload["exports"]}
        self.assertEqual(set(datasets), {"orders", "customers", "menu", "inventory"})
        for row in datasets.values():
            self.assertGreaterEqual(row["row_count"], 0)
            self.assertTrue(row["label"])

    def test_orders_export_is_csv_with_header(self):
        response = self.client.get(
            f"{BASE}/company/technology/export",
            params={"dataset": "orders"},
            headers=self.headers,
        )
        self.assertEqual(response.status_code, 200, response.text)
        self.assertIn("text/csv", response.headers["content-type"])
        self.assertIn(
            "attachment;", response.headers["content-disposition"]
        )
        header = response.text.splitlines()[0]
        self.assertEqual(
            header,
            "id,date,store_id,order_type,status,payment_status,"
            "payment_method,subtotal,discount_amount,tax_amount,"
            "total_amount,customer_name,customer_phone,created_at",
        )

    def test_customers_export_uses_customer_columns(self):
        response = self.client.get(
            f"{BASE}/company/technology/export",
            params={"dataset": "customers"},
            headers=self.headers,
        )
        self.assertEqual(response.status_code, 200, response.text)
        header = response.text.splitlines()[0]
        self.assertIn("total_spend", header)
        self.assertIn("created_at", header)

    def test_unknown_dataset_returns_404(self):
        response = self.client.get(
            f"{BASE}/company/technology/export",
            params={"dataset": "secrets"},
            headers=self.headers,
        )
        self.assertEqual(response.status_code, 404)

    def test_anonymous_access_is_denied(self):
        response = self.client.get(f"{BASE}/company/technology/overview")
        self.assertEqual(response.status_code, 401)


if __name__ == "__main__":
    unittest.main()
