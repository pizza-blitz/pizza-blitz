"""Multi-step offer approvals gate letter generation."""

import os
import unittest

os.environ.setdefault("PYTHONDONTWRITEBYTECODE", "1")

from fastapi.testclient import TestClient

from app.core.config import settings
from app.main import app


class OfferApprovalTest(unittest.TestCase):
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
        self.headers = {"Authorization": f"Bearer {login.json()['access_token']}"}

    def tearDown(self):
        self._ctx.__exit__(None, None, None)

    def _job(self, required: bool = True) -> dict:
        response = self.client.post(
            "/api/v1/restaurant/hr/recruitment/jobs",
            json={
                "title": f"Approval Chef {id(self)}",
                "department": "Kitchen",
                "status": "open",
                "offer_approvals_required": required,
            },
            headers=self.headers,
        )
        self.assertEqual(response.status_code, 201, response.text)
        return response.json()["job"]

    def _application_at_offer(self, job: dict) -> dict:
        application = self.client.post(
            "/api/v1/restaurant/hr/recruitment/applications",
            json={
                "job_id": job["id"],
                "candidate_name": "Approval Candidate",
                "email": f"approval-{id(self)}@example.com",
            },
            headers=self.headers,
        ).json()["application"]
        for stage in ("screening", "interview"):
            self.client.patch(
                f"/api/v1/restaurant/hr/recruitment/applications/{application['id']}/stage",
                json={"stage": stage, "note": f"Move to {stage}."},
                headers=self.headers,
            )
        response = self.client.patch(
            f"/api/v1/restaurant/hr/recruitment/applications/{application['id']}/stage",
            json={
                "stage": "offer",
                "note": "Offer approved.",
                "offered_salary": 34000,
                "joining_date": "2026-12-18",
            },
            headers=self.headers,
        )
        self.assertEqual(response.status_code, 200, response.text)
        return application

    def _request(self, application_id: int) -> dict:
        response = self.client.post(
            f"/api/v1/restaurant/hr/recruitment/applications/{application_id}/offer/approvals",
            json={"steps": ["People lead", "Finance lead"]},
            headers=self.headers,
        )
        self.assertEqual(response.status_code, 200, response.text)
        return response.json()["application"]

    def _decide(self, application_id: int, approval_id: int, decision: str) -> dict:
        response = self.client.post(
            f"/api/v1/restaurant/hr/recruitment/applications/{application_id}/offer/approvals/{approval_id}/decide",
            json={"decision": decision, "note": f"{decision} proof"},
            headers=self.headers,
        )
        self.assertEqual(response.status_code, 200, response.text)
        return response.json()["application"]

    def test_two_step_approval_unblocks_generation(self):
        job = self._job(required=True)
        application = self._application_at_offer(job)
        blocked = self.client.post(
            f"/api/v1/restaurant/hr/recruitment/applications/{application['id']}/offer",
            json={"expires_in_days": 7},
            headers=self.headers,
        )
        self.assertEqual(blocked.status_code, 422, blocked.text)

        requested = self._request(application["id"])
        self.assertEqual(len(requested["offer_approvals"]), 2)
        self.assertFalse(requested["offer_approvals_ready"])

        first = requested["offer_approvals"][0]
        after_first = self._decide(application["id"], first["id"], "approve")
        self.assertFalse(after_first["offer_approvals_ready"])
        still_blocked = self.client.post(
            f"/api/v1/restaurant/hr/recruitment/applications/{application['id']}/offer",
            json={"expires_in_days": 7},
            headers=self.headers,
        )
        self.assertEqual(still_blocked.status_code, 422, still_blocked.text)

        second = after_first["offer_approvals"][1]
        ready = self._decide(application["id"], second["id"], "approve")
        self.assertTrue(ready["offer_approvals_ready"])
        generated = self.client.post(
            f"/api/v1/restaurant/hr/recruitment/applications/{application['id']}/offer",
            json={"expires_in_days": 7},
            headers=self.headers,
        )
        self.assertEqual(generated.status_code, 201, generated.text)
        self.assertEqual(generated.json()["application"]["offer"]["status"], "sent")

    def test_rejection_blocks_generation(self):
        job = self._job(required=True)
        application = self._application_at_offer(job)
        requested = self._request(application["id"])
        first = requested["offer_approvals"][0]
        rejected = self._decide(application["id"], first["id"], "reject")
        self.assertEqual(rejected["offer_approvals"][0]["status"], "rejected")
        blocked = self.client.post(
            f"/api/v1/restaurant/hr/recruitment/applications/{application['id']}/offer",
            json={"expires_in_days": 7},
            headers=self.headers,
        )
        self.assertEqual(blocked.status_code, 422, blocked.text)
        invalid = self.client.post(
            f"/api/v1/restaurant/hr/recruitment/applications/{application['id']}/offer/approvals/{first['id']}/decide",
            json={"decision": "approve", "note": ""},
            headers=self.headers,
        )
        self.assertEqual(invalid.status_code, 422, invalid.text)

    def test_approvals_are_optional_when_job_does_not_require_them(self):
        job = self._job(required=False)
        application = self._application_at_offer(job)
        generated = self.client.post(
            f"/api/v1/restaurant/hr/recruitment/applications/{application['id']}/offer",
            json={"expires_in_days": 7},
            headers=self.headers,
        )
        self.assertEqual(generated.status_code, 201, generated.text)
        self.assertTrue(generated.json()["application"]["offer_approvals_ready"])


if __name__ == "__main__":
    unittest.main()
