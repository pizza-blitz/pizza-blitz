"""Kitchen Display System board tests."""

import os
import unittest
from datetime import datetime, time, timedelta

os.environ.setdefault("PYTHONDONTWRITEBYTECODE", "1")

from fastapi.testclient import TestClient

from app.core.clock import business_now, business_zone
from app.core.config import settings
from app.main import app


def order_payload(**overrides) -> dict:
    payload = {
        "order_type": "takeaway",
        "customer_name": "KDS Guest",
        "customer_phone": "9812345671",
        "payment_method": "cash",
        "items": [
            {"name": "Garlic Bread", "quantity": 1, "price": 119},
            {"name": "Cold Coffee", "quantity": 2, "price": 99},
        ],
    }
    payload.update(overrides)
    return payload


class KdsBoardTest(unittest.TestCase):
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

    def create_order(self, **overrides) -> int:
        response = self.client.post(
            "/api/v1/restaurant/orders/", json=order_payload(**overrides)
        )
        self.assertEqual(response.status_code, 200, response.text)
        return response.json()["order_id"]

    def test_board_lists_active_orders_and_station_lines(self):
        order_id = self.create_order()
        response = self.client.get(
            "/api/v1/restaurant/orders/kds", headers=self.headers
        )
        self.assertEqual(response.status_code, 200, response.text)
        data = response.json()
        order = next((row for row in data["orders"] if row["id"] == order_id), None)
        self.assertIsNotNone(order, "New order did not appear on the KDS board.")
        self.assertEqual(order["line_count"], 2)
        self.assertIn("oven", order["station_keys"])
        self.assertIn("cold", order["station_keys"])
        self.assertIn("age_seconds", order)
        self.assertGreaterEqual(data["metrics"]["active_orders"], 1)
        self.assertGreaterEqual(data["metrics"]["pending_lines"], 2)

    def test_station_bump_and_order_progress(self):
        order_id = self.create_order()
        bump = self.client.patch(
            f"/api/v1/restaurant/orders/{order_id}/stations/oven/status",
            json={"status": "ready"},
            headers=self.headers,
        )
        self.assertEqual(bump.status_code, 200, bump.text)

        board = self.client.get(
            "/api/v1/restaurant/orders/kds", headers=self.headers
        ).json()
        order = next(row for row in board["orders"] if row["id"] == order_id)
        oven_line = next(line for line in order["lines"] if line["station_key"] == "oven")
        self.assertEqual(oven_line["status"], "ready")
        self.assertNotEqual(order["status"], "ready")

        cold = self.client.patch(
            f"/api/v1/restaurant/orders/{order_id}/stations/cold/status",
            json={"status": "ready"},
            headers=self.headers,
        )
        self.assertEqual(cold.status_code, 200, cold.text)
        board = self.client.get(
            "/api/v1/restaurant/orders/kds", headers=self.headers
        ).json()
        order = next(row for row in board["orders"] if row["id"] == order_id)
        self.assertEqual(order["status"], "ready")

        recall = self.client.patch(
            f"/api/v1/restaurant/orders/{order_id}/stations/oven/status",
            json={"status": "preparing"},
            headers=self.headers,
        )
        self.assertEqual(recall.status_code, 200, recall.text)
        board = self.client.get(
            "/api/v1/restaurant/orders/kds", headers=self.headers
        ).json()
        order = next(row for row in board["orders"] if row["id"] == order_id)
        oven_line = next(line for line in order["lines"] if line["station_key"] == "oven")
        self.assertEqual(oven_line["status"], "preparing")

    def test_far_future_scheduled_order_is_hidden(self):
        target = (business_now() + timedelta(days=1)).date()
        scheduled = datetime.combine(
            target, time(hour=12, minute=30), tzinfo=business_zone()
        ).isoformat()
        order_id = self.create_order(scheduled_for=scheduled)
        board = self.client.get(
            "/api/v1/restaurant/orders/kds", headers=self.headers
        ).json()
        ids = {row["id"] for row in board["orders"]}
        self.assertNotIn(order_id, ids)

    def test_board_requires_authentication(self):
        response = self.client.get("/api/v1/restaurant/orders/kds")
        self.assertEqual(response.status_code, 401)


if __name__ == "__main__":
    unittest.main()
