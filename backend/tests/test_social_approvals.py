"""Social approval workflow: staff submit, admin approve/reject, publish gated."""

import os
import unittest

os.environ.setdefault("PYTHONDONTWRITEBYTECODE", "1")

from fastapi.testclient import TestClient

from app.core.config import settings
from app.main import app


class SocialApprovalTest(unittest.TestCase):
    def setUp(self):
        self._ctx = TestClient(app)
        self.client = self._ctx.__enter__()
        admin = self.client.post(
            "/api/v1/auth/admin/login",
            json={
                "id": settings.PIZZA_BLITZ_ADMIN_ID,
                "password": settings.PIZZA_BLITZ_ADMIN_PASSWORD,
            },
        )
        staff = self.client.post(
            "/api/v1/auth/staff/login",
            json={
                "id": settings.PIZZA_BLITZ_STAFF_ID,
                "password": settings.PIZZA_BLITZ_STAFF_PASSWORD,
            },
        )
        self.admin_headers = {"Authorization": f"Bearer {admin.json()['access_token']}"}
        self.staff_headers = {"Authorization": f"Bearer {staff.json()['access_token']}"}

    def tearDown(self):
        self._ctx.__exit__(None, None, None)

    def _post(self, headers: dict, *, requires_approval: bool = True) -> dict:
        response = self.client.post(
            "/api/v1/restaurant/social/posts",
            json={
                "title": f"Approval proof {id(self)}",
                "message": "A reel-ready social update for approval proof.",
                "image_url": "https://example.com/pizza.jpg",
                "platforms": ["facebook", "instagram"],
                "status": "scheduled",
                "scheduled_at": "2026-10-01T10:00:00",
                "requires_approval": requires_approval,
            },
            headers=headers,
        )
        self.assertEqual(response.status_code, 200, response.text)
        return response.json()["post"]

    def test_pending_post_cannot_publish_until_approved(self):
        post = self._post(self.staff_headers)
        self.assertEqual(post["approval_status"], "pending")

        blocked = self.client.post(
            f"/api/v1/restaurant/social/posts/{post['id']}/publish",
            json={"dry_run": False},
            headers=self.admin_headers,
        )
        self.assertEqual(blocked.status_code, 409, blocked.text)

        dry_run = self.client.post(
            f"/api/v1/restaurant/social/posts/{post['id']}/publish",
            json={"dry_run": True},
            headers=self.admin_headers,
        )
        self.assertEqual(dry_run.status_code, 200, dry_run.text)

        staff_approve = self.client.post(
            f"/api/v1/restaurant/social/posts/{post['id']}/approve",
            json={"note": "Looks good."},
            headers=self.staff_headers,
        )
        self.assertEqual(staff_approve.status_code, 403, staff_approve.text)

        approved = self.client.post(
            f"/api/v1/restaurant/social/posts/{post['id']}/approve",
            json={"note": "Brand-safe and on message."},
            headers=self.admin_headers,
        )
        self.assertEqual(approved.status_code, 200, approved.text)
        self.assertEqual(approved.json()["post"]["approval_status"], "approved")
        self.assertTrue(approved.json()["post"]["approved_by"].startswith("admin"))

        queue = self.client.get(
            "/api/v1/restaurant/social/approvals", headers=self.admin_headers
        )
        self.assertEqual(queue.status_code, 200, queue.text)
        self.assertNotIn(
            post["id"], [row["id"] for row in queue.json()["posts"]]
        )

        published = self.client.post(
            f"/api/v1/restaurant/social/posts/{post['id']}/publish",
            json={"dry_run": True},
            headers=self.admin_headers,
        )
        self.assertEqual(published.status_code, 200, published.text)

    def test_rejection_requires_note_and_blocks_publish(self):
        post = self._post(self.staff_headers)
        missing = self.client.post(
            f"/api/v1/restaurant/social/posts/{post['id']}/reject",
            json={"note": ""},
            headers=self.admin_headers,
        )
        self.assertEqual(missing.status_code, 422, missing.text)
        rejected = self.client.post(
            f"/api/v1/restaurant/social/posts/{post['id']}/reject",
            json={"note": "Caption needs a price disclaimer."},
            headers=self.admin_headers,
        )
        self.assertEqual(rejected.status_code, 200, rejected.text)
        self.assertEqual(rejected.json()["post"]["approval_status"], "rejected")
        blocked = self.client.post(
            f"/api/v1/restaurant/social/posts/{post['id']}/publish",
            json={"dry_run": False},
            headers=self.admin_headers,
        )
        self.assertEqual(blocked.status_code, 409, blocked.text)

    def test_auto_publish_status_flags_pending_approval(self):
        post = self._post(self.admin_headers)
        status = self.client.get(
            "/api/v1/restaurant/social/auto-publish/status",
            headers=self.admin_headers,
        )
        self.assertEqual(status.status_code, 200, status.text)
        row = next(
            (item for item in status.json()["due_posts"] if item["id"] == post["id"]),
            None,
        )
        self.assertIsNotNone(row)
        self.assertIn("Approval pending", row["blockers"])


if __name__ == "__main__":
    unittest.main()
