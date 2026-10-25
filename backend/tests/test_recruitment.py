"""Recruitment pipeline: jobs, applicants, stage moves and onboarding handoff."""

import os
import unittest

os.environ.setdefault("PYTHONDONTWRITEBYTECODE", "1")

from fastapi.testclient import TestClient

from app.core.config import settings
from app.main import app


class RecruitmentTest(unittest.TestCase):
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

    def test_job_and_candidate_move_to_hire(self):
        job = self.client.post(
            "/api/v1/restaurant/hr/recruitment/jobs",
            json={
                "title": "Proof Pizza Chef",
                "department": "Kitchen",
                "location": "Kolkata",
                "employment_type": "full_time",
                "description": "Own the pizza station.",
                "openings": 2,
                "status": "open",
            },
            headers=self.headers,
        )
        self.assertEqual(job.status_code, 201, job.text)
        job_id = job.json()["job"]["id"]

        created = self.client.post(
            "/api/v1/restaurant/hr/recruitment/applications",
            json={
                "job_id": job_id,
                "candidate_name": "Recruitment Proof Candidate",
                "email": f"recruit-{job_id}@pizza-blitz.test",
                "phone": "919833334444",
                "source": "careers",
                "expected_salary": 34000,
            },
            headers=self.headers,
        )
        self.assertEqual(created.status_code, 201, created.text)
        application_id = created.json()["application"]["id"]

        invalid = self.client.patch(
            f"/api/v1/restaurant/hr/recruitment/applications/{application_id}/stage",
            json={"stage": "hired"},
            headers=self.headers,
        )
        self.assertEqual(invalid.status_code, 422)

        for stage, extra in (
            ("screening", {}),
            ("interview", {}),
            ("offer", {"offered_salary": 36000, "joining_date": "2026-11-15"}),
        ):
            moved = self.client.patch(
                f"/api/v1/restaurant/hr/recruitment/applications/{application_id}/stage",
                json={"stage": stage, "note": f"Moved to {stage}", **extra},
                headers=self.headers,
            )
            self.assertEqual(moved.status_code, 200, moved.text)

        hired = self.client.patch(
            f"/api/v1/restaurant/hr/recruitment/applications/{application_id}/stage",
            json={"stage": "hired", "note": "Offer accepted."},
            headers=self.headers,
        )
        self.assertEqual(hired.status_code, 200, hired.text)
        application = hired.json()["application"]
        self.assertEqual(application["stage"], "hired")
        self.assertIsNotNone(application["onboarding_candidate_id"])
        self.assertTrue(
            any(event["to_stage"] == "hired" for event in application["stage_history"])
        )

        onboarding = self.client.get(
            f"/api/v1/restaurant/hr/onboarding/candidates/{application['onboarding_candidate_id']}",
            headers=self.headers,
        )
        self.assertEqual(onboarding.status_code, 200, onboarding.text)
        self.assertEqual(
            onboarding.json()["full_name"], "Recruitment Proof Candidate"
        )
        self.assertEqual(onboarding.json()["designation"], "Proof Pizza Chef")

        summary = self.client.get(
            "/api/v1/restaurant/hr/recruitment/summary", headers=self.headers
        )
        self.assertGreaterEqual(summary.json()["hires"], 1)
        self.assertGreaterEqual(summary.json()["applications"], 1)

    def test_interview_scheduling_and_staff_denied(self):
        job = self.client.post(
            "/api/v1/restaurant/hr/recruitment/jobs",
            json={"title": "Interview Proof Job", "status": "open"},
            headers=self.headers,
        ).json()["job"]
        application = self.client.post(
            "/api/v1/restaurant/hr/recruitment/applications",
            json={
                "job_id": job["id"],
                "candidate_name": "Interview Proof Candidate",
                "email": f"interview-{job['id']}@pizza-blitz.test",
            },
            headers=self.headers,
        ).json()["application"]

        scheduled = self.client.post(
            f"/api/v1/restaurant/hr/recruitment/applications/{application['id']}/interviews",
            json={
                "scheduled_at": "2026-11-01T10:30:00",
                "mode": "video",
                "interviewer": "HR Head",
            },
            headers=self.headers,
        )
        self.assertEqual(scheduled.status_code, 201, scheduled.text)
        detail = self.client.get(
            f"/api/v1/restaurant/hr/recruitment/applications/{application['id']}",
            headers=self.headers,
        )
        self.assertEqual(detail.json()["application"]["stage"], "interview")
        self.assertEqual(len(detail.json()["application"]["interviews"]), 1)

        staff_login = self.client.post(
            "/api/v1/auth/staff/login",
            json={
                "id": settings.PIZZA_BLITZ_STAFF_ID,
                "password": settings.PIZZA_BLITZ_STAFF_PASSWORD,
            },
        )
        headers = {"Authorization": f"Bearer {staff_login.json()['access_token']}"}
        self.assertEqual(
            self.client.get(
                "/api/v1/restaurant/hr/recruitment/jobs", headers=headers
            ).status_code,
            403,
        )


if __name__ == "__main__":
    unittest.main()
