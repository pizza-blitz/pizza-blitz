import unittest
from unittest.mock import patch

from fastapi.testclient import TestClient

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


if __name__ == "__main__":
    unittest.main()
