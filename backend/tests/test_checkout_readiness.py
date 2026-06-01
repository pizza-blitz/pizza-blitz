import os
import unittest
from unittest.mock import patch

from fastapi.testclient import TestClient

from app.api.api_v1.endpoints.orders import checkout_readiness_payload
from app.core.config import settings
from app.main import app


class CheckoutReadinessTest(unittest.TestCase):
    def test_local_sqlite_allows_development_orders(self):
        with (
            patch.object(settings, "ENVIRONMENT", "development"),
            patch.object(settings, "SQLALCHEMY_DATABASE_URI", "sqlite:///local.sqlite"),
            patch.dict(os.environ, {"VERCEL": "", "VERCEL_ENV": ""}, clear=False),
        ):
            readiness = checkout_readiness_payload()

        self.assertTrue(readiness["accepting_orders"])
        self.assertEqual(readiness["status"], "accepting_orders")

    def test_cloud_sqlite_is_preview_only_and_rejects_order_capture(self):
        with (
            patch.object(settings, "ENVIRONMENT", "development"),
            patch.object(settings, "SQLALCHEMY_DATABASE_URI", "sqlite:///:memory:"),
            patch.dict(os.environ, {"VERCEL": "1", "VERCEL_ENV": "production"}, clear=False),
            TestClient(app) as client,
        ):
            readiness = client.get("/api/v1/restaurant/orders/checkout-readiness")
            create = client.post(
                "/api/v1/restaurant/orders/",
                json={
                    "order_type": "takeaway",
                    "customer_name": "Preview Safety Proof",
                    "customer_phone": "9400000001",
                    "items": [{"name": "Margherita Pizza", "quantity": 1, "price": 199}],
                },
            )

        self.assertEqual(readiness.status_code, 200)
        self.assertFalse(readiness.json()["accepting_orders"])
        self.assertEqual(readiness.json()["status"], "storefront_preview")
        self.assertEqual(create.status_code, 503)
        self.assertIn("being activated", create.json()["detail"])

    def test_cloud_postgresql_enables_order_capture_contract(self):
        with (
            patch.object(settings, "ENVIRONMENT", "production"),
            patch.object(settings, "SQLALCHEMY_DATABASE_URI", "postgresql://user:password@example.com/pizza"),
            patch.dict(os.environ, {"VERCEL": "1", "VERCEL_ENV": "production"}, clear=False),
        ):
            readiness = checkout_readiness_payload()

        self.assertTrue(readiness["accepting_orders"])
        self.assertTrue(readiness["database_ready"])
        self.assertEqual(readiness["status"], "accepting_orders")


if __name__ == "__main__":
    unittest.main()
