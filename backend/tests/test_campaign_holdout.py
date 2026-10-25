"""Deterministic campaign holdouts and treated-vs-holdout experiment reporting."""

import unittest
from datetime import datetime, timedelta

from fastapi.testclient import TestClient

from app.core.clock import business_today
from app.core.config import settings
from app.db.session import SessionLocal
from app.main import app
from app.models.domain import CampaignDelivery, Customer, Promotion, RestaurantOrder
from app.services.holdout_service import select_holdout_ids


class CampaignHoldoutTest(unittest.TestCase):
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
        self.phones = ["9123400881", "9123400882"]

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
            db.query(Customer).filter(Customer.phone.in_(self.phones)).delete(
                synchronize_session=False
            )
            if self.promo_id is not None:
                db.query(Promotion).filter(Promotion.id == self.promo_id).delete()
            db.commit()
        finally:
            db.close()
        self._ctx.__exit__(None, None, None)

    def test_holdout_selection_is_deterministic_and_bounded(self):
        ids = list(range(1, 1001))
        first = select_holdout_ids(42, ids, 20)
        second = select_holdout_ids(42, ids, 20)
        self.assertEqual(first, second)
        self.assertGreater(len(first), 120)
        self.assertLess(len(first), 280)
        self.assertEqual(select_holdout_ids(42, ids, 0), set())
        capped = select_holdout_ids(42, ids, 90)
        self.assertLessEqual(len(capped), 500)

    def test_treated_vs_holdout_incremental_revenue(self):
        today = business_today()
        promo = self.client.post(
            "/api/v1/restaurant/promotions/",
            json={
                "name": "Holdout Experiment",
                "code": "HOLDOUT10",
                "start_date": today.isoformat(),
                "end_date": (today + timedelta(days=5)).isoformat(),
                "discount_type": "percentage",
                "discount_value": 10,
                "audience": "marketing_opt_in",
                "channel": "whatsapp",
                "status": "active",
                "holdout_percent": 50,
            },
            headers=self.headers,
        )
        self.assertEqual(promo.status_code, 200, promo.text)
        self.promo_id = promo.json()["promotion"]["id"]
        self.assertEqual(promo.json()["promotion"]["holdout_percent"], 50)

        db = SessionLocal()
        try:
            treated_customer = Customer(
                name="Treated Guest", phone=self.phones[0], opt_in_marketing=True
            )
            holdout_customer = Customer(
                name="Holdout Guest", phone=self.phones[1], opt_in_marketing=True
            )
            db.add_all([treated_customer, holdout_customer])
            db.commit()
            db.refresh(treated_customer)
            db.refresh(holdout_customer)
            now = datetime.utcnow()
            sent = CampaignDelivery(
                promotion_id=self.promo_id,
                customer_id=treated_customer.id,
                channel="whatsapp",
                destination=self.phones[0],
                message="Treated send",
                status="sent",
                attempted_at=now - timedelta(hours=3),
            )
            holdout = CampaignDelivery(
                promotion_id=self.promo_id,
                customer_id=holdout_customer.id,
                channel="whatsapp",
                destination=self.phones[1],
                message="Holdout assignment",
                status="holdout",
                attempted_at=now - timedelta(hours=3),
            )
            db.add_all([sent, holdout])
            db.commit()
            self.delivery_ids = [sent.id, holdout.id]
        finally:
            db.close()

        order = self.client.post(
            "/api/v1/restaurant/orders/",
            json={
                "order_type": "takeaway",
                "customer_name": "Treated Guest",
                "customer_phone": self.phones[0],
                "payment_method": "upi",
                "coupon_code": "HOLDOUT10",
                "items": [{"name": "Margherita Pizza (R)", "quantity": 2, "price": 199}],
            },
            headers=self.headers,
        )
        self.assertEqual(order.status_code, 200, order.text)
        self.order_id = order.json()["order_id"]

        performance = self.client.get(
            f"/api/v1/restaurant/promotions/performance/{self.promo_id}",
            headers=self.headers,
        )
        self.assertEqual(performance.status_code, 200, performance.text)
        experiment = performance.json()["holdout_experiment"]
        self.assertTrue(experiment["enabled"])
        self.assertEqual(experiment["treated"]["customers"], 1)
        self.assertEqual(experiment["treated"]["converted"], 1)
        self.assertEqual(experiment["holdout"]["customers"], 1)
        self.assertEqual(experiment["holdout"]["converted"], 0)
        self.assertGreater(experiment["incremental_revenue"], 0)
        self.assertAlmostEqual(
            experiment["incremental_revenue"],
            experiment["treated"]["revenue"],
            places=2,
        )

    def test_holdout_percent_is_capped(self):
        today = business_today()
        response = self.client.post(
            "/api/v1/restaurant/promotions/",
            json={
                "name": "Holdout Too Large",
                "start_date": today.isoformat(),
                "end_date": (today + timedelta(days=1)).isoformat(),
                "holdout_percent": 51,
            },
            headers=self.headers,
        )
        self.assertEqual(response.status_code, 422, response.text)


if __name__ == "__main__":
    unittest.main()
