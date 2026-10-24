"""Messaging inbox: webhook intake, threads, templates and outbound delivery."""

import os
import unittest
from unittest.mock import patch

os.environ.setdefault("PYTHONDONTWRITEBYTECODE", "1")

from fastapi.testclient import TestClient

from app.core.config import settings
from app.main import app
from app.services.campaign_dispatch_service import CampaignProviderResult

WEBHOOK_TOKEN = "messaging-proof-token"


def whatsapp_payload(phone: str, body: str, name: str = "Inbox Proof") -> dict:
    return {
        "entry": [
            {
                "changes": [
                    {
                        "value": {
                            "contacts": [{"profile": {"name": name}}],
                            "messages": [
                                {
                                    "from": phone,
                                    "id": f"wamid.{phone}",
                                    "type": "text",
                                    "text": {"body": body},
                                }
                            ],
                        }
                    }
                ]
            }
        ]
    }


class MessagingInboxTest(unittest.TestCase):
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
        self.token_patch = patch.object(
            settings, "MESSAGING_WEBHOOK_TOKEN", WEBHOOK_TOKEN
        )
        self.token_patch.start()

    def tearDown(self):
        self.token_patch.stop()
        self._ctx.__exit__(None, None, None)

    def inbound(self, phone: str, body: str):
        return self.client.post(
            f"/api/v1/restaurant/messaging/webhook/whatsapp?token={WEBHOOK_TOKEN}",
            json=whatsapp_payload(phone, body),
        )

    def test_webhook_creates_thread_and_marks_read(self):
        phone = f"9198{str(id(self))[-8:]}"
        response = self.inbound(phone, "Is my pizza ready?")
        self.assertEqual(response.status_code, 200, response.text)
        thread_id = response.json()["thread_id"]

        threads = self.client.get(
            "/api/v1/restaurant/messaging/threads", headers=self.headers
        )
        self.assertEqual(threads.status_code, 200, threads.text)
        row = next(
            item for item in threads.json()["threads"] if item["id"] == thread_id
        )
        self.assertEqual(row["channel"], "whatsapp")
        self.assertEqual(row["unread_count"], 1)
        self.assertEqual(row["contact_name"], "Inbox Proof")

        detail = self.client.get(
            f"/api/v1/restaurant/messaging/threads/{thread_id}",
            headers=self.headers,
        )
        self.assertEqual(detail.status_code, 200)
        self.assertEqual(detail.json()["messages"][0]["direction"], "inbound")
        self.assertEqual(detail.json()["messages"][0]["body"], "Is my pizza ready?")

        read = self.client.post(
            f"/api/v1/restaurant/messaging/threads/{thread_id}/read",
            headers=self.headers,
        )
        self.assertEqual(read.status_code, 200)
        self.assertEqual(read.json()["thread"]["unread_count"], 0)

        closed = self.client.patch(
            f"/api/v1/restaurant/messaging/threads/{thread_id}",
            json={"status": "closed", "assigned_to": "admin"},
            headers=self.headers,
        )
        self.assertEqual(closed.status_code, 200)
        self.assertEqual(closed.json()["thread"]["status"], "closed")

    def test_webhook_rejects_bad_token(self):
        response = self.client.post(
            "/api/v1/restaurant/messaging/webhook/whatsapp?token=wrong",
            json=whatsapp_payload("919800000001", "hello"),
        )
        self.assertEqual(response.status_code, 401)

    def test_templates_and_outbound_reply(self):
        template = self.client.post(
            "/api/v1/restaurant/messaging/templates",
            json={
                "name": "Order ready proof",
                "channel": "whatsapp",
                "body": "Your order is ready for pickup.",
                "category": "transactional",
                "status": "approved",
            },
            headers=self.headers,
        )
        self.assertEqual(template.status_code, 201, template.text)
        self.assertEqual(template.json()["template"]["status"], "approved")

        templates = self.client.get(
            "/api/v1/restaurant/messaging/templates?channel=whatsapp",
            headers=self.headers,
        )
        self.assertTrue(
            any(row["name"] == "Order ready proof" for row in templates.json()["templates"])
        )

        phone = f"9197{str(id(self))[-8:]}"
        inbound = self.inbound(phone, "Can I add a coke?")
        thread_id = inbound.json()["thread_id"]
        with patch(
            "app.api.api_v1.endpoints.messaging.send_campaign_message",
            return_value=CampaignProviderResult(
                provider="meta-whatsapp",
                status="sent",
                external_id="wamid.outbound-proof",
            ),
        ):
            reply = self.client.post(
                f"/api/v1/restaurant/messaging/threads/{thread_id}/messages",
                json={"body": "Yes, added to your order."},
                headers=self.headers,
            )
        self.assertEqual(reply.status_code, 200, reply.text)
        self.assertEqual(reply.json()["message"]["direction"], "outbound")
        self.assertEqual(reply.json()["message"]["status"], "sent")
        self.assertEqual(reply.json()["message"]["external_id"], "wamid.outbound-proof")


if __name__ == "__main__":
    unittest.main()
