"""Transactional order-status notification tests."""

import os
import unittest
from unittest.mock import patch

os.environ.setdefault("PYTHONDONTWRITEBYTECODE", "1")

from fastapi.testclient import TestClient

from app.core.config import settings
from app.main import app


def order_payload(**overrides) -> dict:
    payload = {
        "order_type": "takeaway",
        "customer_name": "Notify Guest",
        "customer_phone": "9812345672",
        "payment_method": "cash",
        "items": [{"name": "Garlic Bread", "quantity": 1, "price": 119}],
    }
    payload.update(overrides)
    return payload


class OrderNotificationTest(unittest.TestCase):
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
        patcher = patch.object(settings, "ORDER_NOTIFICATIONS_ENABLED", True)
        patcher.start()
        self.addCleanup(patcher.stop)
        channel_patcher = patch.object(settings, "ORDER_NOTIFICATION_CHANNEL", "console")
        channel_patcher.start()
        self.addCleanup(channel_patcher.stop)

    def tearDown(self):
        self._ctx.__exit__(None, None, None)

    def create_order(self, **overrides) -> int:
        response = self.client.post(
            "/api/v1/restaurant/orders/", json=order_payload(**overrides)
        )
        self.assertEqual(response.status_code, 200, response.text)
        return response.json()["order_id"]

    def set_status(self, order_id: int, status: str):
        return self.client.patch(
            f"/api/v1/restaurant/orders/{order_id}/status",
            json={"status": status},
            headers=self.headers,
        )

    def notifications(self, order_id: int):
        return self.client.get(
            f"/api/v1/restaurant/orders/{order_id}/notifications", headers=self.headers
        )

    def test_status_changes_send_once_per_event(self):
        order_id = self.create_order()

        preparing = self.set_status(order_id, "preparing")
        self.assertEqual(preparing.status_code, 200, preparing.text)
        listed = self.notifications(order_id)
        self.assertEqual(listed.status_code, 200, listed.text)
        rows = listed.json()["notifications"]
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]["event"], "preparing")
        self.assertEqual(rows[0]["status"], "sent")
        self.assertEqual(rows[0]["provider"], "console")
        self.assertIn(f"Order #{order_id}", rows[0]["message"])

        # Repeating the same status must not duplicate the notification.
        self.set_status(order_id, "preparing")
        self.assertEqual(len(self.notifications(order_id).json()["notifications"]), 1)

        self.set_status(order_id, "ready")
        rows = self.notifications(order_id).json()["notifications"]
        self.assertEqual(len(rows), 2)
        self.assertEqual({row["event"] for row in rows}, {"preparing", "ready"})

    def test_tracking_exposes_sent_updates(self):
        order_id = self.create_order()
        self.set_status(order_id, "preparing")
        self.set_status(order_id, "ready")
        tracked = self.client.get(
            f"/api/v1/restaurant/orders/track/{order_id}?phone=9812345672"
        )
        self.assertEqual(tracked.status_code, 200, tracked.text)
        updates = tracked.json()["notifications"]
        self.assertEqual([update["event"] for update in updates], ["preparing", "ready"])
        self.assertNotIn("recipient", updates[0])

    def test_cancellation_notifies(self):
        order_id = self.create_order()
        cancelled = self.client.patch(
            f"/api/v1/restaurant/orders/{order_id}/cancel",
            json={"reason": "Customer changed their mind"},
            headers=self.headers,
        )
        self.assertEqual(cancelled.status_code, 200, cancelled.text)
        events = {
            row["event"] for row in self.notifications(order_id).json()["notifications"]
        }
        self.assertIn("cancelled", events)

    def test_disabled_notifications_are_recorded_as_skipped(self):
        with patch.object(settings, "ORDER_NOTIFICATIONS_ENABLED", False):
            order_id = self.create_order()
            self.set_status(order_id, "preparing")
        rows = self.notifications(order_id).json()["notifications"]
        self.assertEqual(rows[0]["status"], "skipped")
        self.assertIn("disabled", rows[0]["error"].lower())

    def test_order_without_phone_is_skipped(self):
        order_id = self.create_order(customer_phone=None)
        self.set_status(order_id, "preparing")
        rows = self.notifications(order_id).json()["notifications"]
        self.assertEqual(rows[0]["status"], "skipped")
        self.assertIn("phone", rows[0]["error"].lower())

    def test_notifications_require_authentication(self):
        order_id = self.create_order()
        anonymous = self.client.get(
            f"/api/v1/restaurant/orders/{order_id}/notifications"
        )
        self.assertEqual(anonymous.status_code, 401)


if __name__ == "__main__":
    unittest.main()
