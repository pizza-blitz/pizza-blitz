import unittest
from datetime import date, timedelta

from fastapi.testclient import TestClient

from app.db.session import SessionLocal
from app.main import app
from app.models.domain import AdCampaign, Customer, Promotion, RestaurantOrder, SocialPost


class PromotionPerformanceReportingTest(unittest.TestCase):
    def test_coupon_order_updates_promotion_performance_report(self):
        today = date.today()
        promo_id = None
        order_id = None
        post_id = None
        campaign_id = None

        with TestClient(app) as client:
            try:
                promo = client.post(
                    "/api/v1/restaurant/promotions/",
                    json={
                        "name": "Attribution Combo",
                        "code": "ATTRIB18",
                        "start_date": today.isoformat(),
                        "end_date": (today + timedelta(days=5)).isoformat(),
                        "description": "Performance reporting test",
                        "discount_type": "percentage",
                        "discount_value": 18,
                        "audience": "marketing_opt_in",
                        "channel": "whatsapp",
                        "status": "active",
                    },
                )
                self.assertEqual(promo.status_code, 200)
                promo_id = promo.json()["promotion"]["id"]

                order = client.post(
                    "/api/v1/restaurant/orders/",
                    json={
                        "order_type": "takeaway",
                        "customer_name": "Performance Guest",
                        "customer_phone": "9123456780",
                        "payment_method": "upi",
                        "coupon_code": " attrib18 ",
                        "items": [
                            {"name": "Margherita Pizza (R)", "quantity": 2, "price": 199}
                        ],
                    },
                )
                self.assertEqual(order.status_code, 200)
                order_id = order.json()["order_id"]
                self.assertEqual(order.json()["discount"], 71.64)

                post = client.post(
                    f"/api/v1/restaurant/promotions/{promo_id}/social-post",
                    json={"platforms": ["facebook"], "status": "ready"},
                )
                self.assertEqual(post.status_code, 200)
                post_id = post.json()["post"]["id"]

                ad = client.post(
                    f"/api/v1/restaurant/promotions/{promo_id}/ad-campaign",
                    json={
                        "platforms": ["instagram"],
                        "daily_budget": 600,
                        "status": "ready",
                    },
                )
                self.assertEqual(ad.status_code, 200)
                campaign_id = ad.json()["campaign"]["id"]

                performance = client.get(
                    f"/api/v1/restaurant/promotions/performance/{promo_id}"
                )
                self.assertEqual(performance.status_code, 200)
                payload = performance.json()
                self.assertEqual(payload["redemptions"]["count"], 1)
                self.assertEqual(payload["redemptions"]["discount"], 71.64)
                self.assertEqual(payload["redemptions"]["unique_customers"], 1)
                self.assertEqual(payload["redemptions"]["average_order_value"], 342.68)
                self.assertEqual(payload["social"]["post_count"], 1)
                self.assertEqual(payload["ads"]["campaign_count"], 1)
                self.assertEqual(payload["ads"]["planned_budget"], 600)
                self.assertEqual(payload["campaign_window"]["phase"], "live")
            finally:
                db = SessionLocal()
                try:
                    if campaign_id is not None:
                        db.query(AdCampaign).filter(AdCampaign.id == campaign_id).delete()
                    if post_id is not None:
                        db.query(SocialPost).filter(SocialPost.id == post_id).delete()
                    if order_id is not None:
                        db.query(RestaurantOrder).filter(RestaurantOrder.id == order_id).delete()
                    db.query(Customer).filter(Customer.phone == "9123456780").delete()
                    if promo_id is not None:
                        db.query(Promotion).filter(Promotion.id == promo_id).delete()
                    db.commit()
                finally:
                    db.close()


if __name__ == "__main__":
    unittest.main()
