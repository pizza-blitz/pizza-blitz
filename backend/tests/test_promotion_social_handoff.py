import unittest
from datetime import timedelta

from fastapi.testclient import TestClient

from app.core.clock import business_today
from app.core.config import settings
from app.db.session import SessionLocal
from app.main import app
from app.models.domain import Promotion, SocialPost, SocialPostDelivery


def cleanup_social_handoff(promo_id: int, post_id: int) -> None:
    db = SessionLocal()
    try:
        db.query(SocialPostDelivery).filter(
            SocialPostDelivery.social_post_id == post_id
        ).delete()
        db.query(SocialPost).filter(SocialPost.id == post_id).delete()
        db.query(Promotion).filter(Promotion.id == promo_id).delete()
        db.commit()
    finally:
        db.close()


class PromotionSocialHandoffTest(unittest.TestCase):
    def test_promotion_can_create_ready_social_post(self):
        today = business_today()
        with TestClient(app) as client:
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
                    "name": "Social Combo",
                    "code": "SOCIAL20",
                    "start_date": today.isoformat(),
                    "end_date": (today + timedelta(days=7)).isoformat(),
                    "description": "Launch social handoff test",
                    "discount_type": "percentage",
                    "discount_value": 20,
                    "audience": "marketing_opt_in",
                    "channel": "email",
                    "status": "active",
                },
            )
            self.assertEqual(promo.status_code, 200)
            promo_id = promo.json()["promotion"]["id"]

            handoff = client.post(
                f"/api/v1/restaurant/promotions/{promo_id}/social-post",
                json={
                    "link_url": "http://localhost:3011/order",
                    "image_url": "https://example.com/pizza.jpg",
                    "platforms": ["facebook", "instagram"],
                    "status": "ready",
                },
            )
            self.assertEqual(handoff.status_code, 200)
            post = handoff.json()["post"]
            self.addCleanup(cleanup_social_handoff, promo_id, post["id"])
            self.assertEqual(post["title"], "Pizza Blitz Offer: Social Combo")
            self.assertEqual(post["platforms"], ["facebook", "instagram"])
            self.assertEqual(post["status"], "ready")
            self.assertEqual(post["link_url"], "http://localhost:3011/order")
            self.assertIn("SOCIAL20", post["message"])
            self.assertIn("20% off", post["message"])

            dry_publish = client.post(
                f"/api/v1/restaurant/social/posts/{post['id']}/publish",
                json={"dry_run": True},
            )
            self.assertEqual(dry_publish.status_code, 200)
            self.assertEqual(dry_publish.json()["dry_run_count"], 2)


if __name__ == "__main__":
    unittest.main()
