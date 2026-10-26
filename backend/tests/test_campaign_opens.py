"""Email open pixels and open-rate engagement reporting."""

import unittest
from datetime import datetime, timedelta

from fastapi.testclient import TestClient

from app.core.clock import business_today
from app.core.config import settings
from app.db.session import SessionLocal
from app.main import app
from app.models.domain import CampaignDelivery, Customer, Promotion


class CampaignOpenTest(unittest.TestCase):
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
        self.delivery_ids: list[int] = []
        self.phone = "9123400771"

    def tearDown(self):
        db = SessionLocal()
        try:
            if self.delivery_ids:
                db.query(CampaignDelivery).filter(
                    CampaignDelivery.id.in_(self.delivery_ids)
                ).delete(synchronize_session=False)
            db.query(Customer).filter(Customer.phone == self.phone).delete()
            if self.promo_id is not None:
                db.query(Promotion).filter(Promotion.id == self.promo_id).delete()
            db.commit()
        finally:
            db.close()
        self._ctx.__exit__(None, None, None)

    def _delivery(self, token: str = "") -> int:
        token = token or "open-token-proof"
        today = business_today()
        promo = self.client.post(
            "/api/v1/restaurant/promotions/",
            json={
                "name": "Open Campaign",
                "code": "OPEN10",
                "start_date": today.isoformat(),
                "end_date": (today + timedelta(days=5)).isoformat(),
                "discount_type": "percentage",
                "discount_value": 10,
                "audience": "marketing_opt_in",
                "channel": "email",
                "status": "active",
            },
            headers=self.headers,
        )
        self.assertEqual(promo.status_code, 200, promo.text)
        self.promo_id = promo.json()["promotion"]["id"]
        db = SessionLocal()
        try:
            customer = Customer(
                name="Open Guest", phone=self.phone, opt_in_marketing=True
            )
            db.add(customer)
            db.commit()
            db.refresh(customer)
            delivery = CampaignDelivery(
                promotion_id=self.promo_id,
                customer_id=customer.id,
                channel="email",
                destination="open-guest@example.com",
                message="Email send",
                status="sent",
                open_token=token,
                attempted_at=datetime.utcnow() - timedelta(hours=1),
            )
            db.add(delivery)
            db.commit()
            self.delivery_ids = [delivery.id]
            return delivery.id
        finally:
            db.close()

    def test_open_pixel_counts_and_engagement(self):
        self._delivery()
        first = self.client.get("/api/v1/restaurant/promotions/open/open-token-proof.png")
        self.assertEqual(first.status_code, 200, first.text)
        self.assertEqual(first.headers["content-type"], "image/gif")
        self.assertIn("no-store", first.headers.get("cache-control", ""))
        self.assertGreater(len(first.content), 0)
        second = self.client.get(
            "/api/v1/restaurant/promotions/open/open-token-proof.png"
        )
        self.assertEqual(second.status_code, 200, second.text)

        db = SessionLocal()
        try:
            row = (
                db.query(CampaignDelivery)
                .filter(CampaignDelivery.id == self.delivery_ids[0])
                .first()
            )
            self.assertEqual(row.open_count, 2)
            self.assertIsNotNone(row.opened_at)
        finally:
            db.close()

        performance = self.client.get(
            f"/api/v1/restaurant/promotions/performance/{self.promo_id}",
            headers=self.headers,
        )
        self.assertEqual(performance.status_code, 200, performance.text)
        engagement = performance.json()["engagement"]
        self.assertEqual(engagement["opened"], 1)
        self.assertEqual(engagement["open_count"], 2)
        self.assertEqual(engagement["open_rate_percent"], 100.0)

    def test_unknown_open_pixel_is_404(self):
        response = self.client.get(
            "/api/v1/restaurant/promotions/open/not-an-open-token.png"
        )
        self.assertEqual(response.status_code, 404, response.text)


if __name__ == "__main__":
    unittest.main()
