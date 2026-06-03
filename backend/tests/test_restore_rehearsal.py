import unittest

from app.core.config import settings
from app.services import ops_service


class SQLiteRestoreRehearsalTest(unittest.TestCase):
    def test_restore_rehearsal_requires_file_backed_sqlite(self):
        old_uri = settings.SQLALCHEMY_DATABASE_URI
        try:
            settings.SQLALCHEMY_DATABASE_URI = "sqlite:///:memory:"
            with self.assertRaisesRegex(ValueError, "file-backed SQLite"):
                ops_service.run_sqlite_restore_rehearsal(None)
        finally:
            settings.SQLALCHEMY_DATABASE_URI = old_uri

    def test_restore_rehearsal_uses_actual_order_table_name(self):
        self.assertIn("orders", ops_service.RESTORE_REHEARSAL_REQUIRED_TABLES)
        self.assertNotIn("restaurant_orders", ops_service.RESTORE_REHEARSAL_REQUIRED_TABLES)


if __name__ == "__main__":
    unittest.main()
