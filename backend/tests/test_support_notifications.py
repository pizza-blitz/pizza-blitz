"""In-app support SLA alerts with deduplication and read state."""

import unittest
from datetime import datetime, timedelta

from fastapi.testclient import TestClient

from app.core.config import settings
from app.db.session import SessionLocal
from app.main import app
from app.models.domain import (
    SupportMessage,
    SupportNotification,
    SupportSlaPolicy,
    SupportTicket,
)

BASE = "/api/v1/restaurant/support"


class SupportNotificationTest(unittest.TestCase):
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
                db.query(SupportNotification).filter(
                    SupportNotification.ticket_id.in_(self.ticket_ids)
                ).delete(synchronize_session=False)
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

    def _ticket(self) -> int:
        response = self.client.post(
            f"{BASE}/tickets",
            json={
                "customer_name": "Alert Guest",
                "email": f"alert-{id(self)}@example.com",
                "subject": "Alert SLA ticket",
                "message": "My delivery has not arrived.",
                "category": "delivery",
                "priority": "high",
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
            return row.id
        finally:
            db.close()

    def test_alerts_are_deduplicated_and_readable(self):
        ticket_id = self._ticket()
        db = SessionLocal()
        try:
            row = db.query(SupportTicket).filter(SupportTicket.id == ticket_id).first()
            row.sla_due_at = datetime.utcnow() - timedelta(hours=1)
            row.first_response_due_at = datetime.utcnow() - timedelta(hours=2)
            db.commit()
        finally:
            db.close()

        first = self.client.post(
            f"{BASE}/notifications/run", headers=self.headers
        )
        self.assertEqual(first.status_code, 200, first.text)
        self.assertGreaterEqual(first.json()["created"], 2)
        second = self.client.post(
            f"{BASE}/notifications/run", headers=self.headers
        )
        self.assertEqual(second.json()["created"], 0)

        listed = self.client.get(
            f"{BASE}/notifications?unread_only=true", headers=self.headers
        )
        self.assertEqual(listed.status_code, 200, listed.text)
        notifications = listed.json()["notifications"]
        kinds = {item["kind"] for item in notifications}
        self.assertIn("resolution_overdue", kinds)
        self.assertIn("first_response_overdue", kinds)
        summary = self.client.get(f"{BASE}/summary", headers=self.headers).json()
        self.assertGreaterEqual(summary["notifications_unread"], 2)

        notification_id = notifications[0]["id"]
        read = self.client.post(
            f"{BASE}/notifications/{notification_id}/read", headers=self.headers
        )
        self.assertEqual(read.status_code, 200, read.text)
        self.assertIsNotNone(read.json()["notification"]["read_at"])

    def test_resolving_clears_pending_alerts(self):
        ticket_id = self._ticket()
        db = SessionLocal()
        try:
            row = db.query(SupportTicket).filter(SupportTicket.id == ticket_id).first()
            row.sla_due_at = datetime.utcnow() - timedelta(hours=1)
            db.commit()
        finally:
            db.close()
        self.client.post(f"{BASE}/notifications/run", headers=self.headers)
        resolved = self.client.patch(
            f"{BASE}/tickets/{ticket_id}",
            json={"status": "resolved"},
            headers=self.headers,
        )
        self.assertEqual(resolved.status_code, 200, resolved.text)
        listed = self.client.get(f"{BASE}/notifications", headers=self.headers).json()
        self.assertEqual(listed["notifications"], [])


if __name__ == "__main__":
    unittest.main()
