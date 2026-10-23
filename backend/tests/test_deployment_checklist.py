"""Deployment readiness checklist tests."""

import os
import unittest

os.environ.setdefault("PYTHONDONTWRITEBYTECODE", "1")

from fastapi.testclient import TestClient

from app.core.config import settings
from app.main import app


class DeploymentChecklistTest(unittest.TestCase):
    def setUp(self):
        self._ctx = TestClient(app)
        self.client = self._ctx.__enter__()

    def tearDown(self):
        self._ctx.__exit__(None, None, None)

    def test_admin_checklist_structure(self):
        login = self.client.post(
            "/api/v1/auth/admin/login",
            json={
                "id": settings.PIZZA_BLITZ_ADMIN_ID,
                "password": settings.PIZZA_BLITZ_ADMIN_PASSWORD,
            },
        )
        self.assertEqual(login.status_code, 200, login.text)
        headers = {"Authorization": f"Bearer {login.json()['access_token']}"}
        response = self.client.get(
            "/api/v1/restaurant/ops/deployment-checklist", headers=headers
        )
        self.assertEqual(response.status_code, 200, response.text)
        data = response.json()
        self.assertIn("environment", data)
        self.assertIn("summary", data)
        self.assertEqual(data["summary"]["total"], len(data["checks"]))
        keys = {check["key"] for check in data["checks"]}
        self.assertTrue(
            {
                "database",
                "migrations",
                "auth_secret",
                "admin_credentials",
                "cors",
                "media",
                "payments",
                "security_headers",
            }.issubset(keys)
        )
        for check in data["checks"]:
            self.assertIn(check["status"], {"ready", "warn", "blocked"})
        self.assertEqual(
            next(check for check in data["checks"] if check["key"] == "database")[
                "status"
            ],
            "ready",
        )
        self.assertEqual(
            next(
                check
                for check in data["checks"]
                if check["key"] == "admin_credentials"
            )["status"],
            "ready",
        )
        self.assertTrue(data["verification_commands"])

    def test_access_control(self):
        self.assertEqual(
            self.client.get(
                "/api/v1/restaurant/ops/deployment-checklist"
            ).status_code,
            401,
        )
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
                "/api/v1/restaurant/ops/deployment-checklist",
                headers=staff_headers,
            ).status_code,
            403,
        )


if __name__ == "__main__":
    unittest.main()
