import unittest
from datetime import date, timedelta

from fastapi.testclient import TestClient

from app.core.config import settings
from app.db.session import SessionLocal
from app.main import app
from app.models.domain import AdCampaign, AdCampaignLaunch, Promotion


class PromotionAdHandoffTest(unittest.TestCase):
    def test_promotion_can_create_ready_ad_campaign(self):
        today = date.today()
        promo_id = None
        campaign_id = None
        with TestClient(app) as client:
            try:
                admin_login = client.post(
                    "/api/v1/auth/admin/login",
                    json={
                        "id": settings.PIZZA_BLITZ_ADMIN_ID,
                        "password": settings.PIZZA_BLITZ_ADMIN_PASSWORD,
                    },
                )
                self.assertEqual(admin_login.status_code, 200)
                client.headers.update(
                    {"Authorization": f"Bearer {admin_login.json()['access_token']}"}
                )

                promo = client.post(
                    "/api/v1/restaurant/promotions/",
                    json={
                        "name": "Meta Launch Combo",
                        "code": "META25",
                        "start_date": today.isoformat(),
                        "end_date": (today + timedelta(days=10)).isoformat(),
                        "description": "Launch ad campaign handoff test",
                        "discount_type": "percentage",
                        "discount_value": 25,
                        "audience": "marketing_opt_in",
                        "channel": "whatsapp",
                        "status": "active",
                    },
                )
                self.assertEqual(promo.status_code, 200)
                promo_id = promo.json()["promotion"]["id"]

                handoff = client.post(
                    f"/api/v1/restaurant/promotions/{promo_id}/ad-campaign",
                    json={
                        "link_url": "http://localhost:3011/order",
                        "image_url": "https://example.com/pizza-ad.jpg",
                        "platforms": ["facebook", "instagram"],
                        "objective": "sales",
                        "daily_budget": 750,
                        "status": "ready",
                    },
                )
                self.assertEqual(handoff.status_code, 200)
                campaign = handoff.json()["campaign"]
                campaign_id = campaign["id"]
                self.assertEqual(campaign["name"], "Pizza Blitz Ad: Meta Launch Combo")
                self.assertEqual(campaign["objective"], "sales")
                self.assertEqual(campaign["platforms"], ["facebook", "instagram"])
                self.assertEqual(campaign["status"], "ready")
                self.assertEqual(campaign["daily_budget"], 750)
                self.assertEqual(campaign["link_url"], "http://localhost:3011/order")
                self.assertIn("META25", campaign["creative_message"])
                self.assertIn("25% off", campaign["creative_message"])

                dry_launch = client.post(
                    f"/api/v1/restaurant/ads/campaigns/{campaign_id}/launch",
                    json={"dry_run": True},
                )
                self.assertEqual(dry_launch.status_code, 200)
                self.assertEqual(dry_launch.json()["dry_run_count"], 1)
            finally:
                db = SessionLocal()
                try:
                    if campaign_id is not None:
                        db.query(AdCampaignLaunch).filter(
                            AdCampaignLaunch.campaign_id == campaign_id
                        ).delete()
                        db.query(AdCampaign).filter(AdCampaign.id == campaign_id).delete()
                    if promo_id is not None:
                        db.query(Promotion).filter(Promotion.id == promo_id).delete()
                    db.commit()
                finally:
                    db.close()


if __name__ == "__main__":
    unittest.main()
