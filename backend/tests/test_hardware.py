"""POS hardware configuration and print/drawer tests."""

import os
import unittest

os.environ.setdefault("PYTHONDONTWRITEBYTECODE", "1")

from fastapi.testclient import TestClient

from app.core.config import settings
from app.main import app


class HardwareTest(unittest.TestCase):
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
        self._ctx.__exit__(None, None, None)

    def save(self, **overrides):
        payload = {
            "printer_name": "Epson TM-T82",
            "paper_width_mm": 80,
            "auto_print": True,
            "receipt_header": "Pizza Blitz Koramangala",
            "receipt_footer": "Thank you!",
            "cash_drawer_enabled": True,
            "drawer_pin": "2",
            "customer_display_url": "http://127.0.0.1:3011/customer-display",
        }
        payload.update(overrides)
        return self.client.put(
            "/api/v1/restaurant/hardware/1", json=payload, headers=self.headers
        )

    def test_configuration_print_and_drawer(self):
        current = self.client.get(
            "/api/v1/restaurant/hardware/1", headers=self.headers
        )
        self.assertEqual(current.status_code, 200, current.text)
        self.assertIn("readiness", current.json())

        saved = self.save()
        self.assertEqual(saved.status_code, 200, saved.text)
        config = saved.json()
        self.assertEqual(config["printer_name"], "Epson TM-T82")
        self.assertEqual(config["paper_width_mm"], 80)
        self.assertTrue(config["cash_drawer_enabled"])
        self.assertTrue(config["readiness"]["customer_display_configured"])

        printed = self.client.post(
            "/api/v1/restaurant/hardware/1/test-print", headers=self.headers
        )
        self.assertEqual(printed.status_code, 200, printed.text)
        job = printed.json()
        self.assertIn("TEST PRINT", job["text"])
        self.assertIn("Pizza Blitz Koramangala", job["text"])
        self.assertIn("80mm", job["text"])
        self.assertIn("<!doctype html>", job["html"])

        drawer = self.client.post(
            "/api/v1/restaurant/hardware/1/drawer-pulse", headers=self.headers
        )
        self.assertEqual(drawer.status_code, 200, drawer.text)
        self.assertEqual(drawer.json()["esc_pos_hex"], "1B700019FA")
        self.assertEqual(drawer.json()["pin"], 2)

        disabled = self.save(cash_drawer_enabled=False)
        self.assertFalse(disabled.json()["cash_drawer_enabled"])
        blocked = self.client.post(
            "/api/v1/restaurant/hardware/1/drawer-pulse", headers=self.headers
        )
        self.assertEqual(blocked.status_code, 409)

    def test_validation_and_access(self):
        invalid_width = self.save(paper_width_mm=60)
        self.assertEqual(invalid_width.status_code, 422)
        missing_store = self.client.get(
            "/api/v1/restaurant/hardware/999999", headers=self.headers
        )
        self.assertEqual(missing_store.status_code, 404)

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
        self.assertEqual(
            self.client.get(
                "/api/v1/restaurant/hardware/1", headers=staff_headers
            ).status_code,
            200,
        )
        self.assertEqual(
            self.client.post(
                "/api/v1/restaurant/hardware/1/test-print", headers=staff_headers
            ).status_code,
            200,
        )
        self.assertEqual(
            self.client.put(
                "/api/v1/restaurant/hardware/1",
                json={"printer_name": "Staff Printer"},
                headers=staff_headers,
            ).status_code,
            403,
        )


if __name__ == "__main__":
    unittest.main()
