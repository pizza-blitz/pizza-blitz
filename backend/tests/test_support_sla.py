"""Support SLA targets, first response, resolution and breach reporting."""

import os
import unittest
from datetime import datetime, timedelta

os.environ.setdefault("PYTHONDONTWRITEBYTECODE", "1")

from fastapi.testclient import TestClient

from app.core.config import settings
from app.db.session import SessionLocal
from app.main import app
from app.models.domain import SupportMessage, SupportTicket

BASE = "/api/v1/restaurant/support"


class SupportSlaTest(unittest.TestCase):
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
        self.headers = {"Authorization": f"Bearer {login.json()['access_token']}"}
        self.ticket_ids: list[int] = []

    def tearDown(self):
        db = SessionLocal()
        try:
            if self.ticket_ids:
                db.query(SupportMessage).filter(
                    SupportMessage.ticket_id.in_(self.ticket_ids)
                ).delete(synchronize_session=False)
                db.query(SupportTicket).filter(
                    SupportTicket.id.in_(self.ticket_ids)
                ).delete(synchronize_session=False)
                db.commit()
        finally:
            db.close()
        self._ctx.__exit__(None, None, None)

    def _create(self, priority: str = "urgent") -> dict:
        response = self.client.post(
            f"{BASE}/tickets",
            json={
                "customer_name": "SLA Guest",
                "email": f"sla-{priority}-{id(self)}@example.com",
                "subject": f"SLA {priority} ticket",
                "message": "My order is late and I need an update.",
                "category": "delivery",
                "priority": priority,
            },
        )
        self.assertEqual(response.status_code, 201, response.text)
        ticket = response.json()["ticket"]
        db = SessionLocal()
        try:
            row = db.query(SupportTicket).filter(SupportTicket.token == response.json()["token"]).first()
            self.ticket_ids.append(row.id)
        finally:
            db.close()
        return ticket

    def _ticket_id(self, index: int = 0) -> int:
        return self.ticket_ids[index]

    def test_first_response_and_resolution_clock(self):
        ticket = self._create("urgent")
        self.assertEqual(ticket["sla_target_hours"], 2)
        self.assertIn(ticket["sla_state"], {"on_track", "due_soon"})
        self.assertIsNotNone(ticket["sla_due_at"])
        self.assertIsNone(ticket["first_response_at"])
        ticket_id = self._ticket_id()

        staff = self.client.post(
            f"{BASE}/tickets/{ticket_id}/reply",
            json={"body": "We are checking with the rider now."},
            headers=self.headers,
        )
        self.assertEqual(staff.status_code, 200, staff.text)
        self.assertIsNotNone(staff.json()["ticket"]["first_response_at"])
        self.assertEqual(staff.json()["ticket"]["status"], "pending")

        resolved = self.client.patch(
            f"{BASE}/tickets/{ticket_id}",
            json={"status": "resolved"},
            headers=self.headers,
        )
        self.assertEqual(resolved.status_code, 200, resolved.text)
        self.assertIsNotNone(resolved.json()["ticket"]["resolved_at"])
        self.assertEqual(resolved.json()["ticket"]["sla_state"], "met")

        token = ticket["ticket_url"].rsplit("/", 1)[-1]
        reopened = self.client.post(
            f"{BASE}/ticket/{token}/reply",
            json={"body": "It is still late."},
        )
        self.assertEqual(reopened.status_code, 200, reopened.text)
        self.assertEqual(reopened.json()["ticket"]["status"], "open")
        self.assertIsNone(reopened.json()["ticket"]["resolved_at"])

    def test_internal_note_does_not_start_first_response_clock(self):
        self._create("high")
        ticket_id = self._ticket_id()
        internal = self.client.post(
            f"{BASE}/tickets/{ticket_id}/reply",
            json={"body": "Escalate to the kitchen lead.", "internal": True},
            headers=self.headers,
        )
        self.assertEqual(internal.status_code, 200, internal.text)
        self.assertIsNone(internal.json()["ticket"]["first_response_at"])

    def test_overdue_and_breached_counts(self):
        self._create("low")
        ticket_id = self._ticket_id()
        db = SessionLocal()
        try:
            row = db.query(SupportTicket).filter(SupportTicket.id == ticket_id).first()
            row.sla_due_at = datetime.utcnow() - timedelta(hours=2)
            db.commit()
        finally:
            db.close()
        summary = self.client.get(f"{BASE}/summary", headers=self.headers)
        self.assertEqual(summary.status_code, 200, summary.text)
        sla = summary.json()["sla"]
        self.assertGreaterEqual(sla["overdue"], 1)
        self.assertEqual(sla["targets_hours"]["urgent"], 2)

        resolved = self.client.patch(
            f"{BASE}/tickets/{ticket_id}",
            json={"status": "resolved"},
            headers=self.headers,
        )
        self.assertEqual(resolved.json()["ticket"]["sla_state"], "breached")
        summary = self.client.get(f"{BASE}/summary", headers=self.headers).json()
        self.assertGreaterEqual(summary["sla"]["breached_resolved"], 1)


if __name__ == "__main__":
    unittest.main()
