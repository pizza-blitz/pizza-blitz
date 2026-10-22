"""Scheduled pickup/delivery order tests."""

import os
import unittest
from datetime import datetime, time, timedelta

os.environ.setdefault("PYTHONDONTWRITEBYTECODE", "1")

from fastapi.testclient import TestClient

from app.core.clock import business_now, business_zone
from app.core.config import settings
from app.main import app
from app.services.scheduling_service import SLOT_CAPACITY

BASE_PROFILE = {
    "name": "Pizza Blitz",
    "tagline": "Hot pizza. Fast lanes. Zero drama.",
    "phone": None,
    "email": None,
    "address_line": None,
    "map_url": None,
    "instagram_url": None,
    "opening_hours": None,
    "online_ordering_paused": False,
    "pause_message": None,
    "prep_time_minutes": 25,
}


def local_slot(days_ahead: int, hour: int, minute: int) -> str:
    target = (business_now() + timedelta(days=days_ahead)).date()
    return datetime.combine(
        target, time(hour=hour, minute=minute), tzinfo=business_zone()
    ).isoformat()


def order_payload(scheduled_for: str | None = None) -> dict:
    payload = {
        "order_type": "takeaway",
        "customer_name": "Scheduled Guest",
        "customer_phone": "9812345678",
        "payment_method": "cash",
        "items": [
            {"name": "Garlic Bread", "quantity": 1, "price": 119},
        ],
    }
    if scheduled_for is not None:
        payload["scheduled_for"] = scheduled_for
    return payload


class ScheduledOrdersTest(unittest.TestCase):
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
        self._set_profile()

    def tearDown(self):
        self._set_profile()
        self._ctx.__exit__(None, None, None)

    def _set_profile(self, **overrides):
        payload = {**BASE_PROFILE, **overrides}
        response = self.client.put(
            "/api/v1/restaurant/ops/store-profile", json=payload, headers=self.headers
        )
        self.assertEqual(response.status_code, 200, response.text)

    def test_slots_endpoint_lists_future_slots(self):
        tomorrow = (business_now() + timedelta(days=1)).date().isoformat()
        response = self.client.get(
            f"/api/v1/restaurant/orders/scheduled-slots?date={tomorrow}"
        )
        self.assertEqual(response.status_code, 200, response.text)
        data = response.json()
        self.assertEqual(data["date"], tomorrow)
        self.assertGreater(len(data["slots"]), 0)
        slot = data["slots"][0]
        self.assertIn("value", slot)
        self.assertIn("label", slot)
        self.assertIn("available", slot)
        self.assertEqual(data["slot_minutes"], 15)

    def test_slots_endpoint_rejects_past_date(self):
        yesterday = (business_now() - timedelta(days=1)).date().isoformat()
        response = self.client.get(
            f"/api/v1/restaurant/orders/scheduled-slots?date={yesterday}"
        )
        self.assertEqual(response.status_code, 422)

    def test_create_scheduled_order(self):
        scheduled = local_slot(1, 12, 30)
        response = self.client.post(
            "/api/v1/restaurant/orders/", json=order_payload(scheduled)
        )
        self.assertEqual(response.status_code, 200, response.text)
        data = response.json()
        self.assertEqual(data["scheduled_label"], "Tomorrow, 12:30 PM")
        self.assertIn("+05:30", data["scheduled_for"])

        order_id = data["order_id"]
        tracked = self.client.get(
            f"/api/v1/restaurant/orders/track/{order_id}?phone=9812345678"
        )
        if tracked.status_code == 200:
            self.assertEqual(tracked.json()["scheduled_label"], "Tomorrow, 12:30 PM")
            self.assertIn("Scheduled", tracked.json()["eta_window"])

    def test_rejects_bad_slots(self):
        for scheduled in (
            local_slot(0, 12, 37),  # not a 15-minute slot
            (business_now() - timedelta(hours=2)).isoformat(),  # past
            local_slot(20, 12, 30),  # beyond the booking window
        ):
            response = self.client.post(
                "/api/v1/restaurant/orders/", json=order_payload(scheduled)
            )
            self.assertEqual(response.status_code, 422, f"{scheduled}: {response.text}")

    def test_rejects_time_outside_opening_hours(self):
        self._set_profile(
            opening_hours={
                "mon": {"open": "11:00", "close": "15:00"},
                "tue": {"open": "11:00", "close": "15:00"},
                "wed": {"open": "11:00", "close": "15:00"},
                "thu": {"open": "11:00", "close": "15:00"},
                "fri": {"open": "11:00", "close": "15:00"},
                "sat": {"open": "11:00", "close": "15:00"},
                "sun": {"open": "11:00", "close": "15:00"},
            }
        )
        response = self.client.post(
            "/api/v1/restaurant/orders/", json=order_payload(local_slot(1, 18, 0))
        )
        self.assertEqual(response.status_code, 422)
        self.assertIn("opening hours", response.json()["detail"])

    def test_slot_capacity_is_enforced(self):
        scheduled = local_slot(1, 15, 0)
        for index in range(SLOT_CAPACITY):
            response = self.client.post(
                "/api/v1/restaurant/orders/", json=order_payload(scheduled)
            )
            self.assertEqual(response.status_code, 200, f"order {index}: {response.text}")

        blocked = self.client.post(
            "/api/v1/restaurant/orders/", json=order_payload(scheduled)
        )
        self.assertEqual(blocked.status_code, 422)
        self.assertIn("full", blocked.json()["detail"].lower())

    def test_paused_store_rejects_scheduled_orders(self):
        self._set_profile(online_ordering_paused=True, pause_message="Oven service.")
        response = self.client.post(
            "/api/v1/restaurant/orders/", json=order_payload(local_slot(1, 12, 30))
        )
        self.assertEqual(response.status_code, 503)


if __name__ == "__main__":
    unittest.main()
