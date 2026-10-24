"""HR document vault and letter verification tests."""

import os
import unittest

os.environ.setdefault("PYTHONDONTWRITEBYTECODE", "1")

from fastapi.testclient import TestClient

from app.core.config import settings
from app.main import app


class HRDocumentsTest(unittest.TestCase):
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
                "employee_code": f"EMP-DOC-{self._testMethodName[-8:]}",
                "full_name": "Document Test Employee",
                "designation": "Kitchen Lead",
                "employment_type": "full_time",
                "status": "active",
                "joining_date": "2025-05-01",
            },
            headers=self.headers,
        )
        self.assertEqual(employee.status_code, 201, employee.text)
        self.employee_id = employee.json()["id"]

    def tearDown(self):
        self._ctx.__exit__(None, None, None)

    def test_upload_list_download_and_delete(self):
        uploaded = self.client.post(
            "/api/v1/restaurant/hr/documents",
            data={
                "employee_id": str(self.employee_id),
                "category": "identity",
                "title": "Passport scan",
                "visibility": "hr",
                "notes": "Verified at onboarding",
            },
            files={
                "file": (
                    "passport.pdf",
                    b"%PDF-1.4\n1 0 obj\n<<>>\nendobj\ntrailer\n<<>>\n%%EOF",
                    "application/pdf",
                )
            },
            headers=self.headers,
        )
        self.assertEqual(uploaded.status_code, 201, uploaded.text)
        document = uploaded.json()
        self.assertEqual(document["category"], "identity")
        self.assertEqual(document["mime_type"], "application/pdf")

        listed = self.client.get(
            "/api/v1/restaurant/hr/documents?employee_id=" + str(self.employee_id),
            headers=self.headers,
        )
        self.assertEqual(listed.status_code, 200, listed.text)
        self.assertEqual(len(listed.json()["documents"]), 1)

        downloaded = self.client.get(
            f"/api/v1/restaurant/hr/documents/{document['id']}/download",
            headers=self.headers,
        )
        self.assertEqual(downloaded.status_code, 200, downloaded.text)
        self.assertTrue(downloaded.content.startswith(b"%PDF"))

        invalid = self.client.post(
            "/api/v1/restaurant/hr/documents",
            data={
                "employee_id": str(self.employee_id),
                "category": "other",
                "title": "Bad file",
            },
            files={"file": ("bad.txt", b"hello world", "text/plain")},
            headers=self.headers,
        )
        self.assertEqual(invalid.status_code, 422)

        deleted = self.client.delete(
            f"/api/v1/restaurant/hr/documents/{document['id']}",
            headers=self.headers,
        )
        self.assertEqual(deleted.status_code, 204)

    def test_issue_and_publicly_verify_letter(self):
        issued = self.client.post(
            "/api/v1/restaurant/hr/letters",
            json={"employee_id": self.employee_id, "letter_type": "offer"},
            headers=self.headers,
        )
        self.assertEqual(issued.status_code, 201, issued.text)
        letter = issued.json()
        self.assertIn("Document Test Employee", letter["content_html"])
        self.assertTrue(letter["verification_code"].startswith("PBL-"))

        verified = self.client.get(
            f"/api/v1/restaurant/hr/verify-letter/{letter['verification_code']}"
        )
        self.assertEqual(verified.status_code, 200, verified.text)
        self.assertTrue(verified.json()["valid"])
        self.assertEqual(
            verified.json()["employee_code"],
            ("EMP-DOC-" + self._testMethodName[-8:]).upper(),
        )

        invalid = self.client.get(
            "/api/v1/restaurant/hr/verify-letter/PBL-000000000000"
        )
        self.assertEqual(invalid.status_code, 200)
        self.assertFalse(invalid.json()["valid"])

        listed = self.client.get(
            "/api/v1/restaurant/hr/letters?employee_id=" + str(self.employee_id),
            headers=self.headers,
        )
        self.assertEqual(listed.status_code, 200, listed.text)
        self.assertIn(
            letter["verification_code"],
            [row["verification_code"] for row in listed.json()["letters"]],
        )

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
                "/api/v1/restaurant/hr/letters", headers=staff_headers
            ).status_code,
            403,
        )


if __name__ == "__main__":
    unittest.main()
