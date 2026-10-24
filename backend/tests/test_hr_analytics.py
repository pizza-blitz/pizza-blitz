"""HR analytics overview and access tests."""

import os
import unittest

os.environ.setdefault("PYTHONDONTWRITEBYTECODE", "1")

from fastapi.testclient import TestClient

from app.core.config import settings
from app.main import app


class HRAnalyticsTest(unittest.TestCase):
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

    def test_overview_shape_and_totals(self):
        employee = self.client.post(
            "/api/v1/restaurant/hr/employees",
            json={
                "employee_code": "EMP-AN-1",
                "full_name": "Analytics Employee",
                "employment_type": "full_time",
                "status": "active",
            },
            headers=self.headers,
        )
        self.assertEqual(employee.status_code, 201, employee.text)

        overview = self.client.get(
            "/api/v1/restaurant/hr/overview", headers=self.headers
        )
        self.assertEqual(overview.status_code, 200, overview.text)
        data = overview.json()
        self.assertIn("workforce", data)
        self.assertIn("attendance", data)
        self.assertIn("payroll", data)
        self.assertIn("onboarding", data)
        self.assertIn("exits", data)
        self.assertGreaterEqual(data["workforce"]["headcount"], 1)
        self.assertIsInstance(data["workforce"]["by_employment_type"], dict)
        self.assertGreaterEqual(data["attendance"]["attendance_rate"], 0)
        self.assertGreaterEqual(data["onboarding"]["conversion_rate"], 0)

    def test_hr_member_view_access(self):
        credential = self.client.post(
            "/api/v1/auth/staff/credential",
            json={
                "id": "hrviewer",
                "password": "hrviewer123",
                "display_name": "HR Viewer",
                "is_active": True,
            },
            headers=self.headers,
        )
        self.assertEqual(credential.status_code, 200, credential.text)
        departments = self.client.get(
            "/api/v1/restaurant/departments/", headers=self.headers
        ).json()["departments"]
        hr = next(row for row in departments if row["key"] == "hr")
        added = self.client.post(
            f"/api/v1/restaurant/departments/{hr['id']}/members",
            json={"staff_id": "hrviewer", "role": "member"},
            headers=self.headers,
        )
        self.assertEqual(added.status_code, 201, added.text)
        granted = self.client.put(
            "/api/v1/auth/permissions/staff",
            json={"permissions": ["hr.view"]},
            headers=self.headers,
        )
        self.assertEqual(granted.status_code, 200, granted.text)

        login = self.client.post(
            "/api/v1/auth/staff/login",
            json={"id": "hrviewer", "password": "hrviewer123"},
        )
        headers = {"Authorization": f"Bearer {login.json()['access_token']}"}
        overview = self.client.get(
            "/api/v1/restaurant/hr/overview", headers=headers
        )
        self.assertEqual(overview.status_code, 200, overview.text)
        denied = self.client.get(
            "/api/v1/restaurant/hr/employees", headers=headers
        )
        self.assertEqual(denied.status_code, 403)

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
                "/api/v1/restaurant/hr/overview", headers=staff_headers
            ).status_code,
            403,
        )


if __name__ == "__main__":
    unittest.main()
