"""Recruitment resumes: public upload, private download and interview scorecards."""

import os
import unittest

os.environ.setdefault("PYTHONDONTWRITEBYTECODE", "1")

from fastapi.testclient import TestClient

from app.core.config import settings
from app.main import app

RESUME_TEXT = b"""Riya Sharma
riya.resume@example.com
+91 98765 43210
Pizza chef with food safety, kitchen inventory and customer service experience.
"""


class RecruitmentResumeTest(unittest.TestCase):
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
        self.job = self.client.post(
            "/api/v1/restaurant/hr/recruitment/jobs",
            json={
                "title": f"Resume Proof Chef {id(self)}",
                "department": "Kitchen",
                "status": "open",
            },
            headers=self.headers,
        ).json()["job"]

    def tearDown(self):
        self._ctx.__exit__(None, None, None)

    def test_public_resume_application_and_admin_download(self):
        response = self.client.post(
            f"/api/v1/restaurant/careers/jobs/{self.job['id']}/apply-resume",
            data={
                "candidate_name": "Riya Sharma",
                "email": "",
                "phone": "",
                "expected_salary": "33000",
                "notes": "Available immediately.",
            },
            files={"file": ("riya-resume.txt", RESUME_TEXT, "text/plain")},
        )
        self.assertEqual(response.status_code, 201, response.text)
        application_id = response.json()["application_id"]
        parsed = response.json()["resume_parsed"]
        self.assertEqual(parsed["email"], "riya.resume@example.com")
        self.assertIn("98765", parsed["phone"])
        self.assertIn("food safety", parsed["skills"])

        detail = self.client.get(
            f"/api/v1/restaurant/hr/recruitment/applications/{application_id}",
            headers=self.headers,
        )
        self.assertEqual(detail.status_code, 200, detail.text)
        application = detail.json()["application"]
        self.assertEqual(application["email"], "riya.resume@example.com")
        self.assertEqual(application["resume"]["file_name"], "riya-resume.txt")
        self.assertIn("Pizza chef", application["resume"]["text_excerpt"])
        self.assertEqual(application["resume"]["parsed"]["skills"][:1], ["pizza"])

        download = self.client.get(
            f"/api/v1/restaurant/hr/recruitment/applications/{application_id}/resume",
            headers=self.headers,
        )
        self.assertEqual(download.status_code, 200, download.text)
        self.assertIn(b"Riya Sharma", download.content)

        anonymous = self.client.get(
            f"/api/v1/restaurant/hr/recruitment/applications/{application_id}/resume"
        )
        self.assertEqual(anonymous.status_code, 401)

    def test_admin_resume_upload_and_interview_scorecard(self):
        created = self.client.post(
            "/api/v1/restaurant/hr/recruitment/applications",
            json={
                "job_id": self.job["id"],
                "candidate_name": "Scorecard Candidate",
                "email": f"scorecard-{id(self)}@example.com",
            },
            headers=self.headers,
        ).json()["application"]
        application_id = created["id"]

        uploaded = self.client.post(
            f"/api/v1/restaurant/hr/recruitment/applications/{application_id}/resume",
            files={"file": ("candidate.txt", RESUME_TEXT, "text/plain")},
            headers=self.headers,
        )
        self.assertEqual(uploaded.status_code, 201, uploaded.text)
        self.assertEqual(uploaded.json()["application"]["resume"]["file_name"], "candidate.txt")

        interview = self.client.post(
            f"/api/v1/restaurant/hr/recruitment/applications/{application_id}/interviews",
            json={
                "scheduled_at": "2026-12-01T10:00:00",
                "mode": "video",
                "interviewer": "Kitchen Lead",
            },
            headers=self.headers,
        )
        self.assertEqual(interview.status_code, 201, interview.text)
        interview_id = interview.json()["interview"]["id"]

        scored = self.client.patch(
            f"/api/v1/restaurant/hr/recruitment/interviews/{interview_id}",
            json={
                "status": "completed",
                "score": 4,
                "recommendation": "strong_yes",
                "notes": "Strong pizza fundamentals and hygiene awareness.",
            },
            headers=self.headers,
        )
        self.assertEqual(scored.status_code, 200, scored.text)
        self.assertEqual(scored.json()["interview"]["score"], 4)
        self.assertEqual(
            scored.json()["interview"]["recommendation"], "strong_yes"
        )

        detail = self.client.get(
            f"/api/v1/restaurant/hr/recruitment/applications/{application_id}",
            headers=self.headers,
        ).json()["application"]
        self.assertEqual(detail["interviews"][0]["score"], 4)

    def test_invalid_resume_rejected(self):
        response = self.client.post(
            f"/api/v1/restaurant/careers/jobs/{self.job['id']}/apply-resume",
            data={"candidate_name": "Invalid Resume", "email": "invalid@example.com"},
            files={"file": ("fake.pdf", b"not really a pdf", "application/pdf")},
        )
        self.assertEqual(response.status_code, 422, response.text)


if __name__ == "__main__":
    unittest.main()
