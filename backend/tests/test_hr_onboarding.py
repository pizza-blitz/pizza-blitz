"""HR onboarding pipeline, checklist and conversion tests."""

import os
import unittest

os.environ.setdefault("PYTHONDONTWRITEBYTECODE", "1")

from fastapi.testclient import TestClient

from app.core.config import settings
from app.main import app


class HROnboardingTest(unittest.TestCase):
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

    def create_candidate(self, code: str, email: str) -> dict:
        response = self.client.post(
            "/api/v1/restaurant/hr/onboarding/candidates",
            json={
                "candidate_code": code,
                "full_name": "Onboarding Test Candidate",
                "email": email,
                "phone": "9812346801",
                "designation": "Pizza Chef",
                "employment_type": "full_time",
                "store_id": 1,
                "expected_joining_date": "2026-11-15",
                "source": "Referral",
            },
            headers=self.headers,
        )
        self.assertEqual(response.status_code, 201, response.text)
        return response.json()

    def test_convert_requires_checklist_and_creates_employee(self):
        candidate = self.create_candidate("CAND-TEST-1", "cand1@example.com")
        self.assertEqual(candidate["status"], "documents_pending")
        self.assertEqual(candidate["task_count"], 6)
        self.assertEqual(candidate["done_count"], 0)

        blocked = self.client.post(
            f"/api/v1/restaurant/hr/onboarding/candidates/{candidate['id']}/convert",
            json={},
            headers=self.headers,
        )
        self.assertEqual(blocked.status_code, 422)

        for task in candidate["tasks"]:
            done = self.client.patch(
                f"/api/v1/restaurant/hr/onboarding/tasks/{task['id']}",
                json={"status": "done"},
                headers=self.headers,
            )
            self.assertEqual(done.status_code, 200, done.text)

        detail = self.client.get(
            f"/api/v1/restaurant/hr/onboarding/candidates/{candidate['id']}",
            headers=self.headers,
        )
        self.assertEqual(detail.json()["progress"], 100)

        converted = self.client.post(
            f"/api/v1/restaurant/hr/onboarding/candidates/{candidate['id']}/convert",
            json={"joining_date": "2026-11-15"},
            headers=self.headers,
        )
        self.assertEqual(converted.status_code, 201, converted.text)
        employee = converted.json()["employee"]
        self.assertTrue(employee["employee_code"].startswith("EMP-"))
        self.assertEqual(converted.json()["candidate"]["status"], "joined")
        self.assertEqual(
            converted.json()["candidate"]["employee_id"], employee["id"]
        )

        employees = self.client.get(
            "/api/v1/restaurant/hr/employees?q=Onboarding%20Test%20Candidate",
            headers=self.headers,
        )
        self.assertEqual(employees.status_code, 200, employees.text)
        self.assertIn(
            employee["employee_code"],
            [row["employee_code"] for row in employees.json()["employees"]],
        )

        again = self.client.post(
            f"/api/v1/restaurant/hr/onboarding/candidates/{candidate['id']}/convert",
            json={},
            headers=self.headers,
        )
        self.assertEqual(again.status_code, 422)

        # Keep the shared test DB tidy for later assertions.
        self.client.patch(
            f"/api/v1/restaurant/hr/employees/{employee['id']}",
            json={"status": "exited"},
            headers=self.headers,
        )

    def test_duplicate_and_access(self):
        self.create_candidate("CAND-TEST-2", "cand2@example.com")
        duplicate = self.client.post(
            "/api/v1/restaurant/hr/onboarding/candidates",
            json={
                "candidate_code": "CAND-TEST-2",
                "full_name": "Duplicate Candidate",
            },
            headers=self.headers,
        )
        self.assertEqual(duplicate.status_code, 422)

        summary = self.client.get(
            "/api/v1/restaurant/hr/onboarding/summary", headers=self.headers
        )
        self.assertEqual(summary.status_code, 200, summary.text)
        self.assertGreaterEqual(summary.json()["total"], 1)

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
                "/api/v1/restaurant/hr/onboarding/candidates",
                headers=staff_headers,
            ).status_code,
            403,
        )


if __name__ == "__main__":
    unittest.main()
