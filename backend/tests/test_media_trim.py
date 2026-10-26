"""Trim library videos into new clips with poster/duration metadata."""

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
class MediaTrimTest(unittest.TestCase):
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

    def _sample(self, seconds: int = 3) -> bytes:
        with tempfile.TemporaryDirectory() as temp_dir:
            target = Path(temp_dir) / "sample.mp4"
            subprocess.run(  # noqa: S603
                [
                    shutil.which("ffmpeg"),
                    "-y",
                    "-f",
                    "lavfi",
                    "-i",
                    f"color=c=#e64a19:s=320x240:d={seconds}",
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

    def _upload(self) -> dict:
        response = self.client.post(
            "/api/v1/restaurant/media/assets",
            files={"file": ("trim-source.mp4", self._sample(), "video/mp4")},
            data={"name": "Trim source", "tags": "reel"},
            headers=self.headers,
        )
        self.assertEqual(response.status_code, 201, response.text)
        asset = response.json()["asset"]
        self.asset_ids.append(asset["id"])
        return asset

    def test_trim_creates_short_clip_with_metadata(self):
        source = self._upload()
        response = self.client.post(
            f"/api/v1/restaurant/media/assets/{source['id']}/trim",
            json={"start_seconds": 0.5, "end_seconds": 1.5, "name": "Trimmed proof"},
            headers=self.headers,
        )
        self.assertEqual(response.status_code, 201, response.text)
        trimmed = response.json()["asset"]
        self.asset_ids.append(trimmed["id"])
        self.assertEqual(trimmed["name"], "Trimmed proof")
        self.assertEqual(trimmed["media_type"], "video")
        self.assertNotEqual(trimmed["url"], source["url"])
        self.assertLess(trimmed["duration_seconds"], 2.0)
        self.assertGreater(trimmed["duration_seconds"], 0.4)
        self.assertTrue(trimmed["poster_url"])
        self.assertIn("trimmed", trimmed["tags"])
        streamed = self.client.get(trimmed["url"])
        self.assertEqual(streamed.status_code, 200, streamed.text)

    def test_trim_rejects_bad_range(self):
        source = self._upload()
        too_long = self.client.post(
            f"/api/v1/restaurant/media/assets/{source['id']}/trim",
            json={"start_seconds": 0, "end_seconds": 30},
            headers=self.headers,
        )
        self.assertEqual(too_long.status_code, 422, too_long.text)
        inverted = self.client.post(
            f"/api/v1/restaurant/media/assets/{source['id']}/trim",
            json={"start_seconds": 2, "end_seconds": 1},
            headers=self.headers,
        )
        self.assertEqual(inverted.status_code, 422, inverted.text)

    def test_trim_re_times_source_captions(self):
        source = self._upload()
        caption = self.client.post(
            f"/api/v1/restaurant/media/assets/{source['id']}/caption",
            files={
                "file": (
                    "source.vtt",
                    b"WEBVTT\n\n"
                    b"00:00:00.300 --> 00:00:00.900\nEarly line\n\n"
                    b"00:00:01.000 --> 00:00:01.800\nMiddle line\n\n"
                    b"00:00:02.200 --> 00:00:02.900\nLate line\n",
                    "text/vtt",
                )
            },
            headers=self.headers,
        )
        self.assertEqual(caption.status_code, 201, caption.text)

        trimmed = self.client.post(
            f"/api/v1/restaurant/media/assets/{source['id']}/trim",
            json={"start_seconds": 0.5, "end_seconds": 2.0, "name": "Captioned trim"},
            headers=self.headers,
        )
        self.assertEqual(trimmed.status_code, 201, trimmed.text)
        asset = trimmed.json()["asset"]
        self.asset_ids.append(asset["id"])
        self.assertTrue(asset["caption_url"])
        served = self.client.get(asset["caption_url"])
        self.assertEqual(served.status_code, 200, served.text)
        body = served.text
        self.assertIn("Early line", body)
        self.assertIn("Middle line", body)
        self.assertNotIn("Late line", body)
        self.assertIn("00:00:00.000 --> 00:00:00.400", body)
        self.assertIn("00:00:00.500 --> 00:00:01.300", body)


if __name__ == "__main__":
    unittest.main()
