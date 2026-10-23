"""Channel-specific menu pricing and availability tests."""

import os
import unittest

os.environ.setdefault("PYTHONDONTWRITEBYTECODE", "1")

from fastapi.testclient import TestClient

from app.core.config import settings
from app.main import app


def order_payload(phone: str, order_type: str, name: str) -> dict:
    payload = {
        "order_type": order_type,
        "customer_name": "Channel Guest",
        "customer_phone": phone,
        "payment_method": "cash",
        "items": [{"name": name, "quantity": 1, "price": 0}],
    }
    if order_type == "delivery":
        payload["delivery_address"] = "12 Park Street"
    return payload


class ChannelPricingTest(unittest.TestCase):
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
        self.item_ids: list[int] = []

    def tearDown(self):
        for item_id in self.item_ids:
            self.client.delete(
                f"/api/v1/restaurant/menu/menu/{item_id}", headers=self.headers
            )
        self._ctx.__exit__(None, None, None)

    def create_item(self, **overrides):
        payload = {
            "name": "Channel Test Pizza",
            "category": "Pizza",
            "selling_price": 299,
            "cost_price": 110,
            "is_available": True,
            "channel_prices": [
                {"channel": "takeaway", "price": 299, "is_available": True},
                {"channel": "delivery", "price": 349, "is_available": True},
                {"channel": "dine-in", "price": 279, "is_available": True},
            ],
        }
        payload.update(overrides)
        return self.client.post(
            "/api/v1/restaurant/menu/menu", json=payload, headers=self.headers
        )

    def test_channel_prices_are_applied_to_orders(self):
        created = self.create_item()
        self.assertEqual(created.status_code, 200, created.text)
        item = created.json()
        self.item_ids.append(item["id"])
        prices = {row["channel"]: row["price"] for row in item["channel_prices"]}
        self.assertEqual(prices["delivery"], 349)
        self.assertEqual(prices["dine-in"], 279)

        takeaway = self.client.post(
            "/api/v1/restaurant/orders/",
            json=order_payload("9812346301", "takeaway", item["name"]),
        )
        self.assertEqual(takeaway.status_code, 200, takeaway.text)
        self.assertAlmostEqual(takeaway.json()["subtotal"], 299, places=2)

        delivery = self.client.post(
            "/api/v1/restaurant/orders/",
            json=order_payload("9812346302", "delivery", item["name"]),
        )
        self.assertEqual(delivery.status_code, 200, delivery.text)
        self.assertAlmostEqual(delivery.json()["subtotal"], 349, places=2)
        self.assertGreater(delivery.json()["total"], delivery.json()["subtotal"])

        public = self.client.get(
            "/api/v1/restaurant/menu/menu-with-customizations"
        )
        public_item = next(row for row in public.json() if row["id"] == item["id"])
        self.assertEqual(
            {row["channel"] for row in public_item["channel_prices"]},
            {"takeaway", "delivery", "dine-in"},
        )

        paused_delivery = self.create_item(
            name="Channel Paused Pizza",
            channel_prices=[
                {"channel": "takeaway", "price": 299, "is_available": True},
                {"channel": "delivery", "price": 349, "is_available": False},
            ],
        )
        self.assertEqual(paused_delivery.status_code, 200, paused_delivery.text)
        paused_item = paused_delivery.json()
        self.item_ids.append(paused_item["id"])
        blocked = self.client.post(
            "/api/v1/restaurant/orders/",
            json=order_payload("9812346303", "delivery", paused_item["name"]),
        )
        self.assertEqual(blocked.status_code, 422)

        cleared = self.create_item(
            name="Channel Cleared Pizza",
            channel_prices=[],
        )
        self.assertEqual(cleared.status_code, 200, cleared.text)
        self.item_ids.append(cleared.json()["id"])
        self.assertEqual(cleared.json()["channel_prices"], [])

    def test_channel_price_validation(self):
        invalid_channel = self.create_item(
            channel_prices=[
                {"channel": "phone", "price": 299, "is_available": True}
            ]
        )
        self.assertEqual(invalid_channel.status_code, 422)
        negative = self.create_item(
            channel_prices=[
                {"channel": "delivery", "price": -10, "is_available": True}
            ]
        )
        self.assertEqual(negative.status_code, 422)


if __name__ == "__main__":
    unittest.main()
