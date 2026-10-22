"""Order tip capture and totals tests."""

import os
import unittest

os.environ.setdefault("PYTHONDONTWRITEBYTECODE", "1")

from fastapi.testclient import TestClient

from app.main import app


def order_payload(**overrides) -> dict:
    payload = {
        "order_type": "takeaway",
        "customer_name": "Tip Guest",
        "customer_phone": "9811122233",
        "payment_method": "cash",
        "items": [{"name": "Garlic Bread", "quantity": 2, "price": 119}],
    }
    payload.update(overrides)
    return payload


class OrderTipsTest(unittest.TestCase):
    def setUp(self):
        self._ctx = TestClient(app)
        self.client = self._ctx.__enter__()

    def tearDown(self):
        self._ctx.__exit__(None, None, None)

    def test_tip_is_added_to_total_and_serialized(self):
        response = self.client.post(
            "/api/v1/restaurant/orders/", json=order_payload(tip_amount=25)
        )
        self.assertEqual(response.status_code, 200, response.text)
        data = response.json()
        self.assertEqual(data["tip_amount"], 25)
        self.assertEqual(data["subtotal"], 238)
        self.assertEqual(data["tax"], 11.9)
        self.assertEqual(data["total"], 274.9)

        order_id = data["order_id"]
        tracked = self.client.get(
            f"/api/v1/restaurant/orders/track/{order_id}?phone=9811122233"
        )
        self.assertEqual(tracked.status_code, 200, tracked.text)
        self.assertEqual(tracked.json()["tip_amount"], 25)

    def test_tip_combines_with_coupon_and_delivery(self):
        response = self.client.post(
            "/api/v1/restaurant/orders/",
            json=order_payload(
                order_type="delivery",
                delivery_address="22 Tip Street, Bengaluru",
                tip_amount=30,
            ),
        )
        self.assertEqual(response.status_code, 200, response.text)
        data = response.json()
        self.assertEqual(data["tip_amount"], 30)
        self.assertGreaterEqual(data["total"], 238 + 30)

    def test_negative_tip_is_rejected(self):
        response = self.client.post(
            "/api/v1/restaurant/orders/", json=order_payload(tip_amount=-1)
        )
        self.assertEqual(response.status_code, 422)

    def test_excessive_tip_is_rejected(self):
        response = self.client.post(
            "/api/v1/restaurant/orders/", json=order_payload(tip_amount=5000)
        )
        self.assertEqual(response.status_code, 422)

    def test_tip_defaults_to_zero(self):
        response = self.client.post("/api/v1/restaurant/orders/", json=order_payload())
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.json()["tip_amount"], 0)

    def test_tips_summary_reports_totals(self):
        login = self.client.post(
            "/api/v1/auth/admin/login",
            json={"id": "admin", "password": "admin123"},
        )
        self.assertEqual(login.status_code, 200, login.text)
        headers = {"Authorization": f"Bearer {login.json()['access_token']}"}

        first = self.client.post(
            "/api/v1/restaurant/orders/", json=order_payload(tip_amount=20)
        )
        second = self.client.post(
            "/api/v1/restaurant/orders/", json=order_payload(tip_amount=40)
        )
        self.assertEqual(first.status_code, 200, first.text)
        self.assertEqual(second.status_code, 200, second.text)

        summary = self.client.get(
            "/api/v1/restaurant/orders/tips-summary?days=1", headers=headers
        )
        self.assertEqual(summary.status_code, 200, summary.text)
        data = summary.json()
        self.assertGreaterEqual(data["tips_total"], 60)
        self.assertGreaterEqual(data["tips_today"], 60)
        self.assertGreaterEqual(data["tipped_orders"], 2)
        self.assertGreater(data["average_tip"], 0)

        anonymous = self.client.get("/api/v1/restaurant/orders/tips-summary")
        self.assertEqual(anonymous.status_code, 401)


if __name__ == "__main__":
    unittest.main()
