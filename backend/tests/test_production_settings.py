"""Production secret configuration guard tests."""

import os
import unittest
from unittest.mock import patch

os.environ.setdefault("PYTHONDONTWRITEBYTECODE", "1")

from app.core.config import settings, validate_production_settings


class ProductionSecretGuardTest(unittest.TestCase):
    def setUp(self):
        self.original = {
            "ENVIRONMENT": settings.ENVIRONMENT,
            "AUTH_SECRET_KEY": settings.AUTH_SECRET_KEY,
            "RESTAURANT_ADMIN_PASSWORD": settings.RESTAURANT_ADMIN_PASSWORD,
            "PIZZA_BLITZ_ADMIN_PASSWORD": settings.PIZZA_BLITZ_ADMIN_PASSWORD,
            "PIZZA_BLITZ_SESSION_SECRET": settings.PIZZA_BLITZ_SESSION_SECRET,
            "SQLALCHEMY_DATABASE_URI": settings.SQLALCHEMY_DATABASE_URI,
        }

    def tearDown(self):
        for name, value in self.original.items():
            setattr(settings, name, value)

    def use_strong_secrets(self) -> None:
        settings.ENVIRONMENT = "production"
        settings.AUTH_SECRET_KEY = "a-strong-random-auth-secret-value"
        settings.RESTAURANT_ADMIN_PASSWORD = "a-strong-admin-password"
        settings.PIZZA_BLITZ_ADMIN_PASSWORD = "a-strong-admin-password"
        settings.PIZZA_BLITZ_SESSION_SECRET = "a-strong-session-secret"

    def test_development_allows_local_defaults(self):
        settings.ENVIRONMENT = "development"
        validate_production_settings()

    def test_production_rejects_default_secrets(self):
        settings.ENVIRONMENT = "production"
        settings.AUTH_SECRET_KEY = "pizza-blitz-local-secret"
        settings.RESTAURANT_ADMIN_PASSWORD = "admin123"
        settings.PIZZA_BLITZ_ADMIN_PASSWORD = "admin123"
        settings.PIZZA_BLITZ_SESSION_SECRET = None

        with self.assertRaises(RuntimeError) as context:
            validate_production_settings()
        message = str(context.exception)
        self.assertIn("AUTH_SECRET_KEY", message)
        self.assertIn("RESTAURANT_ADMIN_PASSWORD", message)
        self.assertIn("PIZZA_BLITZ_SESSION_SECRET", message)

    def test_production_accepts_strong_secrets(self):
        self.use_strong_secrets()
        settings.SQLALCHEMY_DATABASE_URI = (
            "postgresql+psycopg2://restaurant:secret@127.0.0.1:5432/pizza_blitz"
        )

        validate_production_settings()

    def test_production_rejects_sqlite_database(self):
        """A production boot on SQLite would keep the restaurant's orders in RAM."""
        self.use_strong_secrets()
        settings.SQLALCHEMY_DATABASE_URI = "sqlite:///:memory:"

        with self.assertRaises(RuntimeError) as context:
            validate_production_settings()
        message = str(context.exception)
        self.assertIn("SQLALCHEMY_DATABASE_URI", message)
        self.assertIn("Postgres", message)

    def test_development_allows_sqlite_database(self):
        settings.ENVIRONMENT = "development"
        settings.SQLALCHEMY_DATABASE_URI = "sqlite:///:memory:"

        validate_production_settings()

    def test_vercel_preview_on_sqlite_still_boots(self):
        """A Vercel preview shows the storefront and refuses orders separately.

        `checkout_readiness_payload()` answers 503 rather than letting preview
        orders land in a database that disappears, which is why the startup guard
        keys on ENVIRONMENT=production and not on the VERCEL flag.
        """
        self.use_strong_secrets()
        settings.ENVIRONMENT = "development"
        settings.SQLALCHEMY_DATABASE_URI = "sqlite:///:memory:"

        with patch.dict(os.environ, {"VERCEL": "1"}, clear=False):
            validate_production_settings()


if __name__ == "__main__":
    unittest.main()
