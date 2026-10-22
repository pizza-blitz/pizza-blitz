import unittest
from types import SimpleNamespace
from unittest.mock import patch

from fastapi.testclient import TestClient

from app.api.api_v1.endpoints.storefront import is_public_storefront_promotion
from app.main import app


class PublicCatalogReadPathTest(unittest.TestCase):
    def test_seeded_public_catalog_reads_do_not_reseed_defaults(self):
        with TestClient(app) as client:
            with patch(
                "app.services.menu_customization_service.seed_default_customizations"
            ) as seed_customizations:
                menu = client.get("/api/v1/restaurant/menu/menu-with-customizations")

            with patch(
                "app.api.api_v1.endpoints.delivery.ensure_delivery_zones"
            ) as seed_delivery_zones:
                zones = client.get("/api/v1/restaurant/delivery/zones")

        self.assertEqual(menu.status_code, 200)
        self.assertEqual(len(menu.json()), 10)
        self.assertGreater(len(zones.json()), 0)
        seed_customizations.assert_not_called()
        seed_delivery_zones.assert_not_called()

    def test_storefront_bootstrap_returns_customer_order_dependencies_together(self):
        with TestClient(app) as client:
            response = client.get("/api/v1/restaurant/storefront/bootstrap")

        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertEqual(len(payload["menu"]), 10)
        # Internal cost data must never reach the public storefront.
        self.assertTrue(all("cost_price" not in item for item in payload["menu"]))
        self.assertIn("accepting_orders", payload["checkout_readiness"])
        self.assertIn("cash_available", payload["payment_checkout"])
        self.assertIn("prepaid_available", payload["payment_checkout"])
        self.assertNotIn("missing_checkout_settings", payload["payment_checkout"])
        self.assertNotIn("missing_webhook_settings", payload["payment_checkout"])
        self.assertGreater(len(payload["delivery_zones"]), 0)
        self.assertLessEqual(len(payload["active_promotions"]), 8)

    def test_storefront_offer_hygiene_keeps_targeted_and_verification_campaigns_internal(self):
        public_offer = SimpleNamespace(
            name="Weekend Family Combo",
            description="Save on a family meal this weekend.",
            code="FAMILY20",
            audience="all_customers",
        )
        targeted_offer = SimpleNamespace(
            name="VIP Party Pack",
            description="Private retention offer.",
            code="VIP20",
            audience="vip_guests",
        )
        verification_offer = SimpleNamespace(
            name="Customer Checkout Proof 123456",
            description="E2E customer checkout coupon proof",
            code="CHK123456",
            audience="all_customers",
        )

        self.assertTrue(is_public_storefront_promotion(public_offer))
        self.assertFalse(is_public_storefront_promotion(targeted_offer))
        self.assertFalse(is_public_storefront_promotion(verification_offer))


if __name__ == "__main__":
    unittest.main()
