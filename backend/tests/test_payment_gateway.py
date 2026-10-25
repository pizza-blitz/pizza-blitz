import hashlib
import hmac
import unittest
from unittest.mock import patch

from app.core.config import settings
from app.db.session import SessionLocal
from app.models.domain import BillingSettings
from app.services import payment_gateway


class PaymentGatewayProviderTest(unittest.TestCase):
    def setUp(self):
        self.original_values = {
            "PAYMENT_PROVIDER": settings.PAYMENT_PROVIDER,
            "PAYMENT_CURRENCY": settings.PAYMENT_CURRENCY,
            "CASHFREE_APP_ID": settings.CASHFREE_APP_ID,
            "CASHFREE_SECRET_KEY": settings.CASHFREE_SECRET_KEY,
            "CASHFREE_WEBHOOK_SECRET": settings.CASHFREE_WEBHOOK_SECRET,
            "CASHFREE_ENVIRONMENT": settings.CASHFREE_ENVIRONMENT,
            "CASHFREE_API_VERSION": settings.CASHFREE_API_VERSION,
            "CASHFREE_BASE_URL": settings.CASHFREE_BASE_URL,
            "RAZORPAY_KEY_ID": settings.RAZORPAY_KEY_ID,
            "RAZORPAY_KEY_SECRET": settings.RAZORPAY_KEY_SECRET,
            "RAZORPAY_WEBHOOK_SECRET": settings.RAZORPAY_WEBHOOK_SECRET,
            "RAZORPAY_BASE_URL": settings.RAZORPAY_BASE_URL,
        }

    def tearDown(self):
        for key, value in self.original_values.items():
            setattr(settings, key, value)
        session = SessionLocal()
        try:
            row = session.query(BillingSettings).first()
            if row is not None:
                row.payment_provider = None
                session.commit()
        finally:
            session.close()

    def test_cashfree_session_creates_provider_order(self):
        settings.PAYMENT_CURRENCY = "INR"
        settings.CASHFREE_APP_ID = "cf_app"
        settings.CASHFREE_SECRET_KEY = "cf_secret"
        settings.CASHFREE_ENVIRONMENT = "sandbox"
        settings.CASHFREE_API_VERSION = "2025-01-01"
        settings.CASHFREE_BASE_URL = "https://sandbox.cashfree.com/pg"

        with patch.object(payment_gateway, "_post_json") as post_json:
            post_json.return_value = (
                200,
                {
                    "order_id": "PB_42_1770000000",
                    "payment_session_id": "session_abc123",
                    "payment_link": "https://payments.example/checkout",
                },
            )

            session = payment_gateway.create_payment_session(
                order_id=42,
                amount=221.5,
                customer_name="Gateway Guest",
                customer_phone="+91 98765 43210",
                provider="cashfree",
                return_url="http://localhost:3011/account",
            )

        self.assertEqual(session["provider"], "cashfree")
        self.assertEqual(session["status"], "ready")
        self.assertEqual(session["session_id"], "PB_42_1770000000")
        self.assertEqual(session["provider_order_id"], "PB_42_1770000000")
        self.assertEqual(session["payment_session_id"], "session_abc123")
        self.assertEqual(session["checkout_payload"]["mode"], "sandbox")

        url, payload, headers = post_json.call_args.args
        self.assertEqual(url, "https://sandbox.cashfree.com/pg/orders")
        self.assertEqual(payload["order_currency"], "INR")
        self.assertEqual(payload["order_tags"]["order_id"], "42")
        self.assertEqual(payload["customer_details"]["customer_phone"], "9876543210")
        self.assertEqual(headers["x-api-version"], "2025-01-01")
        self.assertEqual(headers["x-client-id"], "cf_app")

    def test_public_checkout_uses_cash_only_until_real_gateway_is_ready(self):
        settings.PAYMENT_PROVIDER = "manual"
        manual = payment_gateway.public_payment_checkout_status()
        self.assertTrue(manual["cash_available"])
        self.assertFalse(manual["prepaid_available"])
        self.assertIsNone(manual["provider"])
        self.assertEqual(manual["mode"], "cash_only")
        self.assertNotIn("missing_checkout_settings", manual)

        settings.PAYMENT_PROVIDER = "cashfree"
        settings.CASHFREE_APP_ID = "cf_app"
        settings.CASHFREE_SECRET_KEY = "cf_secret"
        settings.CASHFREE_WEBHOOK_SECRET = None
        unsigned = payment_gateway.public_payment_checkout_status()
        self.assertFalse(unsigned["prepaid_available"])

        settings.CASHFREE_WEBHOOK_SECRET = "cf_webhook"
        ready = payment_gateway.public_payment_checkout_status()
        self.assertTrue(ready["prepaid_available"])
        self.assertEqual(ready["provider"], "cashfree")
        self.assertEqual(ready["mode"], "online_gateway")

    def test_razorpay_session_creates_provider_order_and_verifies_signature(self):
        settings.PAYMENT_CURRENCY = "INR"
        settings.RAZORPAY_KEY_ID = "rzp_test_key"
        settings.RAZORPAY_KEY_SECRET = "rzp_secret"
        settings.RAZORPAY_BASE_URL = "https://api.razorpay.com"

        with patch.object(payment_gateway, "_post_json") as post_json:
            post_json.return_value = (
                200,
                {
                    "id": "order_test_001",
                    "amount": 12345,
                    "currency": "INR",
                    "status": "created",
                },
            )

            session = payment_gateway.create_payment_session(
                order_id=77,
                amount=123.45,
                customer_name="Razor Guest",
                customer_phone="9555555555",
                provider="razorpay",
                return_url=None,
            )

        self.assertEqual(session["provider"], "razorpay")
        self.assertEqual(session["session_id"], "order_test_001")
        self.assertEqual(session["checkout_payload"]["key"], "rzp_test_key")
        self.assertEqual(session["checkout_payload"]["amount"], 12345)
        self.assertEqual(session["checkout_payload"]["order_id"], "order_test_001")

        url, payload, headers = post_json.call_args.args
        self.assertEqual(url, "https://api.razorpay.com/v1/orders")
        self.assertEqual(payload["amount"], 12345)
        self.assertEqual(payload["notes"]["order_id"], "77")
        self.assertTrue(headers["Authorization"].startswith("Basic "))

        signature = hmac.new(
            b"rzp_secret",
            b"order_test_001|pay_test_001",
            hashlib.sha256,
        ).hexdigest()
        self.assertTrue(
            payment_gateway.verify_razorpay_checkout_signature(
                provider_order_id="order_test_001",
                provider_payment_id="pay_test_001",
                provider_signature=signature,
            )
        )
        self.assertFalse(
            payment_gateway.verify_razorpay_checkout_signature(
                provider_order_id="order_test_001",
                provider_payment_id="pay_test_001",
                provider_signature="bad-signature",
            )
        )


if __name__ == "__main__":
    unittest.main()
