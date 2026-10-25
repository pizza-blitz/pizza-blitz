"""Marketing hub calendar and reel/video social publishing."""

import os
import unittest
from unittest.mock import patch

os.environ.setdefault("PYTHONDONTWRITEBYTECODE", "1")

from fastapi.testclient import TestClient

from app.core.config import settings
from app.main import app
from app.services.social_publish_service import _publish_instagram_media


class MarketingHubTest(unittest.TestCase):
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

    def test_reel_post_and_calendar(self):
        missing_video = self.client.post(
            "/api/v1/restaurant/social/posts",
            json={
                "title": "Broken reel",
                "message": "No video",
                "media_type": "reel",
                "platforms": ["instagram"],
            },
            headers=self.headers,
        )
        self.assertEqual(missing_video.status_code, 422, missing_video.text)

        created = self.client.post(
            "/api/v1/restaurant/social/posts",
            json={
                "title": "Proof reel",
                "message": "Our new pizza reel",
                "media_type": "reel",
                "video_url": "https://cdn.example.com/proof-reel.mp4",
                "cover_image_url": "https://cdn.example.com/proof-cover.jpg",
                "platforms": ["instagram"],
                "status": "scheduled",
                "scheduled_at": "2026-11-02T10:00:00",
            },
            headers=self.headers,
        )
        self.assertEqual(created.status_code, 200, created.text)
        post = created.json()["post"]
        self.assertEqual(post["media_type"], "reel")
        self.assertEqual(post["video_url"], "https://cdn.example.com/proof-reel.mp4")

        calendar = self.client.get(
            "/api/v1/restaurant/marketing/calendar?year=2026&month=11",
            headers=self.headers,
        )
        self.assertEqual(calendar.status_code, 200, calendar.text)
        items = calendar.json()["items"]
        item = next(row for row in items if row["reference_id"] == post["id"])
        self.assertEqual(item["kind"], "social")
        self.assertEqual(item["media_type"], "reel")
        self.assertEqual(item["date"], "2026-11-02")

    def test_instagram_reel_payload(self):
        with patch(
            "app.services.social_publish_service._post_form"
        ) as post_form:
            post_form.side_effect = [
                (200, {"id": "container-1"}, None),
                (200, {"id": "media-1"}, None),
            ]
            result = _publish_instagram_media(
                message="Reel caption",
                image_url=None,
                video_url="https://cdn.example.com/reel.mp4",
                cover_image_url="https://cdn.example.com/cover.jpg",
                media_type="reel",
                config={
                    "INSTAGRAM_BUSINESS_ACCOUNT_ID": "1789",
                    "INSTAGRAM_ACCESS_TOKEN": "token",
                    "META_GRAPH_VERSION": "v25.0",
                },
            )
        self.assertEqual(result.status, "published")
        self.assertEqual(result.external_id, "media-1")
        first_payload = post_form.call_args_list[0].args[1]
        self.assertEqual(first_payload["media_type"], "REELS")
        self.assertEqual(first_payload["video_url"], "https://cdn.example.com/reel.mp4")
        self.assertEqual(first_payload["cover_url"], "https://cdn.example.com/cover.jpg")


if __name__ == "__main__":
    unittest.main()
