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

            promo = client.post(
                "/api/v1/restaurant/promotions/",
                json={
                    "name": "Weekend Combo",
                    "start_date": yesterday.isoformat(),
                    "end_date": today.isoformat(),
                    "discount_type": "percentage",
                    "discount_value": 15,
                },
            )
            self.assertEqual(promo.status_code, 200)
            promo_id = promo.json()["promotion"]["id"]

            active_promos = client.get("/api/v1/restaurant/promotions/active")
            self.assertEqual(active_promos.status_code, 200)
            self.assertIn("Weekend Combo", [item["name"] for item in active_promos.json()])

            promo_performance = client.get(
                f"/api/v1/restaurant/promotions/performance/{promo_id}"
            )
            self.assertEqual(promo_performance.status_code, 200)
            self.assertAlmostEqual(
                promo_performance.json()["total_revenue_during"],
                2217.9,
                places=2,
            )

            shift = client.post(
                "/api/v1/restaurant/shifts/",
                json={
                    "date": today.isoformat(),
                    "staff_name": "Amit",
                    "role": "Chef",
                    "shift_start": "11:00",
                    "shift_end": "23:00",
                },
            )
            self.assertEqual(shift.status_code, 200)

            shift_performance = client.get("/api/v1/restaurant/shifts/performance")
            self.assertEqual(shift_performance.status_code, 200)
            self.assertEqual(shift_performance.json()[0]["staff_name"], "Amit")

            shift_day = client.get(f"/api/v1/restaurant/shifts/by-date/{today.isoformat()}")
            self.assertEqual(shift_day.status_code, 200)
            self.assertAlmostEqual(shift_day.json()["total_sale"], 1417.9, places=2)

            vendors = client.get("/api/v1/restaurant/vendors/")
            self.assertEqual(vendors.status_code, 200)
            vendor_id = vendors.json()[0]["id"]

            first_price = client.post(
                "/api/v1/restaurant/vendors/prices",
                json={
                    "vendor_id": vendor_id,
                    "item_name": "Amul Cheese",
                    "price_per_unit": 500,
                    "unit": "kg",
                },
            )
            self.assertEqual(first_price.status_code, 200)

            second_price = client.post(
                "/api/v1/restaurant/vendors/prices",
                json={
                    "vendor_id": vendor_id,
                    "item_name": "Amul Cheese",
                    "price_per_unit": 550,
                    "unit": "kg",
                },
            )
            self.assertEqual(second_price.status_code, 200)

            price_history = client.get("/api/v1/restaurant/vendors/prices/history/Amul Cheese")
            self.assertEqual(price_history.status_code, 200)
            self.assertGreaterEqual(len(price_history.json()), 2)

            price_alerts = client.get("/api/v1/restaurant/vendors/prices/alerts/increases")
            self.assertEqual(price_alerts.status_code, 200)
            self.assertIn("Amul Cheese", [item["item_name"] for item in price_alerts.json()])

            cheapest = client.get("/api/v1/restaurant/vendors/intelligence/cheapest/Amul Cheese")
            self.assertEqual(cheapest.status_code, 200)
            self.assertEqual(cheapest.json()[0]["price_per_unit"], 550)

            breakeven_setup = client.post(
                "/api/v1/restaurant/stats/breakeven/setup",
                params={
                    "month": today.strftime("%Y-%m"),
                    "rent": 1000,
                    "salaries": 2000,
                    "utilities": 500,
                    "other_fixed": 250,
                    "avg_order_value": 250,
                },
            )
            self.assertEqual(breakeven_setup.status_code, 200)

            breakeven = client.get("/api/v1/restaurant/stats/breakeven")
            self.assertEqual(breakeven.status_code, 200)
            self.assertEqual(breakeven.json()["fixed_costs"]["total"], 3750)

            empty_order = client.post(
                "/api/v1/restaurant/orders/",
                json={"order_type": "takeaway", "items": []},
            )
            self.assertEqual(empty_order.status_code, 422)

            takeaway = client.post(
                "/api/v1/restaurant/orders/",
                json={
                    "order_type": "takeaway",
                    "customer_name": "Walk-in",
                    "customer_phone": "9999999999",
                    "payment_method": "upi",
                    "discount_amount": 10,
                    "items": [
                        {"name": "Margherita Pizza (R)", "quantity": 2, "price": 199}
                    ],
                },
            )
            self.assertEqual(takeaway.status_code, 200)
            self.assertEqual(takeaway.json()["subtotal"], 398)
            self.assertEqual(takeaway.json()["discount"], 10)
            self.assertEqual(takeaway.json()["tax"], 19.4)
            self.assertEqual(takeaway.json()["total"], 407.4)

            takeaway_id = takeaway.json()["order_id"]
            fetched_order = client.get(f"/api/v1/restaurant/orders/{takeaway_id}")
            self.assertEqual(fetched_order.status_code, 200)
            self.assertEqual(fetched_order.json()["customer_phone"], "9999999999")

            customers = client.get("/api/v1/restaurant/customers/")
            self.assertEqual(customers.status_code, 200)
            customer_phones = [customer["phone"] for customer in customers.json()]
            self.assertIn("9999999999", customer_phones)

            customer_summary = client.get("/api/v1/restaurant/customers/summary")
            self.assertEqual(customer_summary.status_code, 200)
            self.assertEqual(customer_summary.json()["total_customers"], 1)

            takeaway_invoice = client.post(
                f"/api/v1/restaurant/orders/{takeaway_id}/invoice?customer_name=Walk-in"
            )
            self.assertEqual(takeaway_invoice.status_code, 200)
            self.assertTrue(takeaway_invoice.json()["invoice_number"].startswith("PB-"))

            closed_takeaway = client.patch(
                f"/api/v1/restaurant/orders/{takeaway_id}/close?payment_method=upi"
            )
            self.assertEqual(closed_takeaway.status_code, 200)
            self.assertEqual(closed_takeaway.json()["status"], "closed")


if __name__ == "__main__":
    unittest.main()
