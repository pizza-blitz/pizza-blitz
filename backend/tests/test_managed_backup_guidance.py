import unittest
from unittest.mock import patch

from app.services import ops_service


class ManagedBackupGuidanceTest(unittest.TestCase):
    def test_managed_database_backup_returns_guidance_without_fake_run(self):
        with patch.object(ops_service, "database_backend", return_value="postgresql"):
            backup = ops_service.create_database_backup(None)

        self.assertIsNone(backup["id"])
        self.assertEqual(backup["backup_type"], "external")
        self.assertEqual(backup["status"], "external_required")
        self.assertEqual(backup["database_backend"], "postgresql")
        self.assertIn("managed database snapshots", backup["error"])


if __name__ == "__main__":
    unittest.main()
