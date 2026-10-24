"""Shared media library: upload, search, usage guard and deletion."""

import os
import unittest

os.environ.setdefault("PYTHONDONTWRITEBYTECODE", "1")

from fastapi.testclient import TestClient

from app.core.config import settings
from app.main import app

PNG_BYTES = b"\x89PNG\r\n\x1a\n" + b"pizza-blitz-media-proof" * 8


class MediaLibraryTest(unittest.TestCase):
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

    def upload(self, name: str = "Margherita") -> dict:
        response = self.client.post(
            "/api/v1/restaurant/media/assets",
            files={"file": (f"{name.lower()}.png", PNG_BYTES, "image/png")},
            data={"name": f"{name} ticket", "tags": "pizza,proof"},
            headers=self.headers,
        )
        self.assertEqual(response.status_code, 201, response.text)
        return response.json()["asset"]

    def test_upload_list_and_attach_to_menu(self):
        asset = self.upload("Margherita")
        self.assertEqual(asset["mime_type"], "image/png")
        self.assertIn("/media/library/", asset["url"])
        self.assertEqual(asset["tags"], ["pizza", "proof"])

        listing = self.client.get(
            "/api/v1/restaurant/media/assets?q=margherita", headers=self.headers
        )
        self.assertEqual(listing.status_code, 200, listing.text)
        self.assertTrue(any(row["id"] == asset["id"] for row in listing.json()["assets"]))

        created = self.client.post(
            "/api/v1/restaurant/menu/menu",
            json={
                "name": "Media Proof Pizza",
                "category": "Pizza",
                "selling_price": 299,
                "cost_price": 110,
                "image_url": asset["url"],
                "image_alt": "Media proof pizza",
            },
            headers=self.headers,
        )
        self.assertEqual(created.status_code, 200, created.text)
        item = created.json()
        self.assertEqual(item["image_url"], asset["url"])

        blocked = self.client.delete(
            f"/api/v1/restaurant/media/assets/{asset['id']}", headers=self.headers
        )
        self.assertEqual(blocked.status_code, 409, blocked.text)
        self.assertIn("menu item", blocked.json()["detail"])

        removed_image = self.client.delete(
            f"/api/v1/restaurant/menu/menu/{item['id']}/image",
            headers=self.headers,
        )
        self.assertEqual(removed_image.status_code, 200, removed_image.text)
        self.assertEqual(removed_image.json()["image_url"], None)

        deleted_item = self.client.delete(
            f"/api/v1/restaurant/menu/menu/{item['id']}",
            headers=self.headers,
        )
        self.assertEqual(deleted_item.status_code, 200, deleted_item.text)

        deleted = self.client.delete(
            f"/api/v1/restaurant/media/assets/{asset['id']}", headers=self.headers
        )
        self.assertEqual(deleted.status_code, 204, deleted.text)

    def test_rejects_non_image_and_unknown_asset(self):
        rejected = self.client.post(
            "/api/v1/restaurant/media/assets",
            files={"file": ("notes.txt", b"not an image", "text/plain")},
            headers=self.headers,
        )
        self.assertEqual(rejected.status_code, 422, rejected.text)

        missing = self.client.delete(
            "/api/v1/restaurant/media/assets/999999", headers=self.headers
        )
        self.assertEqual(missing.status_code, 404, missing.text)


if __name__ == "__main__":
    unittest.main()
