"""Production secret configuration guard tests."""

import os
import unittest

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
        }

    def tearDown(self):
        for name, value in self.original.items():
            setattr(settings, name, value)

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
        settings.ENVIRONMENT = "production"
        settings.AUTH_SECRET_KEY = "a-strong-random-auth-secret-value"
        settings.RESTAURANT_ADMIN_PASSWORD = "a-strong-admin-password"
        settings.PIZZA_BLITZ_ADMIN_PASSWORD = "a-strong-admin-password"
        settings.PIZZA_BLITZ_SESSION_SECRET = "a-strong-session-secret"

        validate_production_settings()


if __name__ == "__main__":
    unittest.main()
