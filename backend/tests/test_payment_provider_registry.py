"""Encrypted payment credentials drive checkout status and direct-bank details."""

import unittest

from fastapi.testclient import TestClient

from app.db.session import SessionLocal
from app.main import app
from app.models.domain import ProviderSetting
from app.services import payment_gateway
from app.services.billing_settings_service import update_settings
from app.services.provider_settings_service import save_provider


class PaymentProviderRegistryTest(unittest.TestCase):
    def setUp(self):
        self._ctx = TestClient(app)
        self.client = self._ctx.__enter__()

    def tearDown(self):
        session = SessionLocal()
        try:
            session.query(ProviderSetting).filter(
                ProviderSetting.provider.in_(["cashfree", "razorpay", "direct_bank"])
            ).delete(synchronize_session=False)
            session.commit()
        finally:
            session.close()
        self._ctx.__exit__(None, None, None)

    def test_registry_drives_cashfree_status_and_direct_bank_session(self):
        session = SessionLocal()
        try:
            save_provider(
                session,
                "cashfree",
                values={
                    "CASHFREE_APP_ID": "cf_registry_app",
                    "CASHFREE_SECRET_KEY": "cf_registry_secret",
                    "CASHFREE_WEBHOOK_SECRET": "cf_webhook_secret",
                    "CASHFREE_ENVIRONMENT": "sandbox",
                },
                enabled=True,
            )
            status = payment_gateway.payment_provider_status("cashfree")
            self.assertTrue(status["checkout_configured"], status)
            self.assertTrue(status["webhook_configured"], status)

            save_provider(
                session,
                "direct_bank",
                values={
                    "DIRECT_BANK_UPI_ID": "pizzablitz@upi",
                    "DIRECT_BANK_ACCOUNT_NAME": "Pizza Blitz",
                },
                enabled=True,
            )
        finally:
            session.close()

        session = payment_gateway.create_payment_session(
            order_id=501,
            amount=299,
            customer_name="Registry Guest",
            customer_phone="+91 98888 77777",
            provider="direct_bank",
        )
        self.assertEqual(session["provider"], "direct_bank")
        self.assertEqual(session["checkout_payload"]["upi_id"], "pizzablitz@upi")
        self.assertEqual(
            session["checkout_payload"]["account_name"], "Pizza Blitz"
        )
        self.assertEqual(session["status"], "ready")

    def test_direct_bank_is_unconfigured_without_values(self):
        status = payment_gateway.payment_provider_status("direct_bank")
        self.assertFalse(status["checkout_configured"])
        self.assertTrue(status["missing_checkout_settings"])

    def test_active_payment_provider_routes_new_sessions(self):
        session = SessionLocal()
        try:
            save_provider(
                session,
                "direct_bank",
                values={"DIRECT_BANK_UPI_ID": "routing@upi"},
                enabled=True,
            )
            update_settings(
                session,
                {
                    "tax_rate": 5,
                    "tax_label": "GST",
                    "invoice_footer": None,
                    "tip_presets": [0, 5, 10, 15],
                    "payment_provider": "direct_bank",
                },
            )
            active = payment_gateway.payment_provider_status()
            self.assertEqual(active["provider"], "direct_bank")
            self.assertTrue(active["checkout_configured"])

            payment_session = payment_gateway.create_payment_session(
                order_id=777,
                amount=199,
                customer_name="Routing Guest",
                customer_phone="+91 90000 00001",
            )
            self.assertEqual(payment_session["provider"], "direct_bank")
            self.assertEqual(
                payment_session["checkout_payload"]["upi_id"], "routing@upi"
            )
        finally:
            update_settings(
                session,
                {
                    "tax_rate": 5,
                    "tax_label": "GST",
                    "invoice_footer": None,
                    "tip_presets": [0, 5, 10, 15],
                    "payment_provider": "manual",
                },
            )
            session.close()
        self.assertEqual(payment_gateway.payment_provider_status()["provider"], "manual")


if __name__ == "__main__":
    unittest.main()
