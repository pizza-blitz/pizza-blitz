"""Video uploads transcode to MP4 with a generated poster in Media Studio."""

import os
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path

os.environ.setdefault("PYTHONDONTWRITEBYTECODE", "1")

from fastapi.testclient import TestClient

from app.core.config import settings
from app.main import app

HAS_FFMPEG = bool(shutil.which("ffmpeg") and shutil.which("ffprobe"))


@unittest.skipUnless(HAS_FFMPEG, "ffmpeg is required for video processing")
class MediaVideoTest(unittest.TestCase):
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

    def _sample(self) -> bytes:
        with tempfile.TemporaryDirectory() as temp_dir:
            target = Path(temp_dir) / "sample.mp4"
            subprocess.run(  # noqa: S603
                [
                    shutil.which("ffmpeg"),
                    "-y",
                    "-f",
                    "lavfi",
                    "-i",
                    "color=c=#e64a19:s=320x240:d=1",
                    "-f",
                    "lavfi",
                    "-i",
                    "anullsrc=r=44100:cl=stereo",
                    "-shortest",
                    "-c:v",
                    "libx264",
                    "-pix_fmt",
                    "yuv420p",
                    "-c:a",
                    "aac",
                    str(target),
                ],
                capture_output=True,
                check=True,
            )
            return target.read_bytes()

    def test_video_upload_creates_poster_and_streams(self):
        response = self.client.post(
            "/api/v1/restaurant/media/assets",
            files={"file": ("reel-proof.mp4", self._sample(), "video/mp4")},
            data={"name": "Reel proof", "tags": "reel"},
            headers=self.headers,
        )
        self.assertEqual(response.status_code, 201, response.text)
        asset = response.json()["asset"]
        self.assertEqual(asset["media_type"], "video")
        self.assertEqual(asset["mime_type"], "video/mp4")
        self.assertGreater(asset["duration_seconds"], 0)
        self.assertTrue(asset["poster_url"].startswith("/media/library/posters/"))
        self.assertTrue(asset["url"].startswith("/media/library/videos/"))

        streamed = self.client.get(asset["url"])
        self.assertEqual(streamed.status_code, 200, streamed.text)
        self.assertGreater(len(streamed.content), 0)
        poster = self.client.get(asset["poster_url"])
        self.assertEqual(poster.status_code, 200, poster.text)

        deleted = self.client.delete(
            f"/api/v1/restaurant/media/assets/{asset['id']}", headers=self.headers
        )
        self.assertEqual(deleted.status_code, 204, deleted.text)
        self.assertEqual(self.client.get(asset["url"]).status_code, 404)

    def test_fake_video_is_rejected(self):
        response = self.client.post(
            "/api/v1/restaurant/media/assets",
            files={"file": ("fake.mp4", b"\x00\x00\x00\x18ftypmp42not-a-video", "video/mp4")},
            headers=self.headers,
        )
        self.assertEqual(response.status_code, 422, response.text)


if __name__ == "__main__":
    unittest.main()
