"""Video captions: VTT upload, SRT conversion, video-only guard and delete."""

import os
import unittest

os.environ.setdefault("PYTHONDONTWRITEBYTECODE", "1")

from fastapi.testclient import TestClient

from app.core.config import settings
from app.db.session import SessionLocal
from app.main import app
from app.models.domain import MediaAsset

VTT = b"""WEBVTT

00:00:01.000 --> 00:00:03.000
Fresh pizza, straight from the oven.
"""
SRT = b"""1
00:00:01,000 --> 00:00:03,000
Hot pizza, delivered fast.
"""


class MediaCaptionTest(unittest.TestCase):
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
        self.headers = {"Authorization": f"Bearer {login.json()['access_token']}"}
        session = SessionLocal()
        try:
            self.video = MediaAsset(
                name="Caption video",
                url="/media/library/videos/caption-proof.mp4",
                file_name="caption-proof.mp4",
                mime_type="video/mp4",
                size_bytes=100,
                media_type="video",
                tags=[],
            )
            self.image = MediaAsset(
                name="Caption image",
                url="/media/library/caption-proof.png",
                file_name="caption-proof.png",
                mime_type="image/png",
                size_bytes=100,
                media_type="image",
                tags=[],
            )
            session.add_all([self.video, self.image])
            session.commit()
            session.refresh(self.video)
            session.refresh(self.image)
            self.video_id = self.video.id
            self.image_id = self.image.id
        finally:
            session.close()

    def tearDown(self):
        session = SessionLocal()
        try:
            session.query(MediaAsset).filter(
                MediaAsset.id.in_([self.video_id, self.image_id])
            ).delete(synchronize_session=False)
            session.commit()
        finally:
            session.close()
        self._ctx.__exit__(None, None, None)

    def test_vtt_and_srt_upload(self):
        vtt = self.client.post(
            f"/api/v1/restaurant/media/assets/{self.video_id}/caption",
            files={"file": ("reel.vtt", VTT, "text/vtt")},
            data={"language": "en"},
            headers=self.headers,
        )
        self.assertEqual(vtt.status_code, 201, vtt.text)
        caption_url = vtt.json()["asset"]["caption_url"]
        self.assertTrue(caption_url.startswith("/media/library/captions/"))
        served = self.client.get(caption_url)
        self.assertEqual(served.status_code, 200, served.text)
        self.assertTrue(served.text.startswith("WEBVTT"))

        srt = self.client.post(
            f"/api/v1/restaurant/media/assets/{self.video_id}/caption",
            files={"file": ("reel.srt", SRT, "application/x-subrip")},
            headers=self.headers,
        )
        self.assertEqual(srt.status_code, 201, srt.text)
        converted = self.client.get(srt.json()["asset"]["caption_url"]).text
        self.assertIn("00:00:01.000 --> 00:00:03.000", converted)
        self.assertNotIn("00:00:01,000", converted)

        deleted = self.client.delete(
            f"/api/v1/restaurant/media/assets/{self.video_id}/caption",
            headers=self.headers,
        )
        self.assertEqual(deleted.status_code, 204, deleted.text)

    def test_captions_reject_images_and_bad_files(self):
        image = self.client.post(
            f"/api/v1/restaurant/media/assets/{self.image_id}/caption",
            files={"file": ("reel.vtt", VTT, "text/vtt")},
            headers=self.headers,
        )
        self.assertEqual(image.status_code, 422, image.text)
        bad = self.client.post(
            f"/api/v1/restaurant/media/assets/{self.video_id}/caption",
            files={"file": ("reel.txt", b"not captions", "text/plain")},
            headers=self.headers,
        )
        self.assertEqual(bad.status_code, 422, bad.text)
        no_cues = self.client.post(
            f"/api/v1/restaurant/media/assets/{self.video_id}/caption",
            files={"file": ("reel.vtt", b"WEBVTT\n\nno timed cues", "text/vtt")},
            headers=self.headers,
        )
        self.assertEqual(no_cues.status_code, 422, no_cues.text)


if __name__ == "__main__":
    unittest.main()
