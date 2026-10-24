"""HR payroll structures, statutory defaults, proration and payslip tests."""

import os
import unittest

os.environ.setdefault("PYTHONDONTWRITEBYTECODE", "1")

from fastapi.testclient import TestClient

from app.core.config import settings
from app.main import app


class HRPayrollTest(unittest.TestCase):
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

    def create_employee(self, code: str, name: str) -> int:
        response = self.client.post(
            "/api/v1/restaurant/hr/employees",
            json={
                "employee_code": code,
                "full_name": name,
                "designation": "Crew",
                "employment_type": "full_time",
                "status": "active",
            },
            headers=self.headers,
        )
        self.assertEqual(response.status_code, 201, response.text)
        return response.json()["id"]

    def test_run_calculation_proration_and_finalize(self):
        employee_id = self.create_employee("EMP-PAY-1", "Payroll Test Employee")
        salary = self.client.put(
            f"/api/v1/restaurant/hr/payroll/salary-structures/{employee_id}",
            json={
                "basic": 30000,
                "hra": 12000,
                "allowances": 8000,
                "other_deductions": 0,
                "tds": 2000,
                "professional_tax": 200,
                "pf_enabled": True,
                "esi_enabled": True,
            },
            headers=self.headers,
        )
        self.assertEqual(salary.status_code, 200, salary.text)
        self.assertEqual(salary.json()["structure"]["monthly_gross"], 50000)

        run_response = self.client.post(
            "/api/v1/restaurant/hr/payroll/runs",
            json={"month": 9, "year": 2026},
            headers=self.headers,
        )
        self.assertEqual(run_response.status_code, 201, run_response.text)
        run = run_response.json()["run"]
        payslip = next(
            row for row in run["payslips"] if row["employee_id"] == employee_id
        )
        self.assertEqual(payslip["gross"], 50000)
        self.assertEqual(payslip["pf_employee"], 1800)
        self.assertEqual(payslip["esi_employee"], 0)
        self.assertEqual(payslip["professional_tax"], 200)
        self.assertEqual(payslip["tds"], 2000)
        self.assertEqual(payslip["total_deductions"], 4000)
        self.assertEqual(payslip["net"], 46000)

        duplicate = self.client.post(
            "/api/v1/restaurant/hr/payroll/runs",
            json={"month": 9, "year": 2026},
            headers=self.headers,
        )
        self.assertEqual(duplicate.status_code, 422)

        absent = self.client.patch(
            f"/api/v1/restaurant/hr/attendance/{employee_id}",
            json={"date": "2026-09-15", "status": "absent"},
            headers=self.headers,
        )
        self.assertEqual(absent.status_code, 200, absent.text)

        recalculated = self.client.post(
            f"/api/v1/restaurant/hr/payroll/runs/{run['id']}/recalculate",
            headers=self.headers,
        )
        self.assertEqual(recalculated.status_code, 200, recalculated.text)
        recalculated_run = recalculated.json()["run"]
        updated = next(
            row
            for row in recalculated_run["payslips"]
            if row["employee_id"] == employee_id
        )
        self.assertEqual(updated["paid_days"], 29)
        self.assertAlmostEqual(updated["gross"], 48333.33, places=2)
        self.assertAlmostEqual(updated["net"], 44333.33, places=2)

        finalized = self.client.post(
            f"/api/v1/restaurant/hr/payroll/runs/{run['id']}/finalize",
            headers=self.headers,
        )
        self.assertEqual(finalized.status_code, 200, finalized.text)
        self.assertEqual(finalized.json()["status"], "finalized")
        locked = self.client.post(
            f"/api/v1/restaurant/hr/payroll/runs/{run['id']}/recalculate",
            headers=self.headers,
        )
        self.assertEqual(locked.status_code, 422)

        payslip_detail = self.client.get(
            f"/api/v1/restaurant/hr/payroll/payslips/{updated['id']}",
            headers=self.headers,
        )
        self.assertEqual(payslip_detail.status_code, 200, payslip_detail.text)
        self.assertIn("earnings", payslip_detail.json()["breakdown"])

    def test_esi_ceiling_and_validation(self):
        employee_id = self.create_employee("EMP-PAY-2", "ESI Test Employee")
        salary = self.client.put(
            f"/api/v1/restaurant/hr/payroll/salary-structures/{employee_id}",
            json={
                "basic": 9000,
                "hra": 6000,
                "allowances": 3000,
                "professional_tax": 0,
                "tds": 0,
            },
            headers=self.headers,
        )
        self.assertEqual(salary.status_code, 200, salary.text)
        run = self.client.post(
            "/api/v1/restaurant/hr/payroll/runs",
            json={"month": 8, "year": 2026},
            headers=self.headers,
        )
        self.assertEqual(run.status_code, 201, run.text)
        payslip = next(
            row
            for row in run.json()["run"]["payslips"]
            if row["employee_id"] == employee_id
        )
        self.assertEqual(payslip["gross"], 18000)
        self.assertEqual(payslip["pf_employee"], 1080)
        self.assertEqual(payslip["esi_employee"], 135)
        self.assertEqual(payslip["employer_esi"], 585)
        self.assertEqual(payslip["net"], 16785)

        invalid = self.client.put(
            f"/api/v1/restaurant/hr/payroll/salary-structures/{employee_id}",
            json={"basic": 0, "hra": 0, "allowances": 0},
            headers=self.headers,
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
                "/api/v1/restaurant/hr/payroll/runs", headers=staff_headers
            ).status_code,
            403,
        )


if __name__ == "__main__":
    unittest.main()
