"""GST accounting summary and CSV export tests."""

import os
import unittest
from datetime import timedelta

os.environ.setdefault("PYTHONDONTWRITEBYTECODE", "1")

from fastapi.testclient import TestClient

from app.core.clock import business_today
from app.core.config import settings
from app.main import app


def order_payload(phone: str, **overrides) -> dict:
    payload = {
        "order_type": "takeaway",
        "customer_name": "Accounting Guest",
        "customer_phone": phone,
        "payment_method": "cash",
        "items": [{"name": "Garlic Bread", "quantity": 2, "price": 119}],
        "tip_amount": 20,
    }
    payload.update(overrides)
    return payload


class AccountingTest(unittest.TestCase):
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
        self.today = business_today().isoformat()

    def tearDown(self):
        self._ctx.__exit__(None, None, None)

    def summary(self, **params):
        query = {"start_date": self.today, "end_date": self.today, **params}
        return self.client.get(
            "/api/v1/restaurant/accounting/summary",
            params=query,
            headers=self.headers,
        )

    def test_summary_cgst_sgst_and_order_export(self):
        before = self.summary()
        self.assertEqual(before.status_code, 200, before.text)
        baseline = before.json()

        created = self.client.post(
            "/api/v1/restaurant/orders/", json=order_payload("9812346001")
        )
        self.assertEqual(created.status_code, 200, created.text)
        order = created.json()

        after = self.summary().json()
        self.assertEqual(after["orders"], baseline["orders"] + 1)
        self.assertAlmostEqual(
            after["gross_sales"], baseline["gross_sales"] + order["subtotal"], places=2
        )
        self.assertAlmostEqual(
            after["tax"], baseline["tax"] + order["tax"], places=2
        )
        self.assertAlmostEqual(
            after["tips"], baseline["tips"] + 20, places=2
        )
        self.assertAlmostEqual(
            after["cgst"] + after["sgst"], after["tax"], places=2
        )
        self.assertAlmostEqual(
            after["net_collected"],
            after["total_billed"] - after["refunds"],
            places=2,
        )

        exported = self.client.get(
            "/api/v1/restaurant/accounting/export",
            params={"start_date": self.today, "end_date": self.today},
            headers=self.headers,
        )
        self.assertEqual(exported.status_code, 200, exported.text)
        self.assertIn("text/csv", exported.headers["content-type"])
        lines = exported.text.splitlines()
        self.assertIn("cgst", lines[0])
        self.assertIn("order_id", lines[0])
        self.assertTrue(
            any(str(order["order_id"]) == line.split(",")[0] for line in lines[1:])
        )

        store_filtered = self.summary(store_id=1)
        self.assertEqual(store_filtered.status_code, 200, store_filtered.text)
        self.assertGreaterEqual(store_filtered.json()["orders"], 1)
        self.assertEqual(self.summary(store_id=999999).json()["orders"], 0)

    def test_validation_and_access(self):
        reversed_range = self.client.get(
            "/api/v1/restaurant/accounting/summary",
            params={
                "start_date": (business_today() - timedelta(days=2)).isoformat(),
                "end_date": self.today,
            },
            headers=self.headers,
        )
        self.assertEqual(reversed_range.status_code, 200)
        backwards = self.client.get(
            "/api/v1/restaurant/accounting/summary",
            params={"start_date": self.today, "end_date": "2020-01-01"},
            headers=self.headers,
        )
        self.assertEqual(backwards.status_code, 422)

        staff_login = self.client.post(
            "/api/v1/auth/staff/login",
            json={
                "id": settings.PIZZA_BLITZ_STAFF_ID,
                "password": settings.PIZZA_BLITZ_STAFF_PASSWORD,
            },
        )
        staff_headers = {
            "Authorization": f"Bearer {staff_login.json()['access_token']}"
        }
        denied = self.client.get(
            "/api/v1/restaurant/accounting/summary",
            params={"start_date": self.today, "end_date": self.today},
            headers=staff_headers,
        )
        self.assertEqual(denied.status_code, 403)

        anonymous = self.client.get(
            "/api/v1/restaurant/accounting/summary",
            params={"start_date": self.today, "end_date": self.today},
        )
        self.assertEqual(anonymous.status_code, 401)


if __name__ == "__main__":
    unittest.main()
