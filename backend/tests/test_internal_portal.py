import hashlib
import hmac
import json
import os
import unittest
from datetime import date, timedelta

os.environ.setdefault("PYTHONDONTWRITEBYTECODE", "1")

from fastapi.testclient import TestClient

from app.core.config import settings
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

            for inventory_item in [
                {
                    "name": "Mozzarella",
                    "category": "Dairy",
                    "unit": "gm",
                    "current_stock": 1000,
                    "minimum_stock": 200,
                    "cost_per_unit": 0.5,
                },
                {
                    "name": "Pizza Base",
                    "category": "Bakery",
                    "unit": "unit",
                    "current_stock": 100,
                    "minimum_stock": 20,
                    "cost_per_unit": 20,
                },
            ]:
                inventory_response = client.post(
                    "/api/v1/restaurant/inventory/items",
                    json=inventory_item,
                )
                self.assertEqual(inventory_response.status_code, 200)

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

            profitability = client.get("/api/v1/restaurant/menu/profitability")
            self.assertEqual(profitability.status_code, 200)
            margherita_profit = next(
                item
                for item in profitability.json()["items"]
                if item["item"] == "Margherita Pizza (R)"
            )
            self.assertEqual(margherita_profit["cost_to_make"], 80)
            self.assertEqual(margherita_profit["cost_source"], "recipe")
            self.assertEqual(margherita_profit["margin"], 119)
            self.assertEqual(margherita_profit["rating"], "Good")

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
                    "code": "WEEKEND15",
                    "start_date": yesterday.isoformat(),
                    "end_date": today.isoformat(),
                    "discount_type": "percentage",
                    "discount_value": 15,
                    "audience": "marketing_opt_in",
                    "channel": "whatsapp",
                    "status": "active",
                    "message_template": "Hi {name}, use {code} for {offer} at Pizza Blitz.",
                },
            )
            self.assertEqual(promo.status_code, 200)
            promo_id = promo.json()["promotion"]["id"]
            self.assertEqual(promo.json()["promotion"]["code"], "WEEKEND15")

            active_promos = client.get("/api/v1/restaurant/promotions/active")
            self.assertEqual(active_promos.status_code, 200)
            self.assertIn("Weekend Combo", [item["name"] for item in active_promos.json()])

            coupon = client.post(
                "/api/v1/restaurant/promotions/validate-code",
                json={"code": "weekend15", "subtotal": 398},
            )
            self.assertEqual(coupon.status_code, 200)
            self.assertEqual(coupon.json()["discount"], 59.7)
            self.assertEqual(coupon.json()["tax"], 16.92)
            self.assertEqual(coupon.json()["total"], 355.22)

            coupon_order = client.post(
                "/api/v1/restaurant/orders/",
                json={
                    "order_type": "takeaway",
                    "customer_name": "Coupon Guest",
                    "payment_method": "upi",
                    "coupon_code": " weekend 15 ",
                    "discount_amount": 300,
                    "items": [
                        {"name": "Margherita Pizza (R)", "quantity": 2, "price": 199}
                    ],
                },
            )
            self.assertEqual(coupon_order.status_code, 200)
            self.assertEqual(coupon_order.json()["discount"], 59.7)
            self.assertEqual(coupon_order.json()["tax"], 16.92)
            self.assertEqual(coupon_order.json()["total"], 355.22)
            self.assertEqual(coupon_order.json()["coupon_code"], "WEEKEND15")

            coupon_order_detail = client.get(
                f"/api/v1/restaurant/orders/{coupon_order.json()['order_id']}"
            )
            self.assertEqual(coupon_order_detail.status_code, 200)
            self.assertIn("Coupon: WEEKEND15", coupon_order_detail.json()["notes"])

            invalid_coupon_order = client.post(
                "/api/v1/restaurant/orders/",
                json={
                    "order_type": "takeaway",
                    "payment_method": "upi",
                    "coupon_code": "NOPE",
                    "items": [
                        {"name": "Margherita Pizza (R)", "quantity": 1, "price": 199}
                    ],
                },
            )
            self.assertEqual(invalid_coupon_order.status_code, 404)

            promo_performance = client.get(
                f"/api/v1/restaurant/promotions/performance/{promo_id}"
            )
            self.assertEqual(promo_performance.status_code, 200)
            self.assertAlmostEqual(
                promo_performance.json()["total_revenue_during"],
                2217.9,
                places=2,
            )
            self.assertEqual(promo_performance.json()["redemption_count"], 1)
            self.assertEqual(promo_performance.json()["redemption_discount"], 59.7)

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
                    "customer_email": "walkin@example.com",
                    "opt_in_marketing": True,
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

            preparing = client.patch(
                f"/api/v1/restaurant/orders/{takeaway_id}/status",
                json={"status": "preparing"},
            )
            self.assertEqual(preparing.status_code, 200)
            self.assertEqual(preparing.json()["status"], "preparing")

            ready = client.patch(
                f"/api/v1/restaurant/orders/{takeaway_id}/status",
                json={"status": "ready"},
            )
            self.assertEqual(ready.status_code, 200)
            self.assertEqual(ready.json()["status"], "ready")

            tracking = client.get(
                f"/api/v1/restaurant/orders/track/{takeaway_id}?phone=9999999999"
            )
            self.assertEqual(tracking.status_code, 200)
            self.assertEqual(tracking.json()["status"], "ready")
            self.assertEqual(tracking.json()["eta_window"], "Ready now")
            self.assertEqual(tracking.json()["tracking_steps"][3]["complete"], True)

            wrong_phone_tracking = client.get(
                f"/api/v1/restaurant/orders/track/{takeaway_id}?phone=1111111111"
            )
            self.assertEqual(wrong_phone_tracking.status_code, 404)

            customers = client.get("/api/v1/restaurant/customers/")
            self.assertEqual(customers.status_code, 200)
            customer_phones = [customer["phone"] for customer in customers.json()]
            self.assertIn("9999999999", customer_phones)
            walkin_customer = next(
                customer
                for customer in customers.json()
                if customer["phone"] == "9999999999"
            )
            self.assertEqual(walkin_customer["email"], "walkin@example.com")
            self.assertEqual(walkin_customer["opt_in_marketing"], True)

            customer_summary = client.get("/api/v1/restaurant/customers/summary")
            self.assertEqual(customer_summary.status_code, 200)
            self.assertEqual(customer_summary.json()["total_customers"], 1)

            customer_history = client.get(
                "/api/v1/restaurant/orders/customer-history/9999999999"
            )
            self.assertEqual(customer_history.status_code, 200)
            self.assertEqual(customer_history.json()["customer"]["phone"], "9999999999")
            self.assertEqual(customer_history.json()["customer"]["email"], "walkin@example.com")
            self.assertEqual(customer_history.json()["customer"]["opt_in_marketing"], True)
            self.assertEqual(customer_history.json()["customer"]["total_orders"], 1)
            self.assertEqual(customer_history.json()["orders"][0]["id"], takeaway_id)

            missing_auth = client.get("/api/v1/auth/me")
            self.assertEqual(missing_auth.status_code, 401)

            invalid_admin_login = client.post(
                "/api/v1/auth/admin/login",
                json={"id": "admin", "password": "wrong"},
            )
            self.assertEqual(invalid_admin_login.status_code, 401)

            admin_login = client.post(
                "/api/v1/auth/admin/login",
                json={"id": "admin", "password": "admin123"},
            )
            self.assertEqual(admin_login.status_code, 200)
            self.assertEqual(admin_login.json()["role"], "admin")
            admin_token = admin_login.json()["access_token"]
            admin_session = client.get(
                "/api/v1/auth/me",
                headers={"Authorization": f"Bearer {admin_token}"},
            )
            self.assertEqual(admin_session.status_code, 200)
            self.assertEqual(admin_session.json()["role"], "admin")

            customer_login = client.post(
                "/api/v1/auth/customer/login",
                json={"phone": "9999999999"},
            )
            self.assertEqual(customer_login.status_code, 200)
            self.assertEqual(customer_login.json()["role"], "customer")
            self.assertEqual(customer_login.json()["phone"], "9999999999")
            customer_session = client.get(
                "/api/v1/auth/me",
                headers={"Authorization": f"Bearer {customer_login.json()['access_token']}"},
            )
            self.assertEqual(customer_session.status_code, 200)
            self.assertEqual(customer_session.json()["role"], "customer")

            zones = client.get("/api/v1/restaurant/delivery/zones")
            self.assertEqual(zones.status_code, 200)
            self.assertIn("City Core", [zone["name"] for zone in zones.json()])
            city_core_zone = next(zone for zone in zones.json() if zone["name"] == "City Core")

            delivery_quote = client.post(
                "/api/v1/restaurant/delivery/quote",
                json={
                    "address": "12 Park Street",
                    "subtotal": 119,
                    "zone_id": city_core_zone["id"],
                },
            )
            self.assertEqual(delivery_quote.status_code, 200)
            self.assertEqual(delivery_quote.json()["is_deliverable"], True)
            self.assertEqual(delivery_quote.json()["delivery_fee"], 39)

            invalid_delivery_quote = client.post(
                "/api/v1/restaurant/delivery/quote",
                json={"address": "Park", "subtotal": 119},
            )
            self.assertEqual(invalid_delivery_quote.status_code, 422)

            delivery = client.post(
                "/api/v1/restaurant/orders/",
                json={
                    "order_type": "delivery",
                    "customer_name": "Walk-in",
                    "customer_phone": "9999999999",
                    "customer_email": "walkin@example.com",
                    "opt_in_marketing": True,
                    "payment_method": "prepaid",
                    "delivery_zone_id": city_core_zone["id"],
                    "notes": (
                        "Customer website order | Fulfillment: delivery | "
                        "ETA: 35-45 min | Address: 12 Park Street"
                    ),
                    "items": [
                        {"name": "Garlic Bread", "quantity": 1, "price": 119}
                    ],
                },
            )
            self.assertEqual(delivery.status_code, 200)
            self.assertEqual(delivery.json()["delivery_fee"], 39)
            self.assertEqual(delivery.json()["delivery_zone"], "City Core")
            self.assertEqual(delivery.json()["total"], 163.95)
            delivery_id = delivery.json()["order_id"]

            delivery_detail = client.get(f"/api/v1/restaurant/orders/{delivery_id}")
            self.assertEqual(delivery_detail.status_code, 200)
            self.assertEqual(delivery_detail.json()["source"], "customer_website")
            self.assertEqual(delivery_detail.json()["fulfillment_type"], "delivery")
            self.assertEqual(delivery_detail.json()["delivery_address"], "12 Park Street")
            self.assertEqual(delivery_detail.json()["delivery_zone"], "City Core")
            self.assertEqual(delivery_detail.json()["delivery_fee"], 39)
            self.assertEqual(delivery_detail.json()["eta_window"], "35-45 min")
            self.assertEqual(delivery_detail.json()["payment_due"], True)

            delivery_tracking = client.get(
                f"/api/v1/restaurant/orders/track/{delivery_id}?phone=9999999999"
            )
            self.assertEqual(delivery_tracking.status_code, 200)
            self.assertEqual(delivery_tracking.json()["tracking_steps"][1]["complete"], False)
            self.assertIn("Payment is pending", delivery_tracking.json()["next_action"])

            assignment = client.patch(
                f"/api/v1/restaurant/delivery/orders/{delivery_id}/assignment",
                json={"assigned_to": "Ravi", "status": "assigned"},
            )
            self.assertEqual(assignment.status_code, 200)
            self.assertEqual(assignment.json()["assignment"]["assigned_to"], "Ravi")
            self.assertEqual(assignment.json()["assignment"]["status"], "assigned")

            delivery_queue = client.get("/api/v1/restaurant/delivery/queue")
            self.assertEqual(delivery_queue.status_code, 200)
            self.assertEqual(delivery_queue.json()["count"], 1)
            self.assertEqual(
                delivery_queue.json()["orders"][0]["assignment"]["assigned_to"],
                "Ravi",
            )

            promo_outreach = client.get(f"/api/v1/restaurant/promotions/{promo_id}/outreach")
            self.assertEqual(promo_outreach.status_code, 200)
            outreach_payload = promo_outreach.json()
            self.assertEqual(outreach_payload["audience_count"], 1)
            self.assertEqual(outreach_payload["contacts"][0]["phone"], "9999999999")
            self.assertIn("WEEKEND15", outreach_payload["message_preview"])

            opt_out_order = client.post(
                "/api/v1/restaurant/orders/",
                json={
                    "order_type": "takeaway",
                    "customer_name": "Privacy Guest",
                    "customer_phone": "9777777777",
                    "customer_email": "privacy@example.com",
                    "opt_in_marketing": False,
                    "payment_method": "cash",
                    "items": [
                        {"name": "Garlic Bread", "quantity": 1, "price": 119}
                    ],
                },
            )
            self.assertEqual(opt_out_order.status_code, 200)

            opt_out_history = client.get(
                "/api/v1/restaurant/orders/customer-history/9777777777"
            )
            self.assertEqual(opt_out_history.status_code, 200)
            self.assertEqual(opt_out_history.json()["customer"]["email"], "privacy@example.com")
            self.assertEqual(opt_out_history.json()["customer"]["opt_in_marketing"], False)

            post_opt_out_summary = client.get("/api/v1/restaurant/customers/summary")
            self.assertEqual(post_opt_out_summary.status_code, 200)
            self.assertEqual(post_opt_out_summary.json()["total_customers"], 2)
            self.assertEqual(post_opt_out_summary.json()["opted_in_customers"], 1)
            self.assertEqual(post_opt_out_summary.json()["opted_out_customers"], 1)
            self.assertEqual(post_opt_out_summary.json()["email_ready_customers"], 2)

            opt_in_segment = client.get(
                "/api/v1/restaurant/customers/",
                params={"segment": "marketing_opt_in"},
            )
            self.assertEqual(opt_in_segment.status_code, 200)
            self.assertEqual([customer["phone"] for customer in opt_in_segment.json()], ["9999999999"])

            opted_out_segment = client.get(
                "/api/v1/restaurant/customers/",
                params={"segment": "opted_out"},
            )
            self.assertEqual(opted_out_segment.status_code, 200)
            self.assertEqual([customer["phone"] for customer in opted_out_segment.json()], ["9777777777"])

            email_search = client.get(
                "/api/v1/restaurant/customers/",
                params={"q": "walkin@example.com"},
            )
            self.assertEqual(email_search.status_code, 200)
            self.assertEqual(email_search.json()[0]["phone"], "9999999999")

            opt_out_outreach = client.get(f"/api/v1/restaurant/promotions/{promo_id}/outreach")
            self.assertEqual(opt_out_outreach.status_code, 200)
            self.assertEqual(opt_out_outreach.json()["audience_count"], 1)
            self.assertNotIn(
                "9777777777",
                [contact["phone"] for contact in opt_out_outreach.json()["contacts"]],
            )

            promo_dispatch = client.get(f"/api/v1/restaurant/promotions/{promo_id}/dispatch")
            self.assertEqual(promo_dispatch.status_code, 200)
            dispatch_payload = promo_dispatch.json()
            self.assertEqual(dispatch_payload["audience_count"], 1)
            self.assertEqual(dispatch_payload["send_ready_count"], 1)
            self.assertEqual(dispatch_payload["missing_destination_count"], 0)
            self.assertEqual(dispatch_payload["contacts"][0]["destination"], "9999999999")
            self.assertTrue(
                dispatch_payload["contacts"][0]["action_url"].startswith(
                    "https://wa.me/9999999999?text="
                )
            )
            self.assertIn("WEEKEND15", dispatch_payload["contacts"][0]["message"])

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
            usage_by_ingredient = {
                item["ingredient_name"]: item
                for item in closed_takeaway.json()["inventory_usage"]
            }
            self.assertEqual(usage_by_ingredient["Mozzarella"]["quantity"], 240)
            self.assertEqual(usage_by_ingredient["Pizza Base"]["quantity"], 2)

            inventory_after_close = client.get("/api/v1/restaurant/inventory/items")
            self.assertEqual(inventory_after_close.status_code, 200)
            stock_by_name = {
                item["name"]: item["current_stock"]
                for item in inventory_after_close.json()
            }
            self.assertEqual(stock_by_name["Mozzarella"], 760)
            self.assertEqual(stock_by_name["Pizza Base"], 98)

            repeated_close = client.patch(
                f"/api/v1/restaurant/orders/{takeaway_id}/close?payment_method=upi"
            )
            self.assertEqual(repeated_close.status_code, 200)
            self.assertEqual(repeated_close.json()["inventory_usage"], [])

            inventory_after_repeat = client.get("/api/v1/restaurant/inventory/items")
            self.assertEqual(inventory_after_repeat.status_code, 200)
            inventory_items_after_repeat = inventory_after_repeat.json()
            repeat_stock_by_name = {
                item["name"]: item["current_stock"]
                for item in inventory_items_after_repeat
            }
            self.assertEqual(repeat_stock_by_name["Mozzarella"], 760)
            self.assertEqual(repeat_stock_by_name["Pizza Base"], 98)
            inventory_id_by_name = {
                item["name"]: item["id"]
                for item in inventory_items_after_repeat
            }

            usage_transactions = client.get(
                f"/api/v1/restaurant/inventory/transactions?item_id={inventory_id_by_name['Mozzarella']}&limit=5"
            )
            self.assertEqual(usage_transactions.status_code, 200)
            self.assertIn(
                "usage",
                [transaction["transaction_type"] for transaction in usage_transactions.json()],
            )

            manual_wastage = client.post(
                "/api/v1/restaurant/inventory/transaction",
                json={
                    "item_id": inventory_id_by_name["Pizza Base"],
                    "transaction_type": "wastage",
                    "quantity": 1,
                    "unit_cost": 20,
                    "notes": "Test stock count correction",
                },
            )
            self.assertEqual(manual_wastage.status_code, 200)
            self.assertEqual(manual_wastage.json()["new_stock"], 97)
            self.assertEqual(
                manual_wastage.json()["transaction"]["signed_quantity"],
                -1,
            )

            invalid_transaction = client.post(
                "/api/v1/restaurant/inventory/transaction",
                json={
                    "item_id": inventory_id_by_name["Pizza Base"],
                    "transaction_type": "spoiled",
                    "quantity": 1,
                },
            )
            self.assertEqual(invalid_transaction.status_code, 422)

            recent_transactions = client.get(
                "/api/v1/restaurant/inventory/transactions?limit=10"
            )
            self.assertEqual(recent_transactions.status_code, 200)
            self.assertIn(
                "Test stock count correction",
                [transaction["notes"] for transaction in recent_transactions.json()],
            )

            for low_stock_item in [
                {
                    "name": "Tomato Sauce",
                    "category": "Sauces",
                    "unit": "liters",
                    "current_stock": 3,
                    "minimum_stock": 10,
                    "cost_per_unit": 120,
                    "supplier_name": "Fresh Farms",
                    "supplier_whatsapp": "919999999999",
                },
                {
                    "name": "Basil",
                    "category": "Herbs",
                    "unit": "bunch",
                    "current_stock": 1,
                    "minimum_stock": 5,
                    "cost_per_unit": 20,
                    "supplier_name": "Fresh Farms",
                    "supplier_whatsapp": "919999999999",
                },
            ]:
                low_stock_response = client.post(
                    "/api/v1/restaurant/inventory/items",
                    json=low_stock_item,
                )
                self.assertEqual(low_stock_response.status_code, 200)

            low_stock_summary = client.get("/api/v1/restaurant/inventory/low-stock")
            self.assertEqual(low_stock_summary.status_code, 200)
            low_stock_payload = low_stock_summary.json()
            self.assertEqual(low_stock_payload["count"], 2)
            reorder_by_name = {
                item["name"]: item["reorder_quantity"]
                for item in low_stock_payload["items"]
            }
            self.assertEqual(reorder_by_name["Tomato Sauce"], 17)
            self.assertEqual(reorder_by_name["Basil"], 9)

            reorder_drafts = client.post(
                "/api/v1/restaurant/purchase-orders/from-low-stock"
            )
            self.assertEqual(reorder_drafts.status_code, 200)
            self.assertEqual(reorder_drafts.json()["created"], 1)
            draft = reorder_drafts.json()["purchase_orders"][0]
            draft_id = draft["id"]
            self.assertEqual(draft["supplier_name"], "Fresh Farms")
            self.assertEqual(draft["total_amount"], 2220)
            self.assertEqual(len(draft["items"]), 2)

            reconciled_items = []
            for item in draft["items"]:
                updated_item = dict(item)
                if item["name"] == "Tomato Sauce":
                    updated_item["received_quantity"] = 18
                    updated_item["unit_cost"] = 110
                elif item["name"] == "Basil":
                    updated_item["received_quantity"] = 8
                    updated_item["unit_cost"] = 22
                reconciled_items.append(updated_item)

            reconciled_po = client.patch(
                f"/api/v1/restaurant/purchase-orders/{draft_id}/items",
                json={"items": reconciled_items},
            )
            self.assertEqual(reconciled_po.status_code, 200)
            self.assertEqual(reconciled_po.json()["total_amount"], 2156)
            reconciled_by_name = {
                item["name"]: item
                for item in reconciled_po.json()["items"]
            }
            self.assertEqual(
                reconciled_by_name["Tomato Sauce"]["received_quantity"],
                18,
            )
            self.assertEqual(reconciled_by_name["Basil"]["unit_cost"], 22)

            sent_po = client.patch(
                f"/api/v1/restaurant/purchase-orders/{draft_id}/sent"
            )
            self.assertEqual(sent_po.status_code, 200)
            self.assertEqual(sent_po.json()["purchase_order"]["status"], "sent")
            self.assertIsNotNone(
                sent_po.json()["purchase_order"]["whatsapp_sent_at"]
            )

            received_po = client.patch(
                f"/api/v1/restaurant/purchase-orders/{draft_id}/receive"
            )
            self.assertEqual(received_po.status_code, 200)
            self.assertEqual(received_po.json()["purchase_order"]["status"], "received")
            updates_by_name = {
                item["name"]: item
                for item in received_po.json()["inventory_updates"]
            }
            self.assertEqual(updates_by_name["Tomato Sauce"]["quantity"], 18)
            self.assertEqual(updates_by_name["Tomato Sauce"]["new_stock"], 21)
            self.assertEqual(updates_by_name["Tomato Sauce"]["unit_cost"], 110)
            self.assertEqual(updates_by_name["Basil"]["quantity"], 8)
            self.assertEqual(updates_by_name["Basil"]["new_stock"], 9)
            self.assertEqual(updates_by_name["Basil"]["unit_cost"], 22)
            self.assertEqual(received_po.json()["expense"]["amount"], 2156)
            self.assertEqual(len(received_po.json()["vendor_prices"]), 2)
            self.assertIn(
                f"Purchase order #{draft_id}",
                received_po.json()["expense"]["description"],
            )

            tomato_price_history = client.get(
                "/api/v1/restaurant/vendors/prices/history/Tomato Sauce"
            )
            self.assertEqual(tomato_price_history.status_code, 200)
            latest_tomato_price = tomato_price_history.json()[0]
            self.assertEqual(latest_tomato_price["vendor_name"], "Fresh Farms")
            self.assertEqual(latest_tomato_price["price_per_unit"], 110)
            self.assertIn(
                f"Purchase order #{draft_id}",
                latest_tomato_price["notes"],
            )

            recent_vendor_prices = client.get(
                "/api/v1/restaurant/vendors/prices/recent?limit=5"
            )
            self.assertEqual(recent_vendor_prices.status_code, 200)
            self.assertIn(
                "Tomato Sauce",
                [item["item_name"] for item in recent_vendor_prices.json()],
            )

            purchase_transactions = client.get(
                "/api/v1/restaurant/inventory/transactions?transaction_type=purchase&limit=10"
            )
            self.assertEqual(purchase_transactions.status_code, 200)
            self.assertIn(
                "Tomato Sauce",
                [transaction["item_name"] for transaction in purchase_transactions.json()],
            )

            low_stock_after_receive = client.get(
                "/api/v1/restaurant/inventory/low-stock"
            )
            self.assertEqual(low_stock_after_receive.status_code, 200)
            self.assertEqual(low_stock_after_receive.json()["count"], 0)

            repeated_receive = client.patch(
                f"/api/v1/restaurant/purchase-orders/{draft_id}/receive"
            )
            self.assertEqual(repeated_receive.status_code, 200)
            self.assertEqual(repeated_receive.json()["inventory_updates"], [])

            purchase_expenses = client.get("/api/v1/restaurant/expenses/expenses")
            self.assertEqual(purchase_expenses.status_code, 200)
            posted_po_expenses = [
                expense
                for expense in purchase_expenses.json()
                if f"Purchase order #{draft_id}" in (expense["description"] or "")
            ]
            self.assertEqual(len(posted_po_expenses), 1)
            self.assertEqual(posted_po_expenses[0]["amount"], 2156)

            expense_categories = client.get("/api/v1/restaurant/expenses/categories")
            self.assertEqual(expense_categories.status_code, 200)
            category_by_name = {
                category["name"]: category["id"]
                for category in expense_categories.json()
            }
            self.assertIn("Inventory Purchase", category_by_name)
            self.assertIn("Marketing", category_by_name)

            manual_expense = client.post(
                "/api/v1/restaurant/expenses/expenses",
                json={
                    "date": f"{today.isoformat()}T12:00:00",
                    "category_id": category_by_name["Marketing"],
                    "amount": 123,
                    "description": "Local flyer campaign",
                },
            )
            self.assertEqual(manual_expense.status_code, 200)
            self.assertEqual(manual_expense.json()["amount"], 123)

            received_reconcile = client.patch(
                f"/api/v1/restaurant/purchase-orders/{draft_id}/items",
                json={"items": reconciled_items},
            )
            self.assertEqual(received_reconcile.status_code, 409)

            closed_status_update = client.patch(
                f"/api/v1/restaurant/orders/{takeaway_id}/status",
                json={"status": "open"},
            )
            self.assertEqual(closed_status_update.status_code, 409)

            prepaid = client.post(
                "/api/v1/restaurant/orders/",
                json={
                    "order_type": "pickup",
                    "customer_name": "Prepaid Guest",
                    "customer_phone": "9888888888",
                    "payment_method": "prepaid",
                    "items": [
                        {"name": "Garlic Bread", "quantity": 1, "price": 119}
                    ],
                },
            )
            self.assertEqual(prepaid.status_code, 200)
            self.assertEqual(prepaid.json()["payment_status"], "awaiting_payment")

            prepaid_id = prepaid.json()["order_id"]
            payment_session = client.post(
                f"/api/v1/restaurant/orders/{prepaid_id}/payment-session",
                json={"provider": "manual", "return_url": "http://localhost:3000/account"},
            )
            self.assertEqual(payment_session.status_code, 200)
            self.assertEqual(
                payment_session.json()["payment_session"]["provider"],
                "manual",
            )
            self.assertEqual(
                payment_session.json()["order"]["payment_status"],
                "awaiting_payment",
            )

            unpaid_prepaid_close = client.patch(
                f"/api/v1/restaurant/orders/{prepaid_id}/close?payment_method=prepaid"
            )
            self.assertEqual(unpaid_prepaid_close.status_code, 409)

            payment = client.post(
                f"/api/v1/restaurant/orders/{prepaid_id}/payment-confirmation",
                json={
                    "payment_provider": "manual",
                    "payment_reference": "TEST-PAY-001",
                    "paid_amount": prepaid.json()["total"],
                },
            )
            self.assertEqual(payment.status_code, 200)
            self.assertEqual(payment.json()["payment_status"], "paid")
            self.assertEqual(payment.json()["payment_reference"], "TEST-PAY-001")

            webhook_order = client.post(
                "/api/v1/restaurant/orders/",
                json={
                    "order_type": "pickup",
                    "customer_name": "Webhook Guest",
                    "customer_phone": "9666666666",
                    "payment_method": "prepaid",
                    "items": [
                        {"name": "Garlic Bread", "quantity": 1, "price": 119}
                    ],
                },
            )
            self.assertEqual(webhook_order.status_code, 200)
            webhook_order_id = webhook_order.json()["order_id"]

            manual_webhook = client.post(
                "/api/v1/restaurant/orders/payments/webhook/manual",
                json={
                    "order_id": webhook_order_id,
                    "payment_reference": "WEBHOOK-MANUAL-001",
                    "paid_amount": webhook_order.json()["total"],
                    "status": "paid",
                },
            )
            self.assertEqual(manual_webhook.status_code, 200)
            self.assertEqual(manual_webhook.json()["status"], "processed")
            self.assertEqual(
                manual_webhook.json()["order"]["payment_status"],
                "paid",
            )
            self.assertEqual(
                manual_webhook.json()["order"]["payment_reference"],
                "WEBHOOK-MANUAL-001",
            )

            repeated_manual_webhook = client.post(
                "/api/v1/restaurant/orders/payments/webhook/manual",
                json={
                    "order_id": webhook_order_id,
                    "payment_reference": "WEBHOOK-MANUAL-001",
                    "paid_amount": webhook_order.json()["total"],
                    "status": "paid",
                },
            )
            self.assertEqual(repeated_manual_webhook.status_code, 200)
            self.assertEqual(repeated_manual_webhook.json()["status"], "already_paid")

            gateway_order = client.post(
                "/api/v1/restaurant/orders/",
                json={
                    "order_type": "pickup",
                    "customer_name": "Gateway Guest",
                    "customer_phone": "9555555555",
                    "payment_method": "prepaid",
                    "items": [
                        {"name": "Garlic Bread", "quantity": 1, "price": 119}
                    ],
                },
            )
            self.assertEqual(gateway_order.status_code, 200)
            gateway_order_id = gateway_order.json()["order_id"]
            razorpay_payload = {
                "event": "payment.captured",
                "payload": {
                    "payment": {
                        "entity": {
                            "id": "pay_test_001",
                            "order_id": f"razorpay_{gateway_order_id}",
                            "amount": int(round(gateway_order.json()["total"] * 100)),
                            "status": "captured",
                            "notes": {"order_id": str(gateway_order_id)},
                        }
                    }
                },
            }
            razorpay_body = json.dumps(
                razorpay_payload,
                separators=(",", ":"),
            ).encode("utf-8")
            old_razorpay_secret = settings.RAZORPAY_WEBHOOK_SECRET
            settings.RAZORPAY_WEBHOOK_SECRET = "test_webhook_secret"
            try:
                bad_gateway_webhook = client.post(
                    "/api/v1/restaurant/orders/payments/webhook/razorpay",
                    content=razorpay_body,
                    headers={
                        "content-type": "application/json",
                        "x-razorpay-signature": "bad-signature",
                    },
                )
                self.assertEqual(bad_gateway_webhook.status_code, 401)

                razorpay_signature = hmac.new(
                    b"test_webhook_secret",
                    razorpay_body,
                    hashlib.sha256,
                ).hexdigest()
                gateway_webhook = client.post(
                    "/api/v1/restaurant/orders/payments/webhook/razorpay",
                    content=razorpay_body,
                    headers={
                        "content-type": "application/json",
                        "x-razorpay-signature": razorpay_signature,
                    },
                )
                self.assertEqual(gateway_webhook.status_code, 200)
                self.assertEqual(gateway_webhook.json()["status"], "processed")
                self.assertEqual(
                    gateway_webhook.json()["order"]["payment_status"],
                    "paid",
                )
                self.assertEqual(
                    gateway_webhook.json()["order"]["payment_reference"],
                    "pay_test_001",
                )
            finally:
                settings.RAZORPAY_WEBHOOK_SECRET = old_razorpay_secret


if __name__ == "__main__":
    unittest.main()
