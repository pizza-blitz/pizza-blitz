"""Customer OTP login tests."""

import os
import unittest
from unittest.mock import patch

os.environ.setdefault("PYTHONDONTWRITEBYTECODE", "1")

from fastapi.testclient import TestClient

from app.core.config import settings
from app.main import app


def order_payload(phone: str = "9812345673") -> dict:
    return {
        "order_type": "takeaway",
        "customer_name": "OTP Guest",
        "customer_phone": phone,
        "payment_method": "cash",
        "items": [{"name": "Garlic Bread", "quantity": 1, "price": 119}],
    }


class CustomerOtpTest(unittest.TestCase):
    def setUp(self):
        self._ctx = TestClient(app)
        self.client = self._ctx.__enter__()

    def tearDown(self):
        self._ctx.__exit__(None, None, None)

    def request_code(self, phone: str):
        return self.client.post(
            "/api/v1/auth/customer/otp/request", json={"phone": phone}
        )

    def test_request_and_verify_code(self):
        phone = "9812345673"
        requested = self.request_code(phone)
        self.assertEqual(requested.status_code, 200, requested.text)
        payload = requested.json()
        self.assertTrue(payload["sent"])
        self.assertIn("debug_code", payload)
        code = payload["debug_code"]

        wrong = self.client.post(
            "/api/v1/auth/customer/otp/verify",
            json={"phone": phone, "code": "000000"},
        )
        self.assertEqual(wrong.status_code, 401)

        verified = self.client.post(
            "/api/v1/auth/customer/otp/verify",
            json={"phone": phone, "code": code},
        )
        self.assertEqual(verified.status_code, 200, verified.text)
        data = verified.json()
        self.assertEqual(data["role"], "customer")
        self.assertEqual(data["phone"], phone)
        self.assertTrue(data["access_token"])

        reused = self.client.post(
            "/api/v1/auth/customer/otp/verify",
            json={"phone": phone, "code": code},
        )
        self.assertEqual(reused.status_code, 401)

    def test_phone_only_login_is_rejected(self):
        response = self.client.post(
            "/api/v1/auth/customer/login", json={"phone": "9812345673"}
        )
        self.assertEqual(response.status_code, 401)
        self.assertIn("one-time", response.json()["detail"].lower())

    def test_order_proof_login_still_works(self):
        phone = "9812345674"
        created = self.client.post(
            "/api/v1/restaurant/orders/", json=order_payload(phone)
        )
        self.assertEqual(created.status_code, 200, created.text)
        order_id = created.json()["order_id"]

        mismatch = self.client.post(
            "/api/v1/auth/customer/login",
            json={"phone": "9812345675", "order_id": order_id},
        )
        self.assertEqual(mismatch.status_code, 401)

        login = self.client.post(
            "/api/v1/auth/customer/login",
            json={"phone": phone, "order_id": order_id},
        )
        self.assertEqual(login.status_code, 200, login.text)
        self.assertEqual(login.json()["role"], "customer")

    def test_invalid_phone_and_code_shapes(self):
        self.assertEqual(
            self.request_code("12").status_code,
            422,
        )
        requested = self.request_code("9812345676").json()
        self.assertEqual(
            self.client.post(
                "/api/v1/auth/customer/otp/verify",
                json={"phone": "9812345676", "code": "abc"},
            ).status_code,
            401,
        )
        self.assertTrue(requested["debug_code"])

    def test_staging_never_returns_debug_code(self):
        with patch.object(settings, "ENVIRONMENT", "staging"), patch.object(
            settings, "CUSTOMER_OTP_DEBUG_ENABLED", True
        ):
            requested = self.request_code("9812345677")

        self.assertEqual(requested.status_code, 200, requested.text)
        self.assertNotIn("debug_code", requested.json())
        self.assertEqual(requested.json()["delivery"], "sent")


if __name__ == "__main__":
    unittest.main()
