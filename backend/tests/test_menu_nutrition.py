"""Menu allergen and nutrition tests."""

import os
import unittest

os.environ.setdefault("PYTHONDONTWRITEBYTECODE", "1")

from fastapi.testclient import TestClient

from app.core.config import settings
from app.main import app


class MenuNutritionTest(unittest.TestCase):
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
        self.item_id = None

    def tearDown(self):
        if self.item_id:
            self.client.delete(
                f"/api/v1/restaurant/menu/menu/{self.item_id}", headers=self.headers
            )
        self._ctx.__exit__(None, None, None)

    def test_allergens_and_nutrition_round_trip(self):
        created = self.client.post(
            "/api/v1/restaurant/menu/menu",
            json={
                "name": "Nutrition Test Pizza",
                "category": "Pizza",
                "selling_price": 299,
                "cost_price": 110,
                "is_available": True,
                "allergens": [" Milk ", "Wheat", "milk"],
                "dietary_tags": ["Vegetarian"],
                "calories": 520,
                "protein_g": 22.5,
                "carbs_g": 61,
                "fat_g": 18.5,
            },
            headers=self.headers,
        )
        self.assertEqual(created.status_code, 200, created.text)
        item = created.json()
        self.item_id = item["id"]
        self.assertEqual(item["allergens"], ["Milk", "Wheat"])
        self.assertEqual(item["dietary_tags"], ["Vegetarian"])
        self.assertEqual(item["calories"], 520)
        self.assertAlmostEqual(item["protein_g"], 22.5)

        menu = self.client.get("/api/v1/restaurant/menu/menu")
        self.assertEqual(menu.status_code, 200, menu.text)
        listed = next(row for row in menu.json() if row["id"] == self.item_id)
        self.assertEqual(listed["allergens"], ["Milk", "Wheat"])
        self.assertEqual(listed["calories"], 520)

        public = self.client.get(
            "/api/v1/restaurant/menu/menu-with-customizations"
        )
        self.assertEqual(public.status_code, 200, public.text)
        public_item = next(row for row in public.json() if row["id"] == self.item_id)
        self.assertEqual(public_item["allergens"], ["Milk", "Wheat"])
        self.assertEqual(public_item["dietary_tags"], ["Vegetarian"])
        self.assertEqual(public_item["fat_g"], 18.5)

        updated = self.client.post(
            "/api/v1/restaurant/menu/menu",
            json={
                **item,
                "calories": 480,
                "allergens": ["Milk"],
                "dietary_tags": ["Vegetarian", "Gluten-free"],
            },
            headers=self.headers,
        )
        self.assertEqual(updated.status_code, 200, updated.text)
        self.assertEqual(updated.json()["calories"], 480)
        self.assertEqual(updated.json()["allergens"], ["Milk"])
        self.assertEqual(
            updated.json()["dietary_tags"], ["Vegetarian", "Gluten-free"]
        )

    def test_validation_and_access(self):
        invalid = self.client.post(
            "/api/v1/restaurant/menu/menu",
            json={
                "name": "Invalid Nutrition",
                "category": "Pizza",
                "selling_price": 199,
                "cost_price": 80,
                "calories": -5,
            },
            headers=self.headers,
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
        denied = self.client.post(
            "/api/v1/restaurant/menu/menu",
            json={
                "name": "Staff Nutrition",
                "category": "Pizza",
                "selling_price": 199,
                "cost_price": 80,
            },
            headers=staff_headers,
        )
        self.assertEqual(denied.status_code, 403)


if __name__ == "__main__":
    unittest.main()
