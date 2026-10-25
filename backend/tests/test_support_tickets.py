"""Customer support tickets: public token thread + staff inbox."""

import os
import unittest

os.environ.setdefault("PYTHONDONTWRITEBYTECODE", "1")

from fastapi.testclient import TestClient

from app.core.config import settings
from app.main import app


class SupportTicketTest(unittest.TestCase):
    def setUp(self):
        self._ctx = TestClient(app)
        self.client = self._ctx.__enter__()
        admin = self.client.post(
            "/api/v1/auth/admin/login",
            json={
                "id": settings.PIZZA_BLITZ_ADMIN_ID,
                "password": settings.PIZZA_BLITZ_ADMIN_PASSWORD,
            },
        )
        self.headers = {"Authorization": f"Bearer {admin.json()['access_token']}"}

    def tearDown(self):
        self._ctx.__exit__(None, None, None)

    def _ticket(self) -> dict:
        response = self.client.post(
            "/api/v1/restaurant/support/tickets",
            json={
                "customer_name": "Support Guest",
                "email": "support-guest@example.com",
                "phone": "9876500001",
                "subject": "Cold pizza on delivery",
                "message": "My pizza arrived cold and the rider could not find the gate.",
                "category": "delivery",
                "priority": "high",
            },
        )
        self.assertEqual(response.status_code, 201, response.text)
        return response.json()

    def test_public_thread_and_staff_internal_note(self):
        created = self._ticket()
        token = created["token"]
        self.assertEqual(created["ticket"]["status"], "open")
        self.assertIn("/support/ticket/", created["ticket"]["ticket_url"])

        public = self.client.get(f"/api/v1/restaurant/support/ticket/{token}")
        self.assertEqual(public.status_code, 200, public.text)
        self.assertEqual(len(public.json()["ticket"]["messages"]), 1)
        self.assertNotIn("token", public.json()["ticket"])

        listed = self.client.get(
            "/api/v1/restaurant/support/tickets",
            headers=self.headers,
        )
        self.assertEqual(listed.status_code, 200, listed.text)
        ticket_id = listed.json()["tickets"][0]["id"]

        reply = self.client.post(
            f"/api/v1/restaurant/support/tickets/{ticket_id}/reply",
            json={"body": "We are checking with the delivery partner."},
            headers=self.headers,
        )
        self.assertEqual(reply.status_code, 200, reply.text)
        self.assertEqual(reply.json()["ticket"]["status"], "pending")

        internal = self.client.post(
            f"/api/v1/restaurant/support/tickets/{ticket_id}/reply",
            json={"body": "Escalate to kitchen lead.", "internal": True},
            headers=self.headers,
        )
        self.assertEqual(internal.status_code, 200, internal.text)

        public_after = self.client.get(
            f"/api/v1/restaurant/support/ticket/{token}"
        ).json()["ticket"]
        self.assertNotIn(
            "Escalate to kitchen lead.",
            [message["body"] for message in public_after["messages"]],
        )

        customer_reply = self.client.post(
            f"/api/v1/restaurant/support/ticket/{token}/reply",
            json={"body": "Thanks, sharing the gate photo now."},
        )
        self.assertEqual(customer_reply.status_code, 200, customer_reply.text)
        self.assertEqual(customer_reply.json()["ticket"]["status"], "open")

    def test_status_priority_and_closed_guard(self):
        created = self._ticket()
        token = created["token"]
        listed = self.client.get(
            "/api/v1/restaurant/support/tickets", headers=self.headers
        ).json()["tickets"]
        ticket_id = listed[0]["id"]
        updated = self.client.patch(
            f"/api/v1/restaurant/support/tickets/{ticket_id}",
            json={"status": "resolved", "priority": "urgent", "assigned_to": "Ops lead"},
            headers=self.headers,
        )
        self.assertEqual(updated.status_code, 200, updated.text)
        self.assertEqual(updated.json()["ticket"]["assigned_to"], "Ops lead")

        closed = self.client.patch(
            f"/api/v1/restaurant/support/tickets/{ticket_id}",
            json={"status": "closed"},
            headers=self.headers,
        )
        self.assertEqual(closed.status_code, 200, closed.text)
        blocked = self.client.post(
            f"/api/v1/restaurant/support/ticket/{token}/reply",
            json={"body": "One more question."},
        )
        self.assertEqual(blocked.status_code, 409, blocked.text)
        summary = self.client.get(
            "/api/v1/restaurant/support/summary", headers=self.headers
        ).json()
        self.assertGreaterEqual(summary["counts"]["closed"], 1)

    def test_ticket_requires_contact_and_valid_order(self):
        missing = self.client.post(
            "/api/v1/restaurant/support/tickets",
            json={
                "customer_name": "No Contact",
                "subject": "Help",
                "message": "Please help with my order.",
            },
        )
        self.assertEqual(missing.status_code, 422, missing.text)
        bad_order = self.client.post(
            "/api/v1/restaurant/support/tickets",
            json={
                "customer_name": "Bad Order",
                "phone": "9876500002",
                "subject": "Order issue",
                "message": "Please check this order.",
                "order_id": 999999,
            },
        )
        self.assertEqual(bad_order.status_code, 422, bad_order.text)


if __name__ == "__main__":
    unittest.main()
