"""Supply workspace: stocktake sessions and inventory adjustments."""

import os
import time
import unittest

os.environ.setdefault("PYTHONDONTWRITEBYTECODE", "1")

from fastapi.testclient import TestClient

from app.core.config import settings
from app.db.session import SessionLocal
from app.main import app
from app.models.domain import InventoryItem, InventoryTransaction, StocktakeLine, StocktakeSession

BASE = "/api/v1/restaurant"
SUPPLY = f"{BASE}/company/supply"


class SupplyStocktakeTest(unittest.TestCase):
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
        self.suffix = str(int(time.time() * 1000))[-8:]
        self.item_name = f"Stocktake mozzarella {self.suffix}"
        created = self.client.post(
            f"{BASE}/inventory/items",
            json={
                "name": self.item_name,
                "category": "Dairy",
                "unit": "kg",
                "current_stock": 10,
                "minimum_stock": 2,
                "cost_per_unit": 5,
            },
            headers=self.headers,
        )
        self.assertEqual(created.status_code, 200, created.text)
        self.item = created.json()
        self.session_ids: list[int] = []

    def tearDown(self):
        db = SessionLocal()
        try:
            session_ids = list(self.session_ids)
            extra_ids = [
                row.id
                for row in db.query(StocktakeSession.id)
                .filter(StocktakeSession.title.like(f"%{self.suffix}%"))
                .all()
            ]
            session_ids = list(dict.fromkeys(session_ids + extra_ids))
            if session_ids:
                db.query(StocktakeLine).filter(
                    StocktakeLine.session_id.in_(session_ids)
                ).delete(synchronize_session=False)
                db.query(StocktakeSession).filter(
                    StocktakeSession.id.in_(session_ids)
                ).delete(synchronize_session=False)
            db.query(InventoryTransaction).filter(
                InventoryTransaction.item_id == self.item["id"]
            ).delete(synchronize_session=False)
            db.query(InventoryItem).filter(
                InventoryItem.id == self.item["id"]
            ).delete(synchronize_session=False)
            db.commit()
        finally:
            db.close()
        self._ctx.__exit__(None, None, None)

    def create_stocktake(self, **overrides) -> dict:
        payload = {
            "title": f"Bar count {self.suffix}",
            "item_ids": [self.item["id"]],
        }
        payload.update(overrides)
        response = self.client.post(
            f"{SUPPLY}/stocktakes", json=payload, headers=self.headers
        )
        self.assertEqual(response.status_code, 200, response.text)
        detail = response.json()
        self.session_ids.append(detail["session"]["id"])
        return detail

    def test_stocktake_lifecycle_applies_adjustments(self):
        listed = self.client.get(f"{SUPPLY}/stocktakes", headers=self.headers)
        self.assertEqual(listed.status_code, 200, listed.text)
        self.assertIn("items", listed.json())
        self.assertIn("summary", listed.json())

        detail = self.create_stocktake()
        stocktake = detail["session"]
        self.assertEqual(stocktake["status"], "counting")
        self.assertIsNotNone(stocktake["started_at"])
        self.assertIsNone(stocktake["completed_at"])
        self.assertEqual(detail["summary"]["line_count"], 1)
        self.assertEqual(detail["summary"]["expected_value"], 50.0)
        self.assertEqual(detail["summary"]["variance_value"], 0.0)
        line = detail["lines"][0]
        self.assertEqual(line["item_id"], self.item["id"])
        self.assertEqual(line["unit"], "kg")
        self.assertEqual(line["expected_qty"], 10.0)
        self.assertEqual(line["counted_qty"], 10.0)

        patched = self.client.patch(
            f"{SUPPLY}/stocktakes/{stocktake['id']}/lines/{line['id']}",
            json={"counted_qty": 7, "note": "Three kilos spoiled"},
            headers=self.headers,
        )
        self.assertEqual(patched.status_code, 200, patched.text)
        updated_line = patched.json()["line"]
        self.assertEqual(updated_line["variance_qty"], -3.0)
        self.assertEqual(updated_line["variance_value"], -15.0)
        self.assertEqual(updated_line["note"], "Three kilos spoiled")
        self.assertEqual(patched.json()["session"]["variance_value"], -15.0)

        fetched = self.client.get(
            f"{SUPPLY}/stocktakes/{stocktake['id']}", headers=self.headers
        )
        self.assertEqual(fetched.status_code, 200, fetched.text)
        summary = fetched.json()["summary"]
        self.assertEqual(summary["variance_lines"], 1)
        self.assertEqual(summary["variance_value"], -15.0)
        self.assertEqual(summary["expected_value"], 50.0)
        self.assertEqual(summary["counted_value"], 35.0)

        completed = self.client.post(
            f"{SUPPLY}/stocktakes/{stocktake['id']}/complete",
            json={"apply_adjustments": True},
            headers=self.headers,
        )
        self.assertEqual(completed.status_code, 200, completed.text)
        finished = completed.json()["session"]
        self.assertEqual(finished["status"], "completed")
        self.assertIsNotNone(finished["completed_at"])
        self.assertEqual(finished["counted_by"], settings.PIZZA_BLITZ_ADMIN_NAME)
        self.assertEqual(finished["variance_value"], -15.0)

        items = self.client.get(f"{BASE}/inventory/items", headers=self.headers)
        self.assertEqual(items.status_code, 200, items.text)
        stored_item = next(
            row for row in items.json() if row["id"] == self.item["id"]
        )
        self.assertAlmostEqual(float(stored_item["current_stock"]), 7.0, places=2)

        transactions = self.client.get(
            f"{BASE}/inventory/transactions",
            params={"item_id": self.item["id"]},
            headers=self.headers,
        )
        self.assertEqual(transactions.status_code, 200, transactions.text)
        adjustments = [
            row for row in transactions.json() if row["transaction_type"] == "adjustment"
        ]
        self.assertEqual(len(adjustments), 1)
        adjustment = adjustments[0]
        self.assertAlmostEqual(float(adjustment["quantity"]), -3.0, places=2)
        self.assertAlmostEqual(float(adjustment["total_cost"]), -15.0, places=2)
        self.assertIn(f"Stocktake #{stocktake['id']}", adjustment["notes"])

        repeat = self.client.post(
            f"{SUPPLY}/stocktakes/{stocktake['id']}/complete",
            json={},
            headers=self.headers,
        )
        self.assertEqual(repeat.status_code, 422)

        edit_after_complete = self.client.patch(
            f"{SUPPLY}/stocktakes/{stocktake['id']}",
            json={"title": "Renamed after completion"},
            headers=self.headers,
        )
        self.assertEqual(edit_after_complete.status_code, 422)

        notes_only = self.client.patch(
            f"{SUPPLY}/stocktakes/{stocktake['id']}",
            json={"notes": "Signed off by the manager."},
            headers=self.headers,
        )
        self.assertEqual(notes_only.status_code, 200, notes_only.text)
        self.assertEqual(
            notes_only.json()["session"]["notes"], "Signed off by the manager."
        )

        line_after_complete = self.client.patch(
            f"{SUPPLY}/stocktakes/{stocktake['id']}/lines/{line['id']}",
            json={"counted_qty": 5},
            headers=self.headers,
        )
        self.assertEqual(line_after_complete.status_code, 422)

        refreshed = self.client.get(f"{SUPPLY}/stocktakes", headers=self.headers)
        self.assertEqual(refreshed.status_code, 200, refreshed.text)
        row = next(
            entry
            for entry in refreshed.json()["items"]
            if entry["id"] == stocktake["id"]
        )
        self.assertEqual(row["status"], "completed")
        self.assertEqual(row["line_count"], 1)
        self.assertEqual(row["counted_lines"], 1)
        self.assertEqual(refreshed.json()["summary"]["completed"], 1)
        self.assertIsNotNone(refreshed.json()["summary"]["last_completed_at"])

    def test_stocktake_without_adjustments_leaves_stock_untouched(self):
        detail = self.create_stocktake(title=f"No adjust count {self.suffix}")
        stocktake = detail["session"]
        line = detail["lines"][0]

        patched = self.client.patch(
            f"{SUPPLY}/stocktakes/{stocktake['id']}/lines/{line['id']}",
            json={"counted_qty": 4},
            headers=self.headers,
        )
        self.assertEqual(patched.status_code, 200, patched.text)

        completed = self.client.post(
            f"{SUPPLY}/stocktakes/{stocktake['id']}/complete",
            json={"apply_adjustments": False},
            headers=self.headers,
        )
        self.assertEqual(completed.status_code, 200, completed.text)
        self.assertEqual(completed.json()["session"]["status"], "completed")

        items = self.client.get(f"{BASE}/inventory/items", headers=self.headers)
        stored_item = next(
            row for row in items.json() if row["id"] == self.item["id"]
        )
        self.assertAlmostEqual(float(stored_item["current_stock"]), 10.0, places=2)

        transactions = self.client.get(
            f"{BASE}/inventory/transactions",
            params={"item_id": self.item["id"]},
            headers=self.headers,
        )
        self.assertEqual(transactions.status_code, 200, transactions.text)
        self.assertEqual(
            [
                row
                for row in transactions.json()
                if row["transaction_type"] == "adjustment"
            ],
            [],
        )

    def test_stocktake_validation(self):
        missing = self.client.post(
            f"{SUPPLY}/stocktakes",
            json={"item_ids": [999999]},
            headers=self.headers,
        )
        self.assertEqual(missing.status_code, 404)

        missing_session = self.client.get(
            f"{SUPPLY}/stocktakes/999999", headers=self.headers
        )
        self.assertEqual(missing_session.status_code, 404)

        detail = self.create_stocktake(title=f"Validation count {self.suffix}")
        stocktake = detail["session"]
        line = detail["lines"][0]

        missing_line = self.client.patch(
            f"{SUPPLY}/stocktakes/{stocktake['id']}/lines/999999",
            json={"counted_qty": 1},
            headers=self.headers,
        )
        self.assertEqual(missing_line.status_code, 404)

        negative = self.client.patch(
            f"{SUPPLY}/stocktakes/{stocktake['id']}/lines/{line['id']}",
            json={"counted_qty": -1},
            headers=self.headers,
        )
        self.assertEqual(negative.status_code, 422)

        bad_status = self.client.patch(
            f"{SUPPLY}/stocktakes/{stocktake['id']}",
            json={"status": "paused"},
            headers=self.headers,
        )
        self.assertEqual(bad_status.status_code, 422)


if __name__ == "__main__":
    unittest.main()
