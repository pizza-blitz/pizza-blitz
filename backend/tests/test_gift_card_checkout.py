"""Gift card payment at customer checkout and refund credit-back."""

import os
import unittest

os.environ.setdefault("PYTHONDONTWRITEBYTECODE", "1")

from fastapi.testclient import TestClient

from app.core.config import settings
from app.db.session import SessionLocal
from app.main import app
from app.models.domain import GiftCard, GiftCardTransaction

BASE = "/api/v1/restaurant"


def order_payload(**overrides) -> dict:
    payload = {
        "order_type": "takeaway",
        "customer_name": "Gift Card Guest",
        "customer_phone": "9876501234",
        "payment_method": "cash",
        "items": [{"name": "Garlic Bread", "quantity": 2, "price": 119}],
    }
    payload.update(overrides)
    return payload


class GiftCardCheckoutTest(unittest.TestCase):
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
        issued = self.client.post(
            f"{BASE}/gift-cards/",
            json={"initial_balance": 5000, "note": "Checkout test"},
            headers=self.headers,
        )
        self.assertEqual(issued.status_code in {200, 201}, True, issued.text)
        self.card = issued.json()
        self.code = self.card["code"]

    def tearDown(self):
        self._ctx.__exit__(None, None, None)

    def test_gift_card_pays_the_order_and_reports_remaining_balance(self):
        created = self.client.post(
            f"{BASE}/orders/",
            json=order_payload(gift_card_code=self.code),
        )
        self.assertEqual(created.status_code, 200, created.text)
        data = created.json()
        self.assertTrue(data["gift_card_applied"])
        self.assertEqual(data["payment_status"], "paid")
        total = round(float(data["total"]), 2)
        self.assertAlmostEqual(
            float(data["gift_card_balance"]), round(5000 - total, 2), places=2
        )

        db = SessionLocal()
        try:
            card = db.query(GiftCard).filter(GiftCard.code == self.code).first()
            self.assertIsNotNone(card)
            self.assertAlmostEqual(float(card.balance), round(5000 - total, 2), places=2)
            redeem = (
                db.query(GiftCardTransaction)
                .filter(
                    GiftCardTransaction.gift_card_id == card.id,
                    GiftCardTransaction.kind == "redeem",
                )
                .first()
            )
            self.assertIsNotNone(redeem)
            self.assertAlmostEqual(float(redeem.amount), total, places=2)
            self.assertEqual(redeem.order_id, data["order_id"])
        finally:
            db.close()

        fetched = self.client.get(
            f"{BASE}/orders/{data['order_id']}", headers=self.headers
        )
        self.assertEqual(fetched.status_code, 200, fetched.text)
        self.assertEqual(fetched.json()["payment_method"], "gift_card")

    def test_insufficient_balance_is_rejected_without_creating_an_order(self):
        small = self.client.post(
            f"{BASE}/gift-cards/",
            json={"initial_balance": 1},
            headers=self.headers,
        )
        self.assertIn(small.status_code, {200, 201}, small.text)
        created = self.client.post(
            f"{BASE}/orders/",
            json=order_payload(gift_card_code=small.json()["code"]),
        )
        self.assertEqual(created.status_code, 422, created.text)
        self.assertIn("less than the order total", created.json()["detail"])

    def test_refund_with_gift_card_method_credits_the_card(self):
        created = self.client.post(
            f"{BASE}/orders/",
            json=order_payload(gift_card_code=self.code),
        )
        self.assertEqual(created.status_code, 200, created.text)
        data = created.json()
        refund_amount = 50
        refunded = self.client.post(
            f"{BASE}/orders/{data['order_id']}/refunds",
            json={
                "amount": refund_amount,
                "reason": "Goodwill adjustment",
                "method": "gift_card",
            },
            headers=self.headers,
        )
        self.assertEqual(refunded.status_code, 200, refunded.text)
        body = refunded.json()
        self.assertAlmostEqual(float(body["gift_card_refunded"]), 50.0, places=2)
        self.assertAlmostEqual(
            float(body["order"]["refunded_amount"]), 50.0, places=2
        )

        db = SessionLocal()
        try:
            card = db.query(GiftCard).filter(GiftCard.code == self.code).first()
            expected = round(
                float(data["gift_card_balance"]) + refund_amount, 2
            )
            self.assertAlmostEqual(float(card.balance), expected, places=2)
        finally:
            db.close()

    def test_unknown_gift_card_code_is_rejected(self):
        created = self.client.post(
            f"{BASE}/orders/",
            json=order_payload(gift_card_code="PB-NOTREAL"),
        )
        self.assertEqual(created.status_code, 404, created.text)


if __name__ == "__main__":
    unittest.main()
