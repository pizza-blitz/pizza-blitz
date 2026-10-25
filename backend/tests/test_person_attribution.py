"""Person-level first/last/linear attribution for coupon campaigns."""

import unittest
from datetime import datetime, timedelta

from fastapi.testclient import TestClient

from app.core.clock import business_today
from app.core.config import settings
from app.db.session import SessionLocal
from app.main import app
from app.models.domain import CampaignDelivery, Customer, Promotion, RestaurantOrder


class PersonAttributionTest(unittest.TestCase):
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
        self.headers = {"Authorization": f"Bearer {login.json()['access_token']}"}
        self.promo_id = None
        self.order_id = None
        self.delivery_ids: list[int] = []
        self.phone = "9123400777"

    def tearDown(self):
        db = SessionLocal()
        try:
            if self.delivery_ids:
                db.query(CampaignDelivery).filter(
                    CampaignDelivery.id.in_(self.delivery_ids)
                ).delete(synchronize_session=False)
            if self.order_id is not None:
                db.query(RestaurantOrder).filter(
                    RestaurantOrder.id == self.order_id
                ).delete()
            db.query(Customer).filter(Customer.phone == self.phone).delete()
            if self.promo_id is not None:
                db.query(Promotion).filter(Promotion.id == self.promo_id).delete()
            db.commit()
        finally:
            db.close()
        self._ctx.__exit__(None, None, None)

    def _seed(self, code: str) -> dict:
        today = business_today()
        promo = self.client.post(
            "/api/v1/restaurant/promotions/",
            json={
                "name": f"Person Attribution {code}",
                "code": code,
                "start_date": today.isoformat(),
                "end_date": (today + timedelta(days=5)).isoformat(),
                "discount_type": "percentage",
                "discount_value": 10,
                "audience": "marketing_opt_in",
                "channel": "whatsapp",
                "status": "active",
            },
            headers=self.headers,
        )
        self.assertEqual(promo.status_code, 200, promo.text)
        self.promo_id = promo.json()["promotion"]["id"]
        order = self.client.post(
            "/api/v1/restaurant/orders/",
            json={
                "order_type": "takeaway",
                "customer_name": "Person Attribution Guest",
                "customer_phone": self.phone,
                "payment_method": "upi",
                "coupon_code": code.lower(),
                "items": [
                    {"name": "Margherita Pizza (R)", "quantity": 2, "price": 199}
                ],
            },
            headers=self.headers,
        )
        self.assertEqual(order.status_code, 200, order.text)
        self.order_id = order.json()["order_id"]
        db = SessionLocal()
        try:
            customer = db.query(Customer).filter(Customer.phone == self.phone).first()
            self.assertIsNotNone(customer)
            now = datetime.utcnow()
            first = CampaignDelivery(
                promotion_id=self.promo_id,
                customer_id=customer.id,
                channel="whatsapp",
                destination=self.phone,
                message="WhatsApp send",
                status="sent",
                attempted_at=now - timedelta(hours=3),
            )
            second = CampaignDelivery(
                promotion_id=self.promo_id,
                customer_id=customer.id,
                channel="sms",
                destination=self.phone,
                message="SMS send",
                status="sent",
                attempted_at=now - timedelta(hours=1),
            )
            db.add_all([first, second])
            db.commit()
            self.delivery_ids = [first.id, second.id]
            return {"customer_id": customer.id}
        finally:
            db.close()

    def test_first_last_linear_credit_from_sends(self):
        self._seed("PERSON10")
        performance = self.client.get(
            f"/api/v1/restaurant/promotions/performance/{self.promo_id}",
            headers=self.headers,
        )
        self.assertEqual(performance.status_code, 200, performance.text)
        person = performance.json()["person_attribution"]
        self.assertEqual(person["model"], "person_level_multi_touch")
        self.assertEqual(person["converted_customers"], 1)
        self.assertEqual(person["touch_count"], 2)
        self.assertEqual(person["unmatched_orders"], 0)
        self.assertEqual(person["first_touch"]["channels"][0]["channel"], "whatsapp")
        self.assertEqual(person["last_touch"]["channels"][0]["channel"], "sms")
        linear = {row["channel"]: row for row in person["linear"]["channels"]}
        self.assertAlmostEqual(linear["whatsapp"]["credit_revenue"], 188.06, places=2)
        self.assertAlmostEqual(linear["sms"]["credit_revenue"], 188.06, places=2)
        self.assertAlmostEqual(person["linear"]["attributed_revenue"], 376.11, places=2)

    def test_no_send_falls_back_to_coupon(self):
        today = business_today()
        promo = self.client.post(
            "/api/v1/restaurant/promotions/",
            json={
                "name": "Person Attribution Fallback",
                "code": "PERSONFB10",
                "start_date": today.isoformat(),
                "end_date": (today + timedelta(days=5)).isoformat(),
                "discount_type": "percentage",
                "discount_value": 10,
                "status": "active",
            },
            headers=self.headers,
        )
        self.promo_id = promo.json()["promotion"]["id"]
        order = self.client.post(
            "/api/v1/restaurant/orders/",
            json={
                "order_type": "takeaway",
                "customer_name": "Fallback Guest",
                "customer_phone": self.phone,
                "payment_method": "upi",
                "coupon_code": "PERSONFB10",
                "items": [{"name": "Margherita Pizza (R)", "quantity": 1, "price": 199}],
            },
            headers=self.headers,
        )
        self.assertEqual(order.status_code, 200, order.text)
        self.order_id = order.json()["order_id"]
        performance = self.client.get(
            f"/api/v1/restaurant/promotions/performance/{self.promo_id}",
            headers=self.headers,
        )
        person = performance.json()["person_attribution"]
        self.assertEqual(person["touch_count"], 0)
        self.assertEqual(person["first_touch"]["channels"][0]["channel"], "coupon")
        self.assertEqual(person["last_touch"]["channels"][0]["channel"], "coupon")


if __name__ == "__main__":
    unittest.main()
