"""HR leave, balances and holidays tests."""

import os
import unittest
from datetime import date, timedelta

os.environ.setdefault("PYTHONDONTWRITEBYTECODE", "1")

from fastapi.testclient import TestClient

from app.core.config import settings
from app.main import app


class HRLeaveTest(unittest.TestCase):
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
        employee = self.client.post(
            "/api/v1/restaurant/hr/employees",
            json={
                "employee_code": f"EMP-LV-{self._testMethodName[-10:]}",
                "full_name": "Leave Test Employee",
                "employment_type": "full_time",
                "status": "active",
                "joining_date": "2026-01-01",
            },
            headers=self.headers,
        )
        self.assertEqual(employee.status_code, 201, employee.text)
        self.employee_id = employee.json()["id"]
        types = self.client.get(
            "/api/v1/restaurant/hr/leave/types", headers=self.headers
        )
        self.assertEqual(types.status_code, 200, types.text)
        self.types = {row["code"]: row for row in types.json()["types"]}
        self.assertIn("casual", self.types)
        self.assertIn("unpaid", self.types)
        self.casual_id = self.types["casual"]["id"]

    def tearDown(self):
        self._ctx.__exit__(None, None, None)

    def test_request_approval_balance_and_cancel(self):
        start = date.today() + timedelta(days=10)
        end = start + timedelta(days=1)
        created = self.client.post(
            "/api/v1/restaurant/hr/leave/requests",
            json={
                "employee_id": self.employee_id,
                "leave_type_id": self.casual_id,
                "start_date": start.isoformat(),
                "end_date": end.isoformat(),
                "reason": "Family function",
            },
            headers=self.headers,
        )
        self.assertEqual(created.status_code, 201, created.text)
        request_id = created.json()["id"]
        self.assertEqual(created.json()["days"], 2)

        overlap = self.client.post(
            "/api/v1/restaurant/hr/leave/requests",
            json={
                "employee_id": self.employee_id,
                "leave_type_id": self.casual_id,
                "start_date": start.isoformat(),
                "end_date": end.isoformat(),
            },
            headers=self.headers,
        )
        self.assertEqual(overlap.status_code, 422)

        approved = self.client.patch(
            f"/api/v1/restaurant/hr/leave/requests/{request_id}/decision",
            json={"decision": "approved", "note": "Cover arranged"},
            headers=self.headers,
        )
        self.assertEqual(approved.status_code, 200, approved.text)
        self.assertEqual(approved.json()["status"], "approved")

        balances = self.client.get(
            "/api/v1/restaurant/hr/leave/balances?year=" + str(start.year),
            headers=self.headers,
        )
        self.assertEqual(balances.status_code, 200, balances.text)
        employee = next(
            row
            for row in balances.json()["employees"]
            if row["employee_id"] == self.employee_id
        )
        casual = next(
            row for row in employee["balances"] if row["leave_type"]["code"] == "casual"
        )
        self.assertEqual(casual["used"], 2)
        self.assertEqual(casual["remaining"], 10)

        cancelled = self.client.patch(
            f"/api/v1/restaurant/hr/leave/requests/{request_id}/cancel",
            json={"note": "Plans changed"},
            headers=self.headers,
        )
        self.assertEqual(cancelled.status_code, 200, cancelled.text)
        self.assertEqual(cancelled.json()["status"], "cancelled")
        balances = self.client.get(
            "/api/v1/restaurant/hr/leave/balances?year=" + str(start.year),
            headers=self.headers,
        )
        employee = next(
            row
            for row in balances.json()["employees"]
            if row["employee_id"] == self.employee_id
        )
        casual = next(
            row for row in employee["balances"] if row["leave_type"]["code"] == "casual"
        )
        self.assertEqual(casual["used"], 0)

        summary = self.client.get(
            "/api/v1/restaurant/hr/leave/summary?year=" + str(start.year),
            headers=self.headers,
        )
        self.assertEqual(summary.status_code, 200, summary.text)
        self.assertIn("pending_requests", summary.json())

    def test_holidays_and_validation(self):
        holiday = self.client.post(
            "/api/v1/restaurant/hr/leave/holidays",
            json={"name": "Team offsite", "date": "2026-12-24"},
            headers=self.headers,
        )
        self.assertEqual(holiday.status_code, 201, holiday.text)
        listed = self.client.get(
            "/api/v1/restaurant/hr/leave/holidays", headers=self.headers
        )
        self.assertIn(
            "Team offsite", [row["name"] for row in listed.json()["holidays"]]
        )
        deleted = self.client.delete(
            f"/api/v1/restaurant/hr/leave/holidays/{holiday.json()['id']}",
            headers=self.headers,
        )
        self.assertEqual(deleted.status_code, 204)

        bad_dates = self.client.post(
            "/api/v1/restaurant/hr/leave/requests",
            json={
                "employee_id": self.employee_id,
                "leave_type_id": self.casual_id,
                "start_date": "2026-12-10",
                "end_date": "2026-12-01",
            },
            headers=self.headers,
        )
        self.assertEqual(bad_dates.status_code, 422)

        custom_type = self.client.post(
            "/api/v1/restaurant/hr/leave/types",
            json={
                "code": "bereavement",
                "name": "Bereavement leave",
                "annual_quota": 3,
                "paid": True,
            },
            headers=self.headers,
        )
        self.assertEqual(custom_type.status_code, 201, custom_type.text)
        self.assertTrue(custom_type.json()["paid"])

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
                "/api/v1/restaurant/hr/leave/requests", headers=staff_headers
            ).status_code,
            403,
        )


if __name__ == "__main__":
    unittest.main()
