"""Landing content: defaults, save, public bootstrap and access."""

import os
import unittest

os.environ.setdefault("PYTHONDONTWRITEBYTECODE", "1")

from fastapi.testclient import TestClient

from app.core.config import settings
from app.main import app


class StorefrontContentTest(unittest.TestCase):
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
        default = self.client.get(
            "/api/v1/restaurant/storefront-content/", headers=self.headers
        ).json()["content"]
        default.pop("customised", None)
        default.pop("updated_at", None)
        self.client.put(
            "/api/v1/restaurant/storefront-content/",
            json=default,
            headers=self.headers,
        )
        self._ctx.__exit__(None, None, None)

    def test_defaults_save_and_public_bootstrap(self):
        initial = self.client.get(
            "/api/v1/restaurant/storefront-content/", headers=self.headers
        )
        self.assertEqual(initial.status_code, 200, initial.text)
        content = initial.json()["content"]
        self.assertTrue(content["hero_title"])
        self.assertIn("Pizza", content["category_images"])

        payload = {
            **{key: content[key] for key in (
                "hero_title",
                "hero_highlight",
                "hero_subtitle",
                "hero_image_url",
                "story_title",
                "story_body",
                "story_image_url",
                "category_images",
            )},
            "hero_title": "Proof oven pizza",
            "hero_highlight": "ready in minutes.",
            "hero_subtitle": "A custom landing subtitle saved from the admin CMS.",
            "story_title": "Proof kitchen story",
            "story_body": "A custom story body saved from the admin CMS and shown publicly.",
            "hero_image_url": "/media/library/proof-hero.jpg",
        }
        saved = self.client.put(
            "/api/v1/restaurant/storefront-content/",
            json=payload,
            headers=self.headers,
        )
        self.assertEqual(saved.status_code, 200, saved.text)
        self.assertTrue(saved.json()["content"]["customised"])

        public = self.client.get("/api/v1/restaurant/storefront/bootstrap")
        self.assertEqual(public.status_code, 200, public.text)
        site = public.json()["site_content"]
        self.assertEqual(site["hero_title"], "Proof oven pizza")
        self.assertEqual(site["story_title"], "Proof kitchen story")
        self.assertEqual(site["hero_image_url"], "/media/library/proof-hero.jpg")

    def test_staff_cannot_edit_content(self):
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
                "/api/v1/restaurant/storefront-content/", headers=headers
            ).status_code,
            403,
        )


if __name__ == "__main__":
    unittest.main()
