"""HR attendance clock, roster, regularisation and leave-awareness tests."""

import os
import unittest

os.environ.setdefault("PYTHONDONTWRITEBYTECODE", "1")

from fastapi.testclient import TestClient

from app.core.clock import business_today
from app.core.config import settings
from app.main import app


class HRAttendanceTest(unittest.TestCase):
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
                "employee_code": f"EMP-AT-{self._testMethodName[-8:]}",
                "full_name": "Attendance Test Employee",
                "employment_type": "full_time",
                "status": "active",
            },
            headers=self.headers,
        )
        self.assertEqual(employee.status_code, 201, employee.text)
        self.employee_id = employee.json()["id"]

    def tearDown(self):
        self._ctx.__exit__(None, None, None)

    def test_clock_in_out_and_roster(self):
        clock_in = self.client.post(
            "/api/v1/restaurant/hr/attendance/clock-in",
            json={"employee_id": self.employee_id, "note": "Opening shift"},
            headers=self.headers,
        )
        self.assertEqual(clock_in.status_code, 200, clock_in.text)
        self.assertIsNotNone(clock_in.json()["check_in_at"])

        duplicate = self.client.post(
            "/api/v1/restaurant/hr/attendance/clock-in",
            json={"employee_id": self.employee_id},
            headers=self.headers,
        )
        self.assertEqual(duplicate.status_code, 422)

        day = self.client.get(
            f"/api/v1/restaurant/hr/attendance/day?date={business_today().isoformat()}",
            headers=self.headers,
        )
        self.assertEqual(day.status_code, 200, day.text)
        row = next(
            row for row in day.json()["rows"] if row["employee_id"] == self.employee_id
        )
        self.assertEqual(row["status"], "present")
        self.assertIsNotNone(row["check_in_at"])

        clock_out = self.client.post(
            "/api/v1/restaurant/hr/attendance/clock-out",
            json={"employee_id": self.employee_id},
            headers=self.headers,
        )
        self.assertEqual(clock_out.status_code, 200, clock_out.text)
        self.assertIsNotNone(clock_out.json()["check_out_at"])

        duplicate_out = self.client.post(
            "/api/v1/restaurant/hr/attendance/clock-out",
            json={"employee_id": self.employee_id},
            headers=self.headers,
        )
        self.assertEqual(duplicate_out.status_code, 422)

        history = self.client.get(
            f"/api/v1/restaurant/hr/attendance/history?employee_id={self.employee_id}",
            headers=self.headers,
        )
        self.assertEqual(history.status_code, 200, history.text)
        self.assertTrue(history.json()["records"])

    def test_regularization_and_leave_awareness(self):
        day = business_today()
        regularized = self.client.patch(
            f"/api/v1/restaurant/hr/attendance/{self.employee_id}",
            json={
                "date": day.isoformat(),
                "status": "absent",
                "note": "No show, regularization test",
            },
            headers=self.headers,
        )
        self.assertEqual(regularized.status_code, 200, regularized.text)
        self.assertEqual(regularized.json()["status"], "absent")

        types = self.client.get(
            "/api/v1/restaurant/hr/leave/types", headers=self.headers
        ).json()["types"]
        casual = next(row for row in types if row["code"] == "casual")
        leave = self.client.post(
            "/api/v1/restaurant/hr/leave/requests",
            json={
                "employee_id": self.employee_id,
                "leave_type_id": casual["id"],
                "start_date": day.isoformat(),
                "end_date": day.isoformat(),
                "reason": "Sick",
            },
            headers=self.headers,
        )
        self.assertEqual(leave.status_code, 201, leave.text)
        approved = self.client.patch(
            f"/api/v1/restaurant/hr/leave/requests/{leave.json()['id']}/decision",
            json={"decision": "approved"},
            headers=self.headers,
        )
        self.assertEqual(approved.status_code, 200, approved.text)

        roster = self.client.get(
            f"/api/v1/restaurant/hr/attendance/day?date={day.isoformat()}",
            headers=self.headers,
        )
        row = next(
            row
            for row in roster.json()["rows"]
            if row["employee_id"] == self.employee_id
        )
        self.assertEqual(row["status"], "on_leave")
        blocked = self.client.post(
            "/api/v1/restaurant/hr/attendance/clock-in",
            json={"employee_id": self.employee_id},
            headers=self.headers,
        )
        self.assertEqual(blocked.status_code, 422)

    def test_access_control(self):
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
                "/api/v1/restaurant/hr/attendance/day", headers=staff_headers
            ).status_code,
            403,
        )


if __name__ == "__main__":
    unittest.main()
