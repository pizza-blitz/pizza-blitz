"""Rider link, GPS, and proof-of-delivery tests."""

import os
import unittest

os.environ.setdefault("PYTHONDONTWRITEBYTECODE", "1")

from fastapi.testclient import TestClient

from app.core.config import settings
from app.main import app


def delivery_payload(phone: str) -> dict:
    return {
        "order_type": "delivery",
        "customer_name": "Rider Test Guest",
        "customer_phone": phone,
        "delivery_address": "12 Park Street",
        "payment_method": "cash",
        "items": [{"name": "Garlic Bread", "quantity": 1, "price": 119}],
    }


class RiderFlowTest(unittest.TestCase):
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

    def create_assigned_delivery(self, phone: str) -> tuple[int, str]:
        created = self.client.post(
            "/api/v1/restaurant/orders/", json=delivery_payload(phone)
        )
        self.assertEqual(created.status_code, 200, created.text)
        order_id = created.json()["order_id"]

        assigned = self.client.patch(
            f"/api/v1/restaurant/delivery/orders/{order_id}/assignment",
            json={"status": "assigned", "assigned_to": "Ravi"},
            headers=self.headers,
        )
        self.assertEqual(assigned.status_code, 200, assigned.text)

        link = self.client.get(
            f"/api/v1/restaurant/delivery/orders/{order_id}/rider-link",
            headers=self.headers,
        )
        self.assertEqual(link.status_code, 200, link.text)
        token = link.json()["rider_token"]
        self.assertTrue(link.json()["rider_path"].startswith("/rider/"))
        return order_id, token

    def test_rider_delivery_flow_with_proof_and_location(self):
        phone = "9812345701"
        order_id, token = self.create_assigned_delivery(phone)

        view = self.client.get(f"/api/v1/restaurant/delivery/rider/{token}")
        self.assertEqual(view.status_code, 200, view.text)
        payload = view.json()
        self.assertEqual(payload["status"], "assigned")
        self.assertEqual(payload["order"]["delivery_address"], "12 Park Street")
        self.assertIn("out_for_delivery", payload["allowed_actions"])

        invalid = self.client.get(
            "/api/v1/restaurant/delivery/rider/not-a-real-token"
        )
        self.assertEqual(invalid.status_code, 404)

        location = self.client.post(
            f"/api/v1/restaurant/delivery/rider/{token}/location",
            json={"lat": 12.9716, "lng": 77.5946},
        )
        self.assertEqual(location.status_code, 200, location.text)
        self.assertAlmostEqual(location.json()["location"]["lat"], 12.9716)
        self.assertEqual(
            self.client.post(
                f"/api/v1/restaurant/delivery/rider/{token}/location",
                json={"lat": 200, "lng": 77},
            ).status_code,
            422,
        )

        too_early = self.client.patch(
            f"/api/v1/restaurant/delivery/rider/{token}/status",
            json={"status": "delivered"},
        )
        self.assertEqual(too_early.status_code, 409)

        started = self.client.patch(
            f"/api/v1/restaurant/delivery/rider/{token}/status",
            json={"status": "out_for_delivery"},
        )
        self.assertEqual(started.status_code, 200, started.text)
        self.assertEqual(started.json()["status"], "out_for_delivery")

        without_proof = self.client.patch(
            f"/api/v1/restaurant/delivery/rider/{token}/status",
            json={"status": "delivered"},
        )
        self.assertEqual(without_proof.status_code, 409)

        bad_proof = self.client.post(
            f"/api/v1/restaurant/delivery/rider/{token}/proof",
            json={"proof_type": "video", "reference": "VIDEO-1"},
        )
        self.assertEqual(bad_proof.status_code, 422)

        proof = self.client.post(
            f"/api/v1/restaurant/delivery/rider/{token}/proof",
            json={
                "proof_type": "photo",
                "reference": "POD-PROOF-1",
                "notes": "Handed to customer",
            },
        )
        self.assertEqual(proof.status_code, 200, proof.text)
        self.assertEqual(proof.json()["proof"]["type"], "photo")

        delivered = self.client.patch(
            f"/api/v1/restaurant/delivery/rider/{token}/status",
            json={"status": "delivered"},
        )
        self.assertEqual(delivered.status_code, 200, delivered.text)
        self.assertEqual(delivered.json()["status"], "delivered")
        self.assertIsNotNone(delivered.json()["timestamps"]["delivered_at"])

        tracked = self.client.get(
            f"/api/v1/restaurant/orders/track/{order_id}?phone={phone}"
        )
        self.assertEqual(tracked.status_code, 200, tracked.text)
        rider = tracked.json()["rider"]
        self.assertEqual(rider["status"], "delivered")
        self.assertTrue(rider["proof_captured"])
        self.assertAlmostEqual(rider["latitude"], 12.9716)

    def test_failed_delivery_requires_reason(self):
        _, token = self.create_assigned_delivery("9812345702")
        self.client.patch(
            f"/api/v1/restaurant/delivery/rider/{token}/status",
            json={"status": "out_for_delivery"},
        )
        no_reason = self.client.patch(
            f"/api/v1/restaurant/delivery/rider/{token}/status",
            json={"status": "failed"},
        )
        self.assertEqual(no_reason.status_code, 422)

        failed = self.client.patch(
            f"/api/v1/restaurant/delivery/rider/{token}/status",
            json={"status": "failed", "notes": "Customer unreachable"},
        )
        self.assertEqual(failed.status_code, 200, failed.text)
        self.assertEqual(failed.json()["status"], "failed")


if __name__ == "__main__":
    unittest.main()
