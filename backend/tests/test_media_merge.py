"""Merge ordered library videos into a new stitched clip."""

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
class MediaMergeTest(unittest.TestCase):
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

    def _sample(self, size: str = "320x240", seconds: int = 1) -> bytes:
        with tempfile.TemporaryDirectory() as temp_dir:
            target = Path(temp_dir) / "sample.mp4"
            subprocess.run(  # noqa: S603
                [
                    shutil.which("ffmpeg"),
                    "-y",
                    "-f",
                    "lavfi",
                    "-i",
                    f"color=c=#e64a19:s={size}:d={seconds}",
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

    def _upload(self, name: str, size: str = "320x240", seconds: int = 1) -> dict:
        response = self.client.post(
            "/api/v1/restaurant/media/assets",
            files={"file": (f"{name}.mp4", self._sample(size, seconds), "video/mp4")},
            data={"name": name},
            headers=self.headers,
        )
        self.assertEqual(response.status_code, 201, response.text)
        asset = response.json()["asset"]
        self.asset_ids.append(asset["id"])
        return asset

    def test_merge_stitches_in_order(self):
        first = self._upload("First clip")
        second = self._upload("Second clip")
        response = self.client.post(
            "/api/v1/restaurant/media/assets/merge",
            json={
                "asset_ids": [first["id"], second["id"]],
                "name": "Merged proof",
            },
            headers=self.headers,
        )
        self.assertEqual(response.status_code, 201, response.text)
        merged = response.json()["asset"]
        self.asset_ids.append(merged["id"])
        self.assertEqual(merged["name"], "Merged proof")
        self.assertEqual(merged["media_type"], "video")
        self.assertNotIn(merged["url"], {first["url"], second["url"]})
        self.assertGreater(merged["duration_seconds"], 1.5)
        self.assertLess(merged["duration_seconds"], 3.0)
        self.assertIn("merged", merged["tags"])
        streamed = self.client.get(merged["url"])
        self.assertEqual(streamed.status_code, 200, streamed.text)

    def test_merge_offsets_source_captions(self):
        first = self._upload("Caption one")
        second = self._upload("Caption two")
        for asset, text in (
            (first, b"WEBVTT\n\n00:00:00.200 --> 00:00:00.600\nFirst caption\n"),
            (second, b"WEBVTT\n\n00:00:00.100 --> 00:00:00.400\nSecond caption\n"),
        ):
            caption = self.client.post(
                f"/api/v1/restaurant/media/assets/{asset['id']}/caption",
                files={"file": ("clip.vtt", text, "text/vtt")},
                headers=self.headers,
            )
            self.assertEqual(caption.status_code, 201, caption.text)

        response = self.client.post(
            "/api/v1/restaurant/media/assets/merge",
            json={"asset_ids": [first["id"], second["id"]], "name": "Captioned merge"},
            headers=self.headers,
        )
        self.assertEqual(response.status_code, 201, response.text)
        merged = response.json()["asset"]
        self.asset_ids.append(merged["id"])
        self.assertTrue(merged["caption_url"])
        body = self.client.get(merged["caption_url"]).text
        self.assertIn("First caption", body)
        self.assertIn("Second caption", body)
        self.assertIn("00:00:00.200 --> 00:00:00.600", body)
        self.assertRegex(body, r"00:00:01\.\d{3} --> 00:00:01\.\d{3}")

    def test_fade_transition_shortens_timeline(self):
        first = self._upload("Fade first", seconds=2)
        second = self._upload("Fade second", seconds=2)
        response = self.client.post(
            "/api/v1/restaurant/media/assets/merge",
            json={
                "asset_ids": [first["id"], second["id"]],
                "name": "Faded proof",
                "transition": "fade",
                "transition_seconds": 0.5,
            },
            headers=self.headers,
        )
        self.assertEqual(response.status_code, 201, response.text)
        merged = response.json()["asset"]
        self.asset_ids.append(merged["id"])
        self.assertGreater(merged["duration_seconds"], 3.0)
        self.assertLess(merged["duration_seconds"], 4.0)
        streamed = self.client.get(merged["url"])
        self.assertEqual(streamed.status_code, 200, streamed.text)

    def test_fade_rejects_three_clips(self):
        clips = [self._upload(f"Fade extra {index}") for index in range(3)]
        response = self.client.post(
            "/api/v1/restaurant/media/assets/merge",
            json={
                "asset_ids": [clip["id"] for clip in clips],
                "transition": "fade",
            },
            headers=self.headers,
        )
        self.assertEqual(response.status_code, 422, response.text)

    def test_merge_rejects_mismatched_or_duplicate_clips(self):
        first = self._upload("Wide clip", "320x240")
        second = self._upload("Tall clip", "240x320")
        mismatch = self.client.post(
            "/api/v1/restaurant/media/assets/merge",
            json={"asset_ids": [first["id"], second["id"]]},
            headers=self.headers,
        )
        self.assertEqual(mismatch.status_code, 422, mismatch.text)
        duplicate = self.client.post(
            "/api/v1/restaurant/media/assets/merge",
            json={"asset_ids": [first["id"], first["id"]]},
            headers=self.headers,
        )
        self.assertEqual(duplicate.status_code, 422, duplicate.text)


if __name__ == "__main__":
    unittest.main()
