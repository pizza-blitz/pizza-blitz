"""S3-compatible public media storage with CDN URLs and local fallback."""

import os
import unittest
from unittest.mock import patch

from app.services import media_storage
from app.services.media_service import save_library_image

PNG = (
    b"\x89PNG\r\n\x1a\n"
    b"\x00\x00\x00\rIHDR"
    b"\x00\x00\x00\x01\x00\x00\x00\x01\x08\x06\x00\x00\x00"
)


class MediaStorageTest(unittest.TestCase):
    def setUp(self):
        self.env = {
            "MEDIA_STORAGE_BACKEND": "s3",
            "S3_BUCKET": "pizza-media",
            "S3_REGION": "ap-south-1",
            "S3_ACCESS_KEY_ID": "test-key",
            "S3_SECRET_ACCESS_KEY": "test-secret",
            "S3_PUBLIC_BASE_URL": "https://cdn.pizzablitz.example",
            "S3_PREFIX": "prod",
        }
        media_storage._client.cache_clear()

    def tearDown(self):
        media_storage._client.cache_clear()
        for key in self.env:
            os.environ.pop(key, None)
        os.environ.pop("S3_ENDPOINT_URL", None)

    def test_cdn_url_key_prefix_and_upload_delete(self):
        calls = {}

        class FakeClient:
            def put_object(self, **kwargs):
                calls["put"] = kwargs

            def delete_object(self, **kwargs):
                calls["delete"] = kwargs

        with patch.dict(os.environ, self.env), patch.object(
            media_storage, "_client", return_value=FakeClient()
        ):
            url = media_storage.upload_bytes(
                "library/pizza.png", PNG, "image/png"
            )
            self.assertEqual(
                url, "https://cdn.pizzablitz.example/prod/library/pizza.png"
            )
            self.assertEqual(calls["put"]["Key"], "prod/library/pizza.png")
            self.assertEqual(calls["put"]["ContentType"], "image/png")
            self.assertEqual(calls["put"]["CacheControl"], "public, max-age=31536000, immutable")
            self.assertTrue(media_storage.delete_url(url))
            self.assertEqual(calls["delete"]["Key"], "prod/library/pizza.png")
            status = media_storage.storage_status()
            self.assertEqual(status["backend"], "s3")
            self.assertTrue(status["configured"])
            self.assertTrue(status["cdn_enabled"])

    def test_s3_upload_is_used_by_library_image(self):
        with patch.dict(os.environ, self.env), patch(
            "app.services.media_service.is_s3", return_value=True
        ), patch(
            "app.services.media_service.upload_bytes",
            return_value="https://cdn.pizzablitz.example/prod/library/pic.png",
        ) as upload:
            url, file_name, mime = save_library_image(PNG, "pic.png")
        self.assertEqual(url, "https://cdn.pizzablitz.example/prod/library/pic.png")
        self.assertTrue(file_name.endswith(".png"))
        self.assertEqual(mime, "image/png")
        upload.assert_called_once()
        self.assertTrue(upload.call_args.args[0].startswith("library/"))

    def test_missing_bucket_config_fails_loudly(self):
        with patch.dict(
            os.environ,
            {"MEDIA_STORAGE_BACKEND": "s3"},
            clear=False,
        ):
            os.environ.pop("S3_BUCKET", None)
            os.environ.pop("S3_ACCESS_KEY_ID", None)
            os.environ.pop("S3_SECRET_ACCESS_KEY", None)
            with self.assertRaises(RuntimeError):
                media_storage.validate_media_storage()

    def test_local_fallback_is_default(self):
        with patch.dict(os.environ, {}, clear=False):
            os.environ.pop("MEDIA_STORAGE_BACKEND", None)
            status = media_storage.storage_status()
        self.assertEqual(status["backend"], "local")
        self.assertTrue(status["configured"])


if __name__ == "__main__":
    unittest.main()
