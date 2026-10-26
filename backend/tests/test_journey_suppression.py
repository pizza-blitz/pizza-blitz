"""Cross-journey suppression prevents overlapping enrollment spam."""

import unittest

from fastapi.testclient import TestClient

from app.core.config import settings
from app.db.session import SessionLocal
from app.main import app
from app.models.domain import Customer, JourneyEnrollment, MarketingJourney


class JourneySuppressionTest(unittest.TestCase):
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
        self.enrollment_ids: list[int] = []
        self.order_id = None
        self.phone = "9123400221"

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
            db.query(Customer).filter(Customer.phone == self.phone).delete()
            db.commit()
        finally:
            db.close()
        self._ctx.__exit__(None, None, None)

    def _journey(self, name: str, suppression: int) -> int:
        response = self.client.post(
            "/api/v1/restaurant/journeys",
            json={
                "name": name,
                "trigger": "manual",
                "status": "active",
                "suppression_hours": suppression,
                "steps": [
                    {"type": "send", "channel": "whatsapp", "body": "Journey offer"}
                ],
            },
            headers=self.headers,
        )
        self.assertEqual(response.status_code, 201, response.text)
        self.journey_ids.append(response.json()["journey"]["id"])
        return response.json()["journey"]["id"]

    def _enroll(self, journey_id: int) -> dict:
        response = self.client.post(
            f"/api/v1/restaurant/journeys/{journey_id}/enroll",
            json={"destination": self.phone, "name": "Suppression Guest"},
            headers=self.headers,
        )
        self.assertEqual(response.status_code, 201, response.text)
        enrollment = response.json()["enrollment"]
        self.enrollment_ids.append(enrollment["id"])
        return enrollment

    def test_overlapping_journey_is_suppressed(self):
        order = self.client.post(
            "/api/v1/restaurant/orders/",
            json={
                "order_type": "takeaway",
                "customer_name": "Suppression Guest",
                "customer_phone": self.phone,
                "payment_method": "cash",
                "items": [{"name": "Garlic Bread", "quantity": 1, "price": 119}],
            },
            headers=self.headers,
        )
        self.assertEqual(order.status_code, 200, order.text)
        self.order_id = order.json()["order_id"]

        first = self._journey("First journey", 24)
        second = self._journey("Second journey", 24)
        third = self._journey("No suppression journey", 0)

        self.assertEqual(self._enroll(first)["status"], "running")
        suppressed = self._enroll(second)
        self.assertEqual(suppressed["status"], "suppressed")
        self.assertIsNone(suppressed["next_run_at"])
        self.assertIn("Suppressed", suppressed["context"]["suppression_reason"])
        self.assertEqual(self._enroll(third)["status"], "running")

        detail = self.client.get(
            f"/api/v1/restaurant/journeys/{second}", headers=self.headers
        )
        journey = detail.json()["journey"]
        self.assertEqual(journey["suppressed_count"], 1)
        self.assertEqual(journey["treated_count"], 0)
        self.assertEqual(journey["holdout_experiment"]["suppressed_count"], 1)


if __name__ == "__main__":
    unittest.main()
