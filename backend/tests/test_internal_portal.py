import os
import unittest
from datetime import date, timedelta

os.environ.setdefault("PYTHONDONTWRITEBYTECODE", "1")

from fastapi.testclient import TestClient

from app.main import app


class InternalPortalValidationTest(unittest.TestCase):
    def test_sales_comparison_pos_invoice_recipes_and_waste(self):
        today = date.today()
        yesterday = today - timedelta(days=1)
        last_year_today = today - timedelta(days=365)
        last_year_yesterday = yesterday - timedelta(days=365)

        with TestClient(app) as client:
            entries = [
                (today, 1000, 800, 350, "current day"),
                (yesterday, 800, 700, 300, "current previous day"),
                (last_year_today, 500, 500, 200, "last year same day"),
                (last_year_yesterday, 700, 650, 250, "last year previous day"),
            ]
            for entry_date, sale, cash, expense, notes in entries:
                response = client.post(
                    "/api/v1/restaurant/sales/daily-entry",
                    json={
                        "date": entry_date.isoformat(),
                        "total_sale": sale,
                        "cash_collected": cash,
                        "total_expense": expense,
                        "payment_method": "mixed",
                        "notes": notes,
                    },
                )
                self.assertEqual(response.status_code, 200)

            dashboard = client.get("/api/v1/restaurant/stats/dashboard-stats?period=7days")
            self.assertEqual(dashboard.status_code, 200)
            metrics = dashboard.json()["metrics"]
            self.assertEqual(metrics["total_sales"], 1800)
            self.assertEqual(metrics["total_expense"], 650)
            self.assertEqual(metrics["total_profit"], 1150)

            comparison = client.get(
                "/api/v1/restaurant/stats/compare/same-period?period=7days"
            )
            self.assertEqual(comparison.status_code, 200)
            comparison_payload = comparison.json()
            self.assertEqual(comparison_payload["current_total"], 1800)
            self.assertEqual(comparison_payload["last_year_total"], 1200)
            self.assertEqual(comparison_payload["change_percent"], 50.0)
            self.assertEqual(comparison_payload["direction"], "up")

            lifetime = client.get("/api/v1/restaurant/stats/insights/lifetime-summary")
            self.assertEqual(lifetime.status_code, 200)
            lifetime_payload = lifetime.json()
            self.assertEqual(lifetime_payload["total_revenue"], 3000)
            self.assertEqual(lifetime_payload["total_profit"], 1900)

            tables = client.get("/api/v1/restaurant/orders/tables")
            self.assertEqual(tables.status_code, 200)
            self.assertGreaterEqual(len(tables.json()), 8)

            order = client.post(
                "/api/v1/restaurant/orders/",
                json={
                    "order_type": "dine-in",
                    "table_number": "T1",
                    "items": [{"name": "Margherita Pizza (R)", "quantity": 2, "price": 199}],
                    "payment_method": "cash",
                },
            )
            self.assertEqual(order.status_code, 200)
            order_id = order.json()["order_id"]
            self.assertEqual(order.json()["total"], 417.9)

            invoice = client.post(f"/api/v1/restaurant/orders/{order_id}/invoice")
            self.assertEqual(invoice.status_code, 200)
            self.assertTrue(invoice.json()["invoice_number"].startswith("PB-"))

            closed = client.patch(f"/api/v1/restaurant/orders/{order_id}/close")
            self.assertEqual(closed.status_code, 200)
            self.assertEqual(closed.json()["status"], "closed")

            today_orders = client.get("/api/v1/restaurant/orders/today")
            self.assertEqual(today_orders.status_code, 200)
            self.assertEqual(today_orders.json()["total_collected_today"], 417.9)

            recipe = client.post(
                "/api/v1/restaurant/recipes/",
                json={
                    "menu_item": "Margherita Pizza (R)",
                    "ingredients": [
                        {"name": "Mozzarella", "quantity": 120, "unit": "gm"},
                        {"name": "Pizza Base", "quantity": 1, "unit": "unit"},
                    ],
                },
            )
            self.assertEqual(recipe.status_code, 200)

            prediction = client.get("/api/v1/restaurant/recipes/next-day-prediction")
            self.assertEqual(prediction.status_code, 200)
            prediction_names = {
                item["ingredient_name"] for item in prediction.json()["predictions"]
            }
            self.assertIn("Mozzarella", prediction_names)

            waste = client.post(
                "/api/v1/restaurant/sales/waste",
                json={
                    "date": today.isoformat(),
                    "item_name": "Pizza Base",
                    "quantity": 3,
                    "unit": "unit",
                    "estimated_cost": 90,
                    "reason": "Burned during prep",
                },
            )
            self.assertEqual(waste.status_code, 200)

            waste_summary = client.get("/api/v1/restaurant/sales/waste/summary")
            self.assertEqual(waste_summary.status_code, 200)
            self.assertEqual(waste_summary.json()["total_waste_cost"], 90)


if __name__ == "__main__":
    unittest.main()
