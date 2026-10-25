"""Editable support SLA policies with separate response and resolution targets."""

import os
import unittest
from datetime import datetime, timedelta

os.environ.setdefault("PYTHONDONTWRITEBYTECODE", "1")

from fastapi.testclient import TestClient

from app.core.config import settings
from app.db.session import SessionLocal
from app.main import app
from app.models.domain import SupportMessage, SupportSlaPolicy, SupportTicket

BASE = "/api/v1/restaurant/support"


class SupportSlaPolicyTest(unittest.TestCase):
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
            db.query(SupportSlaPolicy).delete(synchronize_session=False)
            db.commit()
        finally:
            db.close()
        self._ctx.__exit__(None, None, None)

    def _create(self, priority: str) -> dict:
        response = self.client.post(
            f"{BASE}/tickets",
            json={
                "customer_name": "Policy Guest",
                "email": f"policy-{priority}-{id(self)}@example.com",
                "subject": f"Policy {priority} ticket",
                "message": "Checking the SLA target for this priority.",
                "category": "other",
                "priority": priority,
            },
        )
        self.assertEqual(response.status_code, 201, response.text)
        db = SessionLocal()
        try:
            row = (
                db.query(SupportTicket)
                .filter(SupportTicket.token == response.json()["token"])
                .first()
            )
            self.ticket_ids.append(row.id)
        finally:
            db.close()
        return response.json()["ticket"]

    def test_defaults_and_update_affect_new_tickets(self):
        defaults = self.client.get(f"{BASE}/sla-policy", headers=self.headers)
        self.assertEqual(defaults.status_code, 200, defaults.text)
        by_priority = {
            row["priority"]: row for row in defaults.json()["policies"]
        }
        self.assertEqual(set(by_priority), {"urgent", "high", "normal", "low"})
        self.assertEqual(by_priority["urgent"]["response_minutes"], 30)
        self.assertEqual(by_priority["urgent"]["resolution_minutes"], 120)

        updated = self.client.put(
            f"{BASE}/sla-policy/urgent",
            json={"response_minutes": 10, "resolution_minutes": 60},
            headers=self.headers,
        )
        self.assertEqual(updated.status_code, 200, updated.text)
        self.assertEqual(updated.json()["policy"]["resolution_hours"], 1)

        ticket = self._create("urgent")
        self.assertEqual(ticket["sla_target_hours"], 1)
        self.assertIsNotNone(ticket["first_response_due_at"])
        response_due = datetime.fromisoformat(ticket["first_response_due_at"])
        resolution_due = datetime.fromisoformat(ticket["sla_due_at"])
        self.assertAlmostEqual(
            (response_due - resolution_due).total_seconds() / 60, -50, delta=1
        )

    def test_invalid_policy_is_rejected(self):
        response = self.client.put(
            f"{BASE}/sla-policy/high",
            json={"response_minutes": 600, "resolution_minutes": 60},
            headers=self.headers,
        )
        self.assertEqual(response.status_code, 422, response.text)

    def test_first_response_overdue_count(self):
        self._create("normal")
        db = SessionLocal()
        try:
            row = (
                db.query(SupportTicket)
                .filter(SupportTicket.id == self.ticket_ids[0])
                .first()
            )
            row.first_response_due_at = datetime.utcnow() - timedelta(minutes=30)
            db.commit()
        finally:
            db.close()
        summary = self.client.get(f"{BASE}/summary", headers=self.headers)
        self.assertEqual(summary.status_code, 200, summary.text)
        self.assertGreaterEqual(summary.json()["sla"]["first_response_overdue"], 1)


if __name__ == "__main__":
    unittest.main()
