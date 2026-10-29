"""Rider link, GPS, and proof-of-delivery tests."""

import os
import unittest
from datetime import datetime, timedelta, timezone

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

        # A rider publishes a call-back number; the customer sees it only
        # while the delivery is active.
        bad_contact = self.client.patch(
            f"/api/v1/restaurant/delivery/rider/{token}/contact",
            json={"phone": "123"},
        )
        self.assertEqual(bad_contact.status_code, 422, bad_contact.text)
        contact = self.client.patch(
            f"/api/v1/restaurant/delivery/rider/{token}/contact",
            json={"phone": "+91 98123 45799"},
        )
        self.assertEqual(contact.status_code, 200, contact.text)
        self.assertEqual(contact.json()["rider_phone"], "919812345799")
        assigned_track = self.client.get(
            f"/api/v1/restaurant/orders/track/{order_id}?phone={phone}"
        )
        self.assertEqual(assigned_track.status_code, 200, assigned_track.text)
        self.assertEqual(
            assigned_track.json()["rider"]["phone"], "919812345799"
        )
        # The guest gets a promise they can count down to, not just a window.
        eta_at = assigned_track.json()["eta_at"]
        self.assertTrue(
            eta_at and eta_at.endswith("Z"),
            f"Tracking ETA was {eta_at!r}.",
        )
        remaining = datetime.fromisoformat(eta_at.replace("Z", "+00:00")) - datetime.now(
            timezone.utc
        )
        self.assertGreater(remaining, timedelta(minutes=40))
        self.assertLessEqual(remaining, timedelta(minutes=46))

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

        # The operations dispatch board reads the same fix and call-back
        # number from the queue, so that contract is asserted too.
        queue = self.client.get(
            "/api/v1/restaurant/delivery/queue", headers=self.headers
        )
        self.assertEqual(queue.status_code, 200, queue.text)
        queued = next(
            row for row in queue.json()["orders"] if row["id"] == order_id
        )
        self.assertEqual(queued["assignment"]["rider_phone"], "919812345799")
        self.assertAlmostEqual(queued["assignment"]["location"]["lat"], 12.9716)
        self.assertAlmostEqual(queued["assignment"]["location"]["lng"], 77.5946)

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
        # A finished delivery has no countdown left to run.
        self.assertIsNone(tracked.json()["eta_at"])
        # The personal number is retired once the handoff is complete.
        self.assertIsNone(rider["phone"])
        late_contact = self.client.patch(
            f"/api/v1/restaurant/delivery/rider/{token}/contact",
            json={"phone": "9812345799"},
        )
        self.assertEqual(late_contact.status_code, 409, late_contact.text)

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
