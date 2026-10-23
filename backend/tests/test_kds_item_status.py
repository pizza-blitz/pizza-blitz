"""Item-level KDS bump and recall tests."""

import os
import unittest

os.environ.setdefault("PYTHONDONTWRITEBYTECODE", "1")

from fastapi.testclient import TestClient

from app.core.config import settings
from app.main import app


class KdsItemStatusTest(unittest.TestCase):
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
        created = self.client.post(
            "/api/v1/restaurant/orders/",
            json={
                "order_type": "takeaway",
                "customer_name": "KDS Line Guest",
                "customer_phone": "9812346601",
                "payment_method": "cash",
                "items": [
                    {"name": "Garlic Bread", "quantity": 1, "price": 119},
                    {"name": "Margherita Pizza", "quantity": 1, "price": 249},
                ],
            },
        )
        self.assertEqual(created.status_code, 200, created.text)
        self.order_id = created.json()["order_id"]

    def tearDown(self):
        self._ctx.__exit__(None, None, None)

    def set_line(self, index: int, status: str):
        return self.client.patch(
            f"/api/v1/restaurant/orders/{self.order_id}/items/{index}/status",
            json={"status": status},
            headers=self.headers,
        )

    def order_line(self, index: int) -> dict:
        order = self.client.get(
            f"/api/v1/restaurant/orders/{self.order_id}", headers=self.headers
        ).json()
        return order["items"][index]

    def test_bump_and_recall_independent_lines(self):
        started = self.set_line(0, "preparing")
        self.assertEqual(started.status_code, 200, started.text)
        self.assertEqual(self.order_line(0)["station_status"], "preparing")
        self.assertEqual(self.order_line(1)["station_status"], "open")
        self.assertEqual(started.json()["order"]["status"], "preparing")

        first_ready = self.set_line(0, "ready")
        self.assertEqual(first_ready.status_code, 200, first_ready.text)
        self.assertEqual(self.order_line(0)["station_status"], "ready")
        self.assertEqual(self.order_line(1)["station_status"], "open")
        self.assertEqual(first_ready.json()["order"]["status"], "preparing")

        second_ready = self.set_line(1, "ready")
        self.assertEqual(second_ready.status_code, 200, second_ready.text)
        self.assertEqual(second_ready.json()["order"]["status"], "ready")

        recalled = self.set_line(0, "preparing")
        self.assertEqual(recalled.status_code, 200, recalled.text)
        self.assertEqual(recalled.json()["order"]["status"], "preparing")
        self.assertIsNone(self.order_line(0).get("station_ready_at"))

        reopened = self.set_line(0, "open")
        self.assertEqual(reopened.status_code, 200, reopened.text)
        line = self.order_line(0)
        self.assertIsNone(line.get("station_started_at"))
        self.assertIsNone(line.get("station_ready_at"))

    def test_validation(self):
        missing = self.set_line(99, "ready")
        self.assertEqual(missing.status_code, 404)
        invalid = self.set_line(0, "burning")
        self.assertEqual(invalid.status_code, 422)
        closed = self.client.patch(
            f"/api/v1/restaurant/orders/{self.order_id}/close?payment_method=cash",
            headers=self.headers,
        )
        if closed.status_code == 200:
            self.assertEqual(self.set_line(0, "ready").status_code, 409)


if __name__ == "__main__":
    unittest.main()
