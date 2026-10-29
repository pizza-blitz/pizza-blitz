"""Quality workspace: audits, temperature checks and licence expiry."""

import os
import unittest
from datetime import timedelta

os.environ.setdefault("PYTHONDONTWRITEBYTECODE", "1")

from fastapi.testclient import TestClient

from app.core.clock import business_today
from app.core.config import settings
from app.db.session import SessionLocal
from app.main import app
from app.models.domain import (
    ComplianceLicence,
    QualityAudit,
    TemperatureLog,
)

BASE = "/api/v1/restaurant/company/quality"


class CompanyQualityApiTest(unittest.TestCase):
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
        self.headers = {
            "Authorization": f"Bearer {login.json()['access_token']}"
        }
        self.today = business_today()
        self.audit_ids: list[int] = []
        self.temperature_ids: list[int] = []
        self.licence_ids: list[int] = []

    def tearDown(self):
        db = SessionLocal()
        try:
            if self.audit_ids:
                db.query(QualityAudit).filter(
                    QualityAudit.id.in_(self.audit_ids)
                ).delete(synchronize_session=False)
            if self.temperature_ids:
                db.query(TemperatureLog).filter(
                    TemperatureLog.id.in_(self.temperature_ids)
                ).delete(synchronize_session=False)
            if self.licence_ids:
                db.query(ComplianceLicence).filter(
                    ComplianceLicence.id.in_(self.licence_ids)
                ).delete(synchronize_session=False)
            db.commit()
        finally:
            db.close()
            self._ctx.__exit__(None, None, None)

    def test_audits_and_overview(self):
        created = self.client.post(
            f"{BASE}/audits",
            json={
                "title": "Morning hygiene audit",
                "audit_type": "hygiene",
                "scheduled_for": self.today.isoformat(),
                "auditor": "Priya Nair",
            },
            headers=self.headers,
        )
        self.assertEqual(created.status_code, 200, created.text)
        audit = created.json()
        self.audit_ids.append(audit["id"])
        self.assertEqual(audit["status"], "scheduled")
        self.assertEqual(audit["open_findings"], 0)
        self.assertEqual(audit["score_pct"], None)

        overview = self.client.get(f"{BASE}/overview", headers=self.headers)
        self.assertEqual(overview.status_code, 200, overview.text)
        self.assertEqual(overview.json()["audits_due"], 1)
        self.assertEqual(overview.json()["audits_completed_30d"], 0)

        completed = self.client.patch(
            f"{BASE}/audits/{audit['id']}",
            json={
                "status": "completed",
                "score": 90,
                "findings": [
                    {
                        "label": "Cold chain log missing",
                        "severity": "high",
                    },
                    {
                        "label": "Handwash station stocked",
                        "severity": "low",
                        "status": "closed",
                        "note": "Verified during walkthrough",
                    },
                ],
            },
            headers=self.headers,
        )
        self.assertEqual(completed.status_code, 200, completed.text)
        result = completed.json()
        self.assertEqual(result["status"], "completed")
        self.assertEqual(result["score_pct"], 90.0)
        self.assertEqual(result["open_findings"], 1)
        self.assertIsNotNone(result["completed_at"])
        self.assertEqual(len(result["findings"]), 2)

        listed = self.client.get(
            f"{BASE}/audits?status=completed", headers=self.headers
        )
        self.assertEqual(listed.status_code, 200, listed.text)
        payload = listed.json()
        self.assertEqual(payload["summary"]["total"], 1)
        self.assertEqual(payload["summary"]["average_score"], 90.0)
        self.assertEqual(payload["summary"]["overdue"], 0)

        overview = self.client.get(f"{BASE}/overview", headers=self.headers)
        self.assertEqual(overview.status_code, 200, overview.text)
        data = overview.json()
        self.assertEqual(data["audits_due"], 0)
        self.assertEqual(data["audits_completed_30d"], 1)
        self.assertEqual(data["average_score"], 90.0)
        self.assertEqual(data["open_findings"], 1)
        self.assertEqual(data["compliance_score"], 100)

        scheduled = self.client.post(
            f"{BASE}/audits",
            json={
                "title": "Weekly kitchen walkthrough",
                "scheduled_for": (
                    self.today + timedelta(days=2)
                ).isoformat(),
            },
            headers=self.headers,
        )
        self.assertEqual(scheduled.status_code, 200, scheduled.text)
        self.audit_ids.append(scheduled.json()["id"])

        overview = self.client.get(f"{BASE}/overview", headers=self.headers)
        self.assertEqual(overview.status_code, 200, overview.text)
        data = overview.json()
        self.assertEqual(data["audits_due"], 1)
        self.assertEqual(data["compliance_score"], 95)
        self.assertTrue(data["attention"])
        self.assertEqual(data["attention"][0]["kind"], "audit_due")

    def test_temperatures(self):
        cases = [
            ("Walk-in fridge", "fridge", 4.0, "ok"),
            ("Front fridge", "fridge", 9.0, "breach"),
            ("Back freezer", "freezer", -8.0, "breach"),
        ]
        for unit_name, unit_type, temperature, expected in cases:
            response = self.client.post(
                f"{BASE}/temperatures",
                json={
                    "unit_name": unit_name,
                    "unit_type": unit_type,
                    "temperature_c": temperature,
                    "recorded_by": "Sam",
                },
                headers=self.headers,
            )
            self.assertEqual(response.status_code, 200, response.text)
            body = response.json()
            self.temperature_ids.append(body["id"])
            self.assertEqual(body["status"], expected)
            self.assertIsNotNone(body["recorded_at"])

        listed = self.client.get(
            f"{BASE}/temperatures?days=1", headers=self.headers
        )
        self.assertEqual(listed.status_code, 200, listed.text)
        payload = listed.json()
        self.assertEqual(payload["summary"]["checks"], 3)
        self.assertEqual(payload["summary"]["ok"], 1)
        self.assertEqual(payload["summary"]["breach"], 2)
        self.assertEqual(payload["summary"]["warning"], 0)
        self.assertIsNotNone(payload["summary"]["last_recorded_at"])

        overview = self.client.get(f"{BASE}/overview", headers=self.headers)
        self.assertEqual(overview.status_code, 200, overview.text)
        data = overview.json()
        self.assertEqual(data["temperature_checks_24h"], 3)
        self.assertEqual(data["temperature_breaches_24h"], 2)
        self.assertEqual(data["compliance_score"], 80)

    def test_licence_expiry_and_void(self):
        expires_on = (self.today + timedelta(days=10)).isoformat()
        created = self.client.post(
            f"{BASE}/licences",
            json={
                "name": "FSSAI state licence",
                "category": "fssai",
                "licence_number": "FSSAI-2026-001",
                "issuing_authority": "Maharashtra FDA",
                "expires_on": expires_on,
            },
            headers=self.headers,
        )
        self.assertEqual(created.status_code, 200, created.text)
        licence = created.json()
        self.licence_ids.append(licence["id"])
        self.assertEqual(licence["status"], "due_soon")
        self.assertEqual(licence["stored_status"], "valid")
        self.assertEqual(licence["days_to_expiry"], 10)

        listed = self.client.get(
            f"{BASE}/licences?status=due_soon", headers=self.headers
        )
        self.assertEqual(listed.status_code, 200, listed.text)
        payload = listed.json()
        self.assertEqual(payload["summary"]["total"], 1)
        self.assertEqual(payload["summary"]["due_soon"], 1)
        self.assertEqual(payload["items"][0]["id"], licence["id"])

        overview = self.client.get(f"{BASE}/overview", headers=self.headers)
        self.assertEqual(overview.status_code, 200, overview.text)
        data = overview.json()
        self.assertEqual(data["licences_expiring"], 1)
        self.assertEqual(data["licences_expired"], 0)
        self.assertEqual(data["compliance_score"], 100)

        voided = self.client.patch(
            f"{BASE}/licences/{licence['id']}",
            json={"status": "void"},
            headers=self.headers,
        )
        self.assertEqual(voided.status_code, 200, voided.text)
        self.assertEqual(voided.json()["status"], "void")
        self.assertEqual(voided.json()["stored_status"], "void")

        listed = self.client.get(
            f"{BASE}/licences?status=void", headers=self.headers
        )
        self.assertEqual(listed.status_code, 200, listed.text)
        payload = listed.json()
        self.assertEqual(payload["summary"]["void"], 1)
        self.assertEqual(payload["items"][0]["id"], licence["id"])

        overview = self.client.get(f"{BASE}/overview", headers=self.headers)
        self.assertEqual(overview.json()["licences_expiring"], 0)


if __name__ == "__main__":
    unittest.main()
