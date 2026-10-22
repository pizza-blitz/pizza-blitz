"""Loyalty points and referral tests."""

import os
import unittest

os.environ.setdefault("PYTHONDONTWRITEBYTECODE", "1")

from fastapi.testclient import TestClient

from app.core.config import settings
from app.main import app


def order_payload(phone: str, **overrides) -> dict:
    payload = {
        "order_type": "takeaway",
        "customer_name": "Loyalty Guest",
        "customer_phone": phone,
        "payment_method": "cash",
        "items": [{"name": "Garlic Bread", "quantity": 2, "price": 119}],
    }
    payload.update(overrides)
    return payload


class LoyaltyTest(unittest.TestCase):
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
        self.admin_headers = {
            "Authorization": f"Bearer {login.json()['access_token']}"
        }

    def tearDown(self):
        self._ctx.__exit__(None, None, None)

    def create_and_close(self, phone: str, **overrides) -> dict:
        created = self.client.post(
            "/api/v1/restaurant/orders/", json=order_payload(phone, **overrides)
        )
        self.assertEqual(created.status_code, 200, created.text)
        order_id = created.json()["order_id"]
        for status in ("preparing", "ready"):
            moved = self.client.patch(
                f"/api/v1/restaurant/orders/{order_id}/status",
                json={"status": status},
                headers=self.admin_headers,
            )
            self.assertEqual(moved.status_code, 200, moved.text)
        closed = self.client.patch(
            f"/api/v1/restaurant/orders/{order_id}/close?payment_method=cash",
            headers=self.admin_headers,
        )
        self.assertEqual(closed.status_code, 200, closed.text)
        return {"order": created.json(), "closed": closed.json()}

    def token_for(self, phone: str) -> str:
        requested = self.client.post(
            "/api/v1/auth/customer/otp/request", json={"phone": phone}
        )
        self.assertEqual(requested.status_code, 200, requested.text)
        verified = self.client.post(
            "/api/v1/auth/customer/otp/verify",
            json={"phone": phone, "code": requested.json()["debug_code"]},
        )
        self.assertEqual(verified.status_code, 200, verified.text)
        return verified.json()["access_token"]

    def loyalty(self, phone: str) -> dict:
        token = self.token_for(phone)
        response = self.client.get(
            "/api/v1/restaurant/customers/me/loyalty",
            headers={"Authorization": f"Bearer {token}"},
        )
        self.assertEqual(response.status_code, 200, response.text)
        return response.json()

    def test_points_awarded_once_on_close(self):
        phone = "9812345691"
        first = self.create_and_close(phone)
        points = int(first["order"]["total"])
        summary = self.loyalty(phone)
        self.assertEqual(summary["points_balance"], points)
        self.assertEqual(summary["lifetime_points"], points)
        self.assertTrue(summary["referral_code"].startswith("PB"))
        self.assertEqual(len(summary["referral_code"]), 8)
        self.assertEqual(summary["tier"], "Slice Starter")
        self.assertEqual(summary["transactions"][0]["type"], "earn")

        # Re-closing the same order must not add points again.
        order_id = first["order"]["order_id"]
        again = self.client.patch(
            f"/api/v1/restaurant/orders/{order_id}/close?payment_method=cash",
            headers=self.admin_headers,
        )
        self.assertEqual(again.status_code, 200, again.text)
        self.assertEqual(self.loyalty(phone)["points_balance"], points)

    def test_referral_rewards_both_customers(self):
        referrer_phone = "9812345692"
        self.create_and_close(referrer_phone)
        referrer = self.loyalty(referrer_phone)

        friend_phone = "9812345693"
        created = self.client.post(
            "/api/v1/restaurant/orders/",
            json=order_payload(friend_phone, referral_code=referrer["referral_code"]),
        )
        self.assertEqual(created.status_code, 200, created.text)
        self.assertTrue(created.json()["referral_applied"])

        friend_order = created.json()
        for status in ("preparing", "ready"):
            self.client.patch(
                f"/api/v1/restaurant/orders/{friend_order['order_id']}/status",
                json={"status": status},
                headers=self.admin_headers,
            )
        self.client.patch(
            f"/api/v1/restaurant/orders/{friend_order['order_id']}/close?payment_method=cash",
            headers=self.admin_headers,
        )

        friend = self.loyalty(friend_phone)
        self.assertEqual(
            friend["points_balance"],
            int(friend_order["total"]) + 100,
        )
        self.assertIn(
            "referral_joined",
            [row["type"] for row in friend["transactions"]],
        )
        referrer_after = self.loyalty(referrer_phone)
        self.assertEqual(referrer_after["points_balance"], referrer["points_balance"] + 100)
        self.assertEqual(referrer_after["referrals_made"], 1)

    def test_referral_validation(self):
        phone = "9812345694"
        invalid = self.client.post(
            "/api/v1/restaurant/orders/",
            json=order_payload(phone, referral_code="NOT-A-CODE"),
        )
        self.assertEqual(invalid.status_code, 422)

        referrer_phone = "9812345695"
        self.create_and_close(referrer_phone)
        code = self.loyalty(referrer_phone)["referral_code"]

        first = self.client.post(
            "/api/v1/restaurant/orders/",
            json=order_payload("9812345696", referral_code=code),
        )
        self.assertEqual(first.status_code, 200, first.text)

        returning = self.client.post(
            "/api/v1/restaurant/orders/",
            json=order_payload(referrer_phone, referral_code=code),
        )
        self.assertEqual(returning.status_code, 422)
        self.assertIn("first order", returning.json()["detail"].lower())

    def test_loyalty_requires_customer_session(self):
        response = self.client.get("/api/v1/restaurant/customers/me/loyalty")
        self.assertEqual(response.status_code, 401)


if __name__ == "__main__":
    unittest.main()
