"""Aggregator outbound menu sync tests."""

import json
import os
import threading
import unittest
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

os.environ.setdefault("PYTHONDONTWRITEBYTECODE", "1")

from fastapi.testclient import TestClient

from app.core.config import settings
from app.main import app
from app.services.aggregator_service import sign_outbound


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
        self.send_response(202)
        self.end_headers()
        self.wfile.write(b"accepted")

    def log_message(self, format, *args):  # noqa: A002 - base signature
        return


class AggregatorMenuSyncTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.server = ThreadingHTTPServer(("127.0.0.1", 0), _Handler)
        cls.thread = threading.Thread(target=cls.server.serve_forever, daemon=True)
        cls.thread.start()
        cls.url = f"http://127.0.0.1:{cls.server.server_port}/hooks/menu"

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
        self.item_id = None

    def tearDown(self):
        if self.item_id:
            self.client.delete(
                f"/api/v1/restaurant/menu/menu/{self.item_id}", headers=self.headers
            )
        self._ctx.__exit__(None, None, None)

    def connect(self) -> dict:
        response = self.client.post(
            "/api/v1/restaurant/integrations/aggregators/",
            json={"platform": "swiggy", "store_id": 1},
            headers=self.headers,
        )
        self.assertEqual(response.status_code, 200, response.text)
        return response.json()

    def test_menu_sync_payload_and_signature(self):
        item = self.client.post(
            "/api/v1/restaurant/menu/menu",
            json={
                "name": "Menu Sync Test Pizza",
                "category": "Pizza",
                "selling_price": 299,
                "cost_price": 100,
                "is_available": True,
                "allergens": ["Milk", "Wheat"],
                "dietary_tags": ["Vegetarian"],
                "calories": 510,
                "channel_prices": [
                    {
                        "channel": "delivery",
                        "price": 349,
                        "is_available": True,
                        "is_visible": True,
                    }
                ],
            },
            headers=self.headers,
        )
        self.assertEqual(item.status_code, 200, item.text)
        self.item_id = item.json()["id"]

        integration = self.connect()
        enabled = self.client.patch(
            f"/api/v1/restaurant/integrations/aggregators/{integration['id']}",
            json={"menu_sync_url": self.url, "menu_sync_enabled": True},
            headers=self.headers,
        )
        self.assertEqual(enabled.status_code, 200, enabled.text)
        secret = enabled.json()["outbound_secret"]

        synced = self.client.post(
            f"/api/v1/restaurant/integrations/aggregators/{integration['id']}/menu-sync",
            headers=self.headers,
        )
        self.assertEqual(synced.status_code, 200, synced.text)
        self.assertEqual(synced.json()["status"], "sent")
        self.assertGreaterEqual(synced.json()["item_count"], 1)

        received = _Handler.received[0]
        body = json.loads(received["body"])
        self.assertEqual(body["event"], "menu.sync")
        self.assertEqual(body["platform"], "swiggy")
        synced_item = next(
            row for row in body["items"] if row["id"] == self.item_id
        )
        self.assertEqual(synced_item["allergens"], ["Milk", "Wheat"])
        self.assertEqual(synced_item["calories"], 510)
        self.assertEqual(synced_item["channel_prices"][0]["price"], 349)
        self.assertEqual(
            received["signature"], sign_outbound(secret, received["body"])
        )

        self.client.patch(
            f"/api/v1/restaurant/integrations/aggregators/{integration['id']}",
            json={"menu_sync_enabled": False},
            headers=self.headers,
        )
        disabled = self.client.post(
            f"/api/v1/restaurant/integrations/aggregators/{integration['id']}/menu-sync",
            headers=self.headers,
        )
        self.assertEqual(disabled.status_code, 409)

    def test_validation_failure_and_access(self):
        integration = self.connect()
        self.client.patch(
            f"/api/v1/restaurant/integrations/aggregators/{integration['id']}",
            json={"menu_sync_url": "", "menu_sync_enabled": False},
            headers=self.headers,
        )
        no_url = self.client.patch(
            f"/api/v1/restaurant/integrations/aggregators/{integration['id']}",
            json={"menu_sync_enabled": True},
            headers=self.headers,
        )
        self.assertEqual(no_url.status_code, 422)
        bad_url = self.client.patch(
            f"/api/v1/restaurant/integrations/aggregators/{integration['id']}",
            json={"menu_sync_url": "ftp://example.com/menu", "menu_sync_enabled": True},
            headers=self.headers,
        )
        self.assertEqual(bad_url.status_code, 422)

        self.client.patch(
            f"/api/v1/restaurant/integrations/aggregators/{integration['id']}",
            json={
                "menu_sync_url": "http://127.0.0.1:9/unreachable",
                "menu_sync_enabled": True,
            },
            headers=self.headers,
        )
        failed = self.client.post(
            f"/api/v1/restaurant/integrations/aggregators/{integration['id']}/menu-sync",
            headers=self.headers,
        )
        self.assertEqual(failed.status_code, 200, failed.text)
        self.assertEqual(failed.json()["status"], "failed")
        self.assertTrue(failed.json()["error"])

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
        denied = self.client.post(
            f"/api/v1/restaurant/integrations/aggregators/{integration['id']}/menu-sync",
            headers=staff_headers,
        )
        self.assertEqual(denied.status_code, 403)


if __name__ == "__main__":
    unittest.main()
