"""Department-scoped HR access for staff members."""

import os
import unittest

os.environ.setdefault("PYTHONDONTWRITEBYTECODE", "1")

from fastapi.testclient import TestClient

from app.core.config import settings
from app.main import app


class HRPermissionsTest(unittest.TestCase):
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

    def make_hr_staff(self, staff_id: str, password: str) -> dict:
        credential = self.client.post(
            "/api/v1/auth/staff/credential",
            json={
                "id": staff_id,
                "password": password,
                "display_name": "HR Team Lead",
                "is_active": True,
            },
            headers=self.headers,
        )
        self.assertEqual(credential.status_code, 200, credential.text)
        departments = self.client.get(
            "/api/v1/restaurant/departments/", headers=self.headers
        ).json()["departments"]
        hr_id = next(row["id"] for row in departments if row["key"] == "hr")
        member = self.client.post(
            f"/api/v1/restaurant/departments/{hr_id}/members",
            json={"staff_id": staff_id, "role": "head"},
            headers=self.headers,
        )
        self.assertEqual(member.status_code, 201, member.text)
        login = self.client.post(
            "/api/v1/auth/staff/login",
            json={"id": staff_id, "password": password},
        )
        self.assertEqual(login.status_code, 200, login.text)
        return {"Authorization": f"Bearer {login.json()['access_token']}"}

    def test_hr_member_requires_granted_permissions(self):
        staff_headers = self.make_hr_staff("hrlead", "hrlead123")
        access = self.client.get(
            "/api/v1/restaurant/hr/access", headers=staff_headers
        )
        self.assertEqual(access.status_code, 200, access.text)
        self.assertTrue(access.json()["is_hr_member"])
        self.assertEqual(access.json()["hr_role"], "head")
        self.assertFalse(access.json()["permissions"]["hr.people"])

        denied = self.client.get(
            "/api/v1/restaurant/hr/employees", headers=staff_headers
        )
        self.assertEqual(denied.status_code, 403)

        granted = self.client.put(
            "/api/v1/auth/permissions/staff",
            json={"permissions": ["hr.view", "hr.people"]},
            headers=self.headers,
        )
        self.assertEqual(granted.status_code, 200, granted.text)

        employees = self.client.get(
            "/api/v1/restaurant/hr/employees", headers=staff_headers
        )
        self.assertEqual(employees.status_code, 200, employees.text)

        departments = self.client.get(
            "/api/v1/restaurant/departments/", headers=staff_headers
        )
        self.assertEqual(departments.status_code, 200, departments.text)
        self.assertEqual(
            [row["key"] for row in departments.json()["departments"]], ["hr"]
        )

        payroll_denied = self.client.get(
            "/api/v1/restaurant/hr/payroll/runs", headers=staff_headers
        )
        self.assertEqual(payroll_denied.status_code, 403)

        granted_payroll = self.client.put(
            "/api/v1/auth/permissions/staff",
            json={"permissions": ["hr.view", "hr.people", "hr.payroll"]},
            headers=self.headers,
        )
        self.assertEqual(granted_payroll.status_code, 200)
        payroll = self.client.get(
            "/api/v1/restaurant/hr/payroll/runs", headers=staff_headers
        )
        self.assertEqual(payroll.status_code, 200, payroll.text)

    def test_non_member_and_admin_state(self):
        admin_state = self.client.get(
            "/api/v1/restaurant/hr/access", headers=self.headers
        )
        self.assertTrue(admin_state.json()["is_admin"])
        self.assertTrue(admin_state.json()["permissions"]["hr.payroll"])

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
        access = self.client.get(
            "/api/v1/restaurant/hr/access", headers=staff_headers
        )
        self.assertFalse(access.json()["is_hr_member"])
        self.assertEqual(
            self.client.get(
                "/api/v1/restaurant/hr/employees", headers=staff_headers
            ).status_code,
            403,
        )


if __name__ == "__main__":
    unittest.main()
