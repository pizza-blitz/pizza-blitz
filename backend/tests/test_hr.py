"""HR People directory tests."""

import os
import unittest

os.environ.setdefault("PYTHONDONTWRITEBYTECODE", "1")

from fastapi.testclient import TestClient

from app.core.config import settings
from app.main import app


class HRPeopleTest(unittest.TestCase):
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

    def test_create_directory_and_link_pos_staff(self):
        staff = self.client.post(
            "/api/v1/auth/staff/credential",
            json={
                "id": "hrcrew",
                "password": "hrcrew123",
                "display_name": "HR Crew",
                "is_active": True,
            },
            headers=self.headers,
        )
        self.assertEqual(staff.status_code, 200, staff.text)

        created = self.client.post(
            "/api/v1/restaurant/hr/employees",
            json={
                "employee_code": "EMP-TEST-1",
                "full_name": "Aarav Sharma",
                "email": "aarav.hr@example.com",
                "phone": "9812346701",
                "designation": "Kitchen Lead",
                "employment_type": "full_time",
                "status": "active",
                "joining_date": "2026-01-15",
                "store_id": 1,
                "staff_id": "hrcrew",
            },
            headers=self.headers,
        )
        self.assertEqual(created.status_code, 201, created.text)
        employee = created.json()
        self.assertEqual(employee["store_id"], 1)
        self.assertTrue(employee["store_name"])
        self.assertEqual(employee["staff_id"], "hrcrew")

        duplicate = self.client.post(
            "/api/v1/restaurant/hr/employees",
            json={
                "employee_code": "EMP-TEST-1",
                "full_name": "Duplicate",
            },
            headers=self.headers,
        )
        self.assertEqual(duplicate.status_code, 422)

        duplicate_staff = self.client.post(
            "/api/v1/restaurant/hr/employees",
            json={
                "employee_code": "EMP-TEST-2",
                "full_name": "Duplicate Staff",
                "staff_id": "hrcrew",
            },
            headers=self.headers,
        )
        self.assertEqual(duplicate_staff.status_code, 422)

        listed = self.client.get(
            "/api/v1/restaurant/hr/employees?q=Aarav",
            headers=self.headers,
        )
        self.assertEqual(listed.status_code, 200, listed.text)
        self.assertEqual(len(listed.json()["employees"]), 1)

        summary = self.client.get(
            "/api/v1/restaurant/hr/summary", headers=self.headers
        )
        self.assertEqual(summary.status_code, 200, summary.text)
        self.assertGreaterEqual(summary.json()["total"], 1)
        self.assertGreaterEqual(summary.json()["linked_pos_staff"], 1)

        exited = self.client.patch(
            f"/api/v1/restaurant/hr/employees/{employee['id']}",
            json={"status": "exited", "notes": "Left the kitchen team"},
            headers=self.headers,
        )
        self.assertEqual(exited.status_code, 200, exited.text)
        self.assertEqual(exited.json()["status"], "exited")
        active = self.client.get(
            "/api/v1/restaurant/hr/employees?status=active",
            headers=self.headers,
        )
        self.assertNotIn(
            employee["employee_code"],
            [row["employee_code"] for row in active.json()["employees"]],
        )

    def test_validation_and_access(self):
        invalid_type = self.client.post(
            "/api/v1/restaurant/hr/employees",
            json={
                "employee_code": "EMP-TEST-3",
                "full_name": "Bad Type",
                "employment_type": "gig",
            },
            headers=self.headers,
        )
        self.assertEqual(invalid_type.status_code, 422)
        bad_store = self.client.post(
            "/api/v1/restaurant/hr/employees",
            json={
                "employee_code": "EMP-TEST-4",
                "full_name": "Bad Store",
                "store_id": 99999,
            },
            headers=self.headers,
        )
        self.assertEqual(bad_store.status_code, 422)
        self.assertEqual(
            self.client.get("/api/v1/restaurant/hr/employees").status_code,
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
                "/api/v1/restaurant/hr/employees", headers=staff_headers
            ).status_code,
            403,
        )


if __name__ == "__main__":
    unittest.main()
