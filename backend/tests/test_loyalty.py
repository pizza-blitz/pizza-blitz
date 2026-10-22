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

    def test_points_redeemed_at_checkout(self):
        phone = "9812345697"
        self.create_and_close(phone)
        token = self.token_for(phone)
        headers = {"Authorization": f"Bearer {token}"}

        below_minimum = self.client.post(
            "/api/v1/restaurant/customers/me/loyalty/redemptions",
            json={"points": 50},
            headers=headers,
        )
        self.assertEqual(below_minimum.status_code, 422)

        too_many = self.client.post(
            "/api/v1/restaurant/customers/me/loyalty/redemptions",
            json={"points": 100000},
            headers=headers,
        )
        self.assertEqual(too_many.status_code, 422)

        created = self.client.post(
            "/api/v1/restaurant/customers/me/loyalty/redemptions",
            json={"points": 100},
            headers=headers,
        )
        self.assertEqual(created.status_code, 200, created.text)
        redemption = created.json()
        self.assertEqual(redemption["discount_amount"], 10)
        self.assertTrue(redemption["token"].startswith("LR"))

        order = self.client.post(
            "/api/v1/restaurant/orders/",
            json=order_payload(
                phone, loyalty_redemption_token=redemption["token"]
            ),
        )
        self.assertEqual(order.status_code, 200, order.text)
        data = order.json()
        self.assertEqual(data["loyalty_discount"], 10)
        self.assertEqual(data["loyalty_points_redeemed"], 100)

        reused = self.client.post(
            "/api/v1/restaurant/orders/",
            json=order_payload(
                phone, loyalty_redemption_token=redemption["token"]
            ),
        )
        self.assertEqual(reused.status_code, 422)

        summary = self.loyalty(phone)
        self.assertEqual(
            summary["points_balance"],
            summary["lifetime_points"] - 100,
        )
        self.assertIn(
            "redeem",
            [row["type"] for row in summary["transactions"]],
        )

    def test_redemption_belongs_to_the_ordering_customer(self):
        owner_phone = "9812345698"
        self.create_and_close(owner_phone)
        owner_token = self.token_for(owner_phone)
        redemption = self.client.post(
            "/api/v1/restaurant/customers/me/loyalty/redemptions",
            json={"points": 100},
            headers={"Authorization": f"Bearer {owner_token}"},
        ).json()

        other_phone = "9812345699"
        stolen = self.client.post(
            "/api/v1/restaurant/orders/",
            json=order_payload(
                other_phone,
                loyalty_redemption_token=redemption["token"],
            ),
        )
        self.assertEqual(stolen.status_code, 422)
        self.assertIn("another customer", stolen.json()["detail"].lower())


if __name__ == "__main__":
    unittest.main()
