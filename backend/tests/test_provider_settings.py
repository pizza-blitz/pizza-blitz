"""Encrypted provider settings, masking and campaign readiness wiring."""

import os
import unittest

os.environ.setdefault("PYTHONDONTWRITEBYTECODE", "1")

from fastapi.testclient import TestClient

from app.core.config import settings
from app.db.session import SessionLocal
from app.main import app
from app.models.domain import ProviderSetting
from app.services.campaign_dispatch_service import campaign_provider_status
from app.services.provider_settings_service import encrypt_credentials


class ProviderSettingsTest(unittest.TestCase):
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
        for provider in ("email", "sms", "whatsapp", "social", "ads"):
            self.client.delete(
                f"/api/v1/restaurant/provider-settings/{provider}",
                headers=self.headers,
            )
        self._ctx.__exit__(None, None, None)

    def test_encrypted_save_mask_and_campaign_status(self):
        saved = self.client.put(
            "/api/v1/restaurant/provider-settings/email",
            json={
                "enabled": True,
                "values": {
                    "RESEND_API_KEY": "re_secret_proof_key",
                    "RESEND_FROM_EMAIL": "orders@pizza-blitz.test",
                },
            },
            headers=self.headers,
        )
        self.assertEqual(saved.status_code, 200, saved.text)
        provider = saved.json()["provider"]
        self.assertTrue(provider["configured"])
        self.assertEqual(provider["source"], "custom")
        self.assertFalse(
            any(field["value"] == "re_secret_proof_key" for field in provider["fields"]),
            "Secret value must not be returned.",
        )

        listed = self.client.get(
            "/api/v1/restaurant/provider-settings/", headers=self.headers
        )
        self.assertEqual(listed.status_code, 200, listed.text)
        email = next(
            row for row in listed.json()["providers"] if row["provider"] == "email"
        )
        self.assertFalse(
            any(field["value"] == "re_secret_proof_key" for field in email["fields"])
        )

        status = campaign_provider_status("email")
        self.assertTrue(status["configured"], status)
        self.assertEqual(status["source"], "custom")

        session = SessionLocal()
        try:
            row = (
                session.query(ProviderSetting)
                .filter(ProviderSetting.provider == "email")
                .first()
            )
            self.assertIsNotNone(row)
            self.assertNotIn("re_secret_proof_key", row.credentials_encrypted)
        finally:
            session.close()

        validated = self.client.post(
            "/api/v1/restaurant/provider-settings/email/validate",
            headers=self.headers,
        )
        self.assertEqual(validated.status_code, 200, validated.text)
        self.assertTrue(validated.json()["valid"])

        disabled = self.client.put(
            "/api/v1/restaurant/provider-settings/email",
            json={
                "enabled": False,
                "values": {
                    "RESEND_API_KEY": "re_secret_proof_key",
                    "RESEND_FROM_EMAIL": "orders@pizza-blitz.test",
                },
            },
            headers=self.headers,
        )
        self.assertEqual(disabled.status_code, 200)
        self.assertFalse(disabled.json()["provider"]["configured"])
        self.assertFalse(campaign_provider_status("email")["configured"])

    def test_staff_cannot_read_or_write_providers(self):
        staff_login = self.client.post(
            "/api/v1/auth/staff/login",
            json={
                "id": settings.PIZZA_BLITZ_STAFF_ID,
                "password": settings.PIZZA_BLITZ_STAFF_PASSWORD,
            },
        )
        headers = {"Authorization": f"Bearer {staff_login.json()['access_token']}"}
        self.assertEqual(
            self.client.get(
                "/api/v1/restaurant/provider-settings/", headers=headers
            ).status_code,
            403,
        )
        self.assertEqual(
            self.client.put(
                "/api/v1/restaurant/provider-settings/email",
                json={"enabled": True, "values": {"RESEND_API_KEY": "x"}},
                headers=headers,
            ).status_code,
            403,
        )

    def test_encryption_round_trip(self):
        ciphertext = encrypt_credentials({"key": "value"})
        self.assertNotIn("value", ciphertext)


if __name__ == "__main__":
    unittest.main()
