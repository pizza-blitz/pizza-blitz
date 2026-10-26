"""Journey holdout assignment and treated-vs-holdout reporting."""

import unittest
from datetime import datetime, timedelta

from fastapi.testclient import TestClient

from app.core.config import settings
from app.db.session import SessionLocal
from app.main import app
from app.models.domain import (
    Customer,
    JourneyEnrollment,
    MarketingJourney,
    RestaurantOrder,
)


class JourneyHoldoutTest(unittest.TestCase):
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
        self.journey_ids: list[int] = []
        self.order_ids: list[int] = []
        self.enrollment_ids: list[int] = []
        self.phones = ["9123400331", "9123400332"]

    def tearDown(self):
        db = SessionLocal()
        try:
            if self.enrollment_ids:
                db.query(JourneyEnrollment).filter(
                    JourneyEnrollment.id.in_(self.enrollment_ids)
                ).delete(synchronize_session=False)
            if self.journey_ids:
                db.query(MarketingJourney).filter(
                    MarketingJourney.id.in_(self.journey_ids)
                ).delete(synchronize_session=False)
            if self.order_ids:
                db.query(RestaurantOrder).filter(
                    RestaurantOrder.id.in_(self.order_ids)
                ).delete(synchronize_session=False)
            db.query(Customer).filter(Customer.phone.in_(self.phones)).delete(
                synchronize_session=False
            )
            db.commit()
        finally:
            db.close()
        self._ctx.__exit__(None, None, None)

    def _order(self, phone: str, name: str) -> int:
        response = self.client.post(
            "/api/v1/restaurant/orders/",
            json={
                "order_type": "takeaway",
                "customer_name": name,
                "customer_phone": phone,
                "payment_method": "cash",
                "items": [{"name": "Garlic Bread", "quantity": 1, "price": 119}],
            },
            headers=self.headers,
        )
        self.assertEqual(response.status_code, 200, response.text)
        order_id = response.json()["order_id"]
        self.order_ids.append(order_id)
        return order_id

    def _journey(self, name: str, holdout: float) -> int:
        response = self.client.post(
            "/api/v1/restaurant/journeys",
            json={
                "name": name,
                "trigger": "manual",
                "status": "active",
                "holdout_percent": holdout,
                "steps": [
                    {"type": "send", "channel": "whatsapp", "body": "Journey offer"}
                ],
            },
            headers=self.headers,
        )
        self.assertEqual(response.status_code, 201, response.text)
        journey_id = response.json()["journey"]["id"]
        self.journey_ids.append(journey_id)
        return journey_id

    def test_full_holdout_enrollment_does_not_run(self):
        self._order(self.phones[0], "Holdout Guest")
        holdout_journey = self._journey("Full holdout journey", 100)
        enrolled = self.client.post(
            f"/api/v1/restaurant/journeys/{holdout_journey}/enroll",
            json={"destination": self.phones[0], "name": "Holdout Guest"},
            headers=self.headers,
        )
        self.assertEqual(enrolled.status_code, 201, enrolled.text)
        enrollment = enrolled.json()["enrollment"]
        self.enrollment_ids.append(enrollment["id"])
        self.assertEqual(enrollment["status"], "holdout")
        self.assertIsNone(enrollment["next_run_at"])

        treated_journey = self._journey("No holdout journey", 0)
        running = self.client.post(
            f"/api/v1/restaurant/journeys/{treated_journey}/enroll",
            json={"destination": self.phones[0], "name": "Holdout Guest"},
            headers=self.headers,
        )
        self.assertEqual(running.status_code, 201, running.text)
        self.enrollment_ids.append(running.json()["enrollment"]["id"])
        self.assertEqual(running.json()["enrollment"]["status"], "running")

        detail = self.client.get(
            f"/api/v1/restaurant/journeys/{holdout_journey}", headers=self.headers
        )
        self.assertEqual(detail.json()["journey"]["holdout_count"], 1)
        self.assertEqual(detail.json()["journey"]["treated_count"], 0)

    def test_experiment_reports_treated_vs_holdout(self):
        self._order(self.phones[0], "Treated Guest")
        journey_id = self._journey("Experiment journey", 50)
        db = SessionLocal()
        try:
            treated_customer = (
                db.query(Customer).filter(Customer.phone == self.phones[0]).first()
            )
            holdout_customer = db.query(Customer).filter(
                Customer.phone == self.phones[1]
            ).first()
            if holdout_customer is None:
                holdout_customer = Customer(
                    name="Holdout Guest",
                    phone=self.phones[1],
                    opt_in_marketing=True,
                )
                db.add(holdout_customer)
                db.commit()
                db.refresh(holdout_customer)
            base = datetime.utcnow() - timedelta(hours=5)
            treated = JourneyEnrollment(
                journey_id=journey_id,
                customer_id=treated_customer.id,
                trigger_ref="experiment-treated",
                status="running",
                current_step=1,
                next_run_at=datetime.utcnow(),
                context={"phone": self.phones[0], "holdout": False},
                created_at=base,
            )
            holdout = JourneyEnrollment(
                journey_id=journey_id,
                customer_id=holdout_customer.id,
                trigger_ref="experiment-holdout",
                status="holdout",
                current_step=0,
                next_run_at=None,
                context={"phone": self.phones[1], "holdout": True},
                created_at=base,
            )
            db.add_all([treated, holdout])
            db.commit()
            self.enrollment_ids = [treated.id, holdout.id]
        finally:
            db.close()

        order = self.client.post(
            "/api/v1/restaurant/orders/",
            json={
                "order_type": "takeaway",
                "customer_name": "Treated Guest",
                "customer_phone": self.phones[0],
                "payment_method": "cash",
                "items": [{"name": "Garlic Bread", "quantity": 1, "price": 119}],
            },
            headers=self.headers,
        )
        self.assertEqual(order.status_code, 200, order.text)
        self.order_ids.append(order.json()["order_id"])

        detail = self.client.get(
            f"/api/v1/restaurant/journeys/{journey_id}", headers=self.headers
        )
        experiment = detail.json()["journey"]["holdout_experiment"]
        self.assertEqual(experiment["treated"]["customers"], 1)
        self.assertEqual(experiment["treated"]["converted"], 1)
        self.assertEqual(experiment["holdout"]["customers"], 1)
        self.assertEqual(experiment["holdout"]["converted"], 0)
        self.assertGreater(experiment["incremental_revenue"], 0)


if __name__ == "__main__":
    unittest.main()
