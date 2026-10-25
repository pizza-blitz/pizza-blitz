"""Configurable billing settings propagate to orders, invoices and the storefront."""

import os
import unittest

os.environ.setdefault("PYTHONDONTWRITEBYTECODE", "1")

from fastapi.testclient import TestClient

from app.core.config import settings
from app.main import app


def order_payload(phone: str) -> dict:
    return {
        "order_type": "takeaway",
        "customer_name": "Tax Config Guest",
        "customer_phone": phone,
        "payment_method": "cash",
        "items": [{"name": "Garlic Bread", "quantity": 2, "price": 119}],
    }


class BillingSettingsTest(unittest.TestCase):
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
        self.assertEqual(login.status_code, 200, login.text)
        self.headers = {"Authorization": f"Bearer {login.json()['access_token']}"}

    def tearDown(self):
        self.client.put(
            "/api/v1/restaurant/billing-settings/",
            json={
                "tax_rate": 5,
                "tax_label": "GST",
                "invoice_footer": None,
                "tip_presets": [0, 5, 10, 15],
            },
            headers=self.headers,
        )
        self._ctx.__exit__(None, None, None)

    def test_tax_rate_applies_to_order_and_invoice(self):
        initial = self.client.get(
            "/api/v1/restaurant/billing-settings/", headers=self.headers
        )
        self.assertEqual(initial.status_code, 200, initial.text)
        self.assertEqual(initial.json()["settings"]["tax_rate"], 5)

        saved = self.client.put(
            "/api/v1/restaurant/billing-settings/",
            json={
                "tax_rate": 12,
                "tax_label": "VAT",
                "invoice_footer": "Thanks for eating at Pizza Blitz.",
                "tip_presets": [0, 10, 20],
            },
            headers=self.headers,
        )
        self.assertEqual(saved.status_code, 200, saved.text)
        self.assertEqual(saved.json()["settings"]["tax_rate"], 12)
        self.assertEqual(saved.json()["settings"]["tip_presets"], [0, 10, 20])

        public = self.client.get("/api/v1/restaurant/billing-settings/public")
        self.assertEqual(public.status_code, 200, public.text)
        self.assertEqual(public.json()["settings"]["tax_rate"], 12)
        bootstrap = self.client.get("/api/v1/restaurant/storefront/bootstrap")
        self.assertEqual(bootstrap.json()["billing"]["tax_rate"], 12)

        created = self.client.post(
            "/api/v1/restaurant/orders/", json=order_payload("9812346111")
        )
        self.assertEqual(created.status_code, 200, created.text)
        order = created.json()
        self.assertAlmostEqual(order["tax"], 28.56, places=2)

        invoice = self.client.post(
            f"/api/v1/restaurant/orders/{order['order_id']}/invoice",
            headers=self.headers,
        )
        self.assertEqual(invoice.status_code, 200, invoice.text)
        self.assertAlmostEqual(invoice.json()["cgst"], 14.28, places=2)
        self.assertAlmostEqual(invoice.json()["sgst"], 14.28, places=2)

    def test_service_charge_and_slab_apply_to_order(self):
        saved = self.client.put(
            "/api/v1/restaurant/billing-settings/",
            json={
                "tax_rate": 5,
                "tax_label": "GST",
                "invoice_footer": None,
                "tip_presets": [0, 5, 10, 15],
                "service_charge_rate": 10,
                "service_charge_label": "Service charge",
                "tax_slabs": [
                    {"threshold": 0, "rate": 5},
                    {"threshold": 200, "rate": 12},
                ],
            },
            headers=self.headers,
        )
        self.assertEqual(saved.status_code, 200, saved.text)
        self.assertEqual(saved.json()["settings"]["service_charge_rate"], 10)
        self.assertEqual(len(saved.json()["settings"]["tax_slabs"]), 2)

        created = self.client.post(
            "/api/v1/restaurant/orders/", json=order_payload("9812346222")
        )
        self.assertEqual(created.status_code, 200, created.text)
        order = created.json()
        self.assertAlmostEqual(order["subtotal"], 238, places=2)
        self.assertAlmostEqual(order["service_charge"], 23.8, places=2)
        self.assertAlmostEqual(order["tax"], 31.42, places=2)
        self.assertAlmostEqual(order["total"], 293.22, places=2)

    def test_tax_inclusive_prices_extract_tax_without_adding_it(self):
        saved = self.client.put(
            "/api/v1/restaurant/billing-settings/",
            json={
                "tax_rate": 5,
                "tax_label": "GST",
                "invoice_footer": None,
                "tip_presets": [0, 5, 10, 15],
                "prices_include_tax": True,
            },
            headers=self.headers,
        )
        self.assertEqual(saved.status_code, 200, saved.text)
        self.assertTrue(saved.json()["settings"]["prices_include_tax"])

        created = self.client.post(
            "/api/v1/restaurant/orders/", json=order_payload("9812346333")
        )
        self.assertEqual(created.status_code, 200, created.text)
        order = created.json()
        self.assertAlmostEqual(order["subtotal"], 238, places=2)
        self.assertAlmostEqual(order["tax"], 11.33, places=2)
        self.assertAlmostEqual(order["total"], 238, places=2)

    def test_staff_cannot_change_billing_settings(self):
        staff_login = self.client.post(
            "/api/v1/auth/staff/login",
            json={
                "id": settings.PIZZA_BLITZ_STAFF_ID,
                "password": settings.PIZZA_BLITZ_STAFF_PASSWORD,
            },
        )
        headers = {"Authorization": f"Bearer {staff_login.json()['access_token']}"}
        self.assertEqual(
            self.client.get(
                "/api/v1/restaurant/billing-settings/", headers=headers
            ).status_code,
            403,
        )
        self.assertEqual(
            self.client.put(
                "/api/v1/restaurant/billing-settings/",
                json={
                    "tax_rate": 18,
                    "tax_label": "GST",
                    "tip_presets": [0, 5],
                },
                headers=headers,
            ).status_code,
            403,
        )


if __name__ == "__main__":
    unittest.main()
