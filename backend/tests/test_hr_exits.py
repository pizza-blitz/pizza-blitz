"""HR exit, clearance and final-settlement tests."""

import os
import unittest

os.environ.setdefault("PYTHONDONTWRITEBYTECODE", "1")

from fastapi.testclient import TestClient

from app.core.config import settings
from app.main import app


class HRExitsTest(unittest.TestCase):
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

    def create_employee(self, code: str, staff_id: str | None = None) -> int:
        if staff_id:
            credential = self.client.post(
                "/api/v1/auth/staff/credential",
                json={
                    "id": staff_id,
                    "password": "exitcrew123",
                    "display_name": "Exit Crew",
                    "is_active": True,
                },
                headers=self.headers,
            )
            self.assertEqual(credential.status_code, 200, credential.text)
        employee = self.client.post(
            "/api/v1/restaurant/hr/employees",
            json={
                "employee_code": code,
                "full_name": "Exit Test Employee",
                "designation": "Kitchen Lead",
                "employment_type": "full_time",
                "status": "active",
                "joining_date": "2018-06-01",
                "staff_id": staff_id,
            },
            headers=self.headers,
        )
        self.assertEqual(employee.status_code, 201, employee.text)
        employee_id = employee.json()["id"]
        salary = self.client.put(
            f"/api/v1/restaurant/hr/payroll/salary-structures/{employee_id}",
            json={
                "basic": 30000,
                "hra": 12000,
                "allowances": 8000,
                "professional_tax": 200,
            },
            headers=self.headers,
        )
        self.assertEqual(salary.status_code, 200, salary.text)
        return employee_id

    def test_clearance_settlement_and_access_revocation(self):
        staff_id = "exitcrew1"
        employee_id = self.create_employee("EMP-EXIT-1", staff_id)
        created = self.client.post(
            "/api/v1/restaurant/hr/exits",
            json={
                "employee_id": employee_id,
                "exit_type": "resignation",
                "resignation_date": "2026-10-01",
                "last_working_date": "2026-11-15",
                "notice_days": 45,
                "reason": "Relocating",
            },
            headers=self.headers,
        )
        self.assertEqual(created.status_code, 201, created.text)
        exit_row = created.json()
        self.assertEqual(exit_row["exit_type"], "resignation")
        self.assertEqual(exit_row["clearance_total"], 6)
        self.assertEqual(exit_row["clearance_done"], 0)

        detail = self.client.get(
            f"/api/v1/restaurant/hr/exits/{exit_row['id']}", headers=self.headers
        )
        self.assertEqual(detail.status_code, 200, detail.text)
        preview = detail.json()["preview"]
        self.assertGreater(preview["pending_salary"], 0)
        self.assertGreater(preview["leave_encashment"], 0)
        self.assertGreater(preview["gratuity"], 0)

        blocked = self.client.post(
            f"/api/v1/restaurant/hr/exits/{exit_row['id']}/settle",
            json={},
            headers=self.headers,
        )
        self.assertEqual(blocked.status_code, 422)

        for task in exit_row["clearance"]:
            cleared = self.client.patch(
                f"/api/v1/restaurant/hr/exits/clearance/{task['id']}",
                json={"status": "cleared", "notes": "Checked"},
                headers=self.headers,
            )
            self.assertEqual(cleared.status_code, 200, cleared.text)

        settled = self.client.post(
            f"/api/v1/restaurant/hr/exits/{exit_row['id']}/settle",
            json={},
            headers=self.headers,
        )
        self.assertEqual(settled.status_code, 200, settled.text)
        self.assertEqual(settled.json()["status"], "settled")
        self.assertGreater(settled.json()["settlement"]["net_settlement"], 0)

        employee = self.client.get(
            f"/api/v1/restaurant/hr/employees/{employee_id}", headers=self.headers
        )
        self.assertEqual(employee.json()["status"], "exited")
        staff = self.client.get(
            "/api/v1/auth/staff/credential", headers=self.headers
        )
        self.assertEqual(staff.status_code, 200)
        # The managed credential endpoint reports the current staff credential.
        if staff.json().get("staff_id") == staff_id:
            self.assertFalse(staff.json().get("is_active"))

        again = self.client.post(
            f"/api/v1/restaurant/hr/exits/{exit_row['id']}/settle",
            json={},
            headers=self.headers,
        )
        self.assertEqual(again.status_code, 422)

    def test_validation_cancel_and_access(self):
        employee_id = self.create_employee("EMP-EXIT-2")
        bad_dates = self.client.post(
            "/api/v1/restaurant/hr/exits",
            json={
                "employee_id": employee_id,
                "resignation_date": "2026-11-15",
                "last_working_date": "2026-10-01",
            },
            headers=self.headers,
        )
        self.assertEqual(bad_dates.status_code, 422)

        created = self.client.post(
            "/api/v1/restaurant/hr/exits",
            json={
                "employee_id": employee_id,
                "resignation_date": "2026-10-01",
                "last_working_date": "2026-12-01",
            },
            headers=self.headers,
        )
        self.assertEqual(created.status_code, 201, created.text)
        cancelled = self.client.post(
            f"/api/v1/restaurant/hr/exits/{created.json()['id']}/cancel",
            headers=self.headers,
        )
        self.assertEqual(cancelled.status_code, 200, cancelled.text)
        self.assertEqual(cancelled.json()["status"], "cancelled")

        summary = self.client.get(
            "/api/v1/restaurant/hr/exits/summary", headers=self.headers
        )
        self.assertEqual(summary.status_code, 200, summary.text)

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
                "/api/v1/restaurant/hr/exits", headers=staff_headers
            ).status_code,
            403,
        )


if __name__ == "__main__":
    unittest.main()
