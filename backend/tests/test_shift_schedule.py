"""Scheduled shift and labour-versus-sales tests."""

import os
import unittest

os.environ.setdefault("PYTHONDONTWRITEBYTECODE", "1")

from fastapi.testclient import TestClient

from app.core.clock import business_today
from app.core.config import settings
from app.main import app


class ShiftScheduleTest(unittest.TestCase):
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
        self.today = business_today().isoformat()

    def tearDown(self):
        self._ctx.__exit__(None, None, None)

    def create_shift(self, **overrides):
        payload = {
            "staff_name": "Scheduled Chef",
            "role": "Kitchen / Oven",
            "date": self.today,
            "start_time": "11:00",
            "end_time": "15:00",
            "hourly_rate": 200,
            "status": "scheduled",
        }
        payload.update(overrides)
        return self.client.post(
            "/api/v1/restaurant/shifts/schedule",
            json=payload,
            headers=self.headers,
        )

    def test_schedule_and_labour_summary(self):
        before = self.client.get(
            "/api/v1/restaurant/shifts/labour-summary",
            params={"start_date": self.today, "end_date": self.today},
            headers=self.headers,
        )
        self.assertEqual(before.status_code, 200, before.text)
        baseline = before.json()["totals"]

        created = self.create_shift()
        self.assertEqual(created.status_code, 200, created.text)
        shift = created.json()
        self.assertEqual(shift["hours"], 4)
        self.assertEqual(shift["labour_cost"], 800)
        self.assertEqual(shift["status"], "scheduled")

        schedule = self.client.get(
            "/api/v1/restaurant/shifts/schedule",
            params={"start_date": self.today, "end_date": self.today},
            headers=self.headers,
        )
        self.assertEqual(schedule.status_code, 200, schedule.text)
        self.assertIn(shift["id"], [row["id"] for row in schedule.json()["shifts"]])
        self.assertGreaterEqual(schedule.json()["summary"]["labour_cost"], 800)

        updated = self.client.patch(
            f"/api/v1/restaurant/shifts/schedule/{shift['id']}",
            json={"end_time": "17:00", "status": "confirmed"},
            headers=self.headers,
        )
        self.assertEqual(updated.status_code, 200, updated.text)
        self.assertEqual(updated.json()["hours"], 6)
        self.assertEqual(updated.json()["labour_cost"], 1200)
        self.assertEqual(updated.json()["status"], "confirmed")

        order = self.client.post(
            "/api/v1/restaurant/orders/",
            json={
                "order_type": "takeaway",
                "customer_name": "Labour Guest",
                "customer_phone": "9812346201",
                "payment_method": "cash",
                "items": [{"name": "Garlic Bread", "quantity": 1, "price": 119}],
            },
        )
        self.assertEqual(order.status_code, 200, order.text)

        after = self.client.get(
            "/api/v1/restaurant/shifts/labour-summary",
            params={"start_date": self.today, "end_date": self.today},
            headers=self.headers,
        )
        self.assertEqual(after.status_code, 200, after.text)
        totals = after.json()["totals"]
        self.assertGreaterEqual(totals["labour_cost"], 1200)
        self.assertAlmostEqual(
            totals["sales"], baseline["sales"] + order.json()["total"], places=2
        )
        self.assertGreater(totals["labour_percent"], 0)
        day = next(row for row in after.json()["days"] if row["date"] == self.today)
        self.assertGreaterEqual(day["labour_cost"], 1200)
        self.assertIn(
            "Kitchen / Oven", [row["role"] for row in after.json()["roles"]]
        )

        deleted = self.client.delete(
            f"/api/v1/restaurant/shifts/schedule/{shift['id']}",
            headers=self.headers,
        )
        self.assertEqual(deleted.status_code, 200, deleted.text)

    def test_schedule_validation_and_access(self):
        same_time = self.create_shift(start_time="11:00", end_time="11:00")
        self.assertEqual(same_time.status_code, 422)
        bad_time = self.create_shift(start_time="morning")
        self.assertEqual(bad_time.status_code, 422)
        no_name = self.create_shift(staff_name="")
        self.assertEqual(no_name.status_code, 422)

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
                "/api/v1/restaurant/shifts/schedule", headers=staff_headers
            ).status_code,
            403,
        )
        self.assertEqual(
            self.client.get(
                "/api/v1/restaurant/shifts/labour-summary", headers=staff_headers
            ).status_code,
            403,
        )


if __name__ == "__main__":
    unittest.main()
