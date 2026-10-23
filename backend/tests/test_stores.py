"""Multi-store registry and consolidated reporting tests."""

import os
import unittest

os.environ.setdefault("PYTHONDONTWRITEBYTECODE", "1")

from fastapi.testclient import TestClient

from app.core.clock import business_today
from app.core.config import settings
from app.main import app


def order_payload(phone: str, store_id: int) -> dict:
    return {
        "order_type": "takeaway",
        "store_id": store_id,
        "customer_name": "Franchise Guest",
        "customer_phone": phone,
        "payment_method": "cash",
        "items": [{"name": "Garlic Bread", "quantity": 1, "price": 119}],
    }


class StoreTest(unittest.TestCase):
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

    def create_store(self, code: str) -> dict:
        response = self.client.post(
            "/api/v1/restaurant/stores/",
            json={
                "name": f"Pizza Blitz {code.title()}",
                "code": code,
                "address_line": "100 Franchise Road",
                "phone": "08012345678",
            },
            headers=self.headers,
        )
        self.assertEqual(response.status_code, 200, response.text)
        return response.json()

    def test_store_registry_orders_and_consolidated_report(self):
        listed = self.client.get(
            "/api/v1/restaurant/stores/", headers=self.headers
        )
        self.assertEqual(listed.status_code, 200, listed.text)
        main = next(
            store for store in listed.json()["stores"] if store["code"] == "MAIN"
        )
        self.assertTrue(main["is_active"])

        store = self.create_store(f"IND{str(int(__import__('time').time()))[-6:]}")
        duplicate = self.client.post(
            "/api/v1/restaurant/stores/",
            json={"name": "Duplicate", "code": store["code"]},
            headers=self.headers,
        )
        self.assertEqual(duplicate.status_code, 409)

        order = self.client.post(
            "/api/v1/restaurant/orders/",
            json=order_payload("9812345901", store["id"]),
        )
        self.assertEqual(order.status_code, 200, order.text)
        self.assertEqual(order.json()["store_id"], store["id"])

        today = business_today().isoformat()
        consolidated = self.client.get(
            f"/api/v1/restaurant/stores/consolidated?start_date={today}&end_date={today}",
            headers=self.headers,
        )
        self.assertEqual(consolidated.status_code, 200, consolidated.text)
        data = consolidated.json()
        franchise = next(row for row in data["stores"] if row["id"] == store["id"])
        self.assertEqual(franchise["orders"], 1)
        self.assertAlmostEqual(franchise["revenue"], order.json()["total"], places=2)
        self.assertGreaterEqual(data["totals"]["orders"], 1)
        self.assertAlmostEqual(
            data["totals"]["revenue"],
            sum(row["revenue"] for row in data["stores"]),
            places=2,
        )

        paused = self.client.patch(
            f"/api/v1/restaurant/stores/{store['id']}",
            json={"is_active": False},
            headers=self.headers,
        )
        self.assertEqual(paused.status_code, 200, paused.text)
        blocked = self.client.post(
            "/api/v1/restaurant/orders/",
            json=order_payload("9812345902", store["id"]),
        )
        self.assertEqual(blocked.status_code, 409)

        self.client.patch(
            f"/api/v1/restaurant/stores/{store['id']}",
            json={"is_active": True},
            headers=self.headers,
        )
        missing = self.client.post(
            "/api/v1/restaurant/orders/",
            json=order_payload("9812345903", 999999),
        )
        self.assertEqual(missing.status_code, 404)

        reversed_range = self.client.get(
            "/api/v1/restaurant/stores/consolidated?start_date=2026-10-10&end_date=2026-10-01",
            headers=self.headers,
        )
        self.assertEqual(reversed_range.status_code, 422)

    def test_last_active_store_cannot_be_paused(self):
        stores = self.client.get(
            "/api/v1/restaurant/stores/", headers=self.headers
        ).json()["stores"]
        active = [store for store in stores if store["is_active"]]
        if len(active) != 1:
            self.skipTest("Another test left multiple stores active.")
        blocked = self.client.patch(
            f"/api/v1/restaurant/stores/{active[0]['id']}",
            json={"is_active": False},
            headers=self.headers,
        )
        self.assertEqual(blocked.status_code, 409)

    def test_staff_store_access(self):
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
                "/api/v1/restaurant/stores/", headers=staff_headers
            ).status_code,
            200,
        )
        self.assertEqual(
            self.client.get(
                "/api/v1/restaurant/stores/consolidated", headers=staff_headers
            ).status_code,
            403,
        )
        self.assertEqual(
            self.client.post(
                "/api/v1/restaurant/stores/",
                json={"name": "Staff Store", "code": "STAFFX"},
                headers=staff_headers,
            ).status_code,
            403,
        )


if __name__ == "__main__":
    unittest.main()
