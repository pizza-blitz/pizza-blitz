"""SLA alert delivery to Slack/email with honest skipped status."""

import os
import unittest
from datetime import datetime, timedelta
from unittest.mock import patch

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


class FakeSlackResponse:
    status = 200

    def __enter__(self):
        return self

    def __exit__(self, *args):
        return False


class SupportAlertDeliveryTest(unittest.TestCase):
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

    def _overdue_ticket(self) -> int:
        response = self.client.post(
            f"{BASE}/tickets",
            json={
                "customer_name": "Delivery Alert Guest",
                "email": f"delivery-alert-{id(self)}@example.com",
                "subject": "Delivery alert ticket",
                "message": "The order is very late.",
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
            row.sla_due_at = datetime.utcnow() - timedelta(hours=1)
            db.commit()
            self.ticket_ids.append(row.id)
            return row.id
        finally:
            db.close()

    def test_slack_delivery_marks_alert_sent(self):
        self._overdue_ticket()
        with patch.dict(
            os.environ,
            {
                "SUPPORT_SLACK_WEBHOOK_URL": "https://hooks.slack.test/services/proof",
                "SUPPORT_ALERT_EMAIL": "",
            },
        ), patch(
            "app.services.support_alert_delivery.urllib.request.urlopen",
            return_value=FakeSlackResponse(),
        ):
            response = self.client.post(
                f"{BASE}/notifications/run", headers=self.headers
            )
        self.assertEqual(response.status_code, 200, response.text)
        self.assertGreaterEqual(response.json()["delivered"], 1)

        listed = self.client.get(f"{BASE}/notifications", headers=self.headers).json()
        alert = listed["notifications"][0]
        self.assertEqual(alert["delivery_status"], "sent")
        self.assertIn("slack", alert["delivery_channels"])
        self.assertIsNotNone(alert["delivered_at"])

    def test_unconfigured_delivery_is_skipped(self):
        self._overdue_ticket()
        with patch.dict(
            os.environ,
            {"SUPPORT_SLACK_WEBHOOK_URL": "", "SUPPORT_ALERT_EMAIL": ""},
        ):
            response = self.client.post(
                f"{BASE}/notifications/run", headers=self.headers
            )
        self.assertEqual(response.status_code, 200, response.text)
        self.assertGreaterEqual(response.json()["delivery_skipped"], 1)
        listed = self.client.get(f"{BASE}/notifications", headers=self.headers).json()
        alert = listed["notifications"][0]
        self.assertEqual(alert["delivery_status"], "skipped")
        self.assertIsNone(alert["delivery_channels"])


if __name__ == "__main__":
    unittest.main()
