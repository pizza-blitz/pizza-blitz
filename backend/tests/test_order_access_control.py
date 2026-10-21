"""Access-control regression tests for customer order history and order detail.

These cover the hardening that stopped anonymous phone-number lookups from
returning a customer's orders, address, and spend totals.
"""

import base64
import hashlib
import hmac
import json
import os
import unittest

os.environ.setdefault("PYTHONDONTWRITEBYTECODE", "1")

from fastapi.testclient import TestClient

from app.core.config import settings
from app.main import app

CUSTOMER_PHONE = "9333333333"
OTHER_PHONE = "9444444444"


def portal_cookie_token(payload: dict) -> str:
    secret = settings.PIZZA_BLITZ_ADMIN_PASSWORD
    payload_part = (
        base64.urlsafe_b64encode(json.dumps(payload).encode("utf-8"))
        .decode("utf-8")
        .rstrip("=")
    )
    signature = hmac.new(
        secret.encode("utf-8"), payload_part.encode("utf-8"), hashlib.sha256
    ).digest()
    signature_part = base64.urlsafe_b64encode(signature).decode("utf-8").rstrip("=")
    return f"{payload_part}.{signature_part}"


def customer_cookie(phone: str) -> dict:
    token = portal_cookie_token(
        {
            "role": "customer",
            "subject": f"customer:{phone}",
            "displayName": "History Probe",
            "phone": phone,
            "exp": 9999999999,
        }
    )
    return {"pb_customer_session": token}


class OrderAccessControlTest(unittest.TestCase):
    def _create_order(self, client: TestClient, phone: str) -> int:
        created = client.post(
            "/api/v1/restaurant/orders/",
            json={
                "order_type": "takeaway",
                "customer_name": "Access Probe",
                "customer_phone": phone,
                "payment_method": "cash",
                "items": [{"name": "Garlic Bread", "quantity": 1, "price": 119}],
            },
        )
        self.assertEqual(created.status_code, 200, created.text)
        return created.json()["order_id"]

    def test_anonymous_lookup_requires_ownership_proof(self):
        with TestClient(app) as client:
            order_id = self._create_order(client, CUSTOMER_PHONE)

            anonymous_detail = client.get(f"/api/v1/restaurant/orders/{order_id}")
            self.assertEqual(anonymous_detail.status_code, 401)

            anonymous_history = client.get(
                f"/api/v1/restaurant/orders/customer-history/{CUSTOMER_PHONE}"
            )
            self.assertEqual(anonymous_history.status_code, 401)

            wrong_proof = client.get(
                f"/api/v1/restaurant/orders/customer-history/{CUSTOMER_PHONE}",
                params={"order_id": order_id + 9999},
            )
            self.assertEqual(wrong_proof.status_code, 401)

            matching_proof = client.get(
                f"/api/v1/restaurant/orders/customer-history/{CUSTOMER_PHONE}",
                params={"order_id": order_id},
            )
            self.assertEqual(matching_proof.status_code, 200, matching_proof.text)
            self.assertEqual(matching_proof.json()["customer"]["phone"], CUSTOMER_PHONE)

            other_phone_proof = client.get(
                f"/api/v1/restaurant/orders/customer-history/{OTHER_PHONE}",
                params={"order_id": order_id},
            )
            self.assertEqual(other_phone_proof.status_code, 401)

    def test_customer_session_is_scoped_to_its_own_phone(self):
        with TestClient(app) as client:
            order_id = self._create_order(client, CUSTOMER_PHONE)
            own_session = client.get(
                f"/api/v1/restaurant/orders/customer-history/{CUSTOMER_PHONE}",
                cookies=customer_cookie(CUSTOMER_PHONE),
            )
            self.assertEqual(own_session.status_code, 200, own_session.text)

            cross_account = client.get(
                f"/api/v1/restaurant/orders/customer-history/{OTHER_PHONE}",
                cookies=customer_cookie(CUSTOMER_PHONE),
            )
            self.assertEqual(cross_account.status_code, 403)

            # A signed session cookie is not an order-detail grant.
            detail_with_customer_cookie = client.get(
                f"/api/v1/restaurant/orders/{order_id}",
                cookies=customer_cookie(CUSTOMER_PHONE),
            )
            self.assertEqual(detail_with_customer_cookie.status_code, 403)

    def test_staff_session_keeps_full_read_access(self):
        with TestClient(app) as client:
            order_id = self._create_order(client, CUSTOMER_PHONE)
            login = client.post(
                "/api/v1/auth/admin/login",
                json={
                    "id": settings.PIZZA_BLITZ_ADMIN_ID,
                    "password": settings.PIZZA_BLITZ_ADMIN_PASSWORD,
                },
            )
            self.assertEqual(login.status_code, 200)
            client.headers.update(
                {"Authorization": f"Bearer {login.json()['access_token']}"}
            )

            detail = client.get(f"/api/v1/restaurant/orders/{order_id}")
            self.assertEqual(detail.status_code, 200)
            self.assertEqual(detail.json()["customer_phone"], CUSTOMER_PHONE)

            history = client.get(
                f"/api/v1/restaurant/orders/customer-history/{CUSTOMER_PHONE}"
            )
            self.assertEqual(history.status_code, 200)
            self.assertTrue(history.json()["orders"])


if __name__ == "__main__":
    unittest.main()
