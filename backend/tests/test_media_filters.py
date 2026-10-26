"""Video filter presets render a new filtered asset."""

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
class MediaFilterTest(unittest.TestCase):
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
        self.asset_ids: list[int] = []

    def tearDown(self):
        for asset_id in self.asset_ids:
            self.client.delete(
                f"/api/v1/restaurant/media/assets/{asset_id}", headers=self.headers
            )
        self._ctx.__exit__(None, None, None)

    def _upload(self) -> dict:
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
            data = target.read_bytes()
        response = self.client.post(
            "/api/v1/restaurant/media/assets",
            files={"file": ("filter-source.mp4", data, "video/mp4")},
            data={"name": "Filter source"},
            headers=self.headers,
        )
        self.assertEqual(response.status_code, 201, response.text)
        asset = response.json()["asset"]
        self.asset_ids.append(asset["id"])
        return asset

    def test_grayscale_filter_creates_new_video(self):
        source = self._upload()
        response = self.client.post(
            f"/api/v1/restaurant/media/assets/{source['id']}/filter",
            json={"preset": "grayscale", "name": "Grayscale proof"},
            headers=self.headers,
        )
        self.assertEqual(response.status_code, 201, response.text)
        filtered = response.json()["asset"]
        self.asset_ids.append(filtered["id"])
        self.assertEqual(filtered["name"], "Grayscale proof")
        self.assertEqual(filtered["media_type"], "video")
        self.assertNotEqual(filtered["url"], source["url"])
        self.assertGreater(filtered["duration_seconds"], 0)
        self.assertIn("filtered", filtered["tags"])
        self.assertIn("grayscale", filtered["tags"])
        streamed = self.client.get(filtered["url"])
        self.assertEqual(streamed.status_code, 200, streamed.text)

    def test_unknown_filter_is_rejected(self):
        source = self._upload()
        response = self.client.post(
            f"/api/v1/restaurant/media/assets/{source['id']}/filter",
            json={"preset": "not-a-filter"},
            headers=self.headers,
        )
        self.assertEqual(response.status_code, 422, response.text)


if __name__ == "__main__":
    unittest.main()
