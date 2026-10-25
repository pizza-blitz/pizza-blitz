"""Public careers board: open roles, detail and application intake."""

import os
import unittest

os.environ.setdefault("PYTHONDONTWRITEBYTECODE", "1")

from fastapi.testclient import TestClient

from app.core.config import settings
from app.main import app


class CareersPageTest(unittest.TestCase):
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
        self.suffix = str(id(self))[-8:]

    def tearDown(self):
        self._ctx.__exit__(None, None, None)

    def create_job(self, title: str, status: str = "open") -> dict:
        response = self.client.post(
            "/api/v1/restaurant/hr/recruitment/jobs",
            json={
                "title": title,
                "department": "Kitchen",
                "location": "Kolkata",
                "employment_type": "full_time",
                "description": "Public careers proof role.",
                "openings": 1,
                "status": status,
            },
            headers=self.headers,
        )
        self.assertEqual(response.status_code, 201, response.text)
        return response.json()["job"]

    def test_public_jobs_and_application_intake(self):
        open_job = self.create_job(f"Careers Open Role {self.suffix}")
        draft_job = self.create_job(f"Careers Draft Role {self.suffix}", status="draft")

        jobs = self.client.get("/api/v1/restaurant/careers/jobs")
        self.assertEqual(jobs.status_code, 200, jobs.text)
        titles = [row["title"] for row in jobs.json()["jobs"]]
        self.assertIn(open_job["title"], titles)
        self.assertNotIn(draft_job["title"], titles)

        detail = self.client.get(f"/api/v1/restaurant/careers/jobs/{open_job['id']}")
        self.assertEqual(detail.status_code, 200, detail.text)
        self.assertEqual(detail.json()["job"]["title"], open_job["title"])
        self.assertEqual(
            self.client.get(
                f"/api/v1/restaurant/careers/jobs/{draft_job['id']}"
            ).status_code,
            404,
        )

        applied = self.client.post(
            f"/api/v1/restaurant/careers/jobs/{open_job['id']}/apply",
            json={
                "candidate_name": "Careers Proof Applicant",
                "email": f"careers-proof-{self.suffix}@pizza-blitz.test",
                "phone": "919811112222",
                "expected_salary": 31000,
                "notes": "I have five years of pizza experience.",
            },
        )
        self.assertEqual(applied.status_code, 201, applied.text)
        self.assertTrue(applied.json()["ok"])

        duplicate = self.client.post(
            f"/api/v1/restaurant/careers/jobs/{open_job['id']}/apply",
            json={
                "candidate_name": "Careers Proof Applicant",
                "email": f"careers-proof-{self.suffix}@pizza-blitz.test",
            },
        )
        self.assertEqual(duplicate.status_code, 422)

        missing_contact = self.client.post(
            f"/api/v1/restaurant/careers/jobs/{open_job['id']}/apply",
            json={"candidate_name": "No Contact"},
        )
        self.assertEqual(missing_contact.status_code, 422)

        applications = self.client.get(
            f"/api/v1/restaurant/hr/recruitment/applications?job_id={open_job['id']}",
            headers=self.headers,
        )
        self.assertEqual(applications.status_code, 200, applications.text)
        row = applications.json()["applications"][0]
        self.assertEqual(row["candidate_name"], "Careers Proof Applicant")
        self.assertEqual(row["source"], "Careers page")
        self.assertEqual(row["stage"], "applied")


if __name__ == "__main__":
    unittest.main()
