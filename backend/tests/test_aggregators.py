"""Aggregator webhook and integration management tests."""

import os
import unittest

os.environ.setdefault("PYTHONDONTWRITEBYTECODE", "1")

from fastapi.testclient import TestClient

from app.core.config import settings
from app.main import app


def webhook_payload(external_id: str, **overrides) -> dict:
    payload = {
        "external_order_id": external_id,
        "customer": {"name": "Swiggy Guest", "phone": "9812346101"},
        "delivery_address": "12 Park Street",
        "items": [{"name": "Garlic Bread", "quantity": 1, "price": 119}],
        "payment_method": "prepaid",
        "payment_status": "paid",
        "notes": "Leave at door",
    }
    payload.update(overrides)
    return payload


class AggregatorTest(unittest.TestCase):
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

    def connect(self, platform: str = "swiggy") -> dict:
        response = self.client.post(
            "/api/v1/restaurant/integrations/aggregators/",
            json={"platform": platform, "store_id": 1},
            headers=self.headers,
        )
        self.assertEqual(response.status_code, 200, response.text)
        return response.json()

    def post_webhook(self, platform: str, token: str, payload: dict):
        return self.client.post(
            f"/api/v1/restaurant/integrations/aggregators/webhook/{platform}",
            json=payload,
            headers={"X-Aggregator-Token": token},
        )

    def test_webhook_creates_order_and_is_idempotent(self):
        integration = self.connect()
        self.assertEqual(integration["platform"], "swiggy")
        self.assertTrue(integration["webhook_token"].startswith("AG-"))
        duplicate_connect = self.connect()
        self.assertEqual(duplicate_connect["id"], integration["id"])

        external_id = f"SWG-{self._testMethodName}-1"
        accepted = self.post_webhook(
            "swiggy", integration["webhook_token"], webhook_payload(external_id)
        )
        self.assertEqual(accepted.status_code, 200, accepted.text)
        self.assertFalse(accepted.json()["duplicate"])
        order_id = accepted.json()["order_id"]

        order = self.client.get(
            f"/api/v1/restaurant/orders/{order_id}", headers=self.headers
        )
        self.assertEqual(order.status_code, 200, order.text)
        data = order.json()
        self.assertEqual(data["order_type"], "delivery")
        self.assertEqual(data["store_id"], 1)
        self.assertEqual(data["payment_status"], "paid")
        self.assertIn("Aggregator: swiggy", data["notes"])
        self.assertIn("Address: 12 Park Street", data["notes"])

        duplicate = self.post_webhook(
            "swiggy", integration["webhook_token"], webhook_payload(external_id)
        )
        self.assertEqual(duplicate.status_code, 200, duplicate.text)
        self.assertTrue(duplicate.json()["duplicate"])
        self.assertEqual(duplicate.json()["order_id"], order_id)

        listed = self.client.get(
            "/api/v1/restaurant/integrations/aggregators/", headers=self.headers
        )
        self.assertEqual(listed.status_code, 200, listed.text)
        row = next(
            item for item in listed.json()["integrations"] if item["id"] == integration["id"]
        )
        self.assertEqual(row["orders_count"], 1)

        feed = self.client.get(
            f"/api/v1/restaurant/integrations/aggregators/{integration['id']}/orders",
            headers=self.headers,
        )
        self.assertEqual(feed.status_code, 200, feed.text)
        self.assertEqual(feed.json()["orders"][0]["order_id"], order_id)

    def test_token_rotation_and_pause_block_webhooks(self):
        integration = self.connect("zomato")
        first = self.post_webhook(
            "zomato",
            integration["webhook_token"],
            webhook_payload(f"ZOM-{self._testMethodName}-1"),
        )
        self.assertEqual(first.status_code, 200, first.text)

        rotated = self.client.post(
            f"/api/v1/restaurant/integrations/aggregators/{integration['id']}/rotate-token",
            headers=self.headers,
        )
        self.assertEqual(rotated.status_code, 200, rotated.text)
        new_token = rotated.json()["webhook_token"]
        self.assertNotEqual(new_token, integration["webhook_token"])

        stale = self.post_webhook(
            "zomato",
            integration["webhook_token"],
            webhook_payload(f"ZOM-{self._testMethodName}-2"),
        )
        self.assertEqual(stale.status_code, 401)

        fresh = self.post_webhook(
            "zomato",
            new_token,
            webhook_payload(f"ZOM-{self._testMethodName}-2"),
        )
        self.assertEqual(fresh.status_code, 200, fresh.text)

        self.client.patch(
            f"/api/v1/restaurant/integrations/aggregators/{integration['id']}",
            json={"is_active": False},
            headers=self.headers,
        )
        paused = self.post_webhook(
            "zomato",
            new_token,
            webhook_payload(f"ZOM-{self._testMethodName}-3"),
        )
        self.assertEqual(paused.status_code, 401)

    def test_validation_and_access(self):
        integration = self.connect("ubereats")
        missing_token = self.client.post(
            "/api/v1/restaurant/integrations/aggregators/webhook/ubereats",
            json=webhook_payload(f"UB-{self._testMethodName}-1"),
        )
        self.assertEqual(missing_token.status_code, 401)

        bad_item = self.post_webhook(
            "ubereats",
            integration["webhook_token"],
            webhook_payload(
                f"UB-{self._testMethodName}-2",
                items=[{"name": "Mystery Box", "quantity": 1}],
            ),
        )
        self.assertEqual(bad_item.status_code, 422)

        no_address = self.post_webhook(
            "ubereats",
            integration["webhook_token"],
            webhook_payload(f"UB-{self._testMethodName}-3", delivery_address=""),
        )
        self.assertEqual(no_address.status_code, 422)

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
        self.assertEqual(
            self.client.get(
                "/api/v1/restaurant/integrations/aggregators/",
                headers=staff_headers,
            ).status_code,
            403,
        )
        self.assertEqual(
            self.client.post(
                "/api/v1/restaurant/integrations/aggregators/",
                json={"platform": "doordash", "store_id": 1},
                headers=staff_headers,
            ).status_code,
            403,
        )
        self.assertEqual(
            self.client.post(
                "/api/v1/restaurant/integrations/aggregators/",
                json={"platform": "deliveroo", "store_id": 1},
                headers=self.headers,
            ).status_code,
            422,
        )


if __name__ == "__main__":
    unittest.main()
