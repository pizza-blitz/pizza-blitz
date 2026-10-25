"""Reusable offer templates: CRUD, default selection and snapshotting."""

import os
import unittest

os.environ.setdefault("PYTHONDONTWRITEBYTECODE", "1")

from fastapi.testclient import TestClient

from app.core.config import settings
from app.main import app


class OfferTemplateTest(unittest.TestCase):
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
                "title": f"Template Chef {id(self)}",
                "department": "Kitchen",
                "status": "open",
            },
            headers=self.headers,
        ).json()["job"]

    def tearDown(self):
        self._ctx.__exit__(None, None, None)

    def _template(self, name: str, body: str, default: bool = False) -> dict:
        response = self.client.post(
            "/api/v1/restaurant/hr/recruitment/offer-templates",
            json={"name": name, "body": body, "is_default": default},
            headers=self.headers,
        )
        self.assertEqual(response.status_code, 201, response.text)
        return response.json()["template"]

    def _offer_application(self) -> dict:
        application = self.client.post(
            "/api/v1/restaurant/hr/recruitment/applications",
            json={
                "job_id": self.job["id"],
                "candidate_name": "Template Candidate",
                "email": f"template-{id(self)}@example.com",
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
                "offered_salary": 32000,
                "joining_date": "2026-12-10",
            },
            headers=self.headers,
        )
        self.assertEqual(response.status_code, 200, response.text)
        return application

    def test_default_template_is_exclusive(self):
        first = self._template(
            f"Standard {id(self)}",
            "Standard terms: 30 days notice and document verification.",
            default=True,
        )
        second = self._template(
            f"Senior {id(self)}",
            "Senior terms: 60 days notice, signing bonus and document verification.",
            default=True,
        )
        templates = self.client.get(
            "/api/v1/restaurant/hr/recruitment/offer-templates",
            headers=self.headers,
        ).json()["templates"]
        first_row = next(row for row in templates if row["id"] == first["id"])
        second_row = next(row for row in templates if row["id"] == second["id"])
        self.assertFalse(first_row["is_default"])
        self.assertTrue(second_row["is_default"])

        updated = self.client.patch(
            f"/api/v1/restaurant/hr/recruitment/offer-templates/{first['id']}",
            json={"body": "Updated standard terms with 45 days notice and verification."},
            headers=self.headers,
        )
        self.assertEqual(updated.status_code, 200, updated.text)
        self.assertIn("45 days", updated.json()["template"]["body"])

    def test_generated_offer_snapshots_template_terms(self):
        template = self._template(
            f"Snapshot {id(self)}",
            "Snapshot terms: probation is 90 days and the notice period is 30 days.",
            default=True,
        )
        application = self._offer_application()
        generated = self.client.post(
            f"/api/v1/restaurant/hr/recruitment/applications/{application['id']}/offer",
            json={"expires_in_days": 7, "template_id": template["id"]},
            headers=self.headers,
        )
        self.assertEqual(generated.status_code, 201, generated.text)
        offer = generated.json()["application"]["offer"]
        self.assertEqual(offer["template"]["name"], template["name"])
        self.assertIn("probation is 90 days", offer["template"]["terms"])

        token = offer["public_url"].rsplit("/", 1)[-1]
        public = self.client.get(f"/api/v1/restaurant/careers/offers/{token}")
        self.assertEqual(public.status_code, 200, public.text)
        self.assertIn("probation is 90 days", public.json()["offer"]["terms"])
        pdf = self.client.get(
            f"/api/v1/restaurant/hr/recruitment/applications/{application['id']}/offer/pdf",
            headers=self.headers,
        )
        self.assertEqual(pdf.status_code, 200, pdf.text)
        self.assertTrue(pdf.content.startswith(b"%PDF"))

        self.client.patch(
            f"/api/v1/restaurant/hr/recruitment/offer-templates/{template['id']}",
            json={"body": "Changed terms that should not rewrite the issued letter."},
            headers=self.headers,
        )
        detail = self.client.get(
            f"/api/v1/restaurant/hr/recruitment/applications/{application['id']}",
            headers=self.headers,
        ).json()["application"]
        self.assertIn("probation is 90 days", detail["offer"]["template"]["terms"])

    def test_generate_rejects_unknown_template(self):
        application = self._offer_application()
        response = self.client.post(
            f"/api/v1/restaurant/hr/recruitment/applications/{application['id']}/offer",
            json={"expires_in_days": 7, "template_id": 999999},
            headers=self.headers,
        )
        self.assertEqual(response.status_code, 422, response.text)


if __name__ == "__main__":
    unittest.main()
