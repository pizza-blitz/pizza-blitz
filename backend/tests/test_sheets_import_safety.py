"""Security regressions for the Google Sheets importer.

The importer fetches spreadsheet URLs server-side, so it must never become an
SSRF probe that can reach arbitrary hosts or internal metadata endpoints.
"""

import unittest
from unittest import mock

from app.services.sheets_service import SheetsService


class SheetsImportUrlSafetyTest(unittest.TestCase):
    def setUp(self):
        self.service = SheetsService()

    def test_rejects_non_google_hosts(self):
        with self.assertRaises(ValueError):
            self.service._fetch_public_text("https://evil.example/export?format=csv")

    def test_rejects_plain_http_even_on_google_hosts(self):
        with self.assertRaises(ValueError):
            self.service._fetch_public_text("http://docs.google.com/spreadsheets/d/abc/export?format=csv")

    def test_rejects_cloud_metadata_addresses(self):
        with self.assertRaises(ValueError):
            self.service._fetch_public_text("https://169.254.169.254/latest/meta-data/")

    def test_rejects_public_csv_import_from_other_hosts(self):
        with self.assertRaises(ValueError):
            self.service.fetch_public_csv_rows("https://evil.example/export?format=csv&gid=0")

    def test_builds_export_urls_on_google_hosts_only(self):
        export_url = self.service.public_csv_export_url(
            "https://evil.example/spreadsheets/d/sheet-123/edit?gid=42"
        )
        self.assertTrue(export_url.startswith("https://docs.google.com/spreadsheets/d/sheet-123/export"))
        self.assertIn("gid=42", export_url)

    def test_rejects_urls_without_a_sheet_id(self):
        with self.assertRaises(ValueError):
            self.service.public_csv_export_url("https://docs.google.com/spreadsheets/")

    def test_discover_gids_normalizes_foreign_urls_to_google_host(self):
        with mock.patch.object(
            self.service, "_fetch_public_text", return_value="gid=123"
        ) as fetch:
            self.service.discover_public_gids("https://evil.example/spreadsheets/d/abc/edit")
        fetched_url = fetch.call_args.args[0]
        self.assertTrue(fetched_url.startswith("https://docs.google.com/"))


if __name__ == "__main__":
    unittest.main()
