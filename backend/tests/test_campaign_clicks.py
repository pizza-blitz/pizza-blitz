"""Campaign tracked links: click redirect, counters and engagement reporting."""

import unittest
from datetime import datetime, timedelta

from fastapi.testclient import TestClient

from app.core.clock import business_today
from app.core.config import settings
from app.db.session import SessionLocal
from app.main import app
from app.models.domain import CampaignDelivery, Customer, Promotion


class CampaignClickTest(unittest.TestCase):
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
        self.phone = "9123400999"

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

    def _promo(self, code: str) -> int:
        today = business_today()
        response = self.client.post(
            "/api/v1/restaurant/promotions/",
            json={
                "name": f"Click Campaign {code}",
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
        self.assertEqual(response.status_code, 200, response.text)
        self.promo_id = response.json()["promotion"]["id"]
        return self.promo_id

    def test_click_redirect_counts_and_engagement(self):
        promo_id = self._promo("CLICK10")
        db = SessionLocal()
        try:
            customer = Customer(
                name="Click Guest", phone=self.phone, opt_in_marketing=True
            )
            db.add(customer)
            db.commit()
            db.refresh(customer)
            delivery = CampaignDelivery(
                promotion_id=promo_id,
                customer_id=customer.id,
                channel="whatsapp",
                destination=self.phone,
                message="Tracked send",
                status="sent",
                tracking_token="click-token-proof",
                attempted_at=datetime.utcnow() - timedelta(hours=1),
            )
            db.add(delivery)
            db.commit()
            self.delivery_ids = [delivery.id]
        finally:
            db.close()

        redirect = self.client.get(
            "/api/v1/restaurant/promotions/track/click-token-proof",
            follow_redirects=False,
        )
        self.assertEqual(redirect.status_code, 307, redirect.text)
        location = redirect.headers["location"]
        self.assertIn("coupon=CLICK10", location)
        self.assertIn("utm_campaign=", location)
        second = self.client.get(
            "/api/v1/restaurant/promotions/track/click-token-proof",
            follow_redirects=False,
        )
        self.assertEqual(second.status_code, 307, second.text)

        db = SessionLocal()
        try:
            row = (
                db.query(CampaignDelivery)
                .filter(CampaignDelivery.id == self.delivery_ids[0])
                .first()
            )
            self.assertEqual(row.click_count, 2)
            self.assertIsNotNone(row.clicked_at)
        finally:
            db.close()

        performance = self.client.get(
            f"/api/v1/restaurant/promotions/performance/{promo_id}",
            headers=self.headers,
        )
        self.assertEqual(performance.status_code, 200, performance.text)
        engagement = performance.json()["engagement"]
        self.assertEqual(engagement["sent"], 1)
        self.assertEqual(engagement["clicked"], 1)
        self.assertEqual(engagement["click_count"], 2)
        self.assertEqual(engagement["click_rate_percent"], 100.0)

    def test_dry_run_send_embeds_tracking_link(self):
        promo_id = self._promo("CLICKSEND10")
        db = SessionLocal()
        try:
            db.add(
                Customer(
                    name="Dry Run Guest", phone=self.phone, opt_in_marketing=True
                )
            )
            db.commit()
        finally:
            db.close()
        response = self.client.post(
            f"/api/v1/restaurant/promotions/{promo_id}/send",
            json={"dry_run": True, "limit": 1},
            headers=self.headers,
        )
        self.assertEqual(response.status_code, 200, response.text)
        deliveries = response.json()["deliveries"]
        self.assertEqual(len(deliveries), 1)
        delivery = deliveries[0]
        self.assertTrue(delivery["tracking_url"])
        self.assertIn("/track/", delivery["tracking_url"])
        self.assertIn("/track/", delivery["message"])
        self.assertEqual(delivery["click_count"], 0)

        db = SessionLocal()
        try:
            rows = (
                db.query(CampaignDelivery)
                .filter(CampaignDelivery.promotion_id == promo_id)
                .all()
            )
            self.delivery_ids = [row.id for row in rows]
        finally:
            db.close()

    def test_unknown_tracking_token_is_404(self):
        response = self.client.get(
            "/api/v1/restaurant/promotions/track/not-a-token",
            follow_redirects=False,
        )
        self.assertEqual(response.status_code, 404, response.text)


if __name__ == "__main__":
    unittest.main()
