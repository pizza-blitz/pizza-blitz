"""Operations and facilities workspaces: checklists, assets and work orders."""

import os
import time
import unittest
from datetime import datetime, timedelta

os.environ.setdefault("PYTHONDONTWRITEBYTECODE", "1")

from fastapi.testclient import TestClient

from app.core.clock import business_today
from app.core.config import settings
from app.db.session import SessionLocal
from app.main import app
from app.models.domain import (
    MaintenanceAsset,
    MaintenanceWorkOrder,
    OpsChecklistRun,
    OpsChecklistTemplate,
)

BASE = "/api/v1/restaurant"
OPS = f"{BASE}/company/operations"


class OperationsWorkspaceTest(unittest.TestCase):
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
        self.template_ids: list[int] = []
        self.asset_ids: list[int] = []
        self.work_order_ids: list[int] = []

    def tearDown(self):
        db = SessionLocal()
        try:
            if self.template_ids:
                run_ids = [
                    row.id
                    for row in db.query(OpsChecklistRun.id)
                    .filter(OpsChecklistRun.template_id.in_(self.template_ids))
                    .all()
                ]
                if run_ids:
                    db.query(OpsChecklistRun).filter(
                        OpsChecklistRun.id.in_(run_ids)
                    ).delete(synchronize_session=False)
                db.query(OpsChecklistTemplate).filter(
                    OpsChecklistTemplate.id.in_(self.template_ids)
                ).delete(synchronize_session=False)
            if self.work_order_ids:
                db.query(MaintenanceWorkOrder).filter(
                    MaintenanceWorkOrder.id.in_(self.work_order_ids)
                ).delete(synchronize_session=False)
            if self.asset_ids:
                db.query(MaintenanceWorkOrder).filter(
                    MaintenanceWorkOrder.asset_id.in_(self.asset_ids)
                ).delete(synchronize_session=False)
                db.query(MaintenanceAsset).filter(
                    MaintenanceAsset.id.in_(self.asset_ids)
                ).delete(synchronize_session=False)
            db.commit()
        finally:
            db.close()
        self._ctx.__exit__(None, None, None)

    def create_template(self, name: str, items: list[dict], **overrides) -> dict:
        payload = {
            "name": name,
            "description": "Created by the operations workspace test.",
            "kind": "opening",
            "items": items,
        }
        payload.update(overrides)
        response = self.client.post(
            f"{OPS}/checklists/templates", json=payload, headers=self.headers
        )
        self.assertEqual(response.status_code, 200, response.text)
        template = response.json()
        self.template_ids.append(template["id"])
        return template

    def start_run(self, template_id: int, **overrides) -> dict:
        payload = {"template_id": template_id}
        payload.update(overrides)
        response = self.client.post(
            f"{OPS}/checklists/runs", json=payload, headers=self.headers
        )
        self.assertEqual(response.status_code, 200, response.text)
        return response.json()

    def test_checklists_seed_and_run_lifecycle(self):
        listed = self.client.get(f"{OPS}/checklists", headers=self.headers)
        self.assertEqual(listed.status_code, 200, listed.text)
        payload = listed.json()
        self.assertIn("items", payload)
        self.assertIn("summary", payload)
        templates = payload["templates"]
        names = {row["name"] for row in templates}
        self.assertIn("Opening checklist", names)
        self.assertIn("Closing checklist", names)
        self.assertIn("Weekly deep clean", names)
        opening = next(row for row in templates if row["name"] == "Opening checklist")
        self.assertEqual(opening["kind"], "opening")
        self.assertEqual(opening["item_count"], 8)
        self.assertTrue(any(item["required"] for item in opening["items"]))
        self.assertGreaterEqual(payload["summary"]["templates"], 3)
        self.assertEqual(
            payload["summary"]["active_templates"], payload["summary"]["templates"]
        )

        template = self.create_template(
            f"Shift handover {self.suffix}",
            [
                {"label": "Confirm till float", "required": True},
                {"label": "Log fridge temperature", "required": True},
                {"label": "Sign the handover sheet"},
            ],
        )
        self.assertEqual(template["item_count"], 3)
        self.assertEqual(
            [item["required"] for item in template["items"]], [True, True, False]
        )

        run = self.start_run(template["id"])
        self.assertEqual(run["status"], "in_progress")
        self.assertEqual(run["template_name"], template["name"])
        self.assertEqual(run["total_count"], 3)
        self.assertEqual(run["done_count"], 0)
        self.assertEqual(run["required_remaining"], 2)
        self.assertEqual(run["started_by"], settings.PIZZA_BLITZ_ADMIN_NAME)
        self.assertIsNone(run["completed_at"])

        duplicate = self.start_run(template["id"])
        self.assertEqual(duplicate["id"], run["id"])
        self.assertEqual(duplicate["total_count"], 3)

        first_patch = self.client.patch(
            f"{OPS}/checklists/runs/{run['id']}",
            json={
                "items": [
                    {"label": "Confirm till float", "done": True},
                    {"label": "Log fridge temperature", "done": False},
                    {"label": "Sign the handover sheet", "done": False},
                ]
            },
            headers=self.headers,
        )
        self.assertEqual(first_patch.status_code, 200, first_patch.text)
        partial = first_patch.json()
        self.assertEqual(partial["status"], "in_progress")
        self.assertEqual(partial["done_count"], 1)
        self.assertEqual(partial["required_remaining"], 1)
        self.assertIsNotNone(partial["items"][0]["completed_at"])

        completed = self.client.patch(
            f"{OPS}/checklists/runs/{run['id']}",
            json={
                "items": [
                    {"label": "Confirm till float", "done": True},
                    {"label": "Log fridge temperature", "done": True},
                    {"label": "Sign the handover sheet", "done": True},
                ],
                "notes": "Handover complete.",
            },
            headers=self.headers,
        )
        self.assertEqual(completed.status_code, 200, completed.text)
        finished = completed.json()
        self.assertEqual(finished["status"], "completed")
        self.assertEqual(finished["done_count"], 3)
        self.assertEqual(finished["required_remaining"], 0)
        self.assertIsNotNone(finished["completed_at"])
        self.assertEqual(finished["notes"], "Handover complete.")

        refreshed = self.client.get(f"{OPS}/checklists", headers=self.headers)
        self.assertEqual(refreshed.status_code, 200, refreshed.text)
        summary = refreshed.json()["summary"]
        self.assertGreaterEqual(summary["runs_today"], 1)
        self.assertGreaterEqual(summary["completed_today"], 1)
        self.assertGreaterEqual(summary["completion_rate"], 1)
        self.assertLessEqual(summary["completion_rate"], 100)
        run_ids = {row["id"] for row in refreshed.json()["runs"]}
        self.assertIn(run["id"], run_ids)

        filtered = self.client.get(
            f"{OPS}/checklists",
            params={"run_date": business_today().isoformat()},
            headers=self.headers,
        )
        self.assertEqual(filtered.status_code, 200, filtered.text)
        self.assertTrue(
            all(
                row["run_date"] == business_today().isoformat()
                for row in filtered.json()["items"]
            )
        )

        bad_status = self.client.patch(
            f"{OPS}/checklists/runs/{run['id']}",
            json={"status": "paused"},
            headers=self.headers,
        )
        self.assertEqual(bad_status.status_code, 422)

        missing = self.client.post(
            f"{OPS}/checklists/runs",
            json={"template_id": 999999},
            headers=self.headers,
        )
        self.assertEqual(missing.status_code, 404)

        inactive = self.create_template(
            f"Retired checklist {self.suffix}",
            [{"label": "Only item", "required": True}],
        )
        deactivated = self.client.patch(
            f"{OPS}/checklists/templates/{inactive['id']}",
            json={"active": False},
            headers=self.headers,
        )
        self.assertEqual(deactivated.status_code, 200, deactivated.text)
        self.assertFalse(deactivated.json()["active"])
        rejected = self.client.post(
            f"{OPS}/checklists/runs",
            json={"template_id": inactive["id"]},
            headers=self.headers,
        )
        self.assertEqual(rejected.status_code, 422)

        empty_items = self.client.post(
            f"{OPS}/checklists/templates",
            json={"name": "Broken template", "items": []},
            headers=self.headers,
        )
        self.assertEqual(empty_items.status_code, 422)

    def create_asset(self, **overrides) -> dict:
        payload = {
            "name": f"Test asset {self.suffix}",
            "category": "kitchen",
            "location": "Main kitchen",
            "criticality": "normal",
        }
        payload.update(overrides)
        response = self.client.post(f"{OPS}/assets", json=payload, headers=self.headers)
        self.assertEqual(response.status_code, 200, response.text)
        asset = response.json()
        self.asset_ids.append(asset["id"])
        return asset

    def create_work_order(self, **overrides) -> dict:
        payload = {"title": f"Repair fryer {self.suffix}", "priority": "normal"}
        payload.update(overrides)
        response = self.client.post(
            f"{OPS}/work-orders", json=payload, headers=self.headers
        )
        self.assertEqual(response.status_code, 200, response.text)
        work_order = response.json()
        self.work_order_ids.append(work_order["id"])
        return work_order

    def test_asset_and_work_order_lifecycle(self):
        tomorrow = business_today() + timedelta(days=7)
        asset = self.create_asset(
            name=f"Convection oven {self.suffix}",
            next_service_due=tomorrow.isoformat(),
            serial_number=f"SN-{self.suffix}",
        )
        self.assertEqual(asset["status"], "operational")
        self.assertTrue(asset["service_due"])
        self.assertEqual(asset["open_work_orders"], 0)

        invalid_asset = self.client.post(
            f"{OPS}/assets",
            json={"name": "Bad status asset", "status": "exploded"},
            headers=self.headers,
        )
        self.assertEqual(invalid_asset.status_code, 422)

        filtered = self.client.get(
            f"{OPS}/assets",
            params={"query": f"Convection oven {self.suffix}"},
            headers=self.headers,
        )
        self.assertEqual(filtered.status_code, 200, filtered.text)
        self.assertEqual([row["id"] for row in filtered.json()["items"]], [asset["id"]])
        self.assertEqual(filtered.json()["summary"]["due_service"], 1)

        past_due = datetime.utcnow() - timedelta(days=2)
        work_order = self.create_work_order(
            asset_id=asset["id"],
            priority="urgent",
            due_at=past_due.isoformat(),
            description="Oven tripping the circuit breaker.",
        )
        self.assertEqual(work_order["status"], "open")
        self.assertEqual(work_order["asset_name"], asset["name"])
        self.assertEqual(work_order["reported_by"], settings.PIZZA_BLITZ_ADMIN_NAME)
        self.assertTrue(work_order["overdue"])

        after_create = self.client.get(
            f"{OPS}/assets",
            params={"query": f"Convection oven {self.suffix}"},
            headers=self.headers,
        )
        maintained = after_create.json()["items"][0]
        self.assertEqual(maintained["status"], "under_maintenance")
        self.assertEqual(maintained["open_work_orders"], 1)

        listed = self.client.get(
            f"{OPS}/work-orders",
            params={"asset_id": asset["id"]},
            headers=self.headers,
        )
        self.assertEqual(listed.status_code, 200, listed.text)
        self.assertEqual(listed.json()["summary"]["open"], 1)
        self.assertEqual(listed.json()["summary"]["overdue"], 1)

        closed = self.client.patch(
            f"{OPS}/work-orders/{work_order['id']}",
            json={"status": "completed", "cost": 125.5, "assigned_to": "tech-1"},
            headers=self.headers,
        )
        self.assertEqual(closed.status_code, 200, closed.text)
        finished = closed.json()
        self.assertEqual(finished["status"], "completed")
        self.assertEqual(finished["cost"], 125.5)
        self.assertIsNotNone(finished["completed_at"])
        self.assertFalse(finished["overdue"])
        self.assertEqual(finished["assigned_to"], "tech-1")

        restored = self.client.get(
            f"{OPS}/assets",
            params={"query": f"Convection oven {self.suffix}"},
            headers=self.headers,
        )
        restored_asset = restored.json()["items"][0]
        self.assertEqual(restored_asset["status"], "operational")
        self.assertEqual(restored_asset["open_work_orders"], 0)

        bad_status = self.client.patch(
            f"{OPS}/work-orders/{work_order['id']}",
            json={"status": "paused"},
            headers=self.headers,
        )
        self.assertEqual(bad_status.status_code, 422)

        missing_asset = self.client.post(
            f"{OPS}/work-orders",
            json={"title": "Unknown asset job", "asset_id": 999999},
            headers=self.headers,
        )
        self.assertEqual(missing_asset.status_code, 404)

        bad_priority = self.client.post(
            f"{OPS}/work-orders",
            json={"title": "Bad priority job", "priority": "whenever"},
            headers=self.headers,
        )
        self.assertEqual(bad_priority.status_code, 422)

        missing_work_order = self.client.patch(
            f"{OPS}/work-orders/999999", json={"status": "completed"}, headers=self.headers
        )
        self.assertEqual(missing_work_order.status_code, 404)

    def test_asset_sorting_and_cancelled_work_order(self):
        prefix = f"Sort asset {self.suffix}"
        due_soon = self.create_asset(
            name=f"{prefix} A",
            next_service_due=(business_today() + timedelta(days=5)).isoformat(),
        )
        no_service = self.create_asset(name=f"{prefix} B")
        due_later = self.create_asset(
            name=f"{prefix} C",
            next_service_due=(business_today() + timedelta(days=60)).isoformat(),
        )
        self.assertFalse(no_service["service_due"])
        self.assertFalse(due_later["service_due"])

        listed = self.client.get(
            f"{OPS}/assets", params={"query": prefix}, headers=self.headers
        )
        self.assertEqual(listed.status_code, 200, listed.text)
        ordered = [row["id"] for row in listed.json()["items"]]
        self.assertEqual(ordered, [due_soon["id"], due_later["id"], no_service["id"]])

        work_order = self.create_work_order(
            asset_id=due_later["id"], priority="normal", title=f"Replace gasket {self.suffix}"
        )
        cancelled = self.client.patch(
            f"{OPS}/work-orders/{work_order['id']}",
            json={"status": "cancelled"},
            headers=self.headers,
        )
        self.assertEqual(cancelled.status_code, 200, cancelled.text)
        asset = self.client.get(
            f"{OPS}/assets",
            params={"query": f"{prefix} C"},
            headers=self.headers,
        ).json()["items"][0]
        self.assertEqual(asset["status"], "operational")
        self.assertEqual(asset["open_work_orders"], 0)


if __name__ == "__main__":
    unittest.main()
