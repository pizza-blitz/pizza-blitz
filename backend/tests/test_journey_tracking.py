"""Journey tracked links/open pixels and per-step engagement."""

import unittest
from datetime import datetime

from fastapi.testclient import TestClient

from app.core.config import settings
from app.db.session import SessionLocal
from app.main import app
from app.models.domain import (
    Customer,
    JourneyEnrollment,
    JourneyEvent,
    JourneyTouch,
    MarketingJourney,
)
from app.services.journey_service import enroll_manual, get_journey


class JourneyTrackingTest(unittest.TestCase):
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
        self.journey_id = None
        self.enrollment_id = None
        self.touch_id = None
        self.phone = "9123400551"

    def tearDown(self):
        db = SessionLocal()
        try:
            if self.touch_id:
                db.query(JourneyTouch).filter(JourneyTouch.id == self.touch_id).delete()
            if self.enrollment_id:
                db.query(JourneyEnrollment).filter(
                    JourneyEnrollment.id == self.enrollment_id
                ).delete()
            if self.journey_id:
                db.query(MarketingJourney).filter(
                    MarketingJourney.id == self.journey_id
                ).delete()
            db.query(Customer).filter(Customer.phone == self.phone).delete()
            db.commit()
        finally:
            db.close()
        self._ctx.__exit__(None, None, None)

    def _seed(self) -> None:
        response = self.client.post(
            "/api/v1/restaurant/journeys",
            json={
                "name": "Journey tracking proof",
                "trigger": "manual",
                "status": "active",
                "steps": [
                    {
                        "type": "send",
                        "channel": "whatsapp",
                        "body": "Here is a journey offer.",
                    }
                ],
            },
            headers=self.headers,
        )
        self.assertEqual(response.status_code, 201, response.text)
        self.journey_id = response.json()["journey"]["id"]
        db = SessionLocal()
        try:
            journey = get_journey(db, self.journey_id)
            enrolled = enroll_manual(
                db, journey, destination=self.phone, name="Journey Tracking Guest"
            )
            self.enrollment_id = enrolled["id"]
            customer = (
                db.query(Customer).filter(Customer.phone == self.phone).first()
            )
            if customer is None:
                customer = Customer(
                    name="Journey Tracking Guest",
                    phone=self.phone,
                    opt_in_marketing=True,
                )
                db.add(customer)
                db.commit()
                db.refresh(customer)
            enrollment_row = (
                db.query(JourneyEnrollment)
                .filter(JourneyEnrollment.id == self.enrollment_id)
                .first()
            )
            enrollment_row.customer_id = customer.id
            touch = JourneyTouch(
                enrollment_id=self.enrollment_id,
                step_index=0,
                channel="whatsapp",
                tracking_token="journey-click-proof",
                open_token="journey-open-proof",
                created_at=datetime.utcnow(),
            )
            db.add(touch)
            db.add(
                JourneyEvent(
                    enrollment_id=self.enrollment_id,
                    step_index=0,
                    step_type="send",
                    status="sent",
                    detail="Sent via proof.",
                )
            )
            db.commit()
            db.refresh(touch)
            self.touch_id = touch.id
        finally:
            db.close()

    def test_track_click_and_open_pixel(self):
        self._seed()
        click = self.client.get(
            "/api/v1/restaurant/journeys/track/journey-click-proof",
            follow_redirects=False,
        )
        self.assertEqual(click.status_code, 307, click.text)
        location = click.headers["location"]
        self.assertIn("/order", location)
        self.assertIn("utm_campaign=Journey%20tracking%20proof", location)
        self.assertIn(f"touch={self.touch_id}", location)

        pixel = self.client.get(
            "/api/v1/restaurant/journeys/open/journey-open-proof.png"
        )
        self.assertEqual(pixel.status_code, 200, pixel.text)
        self.assertEqual(pixel.headers["content-type"], "image/gif")
        self.assertIn("no-store", pixel.headers.get("cache-control", ""))

        detail = self.client.get(
            f"/api/v1/restaurant/journeys/{self.journey_id}", headers=self.headers
        )
        self.assertEqual(detail.status_code, 200, detail.text)
        attribution = detail.json()["journey"]["touch_attribution"]
        self.assertEqual(attribution["engagement"]["touches"], 1)
        self.assertEqual(attribution["engagement"]["click_count"], 1)
        self.assertEqual(attribution["engagement"]["open_count"], 1)
        self.assertEqual(attribution["engagement"]["click_rate_percent"], 100.0)
        self.assertEqual(attribution["steps"][0]["clicks"], 1)
        self.assertEqual(attribution["steps"][0]["opens"], 1)

    def test_unknown_journey_tokens_are_404(self):
        click = self.client.get(
            "/api/v1/restaurant/journeys/track/not-a-journey-token",
            follow_redirects=False,
        )
        self.assertEqual(click.status_code, 404, click.text)
        pixel = self.client.get(
            "/api/v1/restaurant/journeys/open/not-a-journey-token.png"
        )
        self.assertEqual(pixel.status_code, 404, pixel.text)


if __name__ == "__main__":
    unittest.main()
