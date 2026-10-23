"""Aggregator outbound status sync, signing and retry tests."""

import json
import os
import threading
import time
import unittest
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

os.environ.setdefault("PYTHONDONTWRITEBYTECODE", "1")

from fastapi.testclient import TestClient

from app.core.config import settings
from app.db.session import SessionLocal
from app.main import app
from app.services.aggregator_service import deliver_aggregator_events, sign_outbound


class _Handler(BaseHTTPRequestHandler):
    received: list[dict] = []

    def do_POST(self):  # noqa: N802 - http server method
        length = int(self.headers.get("Content-Length", "0"))
        body = self.rfile.read(length)
        _Handler.received.append(
            {
                "body": body,
                "signature": self.headers.get("X-Pizza-Signature"),
                "event": self.headers.get("X-Pizza-Event"),
            }
        )
        self.send_response(200)
        self.end_headers()
        self.wfile.write(b"ok")

    def log_message(self, format, *args):  # noqa: A002 - base signature
        return


class AggregatorOutboundTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.server = ThreadingHTTPServer(("127.0.0.1", 0), _Handler)
        cls.thread = threading.Thread(target=cls.server.serve_forever, daemon=True)
        cls.thread.start()
        cls.url = f"http://127.0.0.1:{cls.server.server_port}/hooks/orders"

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()
        cls.server.server_close()

    def setUp(self):
        self._ctx = TestClient(app)
        self.client = self._ctx.__enter__()
        _Handler.received = []
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

    def connect(self, platform: str = "doordash") -> dict:
        response = self.client.post(
            "/api/v1/restaurant/integrations/aggregators/",
            json={"platform": platform, "store_id": 1},
            headers=self.headers,
        )
        self.assertEqual(response.status_code, 200, response.text)
        return response.json()

    def create_order(self, integration: dict) -> int:
        payload = {
            "external_order_id": f"OUT-{self._testMethodName}-{time.time_ns()}",
            "customer": {"name": "Outbound Guest", "phone": "9812346401"},
            "delivery_address": "12 Park Street",
            "items": [{"name": "Garlic Bread", "quantity": 1, "price": 119}],
            "payment_method": "prepaid",
            "payment_status": "paid",
        }
        response = self.client.post(
            f"/api/v1/restaurant/integrations/aggregators/webhook/{integration['platform']}",
            json=payload,
            headers={"X-Aggregator-Token": integration["webhook_token"]},
        )
        self.assertEqual(response.status_code, 200, response.text)
        return response.json()["order_id"]

    def deliver(self):
        with SessionLocal() as db:
            return deliver_aggregator_events(db)

    def test_status_sync_signs_and_retries(self):
        integration = self.connect()
        enabled = self.client.patch(
            f"/api/v1/restaurant/integrations/aggregators/{integration['id']}",
            json={"outbound_url": self.url, "outbound_enabled": True},
            headers=self.headers,
        )
        self.assertEqual(enabled.status_code, 200, enabled.text)
        secret = enabled.json()["outbound_secret"]
        self.assertTrue(secret.startswith("AGOUT-"))

        order_id = self.create_order(integration)
        moved = self.client.patch(
            f"/api/v1/restaurant/orders/{order_id}/status",
            json={"status": "preparing"},
            headers=self.headers,
        )
        self.assertEqual(moved.status_code, 200, moved.text)

        summary = self.deliver()
        self.assertEqual(summary["sent"], 1, summary)
        self.assertEqual(len(_Handler.received), 1)
        received = _Handler.received[0]
        body = json.loads(received["body"])
        self.assertEqual(body["status"], "preparing")
        self.assertEqual(body["order_id"], order_id)
        self.assertEqual(
            received["signature"], sign_outbound(secret, received["body"])
        )

        events = self.client.get(
            f"/api/v1/restaurant/integrations/aggregators/{integration['id']}/events",
            headers=self.headers,
        )
        self.assertEqual(events.status_code, 200, events.text)
        self.assertEqual(events.json()["events"][0]["delivery_status"], "sent")

        cancelled = self.client.patch(
            f"/api/v1/restaurant/orders/{order_id}/cancel",
            json={"reason": "Outbound proof"},
            headers=self.headers,
        )
        self.assertEqual(cancelled.status_code, 200, cancelled.text)
        second = self.deliver()
        self.assertEqual(second["sent"], 1, second)
        self.assertEqual(json.loads(_Handler.received[1]["body"])["status"], "cancelled")

        # A failing endpoint keeps the event with a retry time.
        failed_url = "http://127.0.0.1:9/unreachable"
        self.client.patch(
            f"/api/v1/restaurant/integrations/aggregators/{integration['id']}",
            json={"outbound_url": failed_url},
            headers=self.headers,
        )
        second_order = self.create_order(integration)
        self.client.patch(
            f"/api/v1/restaurant/orders/{second_order}/status",
            json={"status": "ready"},
            headers=self.headers,
        )
        failed = self.deliver()
        self.assertEqual(failed["failed"], 1, failed)
        listed = self.client.get(
            f"/api/v1/restaurant/integrations/aggregators/{integration['id']}/events",
            headers=self.headers,
        ).json()["events"]
        failed_event = next(row for row in listed if row["order_id"] == second_order)
        self.assertEqual(failed_event["delivery_status"], "failed")
        self.assertEqual(failed_event["attempts"], 1)
        self.assertTrue(failed_event["last_error"])

    def test_outbound_validation_and_access(self):
        integration = self.connect("ubereats")
        missing_url = self.client.patch(
            f"/api/v1/restaurant/integrations/aggregators/{integration['id']}",
            json={"outbound_enabled": True},
            headers=self.headers,
        )
        self.assertEqual(missing_url.status_code, 422)
        invalid_url = self.client.patch(
            f"/api/v1/restaurant/integrations/aggregators/{integration['id']}",
            json={"outbound_url": "not-a-url", "outbound_enabled": True},
            headers=self.headers,
        )
        self.assertEqual(invalid_url.status_code, 422)

        staff_login = self.client.post(
            "/api/v1/auth/staff/login",
            json={
                "id": settings.PIZZA_BLITZ_STAFF_ID,
                "password": settings.PIZZA_BLITZ_STAFF_PASSWORD,
            },
        )
        staff_headers = {
            "Authorization": f"Bearer {staff_login.json()['access_token']}"
        }
        denied = self.client.patch(
            f"/api/v1/restaurant/integrations/aggregators/{integration['id']}",
            json={"outbound_enabled": False},
            headers=staff_headers,
        )
        self.assertEqual(denied.status_code, 403)


if __name__ == "__main__":
    unittest.main()
