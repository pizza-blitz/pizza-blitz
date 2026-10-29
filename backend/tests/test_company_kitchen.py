"""Menu engineering report: sold units, margins and menu classifications."""

import os
import time
import unittest

os.environ.setdefault("PYTHONDONTWRITEBYTECODE", "1")

from fastapi.testclient import TestClient

from app.core.clock import business_today
from app.core.config import settings
from app.db.session import SessionLocal
from app.main import app
from app.models.domain import MenuItem, RestaurantOrder

BASE = "/api/v1/restaurant"


class CompanyKitchenTest(unittest.TestCase):
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
        suffix = str(int(time.time() * 1000))
        self.marker = f"Kitchen Engineering {suffix}"
        self.today = business_today()
        self.menu_item_ids: list[int] = []
        self.order_ids: list[int] = []
        db = SessionLocal()
        try:
            self.star_item = MenuItem(
                name=f"{self.marker} Star",
                category=f"Engineering {suffix}",
                selling_price=300,
                cost_price=100,
            )
            self.value_item = MenuItem(
                name=f"{self.marker} Value",
                category=f"Engineering {suffix}",
                selling_price=500,
                cost_price=200,
            )
            db.add_all([self.star_item, self.value_item])
            db.commit()
            db.refresh(self.star_item)
            db.refresh(self.value_item)
            self.menu_item_ids = [self.star_item.id, self.value_item.id]
            self.star_name = self.star_item.name
            self.value_name = self.value_item.name
            self.category = self.star_item.category

            order = RestaurantOrder(
                date=self.today,
                store_id=1,
                status="completed",
                items=[
                    {
                        "menu_item_id": self.star_item.id,
                        "name": self.star_item.name,
                        "category": self.star_item.category,
                        "quantity": 2,
                        "price": 300,
                    },
                    {
                        "menu_item_id": self.value_item.id,
                        "name": self.value_item.name,
                        "category": self.value_item.category,
                        "quantity": 1,
                        "price": 500,
                    },
                ],
            )
            cancelled = RestaurantOrder(
                date=self.today,
                store_id=1,
                status="cancelled",
                items=[
                    {
                        "menu_item_id": self.star_item.id,
                        "name": self.star_item.name,
                        "category": self.star_item.category,
                        "quantity": 99,
                        "price": 300,
                    }
                ],
            )
            db.add_all([order, cancelled])
            db.commit()
            db.refresh(order)
            db.refresh(cancelled)
            self.order_ids = [order.id, cancelled.id]
        finally:
            db.close()

    def tearDown(self):
        db = SessionLocal()
        try:
            if self.order_ids:
                db.query(RestaurantOrder).filter(
                    RestaurantOrder.id.in_(self.order_ids)
                ).delete(synchronize_session=False)
            if self.menu_item_ids:
                db.query(MenuItem).filter(
                    MenuItem.id.in_(self.menu_item_ids)
                ).delete(synchronize_session=False)
            db.commit()
        finally:
            db.close()
        self._ctx.__exit__(None, None, None)

    def test_menu_engineering_classifies_sold_items(self):
        response = self.client.get(
            f"{BASE}/company/kitchen/menu-engineering",
            params={"days": 1},
            headers=self.headers,
        )
        self.assertEqual(response.status_code, 200, response.text)
        payload = response.json()
        self.assertIn("items", payload)
        self.assertIn("categories", payload)
        self.assertIn("summary", payload)

        rows = {row["name"]: row for row in payload["items"]}
        star = rows[self.star_name]
        value = rows[self.value_name]

        self.assertEqual(star["units"], 2)
        self.assertAlmostEqual(star["revenue"], 600.0, places=2)
        self.assertAlmostEqual(star["cost"], 200.0, places=2)
        self.assertAlmostEqual(star["margin"], 400.0, places=2)
        self.assertAlmostEqual(star["margin_per_unit"], 200.0, places=2)

        self.assertEqual(value["units"], 1)
        self.assertAlmostEqual(value["revenue"], 500.0, places=2)
        self.assertAlmostEqual(value["cost"], 200.0, places=2)
        self.assertAlmostEqual(value["margin"], 300.0, places=2)

        classifications = {
            "star",
            "plough_horse",
            "puzzle",
            "dog",
        }
        self.assertIn(star["classification"], classifications)
        self.assertIn(value["classification"], classifications)
        self.assertTrue(star["action"])
        self.assertTrue(value["action"])
        # The cancelled order must not inflate units.
        self.assertNotEqual(star["units"], 101)
        self.assertGreater(star["popularity_share"], 0)
        self.assertLessEqual(star["popularity_share"], 100)

        summary = payload["summary"]
        self.assertEqual(summary["days"], 1)
        self.assertGreaterEqual(summary["orders_counted"], 1)
        self.assertGreaterEqual(summary["items_sold"], 3)
        self.assertGreaterEqual(summary["revenue"], 1100.0)
        self.assertEqual(
            summary["stars"]
            + summary["plough_horses"]
            + summary["puzzles"]
            + summary["dogs"],
            len(payload["items"]),
        )
        self.assertIn("basis", summary)

        category = next(
            row
            for row in payload["categories"]
            if row["category"] == self.category
        )
        self.assertEqual(category["item_count"], 2)
        self.assertEqual(category["units"], 3)
        self.assertAlmostEqual(category["revenue"], 1100.0, places=2)


if __name__ == "__main__":
    unittest.main()
