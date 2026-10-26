"""Journey first/last/linear credit across steps."""

import unittest
from datetime import datetime, timedelta

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
    RestaurantOrder,
)


class JourneyStepModelsTest(unittest.TestCase):
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
        self.touch_ids: list[int] = []
        self.event_ids: list[int] = []
        self.order_id = None
        self.phone = "9123400441"

    def tearDown(self):
        db = SessionLocal()
        try:
            if self.touch_ids:
                db.query(JourneyTouch).filter(
                    JourneyTouch.id.in_(self.touch_ids)
                ).delete(synchronize_session=False)
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
            if self.order_id:
                db.query(RestaurantOrder).filter(
                    RestaurantOrder.id == self.order_id
                ).delete()
            db.query(Customer).filter(Customer.phone == self.phone).delete()
            db.commit()
        finally:
            db.close()
        self._ctx.__exit__(None, None, None)

    def test_first_last_linear_step_credit(self):
        journey = self.client.post(
            "/api/v1/restaurant/journeys",
            json={
                "name": "Step model proof",
                "trigger": "manual",
                "status": "active",
                "steps": [
                    {"type": "send", "channel": "whatsapp", "body": "First"},
                    {"type": "send", "channel": "email", "body": "Second"},
                ],
            },
            headers=self.headers,
        )
        self.assertEqual(journey.status_code, 201, journey.text)
        self.journey_id = journey.json()["journey"]["id"]
        db = SessionLocal()
        try:
            customer = Customer(
                name="Step Model Guest", phone=self.phone, opt_in_marketing=True
            )
            db.add(customer)
            db.commit()
            db.refresh(customer)
            enrollment = JourneyEnrollment(
                journey_id=self.journey_id,
                customer_id=customer.id,
                trigger_ref="step-model-proof",
                status="running",
                current_step=2,
                next_run_at=datetime.utcnow(),
            )
            db.add(enrollment)
            db.commit()
            db.refresh(enrollment)
            self.enrollment_id = enrollment.id
            base = datetime.utcnow() - timedelta(hours=3)
            first = JourneyTouch(
                enrollment_id=enrollment.id,
                step_index=0,
                channel="whatsapp",
                tracking_token="step-first",
                open_token="step-first-open",
                created_at=base,
            )
            second = JourneyTouch(
                enrollment_id=enrollment.id,
                step_index=1,
                channel="email",
                tracking_token="step-second",
                open_token="step-second-open",
                created_at=base + timedelta(hours=1),
            )
            db.add_all([first, second])
            for index in (0, 1):
                event = JourneyEvent(
                    enrollment_id=enrollment.id,
                    step_index=index,
                    step_type="send",
                    status="sent",
                )
                db.add(event)
            db.commit()
            self.touch_ids = [first.id, second.id]
            self.event_ids = [
                row.id
                for row in db.query(JourneyEvent)
                .filter(JourneyEvent.enrollment_id == enrollment.id)
                .all()
            ]
        finally:
            db.close()

        order = self.client.post(
            "/api/v1/restaurant/orders/",
            json={
                "order_type": "takeaway",
                "customer_name": "Step Model Guest",
                "customer_phone": self.phone,
                "payment_method": "cash",
                "items": [{"name": "Garlic Bread", "quantity": 1, "price": 119}],
            },
            headers=self.headers,
        )
        self.assertEqual(order.status_code, 200, order.text)
        self.order_id = order.json()["order_id"]

        detail = self.client.get(
            f"/api/v1/restaurant/journeys/{self.journey_id}", headers=self.headers
        )
        self.assertEqual(detail.status_code, 200, detail.text)
        attribution = detail.json()["journey"]["touch_attribution"]
        first = attribution["step_models"]["first_touch"]
        last = attribution["step_models"]["last_touch"]
        linear = attribution["step_models"]["linear"]
        self.assertEqual(first[0]["step_index"], 0)
        self.assertEqual(first[0]["channel"], "whatsapp")
        self.assertEqual(last[0]["step_index"], 1)
        self.assertEqual(last[0]["channel"], "email")
        self.assertEqual(len(linear), 2)
        self.assertAlmostEqual(
            linear[0]["credit_revenue"], linear[1]["credit_revenue"], places=2
        )
        self.assertEqual(attribution["best_step"]["step_index"], 0)


if __name__ == "__main__":
    unittest.main()
