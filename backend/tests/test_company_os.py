"""Company OS Phase 1: registry, scoped access, work items and approvals."""

import os
import unittest

os.environ.setdefault("PYTHONDONTWRITEBYTECODE", "1")

from fastapi.testclient import TestClient

from app.core.config import settings
from app.main import app
from app.services.company_catalog import (
    DEPARTMENT_SPECS,
    MODULE_CATALOG,
    PORTAL_ROUTES,
)

BASE = "/api/v1/restaurant"


class CompanyOSRegistryTest(unittest.TestCase):
    def test_catalogue_covers_every_portal_route(self):
        routes = [
            module["route_template"]
            for module in MODULE_CATALOG
            if module["route_template"]
        ]
        self.assertEqual(len(routes), len(set(routes)), "Duplicate route modules")
        self.assertEqual(set(routes), PORTAL_ROUTES)

        department_keys = {spec["key"] for spec in DEPARTMENT_SPECS}
        for module in MODULE_CATALOG:
            self.assertIn(module["owner"], department_keys)
            self.assertTrue(module["permission_key"], module["key"])
            self.assertTrue(module["description"], module["key"])

    def test_expected_departments_and_sub_departments(self):
        keys = {spec["key"] for spec in DEPARTMENT_SPECS}
        core = {
            "executive",
            "operations",
            "kitchen",
            "supply",
            "quality",
            "finance",
            "hr",
            "marketing",
            "revenue",
            "technology",
        }
        self.assertTrue(core.issubset(keys))
        parents = {
            spec["key"]: spec.get("parent")
            for spec in DEPARTMENT_SPECS
            if spec.get("parent")
        }
        self.assertEqual(parents["guest-experience"], "operations")
        self.assertEqual(parents["facilities"], "operations")
        self.assertEqual(parents["training"], "hr")
        self.assertEqual(parents["legal"], "quality")
        self.assertEqual(parents["franchise"], "executive")
        for parent in parents.values():
            self.assertIn(parent, keys)


class CompanyOSApiTest(unittest.TestCase):
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

    def make_staff(self, staff_id: str) -> dict:
        credential = self.client.post(
            "/api/v1/auth/staff/credential",
            json={
                "id": staff_id,
                "password": f"{staff_id}123",
                "display_name": staff_id.title(),
                "is_active": True,
            },
            headers=self.headers,
        )
        self.assertEqual(credential.status_code, 200, credential.text)
        login = self.client.post(
            "/api/v1/auth/staff/login",
            json={"id": staff_id, "password": f"{staff_id}123"},
        )
        self.assertEqual(login.status_code, 200, login.text)
        return {"Authorization": f"Bearer {login.json()['access_token']}"}

    def department(self, key: str) -> dict:
        listed = self.client.get(
            f"{BASE}/departments/", headers=self.headers
        )
        self.assertEqual(listed.status_code, 200, listed.text)
        return next(
            row for row in listed.json()["departments"] if row["key"] == key
        )

    def add_member(
        self,
        department_id: int,
        staff_id: str,
        role_key: str = "member",
        scoped: bool = True,
    ) -> dict:
        role_id = None
        if scoped:
            roles = self.client.get(
                f"{BASE}/departments/{department_id}/roles",
                headers=self.headers,
            )
            self.assertEqual(roles.status_code, 200, roles.text)
            role_id = next(
                row["id"] for row in roles.json()["roles"] if row["key"] == role_key
            )
        payload = {"staff_id": staff_id, "role": role_key}
        if role_id is not None:
            payload["department_role_id"] = role_id
        added = self.client.post(
            f"{BASE}/departments/{department_id}/members",
            json=payload,
            headers=self.headers,
        )
        self.assertEqual(added.status_code, 201, added.text)
        return role_id

    def test_navigation_and_scorecard(self):
        navigation = self.client.get(
            f"{BASE}/departments/navigation", headers=self.headers
        )
        self.assertEqual(navigation.status_code, 200, navigation.text)
        payload = navigation.json()
        titles = [group["title"] for group in payload["groups"]]
        self.assertIn("Operations", titles)
        self.assertEqual(titles[-1], "Shared services")
        hrefs = {
            item["href"]
            for group in payload["groups"]
            for item in group["items"]
        }
        self.assertIn("/orders", hrefs)
        self.assertIn("/work", hrefs)
        self.assertIn("/departments", hrefs)

        scorecard = self.client.get(
            f"{BASE}/departments/scorecard", headers=self.headers
        )
        self.assertEqual(scorecard.status_code, 200, scorecard.text)
        rows = scorecard.json()["departments"]
        self.assertEqual(len(rows), 10)
        self.assertIn("finance", {row["key"] for row in rows})

    def test_scoped_member_sees_only_their_department(self):
        staff_headers = self.make_staff("opsmember")
        operations = self.department("operations")
        self.add_member(operations["id"], "opsmember", "member")

        access = self.client.get(
            f"{BASE}/departments/access", headers=staff_headers
        )
        self.assertEqual(access.status_code, 200, access.text)
        payload = access.json()
        self.assertEqual(
            [row["key"] for row in payload["departments"]], ["operations"]
        )
        permissions = payload["departments"][0]["permissions"]
        self.assertIn("operations.orders", permissions)
        self.assertIn("operations.counter", permissions)
        self.assertIn("shared.work", permissions)
        self.assertNotIn("finance.accounting", permissions)

        listed = self.client.get(f"{BASE}/departments/", headers=staff_headers)
        self.assertEqual(listed.status_code, 200, listed.text)
        self.assertEqual(
            [row["key"] for row in listed.json()["departments"]], ["operations"]
        )

        workspace = self.client.get(
            f"{BASE}/departments/operations", headers=staff_headers
        )
        self.assertEqual(workspace.status_code, 200, workspace.text)
        detail = workspace.json()
        self.assertIn("kpis", detail)
        self.assertIn("work_items", detail)
        modules = {row["key"]: row for row in detail["modules"]}
        self.assertTrue(modules["orders"]["can_view"])
        self.assertTrue(modules["counter"]["can_view"])
        self.assertFalse(modules["shifts"]["can_view"])

        denied = self.client.get(
            f"{BASE}/departments/finance", headers=staff_headers
        )
        self.assertEqual(denied.status_code, 403)

        navigation = self.client.get(
            f"{BASE}/departments/navigation", headers=staff_headers
        )
        self.assertEqual(navigation.status_code, 200, navigation.text)
        hrefs = {
            item["href"]
            for group in navigation.json()["groups"]
            for item in group["items"]
        }
        self.assertIn("/orders", hrefs)
        self.assertNotIn("/accounting", hrefs)
        self.assertIn("/work", hrefs)
        self.assertIn("/departments", hrefs)

        scorecard = self.client.get(
            f"{BASE}/departments/scorecard", headers=staff_headers
        )
        self.assertEqual(scorecard.status_code, 200, scorecard.text)
        self.assertEqual(
            [row["key"] for row in scorecard.json()["departments"]],
            ["operations"],
        )

    def test_non_member_staff_is_denied_department_data(self):
        staff_headers = self.make_staff("outsider")
        self.assertEqual(
            self.client.get(f"{BASE}/departments/", headers=staff_headers).status_code,
            403,
        )
        self.assertEqual(
            self.client.get(
                f"{BASE}/departments/operations", headers=staff_headers
            ).status_code,
            403,
        )
        create = self.client.post(
            f"{BASE}/work/items",
            json={
                "department_key": "operations",
                "title": "Restock napkins",
            },
            headers=staff_headers,
        )
        self.assertEqual(create.status_code, 403)

    def test_work_items_and_approval_decisions(self):
        manager_headers = self.make_staff("opsmanager")
        member_headers = self.make_staff("opsteam")
        operations = self.department("operations")
        self.add_member(operations["id"], "opsmanager", "manager")
        self.add_member(operations["id"], "opsteam", "member")

        created = self.client.post(
            f"{BASE}/work/items",
            json={
                "department_key": "operations",
                "title": "Close the counter float",
                "description": "Count the drawer and log variance.",
                "priority": "high",
                "owner_staff_id": "opsmanager",
            },
            headers=self.headers,
        )
        self.assertEqual(created.status_code, 201, created.text)
        item = created.json()["work_item"]
        self.assertTrue(item["needs_attention"])

        inbox = self.client.get(f"{BASE}/work", headers=manager_headers)
        self.assertEqual(inbox.status_code, 200, inbox.text)
        self.assertGreaterEqual(inbox.json()["counts"]["work_items"], 1)
        self.assertIn(
            item["id"],
            [row["id"] for row in inbox.json()["work_items"]],
        )

        comment = self.client.post(
            f"{BASE}/work/items/{item['id']}/comments",
            json={"body": "Drawer counted, variance Rs 0."},
            headers=manager_headers,
        )
        self.assertEqual(comment.status_code, 201, comment.text)

        closed = self.client.patch(
            f"{BASE}/work/items/{item['id']}",
            json={"status": "done"},
            headers=manager_headers,
        )
        self.assertEqual(closed.status_code, 200, closed.text)
        self.assertEqual(closed.json()["work_item"]["status"], "done")

        approval = self.client.post(
            f"{BASE}/work/approvals",
            json={
                "department_key": "operations",
                "title": "Approve late-night delivery fee",
                "kind": "expense",
                "amount": 450,
                "note": "Third-party delivery surcharge.",
            },
            headers=manager_headers,
        )
        self.assertEqual(approval.status_code, 201, approval.text)
        approval_row = approval.json()["approval"]

        denied = self.client.post(
            f"{BASE}/work/approvals/{approval_row['id']}/decision",
            json={"decision": "approved"},
            headers=member_headers,
        )
        self.assertEqual(denied.status_code, 403)

        decided = self.client.post(
            f"{BASE}/work/approvals/{approval_row['id']}/decision",
            json={"decision": "approved", "note": "Within policy."},
            headers=manager_headers,
        )
        self.assertEqual(decided.status_code, 200, decided.text)
        self.assertEqual(decided.json()["approval"]["status"], "approved")

        member_task = self.client.post(
            f"{BASE}/work/items",
            json={
                "department_key": "operations",
                "title": "Restock napkins",
            },
            headers=member_headers,
        )
        self.assertEqual(member_task.status_code, 201, member_task.text)
        owned = member_task.json()["work_item"]
        self.assertEqual(owned["owner_staff_id"], "opsteam")
        member_inbox = self.client.get(f"{BASE}/work", headers=member_headers)
        self.assertEqual(member_inbox.status_code, 200, member_inbox.text)
        self.assertIn(
            owned["id"],
            [row["id"] for row in member_inbox.json()["work_items"]],
        )
        member_closed = self.client.patch(
            f"{BASE}/work/items/{owned['id']}",
            json={"status": "done"},
            headers=member_headers,
        )
        self.assertEqual(member_closed.status_code, 200, member_closed.text)

    def test_social_approval_is_mirrored_and_decided_once(self):
        created = self.client.post(
            f"{BASE}/social/posts",
            json={
                "title": "Friday combo reel",
                "message": "Two pizzas, one price.",
                "media_type": "image",
                "image_url": "https://example.com/combo.jpg",
                "requires_approval": True,
                "status": "draft",
            },
            headers=self.headers,
        )
        self.assertEqual(created.status_code, 200, created.text)
        post = created.json()["post"]

        inbox = self.client.get(
            f"{BASE}/work/approvals?department_key=marketing",
            headers=self.headers,
        )
        self.assertEqual(inbox.status_code, 200, inbox.text)
        mirrored = [
            row
            for row in inbox.json()["approvals"]
            if row["source_type"] == "social_post"
            and int(row["source_id"]) == post["id"]
        ]
        self.assertEqual(len(mirrored), 1)

        decided = self.client.post(
            f"{BASE}/work/approvals/{mirrored[0]['id']}/decision",
            json={"decision": "approved", "note": "Brand-safe."},
            headers=self.headers,
        )
        self.assertEqual(decided.status_code, 200, decided.text)

        posts = self.client.get(f"{BASE}/social/posts", headers=self.headers)
        updated = next(row for row in posts.json() if row["id"] == post["id"])
        self.assertEqual(updated["approval_status"], "approved")


if __name__ == "__main__":
    unittest.main()
