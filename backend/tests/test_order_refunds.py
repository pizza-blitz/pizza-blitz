"""Order refund ledger tests."""

import os
import unittest

os.environ.setdefault("PYTHONDONTWRITEBYTECODE", "1")

from fastapi.testclient import TestClient

from app.core.config import settings
from app.main import app


def order_payload() -> dict:
    return {
        "order_type": "takeaway",
        "customer_name": "Refund Guest",
        "customer_phone": "9812345670",
        "payment_method": "cash",
        "items": [{"name": "Garlic Bread", "quantity": 2, "price": 119}],
    }


class OrderRefundTest(unittest.TestCase):
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

    def create_order(self) -> int:
        response = self.client.post(
            "/api/v1/restaurant/orders/", json=order_payload()
        )
        self.assertEqual(response.status_code, 200, response.text)
        return response.json()["order_id"]

    def close_order(self, order_id: int) -> dict:
        for status in ("preparing", "ready"):
            moved = self.client.patch(
                f"/api/v1/restaurant/orders/{order_id}/status",
                json={"status": status},
                headers=self.headers,
            )
            self.assertEqual(moved.status_code, 200, moved.text)
        closed = self.client.patch(
            f"/api/v1/restaurant/orders/{order_id}/close?payment_method=cash",
            headers=self.headers,
        )
        self.assertEqual(closed.status_code, 200, closed.text)
        return closed.json()

    def refund(self, order_id: int, amount: float, **overrides):
        payload = {
            "amount": amount,
            "reason": "Cold pizza on arrival",
            "method": "cash",
            **overrides,
        }
        return self.client.post(
            f"/api/v1/restaurant/orders/{order_id}/refunds",
            json=payload,
            headers=self.headers,
        )

    def test_refund_requires_captured_payment(self):
        order_id = self.create_order()
        response = self.refund(order_id, 50)
        self.assertEqual(response.status_code, 409)
        self.assertIn("no captured payment", response.json()["detail"].lower())

    def test_partial_then_full_refund(self):
        order_id = self.create_order()
        self.close_order(order_id)

        partial = self.refund(order_id, 50)
        self.assertEqual(partial.status_code, 200, partial.text)
        data = partial.json()
        self.assertEqual(data["refund"]["amount"], 50)
        self.assertEqual(data["summary"]["refunded_amount"], 50)
        self.assertEqual(data["order"]["payment_status"], "partially_refunded")
        self.assertGreater(data["summary"]["refundable_amount"], 0)

        refundable = data["summary"]["refundable_amount"]
        over = self.refund(order_id, round(refundable + 1, 2))
        self.assertEqual(over.status_code, 422)
        self.assertIn("refundable amount", over.json()["detail"].lower())

        final = self.refund(order_id, refundable, method="upi", reference="UPI-123")
        self.assertEqual(final.status_code, 200, final.text)
        self.assertEqual(final.json()["order"]["payment_status"], "refunded")
        self.assertEqual(final.json()["summary"]["refundable_amount"], 0)

        extra = self.refund(order_id, 1)
        self.assertEqual(extra.status_code, 409)

        listed = self.client.get(
            f"/api/v1/restaurant/orders/{order_id}/refunds", headers=self.headers
        )
        self.assertEqual(listed.status_code, 200, listed.text)
        self.assertEqual(len(listed.json()["refunds"]), 2)
        self.assertEqual(listed.json()["refunds"][0]["method"], "upi")

    def test_refund_validation(self):
        order_id = self.create_order()
        self.close_order(order_id)
        self.assertEqual(self.refund(order_id, 0).status_code, 422)
        self.assertEqual(self.refund(order_id, 50, method="bitcoin").status_code, 422)
        self.assertEqual(self.refund(order_id, 50, reason="x").status_code, 422)

    def test_staff_cannot_create_refund(self):
        order_id = self.create_order()
        self.close_order(order_id)
        login = self.client.post(
            "/api/v1/auth/staff/login",
            json={
                "id": settings.PIZZA_BLITZ_STAFF_ID,
                "password": settings.PIZZA_BLITZ_STAFF_PASSWORD,
            },
        )
        if login.status_code != 200:
            self.skipTest("Staff login is not configured in this environment.")
        headers = {"Authorization": f"Bearer {login.json()['access_token']}"}
        response = self.client.post(
            f"/api/v1/restaurant/orders/{order_id}/refunds",
            json={"amount": 10, "reason": "Test refund", "method": "cash"},
            headers=headers,
        )
        self.assertEqual(response.status_code, 403)

    def test_refund_summary(self):
        order_id = self.create_order()
        self.close_order(order_id)
        self.refund(order_id, 25, method="card")
        summary = self.client.get(
            "/api/v1/restaurant/orders/refunds/summary?days=1", headers=self.headers
        )
        self.assertEqual(summary.status_code, 200, summary.text)
        data = summary.json()
        self.assertGreaterEqual(data["refunds_total"], 25)
        self.assertGreaterEqual(data["refund_count"], 1)
        self.assertIn("card", data["by_method"])

        anonymous = self.client.get("/api/v1/restaurant/orders/refunds/summary")
        self.assertEqual(anonymous.status_code, 401)


if __name__ == "__main__":
    unittest.main()
