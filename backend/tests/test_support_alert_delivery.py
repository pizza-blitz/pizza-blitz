"""SLA alert delivery to Slack/email with honest skipped status."""

import os
import json
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
from app.services.support_alert_delivery import (
    retry_due_alerts,
    retry_pending_pager_resolutions,
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

        with patch.dict(
            os.environ,
            {
                "SUPPORT_SLACK_WEBHOOK_URL": "https://hooks.slack.test/services/retry",
                "SUPPORT_ALERT_EMAIL": "",
            },
        ), patch(
            "app.services.support_alert_delivery.urllib.request.urlopen",
            return_value=FakeSlackResponse(),
        ):
            retried = self.client.post(
                f"{BASE}/notifications/{alert['id']}/retry", headers=self.headers
            )
        self.assertEqual(retried.status_code, 200, retried.text)
        self.assertEqual(retried.json()["notification"]["delivery_status"], "sent")
        self.assertIn("slack", retried.json()["notification"]["delivery_channels"])


    def test_pager_webhook_delivers_high_priority_alert(self):
        self._overdue_ticket()
        with patch.dict(
            os.environ,
            {
                "SUPPORT_SLACK_WEBHOOK_URL": "",
                "SUPPORT_ALERT_EMAIL": "",
                "SUPPORT_PAGER_WEBHOOK_URL": (
                    "https://events.pagerduty.test/v2/enqueue"
                ),
                "SUPPORT_PAGER_ROUTING_KEY": "routing-proof",
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
        self.assertIn("pager", alert["delivery_channels"])

    def test_resolving_ticket_sends_pager_resolve(self):
        ticket_id = self._overdue_ticket()
        calls: list[dict] = []

        def fake_urlopen(request, timeout=10):
            calls.append(json.loads(request.data.decode("utf-8")))
            return FakeSlackResponse()

        with patch.dict(
            os.environ,
            {
                "SUPPORT_SLACK_WEBHOOK_URL": "",
                "SUPPORT_ALERT_EMAIL": "",
                "SUPPORT_PAGER_WEBHOOK_URL": "https://events.pagerduty.test/v2/enqueue",
                "SUPPORT_PAGER_ROUTING_KEY": "routing-proof",
            },
        ), patch(
            "app.services.support_alert_delivery.urllib.request.urlopen",
            side_effect=fake_urlopen,
        ):
            run = self.client.post(f"{BASE}/notifications/run", headers=self.headers)
            self.assertEqual(run.status_code, 200, run.text)
            resolved = self.client.patch(
                f"{BASE}/tickets/{ticket_id}",
                json={"status": "resolved"},
                headers=self.headers,
            )
            self.assertEqual(resolved.status_code, 200, resolved.text)

        self.assertGreaterEqual(len(calls), 2, calls)
        self.assertEqual(calls[0]["event_action"], "trigger")
        self.assertEqual(calls[1]["event_action"], "resolve")
        self.assertEqual(calls[0]["dedup_key"], calls[1]["dedup_key"])

    def test_failed_pager_resolve_is_retried_later(self):
        ticket_id = self._overdue_ticket()
        with patch.dict(
            os.environ,
            {
                "SUPPORT_SLACK_WEBHOOK_URL": "",
                "SUPPORT_ALERT_EMAIL": "",
                "SUPPORT_PAGER_WEBHOOK_URL": "https://events.pagerduty.test/v2/enqueue",
                "SUPPORT_PAGER_ROUTING_KEY": "routing-proof",
            },
        ), patch(
            "app.services.support_alert_delivery.urllib.request.urlopen",
            return_value=FakeSlackResponse(),
        ):
            run = self.client.post(f"{BASE}/notifications/run", headers=self.headers)
            self.assertEqual(run.status_code, 200, run.text)
        with patch.dict(
            os.environ,
            {
                "SUPPORT_SLACK_WEBHOOK_URL": "",
                "SUPPORT_ALERT_EMAIL": "",
                "SUPPORT_PAGER_WEBHOOK_URL": "https://events.pagerduty.test/v2/enqueue",
                "SUPPORT_PAGER_ROUTING_KEY": "routing-proof",
            },
        ), patch(
            "app.services.support_alert_delivery.urllib.request.urlopen",
            side_effect=OSError("pager down"),
        ):
            resolved = self.client.patch(
                f"{BASE}/tickets/{ticket_id}",
                json={"status": "resolved"},
                headers=self.headers,
            )
            self.assertEqual(resolved.status_code, 200, resolved.text)

        db = SessionLocal()
        try:
            pending = (
                db.query(SupportNotification)
                .filter(
                    SupportNotification.ticket_id == ticket_id,
                    SupportNotification.pager_dedup_key.isnot(None),
                    SupportNotification.pager_resolved_at.is_(None),
                )
                .all()
            )
            self.assertGreaterEqual(len(pending), 1)
            with patch.dict(
                os.environ,
                {
                    "SUPPORT_PAGER_WEBHOOK_URL": (
                        "https://events.pagerduty.test/v2/enqueue"
                    ),
                    "SUPPORT_PAGER_ROUTING_KEY": "routing-proof",
                },
            ), patch(
                "app.services.support_alert_delivery.urllib.request.urlopen",
                return_value=FakeSlackResponse(),
            ):
                summary = retry_pending_pager_resolutions(db)
            self.assertGreaterEqual(summary["resolved"], 1)
            for row in pending:
                db.refresh(row)
                self.assertIsNotNone(row.pager_resolved_at)
                self.assertIsNotNone(row.read_at)
        finally:
            db.close()

    def test_failed_delivery_schedules_retry_and_succeeds(self):
        self._overdue_ticket()
        with patch.dict(
            os.environ,
            {
                "SUPPORT_SLACK_WEBHOOK_URL": "https://hooks.slack.test/services/retry",
                "SUPPORT_ALERT_EMAIL": "",
            },
        ), patch(
            "app.services.support_alert_delivery.urllib.request.urlopen",
            side_effect=OSError("network down"),
        ):
            response = self.client.post(
                f"{BASE}/notifications/run", headers=self.headers
            )
        self.assertEqual(response.status_code, 200, response.text)
        listed = self.client.get(f"{BASE}/notifications", headers=self.headers).json()
        alert = listed["notifications"][0]
        self.assertEqual(alert["delivery_status"], "retrying")
        self.assertEqual(alert["delivery_attempts"], 1)
        self.assertIsNotNone(alert["next_retry_at"])

        db = SessionLocal()
        try:
            row = (
                db.query(SupportNotification)
                .filter(SupportNotification.id == alert["id"])
                .first()
            )
            row.next_retry_at = datetime.utcnow() - timedelta(minutes=1)
            db.commit()
        finally:
            db.close()

        with patch.dict(
            os.environ,
            {
                "SUPPORT_SLACK_WEBHOOK_URL": "https://hooks.slack.test/services/retry",
                "SUPPORT_ALERT_EMAIL": "",
            },
        ), patch(
            "app.services.support_alert_delivery.urllib.request.urlopen",
            return_value=FakeSlackResponse(),
        ):
            db = SessionLocal()
            try:
                summary = retry_due_alerts(db)
            finally:
                db.close()
        self.assertEqual(summary["sent"], 1, summary)
        listed = self.client.get(f"{BASE}/notifications", headers=self.headers).json()
        alert = listed["notifications"][0]
        self.assertEqual(alert["delivery_status"], "sent")
        self.assertEqual(alert["delivery_attempts"], 2)


if __name__ == "__main__":
    unittest.main()
