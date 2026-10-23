"""Security headers and client-error monitoring tests."""

import os
import unittest

os.environ.setdefault("PYTHONDONTWRITEBYTECODE", "1")

from fastapi.testclient import TestClient

from app.core.config import settings
from app.main import app


class SecurityHeadersTest(unittest.TestCase):
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

    def test_api_security_headers_and_request_id(self):
        response = self.client.get("/health")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.headers["x-content-type-options"], "nosniff")
        self.assertEqual(response.headers["x-frame-options"], "DENY")
        self.assertEqual(response.headers["referrer-policy"], "no-referrer")
        self.assertIn("default-src 'none'", response.headers["content-security-policy"])
        self.assertIn("geolocation=(self)", response.headers["permissions-policy"])
        self.assertTrue(response.headers["x-request-id"])

        echoed = self.client.get(
            "/api/v1/restaurant/orders/999999", headers={"X-Request-ID": "proof-123"}
        )
        self.assertEqual(echoed.headers["x-request-id"], "proof-123")
        self.assertEqual(echoed.headers["x-content-type-options"], "nosniff")

        not_found = self.client.get("/api/v1/does-not-exist")
        self.assertEqual(not_found.status_code, 404)
        self.assertEqual(not_found.headers["x-frame-options"], "DENY")

    def test_client_error_reporting(self):
        created = self.client.post(
            "/api/v1/restaurant/ops/client-errors",
            json={
                "message": "Hydration failed on /dashboard",
                "stack": "Error: hydration\n at Dashboard",
                "url": "http://localhost:3011/dashboard",
                "user_agent": "Playwright",
            },
            headers={"X-Request-ID": "client-proof-1"},
        )
        self.assertEqual(created.status_code, 202, created.text)
        self.assertEqual(created.json()["status"], "recorded")

        listed = self.client.get(
            "/api/v1/restaurant/ops/client-errors", headers=self.headers
        )
        self.assertEqual(listed.status_code, 200, listed.text)
        self.assertGreaterEqual(listed.json()["count"], 1)
        report = next(
            row
            for row in listed.json()["errors"]
            if row["message"] == "Hydration failed on /dashboard"
        )
        self.assertEqual(report["request_id"], "client-proof-1")

        invalid = self.client.post(
            "/api/v1/restaurant/ops/client-errors", json={"message": ""}
        )
        self.assertEqual(invalid.status_code, 422)

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
                "/api/v1/restaurant/ops/client-errors", headers=staff_headers
            ).status_code,
            403,
        )


if __name__ == "__main__":
    unittest.main()
