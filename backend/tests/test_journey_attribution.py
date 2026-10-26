"""Journey-level send attribution: sends, customers, conversions and revenue."""

import unittest

from fastapi.testclient import TestClient

from app.core.config import settings
from app.db.session import SessionLocal
from app.main import app
from app.models.domain import (
    Customer,
    JourneyEnrollment,
    JourneyEvent,
    MarketingJourney,
    RestaurantOrder,
)


class JourneyAttributionTest(unittest.TestCase):
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
        self.event_ids: list[int] = []
        self.phone = "9123400661"
        self.order_ids: list[int] = []

    def tearDown(self):
        db = SessionLocal()
        try:
            if self.event_ids:
                db.query(JourneyEvent).filter(
                    JourneyEvent.id.in_(self.event_ids)
                ).delete(synchronize_session=False)
            if self.enrollment_id:
                db.query(JourneyEnrollment).filter(
                    JourneyEnrollment.id == self.enrollment_id
                ).delete()
            if self.journey_id:
                db.query(MarketingJourney).filter(
                    MarketingJourney.id == self.journey_id
                ).delete()
            if self.order_ids:
                db.query(RestaurantOrder).filter(
                    RestaurantOrder.id.in_(self.order_ids)
                ).delete(synchronize_session=False)
            db.query(Customer).filter(Customer.phone == self.phone).delete()
            db.commit()
        finally:
            db.close()
        self._ctx.__exit__(None, None, None)

    def _journey(self) -> int:
        response = self.client.post(
            "/api/v1/restaurant/journeys",
            json={
                "name": "Journey attribution proof",
                "trigger": "manual",
                "status": "active",
                "steps": [
                    {
                        "type": "send",
                        "channel": "whatsapp",
                        "body": "Thanks for ordering. Here is 10% off.",
                    }
                ],
            },
            headers=self.headers,
        )
        self.assertEqual(response.status_code, 201, response.text)
        self.journey_id = response.json()["journey"]["id"]
        return self.journey_id

    def _order(self, item_name: str = "Garlic Bread") -> int:
        response = self.client.post(
            "/api/v1/restaurant/orders/",
            json={
                "order_type": "takeaway",
                "customer_name": "Journey Attribution Guest",
                "customer_phone": self.phone,
                "payment_method": "cash",
                "items": [{"name": item_name, "quantity": 1, "price": 119}],
            },
            headers=self.headers,
        )
        self.assertEqual(response.status_code, 200, response.text)
        order_id = response.json()["order_id"]
        self.order_ids.append(order_id)
        return order_id

    def test_sends_convert_orders_after_first_touch(self):
        self._order("Pre-journey order")
        journey_id = self._journey()
        enrolled = self.client.post(
            f"/api/v1/restaurant/journeys/{journey_id}/enroll",
            json={"destination": self.phone, "name": "Journey Attribution Guest"},
            headers=self.headers,
        )
        self.assertEqual(enrolled.status_code, 201, enrolled.text)
        self.enrollment_id = enrolled.json()["enrollment"]["id"]
        db = SessionLocal()
        try:
            event = JourneyEvent(
                enrollment_id=self.enrollment_id,
                step_index=0,
                step_type="send",
                status="sent",
                detail="Sent via proof.",
            )
            db.add(event)
            db.commit()
            db.refresh(event)
            self.event_ids = [event.id]
        finally:
            db.close()

        order_id = self._order("Post-journey order")
        detail = self.client.get(
            f"/api/v1/restaurant/journeys/{journey_id}", headers=self.headers
        )
        self.assertEqual(detail.status_code, 200, detail.text)
        attribution = detail.json()["journey"]["touch_attribution"]
        self.assertEqual(attribution["sent_events"], 1)
        self.assertEqual(attribution["unique_customers"], 1)
        self.assertEqual(attribution["converted_customers"], 1)
        self.assertEqual(attribution["orders_attributed"], 1)
        self.assertGreater(attribution["revenue"], 0)
        self.assertEqual(attribution["channels"][0]["channel"], "whatsapp")
        self.assertGreater(order_id, 0)

    def test_no_sends_returns_empty_attribution(self):
        journey_id = self._journey()
        detail = self.client.get(
            f"/api/v1/restaurant/journeys/{journey_id}", headers=self.headers
        )
        attribution = detail.json()["journey"]["touch_attribution"]
        self.assertEqual(attribution["sent_events"], 0)
        self.assertEqual(attribution["revenue"], 0)


if __name__ == "__main__":
    unittest.main()
