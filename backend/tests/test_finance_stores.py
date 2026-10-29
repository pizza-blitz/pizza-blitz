"""Store dimensions on finance ledgers and the outlet P&L workspace."""

import os
import time
import unittest

os.environ.setdefault("PYTHONDONTWRITEBYTECODE", "1")

from fastapi.testclient import TestClient

from app.core.clock import business_today
from app.core.config import settings
from app.db.session import SessionLocal
from app.main import app
from app.models.domain import (
    Approval,
    ApprovalStep,
    DailySales,
    Expense,
    InventoryItem,
    InventoryTransaction,
    PurchaseOrder,
    Store,
    Vendor,
    VendorPriceHistory,
    WasteLog,
    WorkItem,
)
from app.services.company_catalog import MODULE_BY_KEY

BASE = "/api/v1/restaurant"


class FinanceStoreTest(unittest.TestCase):
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
        code = f"FIN{str(int(time.time() * 1000))[-6:]}"
        created = self.client.post(
            f"{BASE}/stores/",
            json={
                "name": f"Pizza Blitz {code}",
                "code": code,
                "address_line": "22 Ledger Lane",
            },
            headers=self.headers,
        )
        self.assertEqual(created.status_code, 200, created.text)
        self.store = created.json()
        self.item_name = f"Outlet Cheese {code}"
        self.vendor_name = f"Ledger Dairy {code}"

    def tearDown(self):
        # The suite shares one in-memory database; remove this outlet's ledger
        # rows so company-wide totals in later tests stay deterministic.
        store_id = getattr(self, "store", {}).get("id")
        if store_id is not None:
            db = SessionLocal()
            try:
                approval_ids = [
                    row.id
                    for row in db.query(Approval.id)
                    .filter(Approval.store_id == store_id)
                    .all()
                ]
                if approval_ids:
                    db.query(ApprovalStep).filter(
                        ApprovalStep.approval_id.in_(approval_ids)
                    ).delete(synchronize_session=False)
                    db.query(Approval).filter(
                        Approval.id.in_(approval_ids)
                    ).delete(synchronize_session=False)
                db.query(WorkItem).filter(
                    WorkItem.store_id == store_id
                ).delete(synchronize_session=False)
                db.query(Expense).filter(
                    Expense.store_id == store_id
                ).delete(synchronize_session=False)
                db.query(DailySales).filter(
                    DailySales.store_id == store_id
                ).delete(synchronize_session=False)
                db.query(WasteLog).filter(
                    WasteLog.store_id == store_id
                ).delete(synchronize_session=False)
                db.query(PurchaseOrder).filter(
                    PurchaseOrder.store_id == store_id
                ).delete(synchronize_session=False)
                inventory_item = (
                    db.query(InventoryItem)
                    .filter(InventoryItem.name == self.item_name)
                    .first()
                )
                if inventory_item is not None:
                    db.query(InventoryTransaction).filter(
                        InventoryTransaction.item_id == inventory_item.id
                    ).delete(synchronize_session=False)
                    db.delete(inventory_item)
                vendor = (
                    db.query(Vendor)
                    .filter(Vendor.name == self.vendor_name)
                    .first()
                )
                if vendor is not None:
                    db.query(VendorPriceHistory).filter(
                        VendorPriceHistory.vendor_id == vendor.id
                    ).delete(synchronize_session=False)
                    db.delete(vendor)
                db.query(Store).filter(Store.id == store_id).delete(
                    synchronize_session=False
                )
                db.commit()
            finally:
                db.close()
        self._ctx.__exit__(None, None, None)

    def daily_entry(self, **overrides):
        payload = {
            "date": self.today,
            "total_sale": 1200,
            "cash_collected": 900,
            "total_expense": 200,
            "payment_method": "mixed",
            "notes": "Outlet ledger test",
            "store_id": self.store["id"],
        }
        payload.update(overrides)
        return self.client.post(
            f"{BASE}/sales/daily-entry", json=payload, headers=self.headers
        )

    def pnl(self, **params):
        query = {"start_date": self.today, "end_date": self.today, **params}
        return self.client.get(
            f"{BASE}/finance/outlet-pnl", params=query, headers=self.headers
        )

    def test_ledger_rows_are_scoped_to_their_outlet(self):
        created = self.daily_entry()
        self.assertEqual(created.status_code, 200, created.text)
        self.assertEqual(created.json()["action"], "created")
        self.assertEqual(created.json()["data"]["store_id"], self.store["id"])

        updated = self.daily_entry(total_sale=1500, cash_collected=1100)
        self.assertEqual(updated.status_code, 200, updated.text)
        self.assertEqual(updated.json()["action"], "updated")

        scoped = self.client.get(
            f"{BASE}/sales/",
            params={"store_id": self.store["id"]},
            headers=self.headers,
        )
        self.assertEqual(scoped.status_code, 200, scoped.text)
        rows = [row for row in scoped.json() if row["date"] == self.today]
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]["store_id"], self.store["id"])
        self.assertAlmostEqual(float(rows[0]["total_sale"]), 1500, places=2)

        exported = self.client.get(
            f"{BASE}/sales/export/csv",
            params={"store_id": self.store["id"]},
            headers=self.headers,
        )
        self.assertEqual(exported.status_code, 200, exported.text)
        self.assertIn("Outlet", exported.text.splitlines()[0])
        self.assertIn(self.store["name"], exported.text)

        missing = self.daily_entry(store_id=999999)
        self.assertEqual(missing.status_code, 404)

    def test_outlet_pnl_splits_costs_and_keeps_untracked_gap(self):
        module = MODULE_BY_KEY["finance-budgets"]
        self.assertEqual(module["route_template"], "/finance/pnl")
        self.assertEqual(module["default_status"], "active")

        self.assertEqual(self.daily_entry().status_code, 200)
        baseline_default = self.client.get(
            f"{BASE}/expenses/expenses",
            params={"store_id": 1},
            headers=self.headers,
        )
        self.assertEqual(baseline_default.status_code, 200)
        default_expense_ids = {row["id"] for row in baseline_default.json()}

        categories = self.client.get(
            f"{BASE}/expenses/categories", headers=self.headers
        )
        self.assertEqual(categories.status_code, 200, categories.text)
        category_by_name = {
            row["name"]: row["id"] for row in categories.json()
        }
        utilities = self.client.post(
            f"{BASE}/expenses/expenses",
            json={
                "store_id": self.store["id"],
                "date": f"{self.today}T12:00:00",
                "category_id": category_by_name["Utilities"],
                "amount": 50,
                "description": "Outlet electricity",
            },
            headers=self.headers,
        )
        self.assertEqual(utilities.status_code, 200, utilities.text)
        self.assertEqual(utilities.json()["store_id"], self.store["id"])

        order = self.client.post(
            f"{BASE}/purchase-orders/",
            json={
                "store_id": self.store["id"],
                "supplier_name": self.vendor_name,
                "supplier_whatsapp": "919999900000",
                "items": [
                    {
                        "name": self.item_name,
                        "quantity": 10,
                        "unit_cost": 20,
                    }
                ],
                "total_amount": 200,
                "status": "draft",
            },
            headers=self.headers,
        )
        self.assertEqual(order.status_code, 200, order.text)
        order_id = order.json()["id"]
        self.assertEqual(order.json()["store_id"], self.store["id"])

        received = self.client.patch(
            f"{BASE}/purchase-orders/{order_id}/receive", headers=self.headers
        )
        self.assertEqual(received.status_code, 200, received.text)
        self.assertIsNotNone(received.json()["purchase_order"]["received_at"])
        self.assertEqual(received.json()["expense"]["store_id"], self.store["id"])

        listed_orders = self.client.get(
            f"{BASE}/purchase-orders/",
            params={"store_id": self.store["id"]},
            headers=self.headers,
        )
        self.assertEqual(listed_orders.status_code, 200)
        self.assertEqual([row["id"] for row in listed_orders.json()], [order_id])

        waste = self.client.post(
            f"{BASE}/sales/waste",
            json={
                "store_id": self.store["id"],
                "date": self.today,
                "item_name": "Mozzarella",
                "quantity": 1,
                "unit": "kg",
                "estimated_cost": 30,
                "reason": "Spoiled during prep",
            },
            headers=self.headers,
        )
        self.assertEqual(waste.status_code, 200, waste.text)
        self.assertEqual(waste.json()["store_id"], self.store["id"])

        scoped_expenses = self.client.get(
            f"{BASE}/expenses/expenses",
            params={"store_id": self.store["id"]},
            headers=self.headers,
        )
        self.assertEqual(scoped_expenses.status_code, 200)
        amounts = {row["amount"] for row in scoped_expenses.json()}
        self.assertEqual(amounts, {50.0, 200.0})
        self.assertTrue(
            all(row["store_id"] == self.store["id"] for row in scoped_expenses.json())
        )

        default_after = self.client.get(
            f"{BASE}/expenses/expenses",
            params={"store_id": 1},
            headers=self.headers,
        )
        self.assertEqual(
            {row["id"] for row in default_after.json()}, default_expense_ids
        )

        daily_scoped = self.client.get(
            f"{BASE}/sales/",
            params={"store_id": self.store["id"]},
            headers=self.headers,
        )
        ledger_row = next(
            row for row in daily_scoped.json() if row["date"] == self.today
        )
        self.assertAlmostEqual(float(ledger_row["total_expense"]), 450, places=2)

        response = self.pnl(store_id=self.store["id"])
        self.assertEqual(response.status_code, 200, response.text)
        data = response.json()
        summary = data["summary"]
        self.assertAlmostEqual(summary["revenue"], 1200, places=2)
        self.assertAlmostEqual(summary["cogs"], 200, places=2)
        self.assertAlmostEqual(summary["opex"], 50, places=2)
        self.assertAlmostEqual(summary["waste"], 30, places=2)
        self.assertAlmostEqual(summary["ledger_expense"], 450, places=2)
        self.assertAlmostEqual(summary["untracked_cost"], 200, places=2)
        self.assertAlmostEqual(summary["total_cost"], 480, places=2)
        self.assertAlmostEqual(summary["net_profit"], 720, places=2)
        self.assertAlmostEqual(summary["gross_profit"], 1000, places=2)
        self.assertEqual(summary["days_with_sales"], 1)
        self.assertEqual(summary["expense_count"], 2)
        self.assertEqual(len(data["stores"]), 1)
        self.assertEqual(data["stores"][0]["store_id"], self.store["id"])
        self.assertAlmostEqual(data["stores"][0]["net_profit"], 720, places=2)

        categories_out = {
            row["category"]: row for row in data["expense_categories"]
        }
        self.assertAlmostEqual(
            categories_out["Inventory Purchase"]["amount"], 200, places=2
        )
        self.assertEqual(categories_out["Inventory Purchase"]["kind"], "cogs")
        self.assertAlmostEqual(categories_out["Utilities"]["amount"], 50, places=2)
        self.assertEqual(categories_out["Utilities"]["kind"], "opex")

        trend_row = next(
            row for row in data["daily_trend"] if row["date"] == self.today
        )
        self.assertAlmostEqual(trend_row["revenue"], 1200, places=2)
        self.assertAlmostEqual(trend_row["net_profit"], 720, places=2)

        labels = {flag["label"] for flag in data["flags"]}
        self.assertIn("Unitemised ledger cost", labels)

        consolidated = self.pnl()
        self.assertEqual(consolidated.status_code, 200, consolidated.text)
        self.assertGreaterEqual(
            consolidated.json()["summary"]["revenue"],
            data["summary"]["revenue"],
        )
        store_ids = [row["store_id"] for row in consolidated.json()["stores"]]
        self.assertIn(self.store["id"], store_ids)

        missing_store = self.pnl(store_id=999999)
        self.assertEqual(missing_store.status_code, 404)
        reversed_range = self.client.get(
            f"{BASE}/finance/outlet-pnl",
            params={"start_date": self.today, "end_date": "2020-01-01"},
            headers=self.headers,
        )
        self.assertEqual(reversed_range.status_code, 422)

        anonymous = self.client.get(
            f"{BASE}/finance/outlet-pnl",
            params={"start_date": self.today, "end_date": self.today},
        )
        self.assertEqual(anonymous.status_code, 401)

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
        denied = self.client.get(
            f"{BASE}/finance/outlet-pnl",
            params={"start_date": self.today, "end_date": self.today},
            headers=staff_headers,
        )
        self.assertEqual(denied.status_code, 403)


if __name__ == "__main__":
    unittest.main()
