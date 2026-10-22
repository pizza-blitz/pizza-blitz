"""Store profile, opening hours, and online-ordering pause tests."""

import os
import unittest
from datetime import datetime
from types import SimpleNamespace

os.environ.setdefault("PYTHONDONTWRITEBYTECODE", "1")

from fastapi.testclient import TestClient

from app.core.config import settings
from app.main import app
from app.services.store_profile_service import is_open_at, normalize_opening_hours

BASE_PAYLOAD = {
    "name": "Pizza Blitz",
    "tagline": "Hot pizza. Fast lanes. Zero drama.",
    "phone": "9999999999",
    "email": "store@example.com",
    "address_line": "12 Test Street",
    "map_url": "https://maps.example.com/store",
    "instagram_url": "https://instagram.com/example",
    "opening_hours": None,
    "online_ordering_paused": False,
    "pause_message": None,
    "prep_time_minutes": 25,
}


class StoreProfileTest(unittest.TestCase):
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
        # Never leak a paused/closed store into later tests.
        self.update()
        self._ctx.__exit__(None, None, None)

    def update(self, **overrides):
        payload = {**BASE_PAYLOAD, **overrides}
        response = self.client.put(
            "/api/v1/restaurant/ops/store-profile",
            json=payload,
            headers=self.headers,
        )
        self.assertEqual(response.status_code, 200, response.text)
        return response.json()

    def test_admin_endpoint_requires_auth(self):
        anonymous = self.client.get("/api/v1/restaurant/ops/store-profile")
        self.assertEqual(anonymous.status_code, 401)

    def test_default_profile_is_public_and_orderable(self):
        public = self.client.get("/api/v1/restaurant/storefront/profile")
        self.assertEqual(public.status_code, 200)
        payload = public.json()
        self.assertEqual(payload["profile"]["name"], "Pizza Blitz")
        self.assertIsNone(payload["profile"]["opening_hours"] or None)
        self.assertTrue(payload["status"]["accepting_orders"])
        self.assertEqual(payload["status"]["state"], "open")
        self.assertIsNone(payload["status"]["next_opening"])
        self.assertNotIn("online_ordering_paused", payload["profile"])

    def test_profile_update_round_trip(self):
        self.update(
            name="Pizza Blitz Koramangala",
            phone="+91 99999 00000",
            address_line="5 Test Road",
            opening_hours={"mon": {"open": "11:00", "close": "23:00"}},
        )
        admin = self.client.get(
            "/api/v1/restaurant/ops/store-profile", headers=self.headers
        ).json()
        self.assertEqual(admin["name"], "Pizza Blitz Koramangala")
        self.assertEqual(admin["opening_hours"]["mon"]["open"], "11:00")

        public = self.client.get("/api/v1/restaurant/storefront/profile").json()
        self.assertEqual(public["profile"]["phone"], "+91 99999 00000")
        self.assertEqual(public["profile"]["address_line"], "5 Test Road")

    def test_pause_blocks_checkout_and_orders(self):
        self.update(
            online_ordering_paused=True,
            pause_message="Back at 6 PM after the oven service.",
        )
        public = self.client.get("/api/v1/restaurant/storefront/profile").json()
        self.assertEqual(public["status"]["state"], "paused")
        self.assertFalse(public["status"]["accepting_orders"])
        self.assertIn("6 PM", public["status"]["message"])

        readiness = self.client.get(
            "/api/v1/restaurant/orders/checkout-readiness"
        ).json()
        self.assertFalse(readiness["accepting_orders"])
        self.assertIn("6 PM", readiness["message"])

        blocked = self.client.post(
            "/api/v1/restaurant/orders/",
            json={"order_type": "takeaway", "items": []},
        )
        self.assertEqual(blocked.status_code, 503)
        self.assertIn("6 PM", blocked.json()["detail"])

        self.update()
        readiness = self.client.get(
            "/api/v1/restaurant/orders/checkout-readiness"
        ).json()
        self.assertTrue(readiness["accepting_orders"])

    def test_closed_hours_block_orders(self):
        self.update(opening_hours={})
        public = self.client.get("/api/v1/restaurant/storefront/profile").json()
        self.assertEqual(public["status"]["state"], "closed")
        self.assertFalse(public["status"]["accepting_orders"])

        readiness = self.client.get(
            "/api/v1/restaurant/orders/checkout-readiness"
        ).json()
        self.assertFalse(readiness["accepting_orders"])

        self.update()
        public = self.client.get("/api/v1/restaurant/storefront/profile").json()
        self.assertTrue(public["status"]["accepting_orders"])

    def test_invalid_opening_hours_are_rejected(self):
        payload = {
            **BASE_PAYLOAD,
            "opening_hours": {"mon": {"open": "25:00", "close": "23:00"}},
        }
        response = self.client.put(
            "/api/v1/restaurant/ops/store-profile",
            json=payload,
            headers=self.headers,
        )
        self.assertEqual(response.status_code, 422)

        payload["opening_hours"] = {"funday": {"open": "11:00", "close": "23:00"}}
        response = self.client.put(
            "/api/v1/restaurant/ops/store-profile",
            json=payload,
            headers=self.headers,
        )
        self.assertEqual(response.status_code, 422)

    def test_opening_hour_normalization(self):
        self.assertIsNone(normalize_opening_hours(None))
        self.assertEqual(normalize_opening_hours({}), {})
        normalized = normalize_opening_hours(
            {"MON": {"open": "11:00", "close": "23:00"}, "tue": None}
        )
        self.assertEqual(normalized, {"mon": {"open": "11:00", "close": "23:00"}})
        with self.assertRaises(ValueError):
            normalize_opening_hours({"mon": {"open": "11:00", "close": "11:00"}})

    def test_overnight_hours(self):
        profile = SimpleNamespace(
            opening_hours={"mon": {"open": "22:00", "close": "02:00"}}
        )
        self.assertTrue(is_open_at(profile, datetime(2026, 10, 19, 23, 0)))  # Mon 23:00
        self.assertTrue(is_open_at(profile, datetime(2026, 10, 20, 1, 0)))  # Tue 01:00
        self.assertFalse(is_open_at(profile, datetime(2026, 10, 19, 12, 0)))  # Mon noon
        self.assertFalse(is_open_at(profile, datetime(2026, 10, 21, 1, 0)))  # Wed 01:00


if __name__ == "__main__":
    unittest.main()
