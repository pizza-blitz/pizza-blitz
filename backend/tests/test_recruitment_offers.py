"""Offer letters: admin generation, secure public link and candidate response."""

import os
import unittest
from datetime import datetime, timedelta
from unittest.mock import patch

os.environ.setdefault("PYTHONDONTWRITEBYTECODE", "1")

from fastapi.testclient import TestClient

from app.core.config import settings
from app.db.session import SessionLocal
from app.main import app
from app.models.domain import RecruitmentApplication
from app.services.campaign_dispatch_service import CampaignProviderResult
from app.services.offer_service import run_offer_reminders


class RecruitmentOfferTest(unittest.TestCase):
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
                "title": f"Offer Proof Chef {id(self)}",
                "department": "Kitchen",
                "location": "Kolkata",
                "status": "open",
            },
            headers=self.headers,
        ).json()["job"]

    def tearDown(self):
        self._ctx.__exit__(None, None, None)

    def _application(self, name: str = "Offer Candidate") -> dict:
        created = self.client.post(
            "/api/v1/restaurant/hr/recruitment/applications",
            json={
                "job_id": self.job["id"],
                "candidate_name": name,
                "email": f"offer-{id(self)}-{name.replace(' ', '')}@example.com",
            },
            headers=self.headers,
        ).json()["application"]
        application_id = created["id"]
        for stage in ("screening", "interview"):
            response = self.client.patch(
                f"/api/v1/restaurant/hr/recruitment/applications/{application_id}/stage",
                json={"stage": stage, "note": f"Move to {stage}."},
                headers=self.headers,
            )
            self.assertEqual(response.status_code, 200, response.text)
        response = self.client.patch(
            f"/api/v1/restaurant/hr/recruitment/applications/{application_id}/stage",
            json={
                "stage": "offer",
                "note": "Offer approved.",
                "offered_salary": 36000,
                "joining_date": "2026-12-15",
            },
            headers=self.headers,
        )
        self.assertEqual(response.status_code, 200, response.text)
        return response.json()["application"]

    def _generate(self, application_id: int) -> dict:
        response = self.client.post(
            f"/api/v1/restaurant/hr/recruitment/applications/{application_id}/offer",
            json={"expires_in_days": 7},
            headers=self.headers,
        )
        self.assertEqual(response.status_code, 201, response.text)
        return response.json()["application"]

    def test_offer_generation_acceptance_and_onboarding(self):
        application = self._application("Accept Candidate")
        generated = self._generate(application["id"])
        offer = generated["offer"]
        self.assertEqual(offer["status"], "sent")
        self.assertIn("/offer/", offer["public_url"])
        token = offer["public_url"].rsplit("/", 1)[-1]

        public = self.client.get(f"/api/v1/restaurant/careers/offers/{token}")
        self.assertEqual(public.status_code, 200, public.text)
        self.assertEqual(public.json()["offer"]["candidate_name"], "Accept Candidate")
        self.assertEqual(public.json()["offer"]["offered_salary"], 36000)

        pdf = self.client.get(f"/api/v1/restaurant/careers/offers/{token}/pdf")
        self.assertEqual(pdf.status_code, 200, pdf.text)
        self.assertTrue(pdf.content.startswith(b"%PDF"))

        accepted = self.client.post(
            f"/api/v1/restaurant/careers/offers/{token}/respond",
            json={
                "decision": "accept",
                "signed_name": "Accept Candidate",
                "note": "Looking forward to joining.",
            },
        )
        self.assertEqual(accepted.status_code, 200, accepted.text)
        self.assertEqual(accepted.json()["status"], "accepted")

        detail = self.client.get(
            f"/api/v1/restaurant/hr/recruitment/applications/{application['id']}",
            headers=self.headers,
        ).json()["application"]
        self.assertEqual(detail["stage"], "hired")
        self.assertEqual(detail["offer"]["status"], "accepted")
        self.assertEqual(detail["offer"]["signed_name"], "Accept Candidate")
        self.assertIsNotNone(detail["onboarding_candidate_id"])

        repeat = self.client.post(
            f"/api/v1/restaurant/careers/offers/{token}/respond",
            json={"decision": "accept", "signed_name": "Accept Candidate"},
        )
        self.assertEqual(repeat.status_code, 409, repeat.text)

    def test_offer_decline_and_expiry(self):
        application = self._application("Decline Candidate")
        generated = self._generate(application["id"])
        token = generated["offer"]["public_url"].rsplit("/", 1)[-1]
        declined = self.client.post(
            f"/api/v1/restaurant/careers/offers/{token}/respond",
            json={
                "decision": "decline",
                "signed_name": "Decline Candidate",
                "note": "Accepted another role.",
            },
        )
        self.assertEqual(declined.status_code, 200, declined.text)
        self.assertEqual(declined.json()["status"], "declined")
        detail = self.client.get(
            f"/api/v1/restaurant/hr/recruitment/applications/{application['id']}",
            headers=self.headers,
        ).json()["application"]
        self.assertEqual(detail["stage"], "rejected")
        self.assertEqual(detail["offer"]["status"], "declined")

        second = self._application("Expired Candidate")
        generated = self._generate(second["id"])
        token = generated["offer"]["public_url"].rsplit("/", 1)[-1]
        session = SessionLocal()
        try:
            row = (
                session.query(RecruitmentApplication)
                .filter(RecruitmentApplication.id == second["id"])
                .first()
            )
            row.offer_expires_at = datetime.utcnow() - timedelta(minutes=1)
            session.commit()
        finally:
            session.close()
        expired = self.client.get(f"/api/v1/restaurant/careers/offers/{token}")
        self.assertEqual(expired.status_code, 200, expired.text)
        self.assertEqual(expired.json()["offer"]["status"], "expired")
        blocked = self.client.post(
            f"/api/v1/restaurant/careers/offers/{token}/respond",
            json={"decision": "accept", "signed_name": "Expired Candidate"},
        )
        self.assertEqual(blocked.status_code, 409, blocked.text)

    def test_offer_email_countersign_and_reminder(self):
        application = self._application("Email Candidate")
        generated = self._generate(application["id"])
        token = generated["offer"]["public_url"].rsplit("/", 1)[-1]

        with patch(
            "app.services.offer_service.send_campaign_message",
            return_value=CampaignProviderResult(
                provider="resend", status="sent", external_id="email-proof"
            ),
        ):
            sent = self.client.post(
                f"/api/v1/restaurant/hr/recruitment/applications/{application['id']}/offer/send",
                headers=self.headers,
            )
        self.assertEqual(sent.status_code, 200, sent.text)
        self.assertEqual(sent.json()["delivery"]["status"], "sent")
        self.assertEqual(
            sent.json()["application"]["offer"]["delivery"]["status"], "sent"
        )

        countersigned = self.client.post(
            f"/api/v1/restaurant/hr/recruitment/applications/{application['id']}/offer/countersign",
            json={"signed_by": "People Lead"},
            headers=self.headers,
        )
        self.assertEqual(countersigned.status_code, 200, countersigned.text)
        self.assertEqual(
            countersigned.json()["application"]["offer"]["countersigned"]["by"],
            "People Lead",
        )
        public = self.client.get(f"/api/v1/restaurant/careers/offers/{token}")
        self.assertEqual(public.json()["offer"]["countersigned_by"], "People Lead")

        session = SessionLocal()
        try:
            row = (
                session.query(RecruitmentApplication)
                .filter(RecruitmentApplication.id == application["id"])
                .first()
            )
            row.offer_expires_at = datetime.utcnow() + timedelta(days=2)
            row.offer_reminder_count = 0
            row.offer_reminder_sent_at = None
            session.commit()
        finally:
            session.close()
        with patch(
            "app.services.offer_service.send_campaign_message",
            return_value=CampaignProviderResult(
                provider="resend", status="sent", external_id="reminder-proof"
            ),
        ):
            summary = run_offer_reminders()
        self.assertGreaterEqual(summary["sent"], 1)
        detail = self.client.get(
            f"/api/v1/restaurant/hr/recruitment/applications/{application['id']}",
            headers=self.headers,
        ).json()["application"]
        self.assertGreaterEqual(detail["offer"]["delivery"]["reminder_count"], 1)

    def test_offer_email_reports_provider_gap_without_crashing(self):
        application = self._application("Provider Gap Candidate")
        self._generate(application["id"])
        with patch(
            "app.services.offer_service.send_campaign_message",
            return_value=CampaignProviderResult(
                provider="resend",
                status="skipped",
                error="Provider not configured: RESEND_API_KEY",
            ),
        ):
            response = self.client.post(
                f"/api/v1/restaurant/hr/recruitment/applications/{application['id']}/offer/send",
                headers=self.headers,
            )
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.json()["delivery"]["status"], "skipped")
        self.assertIn("RESEND_API_KEY", response.json()["delivery"]["error"])

    def test_offer_requires_offer_stage(self):
        application = self.client.post(
            "/api/v1/restaurant/hr/recruitment/applications",
            json={
                "job_id": self.job["id"],
                "candidate_name": "Too Early Candidate",
                "email": f"tooearly-{id(self)}@example.com",
            },
            headers=self.headers,
        ).json()["application"]
        response = self.client.post(
            f"/api/v1/restaurant/hr/recruitment/applications/{application['id']}/offer",
            json={"expires_in_days": 7},
            headers=self.headers,
        )
        self.assertEqual(response.status_code, 422, response.text)


if __name__ == "__main__":
    unittest.main()
