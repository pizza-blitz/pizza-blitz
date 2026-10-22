"""Menu image upload and serving tests."""

import base64
import os
import unittest

os.environ.setdefault("PYTHONDONTWRITEBYTECODE", "1")

from fastapi.testclient import TestClient

from app.core.config import settings
from app.main import app

# 1x1 transparent PNG.
PNG_BYTES = base64.b64decode(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAFgwJ/lK3d"
    "WQAAAABJRU5ErkJggg=="
)


class MenuMediaTest(unittest.TestCase):
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
        items = self.client.get("/api/v1/restaurant/menu/menu").json()
        self.item = next(row for row in items if row["name"] == "Garlic Bread")
        self.item_id = self.item["id"]

    def tearDown(self):
        self.client.delete(
            f"/api/v1/restaurant/menu/menu/{self.item_id}/image",
            headers=self.headers,
        )
        self._ctx.__exit__(None, None, None)

    def upload(self, content: bytes = PNG_BYTES, alt: str = "Garlic bread on a board"):
        return self.client.post(
            f"/api/v1/restaurant/menu/menu/{self.item_id}/image",
            files={"file": ("menu.png", content, "image/png")},
            data={"alt": alt},
            headers=self.headers,
        )

    def test_upload_serves_and_exposes_image(self):
        response = self.upload()
        self.assertEqual(response.status_code, 200, response.text)
        uploaded = response.json()
        self.assertTrue(uploaded["image_url"].startswith("/media/menu/"))
        self.assertEqual(uploaded["image_alt"], "Garlic bread on a board")

        served = self.client.get(uploaded["image_url"])
        self.assertEqual(served.status_code, 200, served.text)
        self.assertEqual(served.headers["content-type"], "image/png")
        self.assertGreaterEqual(len(served.content), len(PNG_BYTES))

        menu = self.client.get("/api/v1/restaurant/menu/menu").json()
        row = next(item for item in menu if item["id"] == self.item_id)
        self.assertEqual(row["image_url"], uploaded["image_url"])

        storefront = self.client.get(
            "/api/v1/restaurant/menu/menu-with-customizations"
        ).json()
        public_row = next(item for item in storefront if item["id"] == self.item_id)
        self.assertEqual(public_row["image_url"], uploaded["image_url"])
        self.assertEqual(public_row["image_alt"], "Garlic bread on a board")

    def test_rejects_non_image_upload(self):
        response = self.upload(content=b"not-an-image", alt="Bad")
        self.assertEqual(response.status_code, 422)
        self.assertIn("JPEG, PNG, or WebP", response.json()["detail"])

    def test_upload_requires_admin(self):
        response = self.client.post(
            f"/api/v1/restaurant/menu/menu/{self.item_id}/image",
            files={"file": ("menu.png", PNG_BYTES, "image/png")},
        )
        self.assertEqual(response.status_code, 401)

    def test_remove_image_clears_fields_and_file(self):
        uploaded = self.upload().json()
        removed = self.client.delete(
            f"/api/v1/restaurant/menu/menu/{self.item_id}/image",
            headers=self.headers,
        )
        self.assertEqual(removed.status_code, 200, removed.text)
        self.assertIsNone(removed.json()["image_url"])
        self.assertEqual(self.client.get(uploaded["image_url"]).status_code, 404)


if __name__ == "__main__":
    unittest.main()
