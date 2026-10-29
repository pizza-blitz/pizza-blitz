"""AI insights endpoint tests.

The AI provider is optional. When no key is configured the endpoint must still
answer 200 with standard guidance instead of failing the page, and when the
provider works it must forward the restaurant's own numbers to the model.
"""

import os
import unittest
import uuid
from datetime import date, datetime, timedelta
from unittest import mock

os.environ.setdefault("PYTHONDONTWRITEBYTECODE", "1")

from sqlalchemy import func

from fastapi.testclient import TestClient

from app.core.config import settings
from app.db.session import SessionLocal
from app.main import app
from app.models.domain import DailySales, InventoryItem


INSIGHTS_PATH = "/api/v1/restaurant/insights/ai-insights"


class AiInsightsTest(unittest.TestCase):
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

        self.proof_name = f"Proof Mozzarella {uuid.uuid4().hex[:8]}"
        self.sales_date = date.today() - timedelta(days=1)
        db = SessionLocal()
        try:
            db.add(
                DailySales(
                    date=self.sales_date,
                    total_sale=5000,
                    total_expense=1200,
                    profit=3800,
                )
            )
            db.add(
                InventoryItem(
                    name=self.proof_name,
                    category="cheese",
                    unit="kg",
                    current_stock=0.4,
                    minimum_stock=5.0,
                    cost_per_unit=400,
                )
            )
            db.commit()
        finally:
            db.close()

    def tearDown(self):
        db = SessionLocal()
        try:
            for row in db.query(DailySales).filter(DailySales.date == self.sales_date).all():
                db.delete(row)
            for item in db.query(InventoryItem).filter(
                InventoryItem.name == self.proof_name
            ).all():
                db.delete(item)
            db.commit()
        finally:
            db.close()
        self._ctx.__exit__(None, None, None)

    def expected_figures(self):
        """Recompute what the endpoint should have read from the database."""
        thirty_days_ago = datetime.utcnow() - timedelta(days=30)
        with SessionLocal() as db:
            sales = db.query(DailySales).filter(DailySales.date >= thirty_days_ago).all()
            low_stock = (
                db.query(func.count(InventoryItem.id))
                .filter(InventoryItem.current_stock < InventoryItem.minimum_stock)
                .scalar()
                or 0
            )
        total_sale = sum(float(row.total_sale) for row in sales)
        total_expense = sum(float(row.total_expense) for row in sales)
        return total_sale, total_expense, total_sale - total_expense, int(low_stock)

    def test_configured_provider_returns_model_insights(self):
        payload = '{"summary": "Trim cheese waste before Friday.", "tips": ["Prep half batches."]}'
        prompts = []

        def fake_generate_text(*, model, contents, **_kwargs):
            prompts.append((model, contents))
            return payload

        total_sale, total_expense, net_profit, low_stock = self.expected_figures()
        with mock.patch(
            "app.api.api_v1.endpoints.insights.generate_text",
            side_effect=fake_generate_text,
        ):
            response = self.client.get(INSIGHTS_PATH, headers=self.headers)

        self.assertEqual(response.status_code, 200, response.text)
        body = response.json()
        self.assertEqual(body["status"], "success")
        self.assertTrue(body["ai_configured"])
        self.assertEqual(body["data"]["summary"], "Trim cheese waste before Friday.")
        self.assertEqual(body["data"]["tips"], ["Prep half batches."])

        self.assertEqual(len(prompts), 1)
        model, prompt = prompts[0]
        self.assertEqual(model, "gemini-1.5-flash")
        # The prompt must carry the restaurant's own figures, not filler copy.
        # The endpoint interpolates a Python dict, so the values appear in
        # dict-repr form with single quotes.
        self.assertIn(f"'total_sales': {total_sale}", prompt)
        self.assertIn(f"'total_expense': {total_expense}", prompt)
        self.assertIn(f"'net_profit': {net_profit}", prompt)
        self.assertGreaterEqual(low_stock, 1)
        self.assertIn(f"'low_stock_count': {low_stock}", prompt)
        if low_stock <= 5:  # the endpoint only sends the first five names.
            self.assertIn(self.proof_name, prompt)

    def test_missing_provider_key_returns_fallback_guidance(self):
        total_sale, _total_expense, net_profit, low_stock = self.expected_figures()
        with mock.patch.dict(os.environ, {}, clear=True):
            response = self.client.get(INSIGHTS_PATH, headers=self.headers)

        self.assertEqual(response.status_code, 200, response.text)
        body = response.json()
        self.assertEqual(body["status"], "fallback")
        self.assertFalse(body["ai_configured"])
        self.assertTrue(body["ai_error"])
        self.assertIn("not configured", body["message"])
        self.assertIsInstance(body["data"]["summary"], str)
        self.assertGreaterEqual(len(body["data"]["tips"]), 1)
        self.assertTrue(all(isinstance(tip, str) for tip in body["data"]["tips"]))

        # The fallback has to state real numbers, not an invented trend.
        self.assertIn(f"Rs {total_sale:,.2f}", body["data"]["summary"])
        self.assertIn(f"Rs {net_profit:,.2f}", body["data"]["summary"])
        self.assertGreaterEqual(low_stock, 1)
        self.assertIn(f"{low_stock} inventory item(s)", body["data"]["summary"])

    def test_provider_failure_also_falls_back(self):
        with mock.patch(
            "app.api.api_v1.endpoints.insights.generate_text",
            side_effect=RuntimeError("model overloaded"),
        ):
            response = self.client.get(INSIGHTS_PATH, headers=self.headers)

        self.assertEqual(response.status_code, 200, response.text)
        body = response.json()
        self.assertEqual(body["status"], "fallback")
        self.assertIn("model overloaded", body["ai_error"])

    def test_requires_admin_session(self):
        response = self.client.get(INSIGHTS_PATH)
        self.assertIn(response.status_code, (401, 403))


if __name__ == "__main__":
    unittest.main()
