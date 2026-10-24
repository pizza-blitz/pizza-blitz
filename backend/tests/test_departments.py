"""Department registry, membership and module catalogue tests."""

import os
import unittest

os.environ.setdefault("PYTHONDONTWRITEBYTECODE", "1")

from fastapi.testclient import TestClient

from app.core.config import settings
from app.main import app


class DepartmentRegistryTest(unittest.TestCase):
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

    def test_seeded_departments_and_catalog(self):
        listed = self.client.get(
            "/api/v1/restaurant/departments/", headers=self.headers
        )
        self.assertEqual(listed.status_code, 200, listed.text)
        departments = {row["key"]: row for row in listed.json()["departments"]}
        self.assertIn("operations", departments)
        self.assertIn("hr", departments)
        self.assertEqual(departments["hr"]["external_system"], "Euron Open HRMS")
        self.assertEqual(departments["hr"]["integration_status"], "pilot")
        self.assertGreaterEqual(departments["hr"]["module_count"], 6)

        hr = self.client.get(
            "/api/v1/restaurant/departments/hr", headers=self.headers
        )
        self.assertEqual(hr.status_code, 200, hr.text)
        modules = {row["key"]: row for row in hr.json()["modules"]}
        self.assertEqual(modules["overview"]["status"], "active")
        self.assertEqual(modules["payroll"]["status"], "active")
        self.assertEqual(modules["onboarding"]["status"], "active")
        self.assertEqual(modules["documents"]["status"], "planned")
        self.assertIn("leave", modules)

        catalog = self.client.get(
            "/api/v1/restaurant/departments/catalog", headers=self.headers
        )
        self.assertEqual(catalog.status_code, 200, catalog.text)
        catalog_keys = {row["key"] for row in catalog.json()["modules"]}
        self.assertTrue({"overview", "people", "payroll", "accounting"}.issubset(catalog_keys))

    def test_create_department_and_members(self):
        created = self.client.post(
            "/api/v1/restaurant/departments/",
            json={
                "name": "Finance & Compliance",
                "key": "finance-compliance",
                "description": "Accounting, tax and statutory compliance.",
                "color": "#2563eb",
                "modules": ["overview", "accounting", "reports"],
            },
            headers=self.headers,
        )
        self.assertEqual(created.status_code, 201, created.text)
        department = created.json()
        self.assertEqual(department["key"], "finance-compliance")
        modules = {row["key"]: row for row in department["modules"]}
        self.assertEqual(modules["accounting"]["status"], "active")
        self.assertEqual(department["member_count"], 0)

        duplicate = self.client.post(
            "/api/v1/restaurant/departments/",
            json={"name": "Another Finance", "key": "finance-compliance"},
            headers=self.headers,
        )
        self.assertEqual(duplicate.status_code, 409)

        invalid = self.client.post(
            "/api/v1/restaurant/departments/",
            json={"name": "Bad Department", "modules": ["not-a-module"]},
            headers=self.headers,
        )
        self.assertEqual(invalid.status_code, 422)

        staff = self.client.post(
            "/api/v1/auth/staff/credential",
            json={
                "id": "deptlead",
                "password": "deptlead123",
                "display_name": "Department Lead",
                "is_active": True,
            },
            headers=self.headers,
        )
        self.assertEqual(staff.status_code, 200, staff.text)
        added = self.client.post(
            f"/api/v1/restaurant/departments/{department['id']}/members",
            json={"staff_id": "deptlead", "role": "head"},
            headers=self.headers,
        )
        self.assertEqual(added.status_code, 201, added.text)
        self.assertEqual(added.json()["members"][0]["display_name"], "Department Lead")
        self.assertEqual(added.json()["members"][0]["role"], "head")

        duplicate_member = self.client.post(
            f"/api/v1/restaurant/departments/{department['id']}/members",
            json={"staff_id": "deptlead", "role": "member"},
            headers=self.headers,
        )
        self.assertEqual(duplicate_member.status_code, 422)

        removed = self.client.delete(
            f"/api/v1/restaurant/departments/{department['id']}/members/deptlead",
            headers=self.headers,
        )
        self.assertEqual(removed.status_code, 204)

        updated = self.client.patch(
            f"/api/v1/restaurant/departments/{department['id']}",
            json={
                "description": "Updated remit",
                "modules": ["overview", "accounting", "reports", "customers"],
                "integration_status": "connected",
            },
            headers=self.headers,
        )
        self.assertEqual(updated.status_code, 200, updated.text)
        self.assertIn(
            "customers", {row["key"] for row in updated.json()["modules"]}
        )
        self.assertEqual(updated.json()["integration_status"], "connected")

    def test_access_control(self):
        self.assertEqual(
            self.client.get("/api/v1/restaurant/departments/").status_code,
            401,
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
                "/api/v1/restaurant/departments/", headers=staff_headers
            ).status_code,
            403,
        )


if __name__ == "__main__":
    unittest.main()
