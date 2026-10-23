"""Post-order feedback and NPS tests."""

import os
import unittest

os.environ.setdefault("PYTHONDONTWRITEBYTECODE", "1")

from fastapi.testclient import TestClient

from app.core.config import settings
from app.main import app


class FeedbackTest(unittest.TestCase):
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
        self.assertEqual(login.status_code, 200, login.text)
        self.headers = {"Authorization": f"Bearer {login.json()['access_token']}"}

    def tearDown(self):
        self._ctx.__exit__(None, None, None)

    def create_order(self, phone: str, close: bool = True) -> int:
        created = self.client.post(
            "/api/v1/restaurant/orders/",
            json={
                "order_type": "takeaway",
                "customer_name": "Feedback Guest",
                "customer_phone": phone,
                "payment_method": "cash",
                "items": [{"name": "Garlic Bread", "quantity": 1, "price": 119}],
            },
        )
        self.assertEqual(created.status_code, 200, created.text)
        order_id = created.json()["order_id"]
        if close:
            for status in ("preparing", "ready"):
                moved = self.client.patch(
                    f"/api/v1/restaurant/orders/{order_id}/status",
                    json={"status": status},
                    headers=self.headers,
                )
                self.assertEqual(moved.status_code, 200, moved.text)
            closed = self.client.patch(
                f"/api/v1/restaurant/orders/{order_id}/close?payment_method=cash",
                headers=self.headers,
            )
            self.assertEqual(closed.status_code, 200, closed.text)
        return order_id

    def test_feedback_submission_and_nps(self):
        phone = "9812346501"
        order_id = self.create_order(phone)

        wrong_phone = self.client.post(
            f"/api/v1/restaurant/feedback/{order_id}",
            json={"phone": "9800000000", "rating": 5, "nps": 10},
        )
        self.assertEqual(wrong_phone.status_code, 403)

        submitted = self.client.post(
            f"/api/v1/restaurant/feedback/{order_id}",
            json={
                "phone": phone,
                "rating": 5,
                "nps": 10,
                "comment": "Fast and hot",
                "tags": ["Fast delivery", "Hot food"],
            },
        )
        self.assertEqual(submitted.status_code, 201, submitted.text)
        self.assertEqual(submitted.json()["rating"], 5)

        duplicate = self.client.post(
            f"/api/v1/restaurant/feedback/{order_id}",
            json={"phone": phone, "rating": 4, "nps": 8},
        )
        self.assertEqual(duplicate.status_code, 409)

        fetched = self.client.get(
            f"/api/v1/restaurant/feedback/{order_id}?phone={phone}"
        )
        self.assertEqual(fetched.status_code, 200, fetched.text)
        self.assertEqual(fetched.json()["comment"], "Fast and hot")

        summary = self.client.get(
            "/api/v1/restaurant/feedback/summary?days=30",
            headers=self.headers,
        )
        self.assertEqual(summary.status_code, 200, summary.text)
        data = summary.json()
        self.assertGreaterEqual(data["feedback_count"], 1)
        self.assertGreaterEqual(data["nps"], 0)
        self.assertAlmostEqual(data["average_rating"], 5.0, places=2)
        self.assertEqual(data["rating_distribution"]["5"], 1)
        self.assertIn("Fast delivery", [row["tag"] for row in data["top_tags"]])

    def test_feedback_validation(self):
        phone = "9812346502"
        open_order = self.create_order(phone, close=False)
        not_completed = self.client.post(
            f"/api/v1/restaurant/feedback/{open_order}",
            json={"phone": phone, "rating": 4, "nps": 8},
        )
        self.assertEqual(not_completed.status_code, 409)

        closed = self.create_order(phone)
        invalid = self.client.post(
            f"/api/v1/restaurant/feedback/{closed}",
            json={"phone": phone, "rating": 6, "nps": 12},
        )
        self.assertEqual(invalid.status_code, 422)

        staff_login = self.client.post(
            "/api/v1/auth/staff/login",
            json={
                "id": settings.PIZZA_BLITZ_STAFF_ID,
                "password": settings.PIZZA_BLITZ_STAFF_PASSWORD,
            },
        )
        staff_headers = {
            "Authorization": f"Bearer {staff_login.json()['access_token']}"
        }
        self.assertEqual(
            self.client.get(
                "/api/v1/restaurant/feedback/summary", headers=staff_headers
            ).status_code,
            403,
        )


if __name__ == "__main__":
    unittest.main()
