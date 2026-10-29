"""Gift card issuance, balance movement, public validation and voiding."""

import os
import time
import unittest

os.environ.setdefault("PYTHONDONTWRITEBYTECODE", "1")

from fastapi.testclient import TestClient

from app.core.config import settings
from app.main import app

BASE = "/api/v1/restaurant"


class CompanyGiftCardsTest(unittest.TestCase):
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
        self.marker = f"gift-{int(time.time() * 1000)}"
        self.created_card_ids: list[int] = []

    def tearDown(self):
        self._ctx.__exit__(None, None, None)

    def summary(self) -> dict:
        response = self.client.get(f"{BASE}/gift-cards/summary", headers=self.headers)
        self.assertEqual(response.status_code, 200, response.text)
        return response.json()

    def test_issue_reload_redeem_and_void(self):
        baseline = self.summary()
        created = self.client.post(
            f"{BASE}/gift-cards",
            json={
                "initial_balance": 1000,
                "customer_phone": "919999900001",
                "note": self.marker,
            },
            headers=self.headers,
        )
        self.assertEqual(created.status_code, 201, created.text)
        card = created.json()
        self.created_card_ids.append(card["id"])
        self.assertTrue(card["code"].startswith("PB-"))
        self.assertEqual(len(card["code"]), 11)
        self.assertAlmostEqual(card["initial_balance"], 1000.0, places=2)
        self.assertAlmostEqual(card["balance"], 1000.0, places=2)
        self.assertEqual(card["status"], "active")

        public = self.client.get(
            f"{BASE}/gift-cards/public/validate/{card['code'].lower()}"
        )
        self.assertEqual(public.status_code, 200, public.text)
        self.assertTrue(public.json()["valid"])
        self.assertAlmostEqual(public.json()["balance"], 1000.0, places=2)

        after_issue = self.summary()
        self.assertAlmostEqual(
            after_issue["outstanding_balance"],
            baseline["outstanding_balance"] + 1000.0,
            places=2,
        )

        reloaded = self.client.post(
            f"{BASE}/gift-cards/{card['id']}/reload",
            json={"amount": 500, "note": "Top up"},
            headers=self.headers,
        )
        self.assertEqual(reloaded.status_code, 200, reloaded.text)
        self.assertAlmostEqual(reloaded.json()["card"]["balance"], 1500.0, places=2)

        redeemed = self.client.post(
            f"{BASE}/gift-cards/{card['id']}/redeem",
            json={"amount": 200, "note": "Counter sale"},
            headers=self.headers,
        )
        self.assertEqual(redeemed.status_code, 200, redeemed.text)
        self.assertAlmostEqual(redeemed.json()["card"]["balance"], 1300.0, places=2)

        public_after = self.client.get(
            f"{BASE}/gift-cards/public/validate/{card['code']}"
        )
        self.assertEqual(public_after.status_code, 200, public_after.text)
        self.assertAlmostEqual(public_after.json()["balance"], 1300.0, places=2)

        detail = self.client.get(
            f"{BASE}/gift-cards/{card['id']}", headers=self.headers
        )
        self.assertEqual(detail.status_code, 200, detail.text)
        kinds = [row["kind"] for row in detail.json()["transactions"]]
        self.assertEqual(kinds[:3], ["redeem", "reload", "issue"])

        voided = self.client.post(
            f"{BASE}/gift-cards/{card['id']}/void",
            json={"note": "Damaged card"},
            headers=self.headers,
        )
        self.assertEqual(voided.status_code, 200, voided.text)
        self.assertEqual(voided.json()["card"]["status"], "void")

        invalid_public = self.client.get(
            f"{BASE}/gift-cards/public/validate/{card['code']}"
        )
        self.assertEqual(invalid_public.status_code, 200, invalid_public.text)
        self.assertFalse(invalid_public.json()["valid"])
        self.assertEqual(invalid_public.json()["status"], "void")

        after_void = self.summary()
        self.assertAlmostEqual(
            after_void["outstanding_balance"],
            baseline["outstanding_balance"],
            places=2,
        )
        self.assertGreaterEqual(after_void["issued_value_this_month"], 1000.0)
        self.assertGreaterEqual(after_void["redeemed_this_month"], 200.0)

        listed = self.client.get(
            f"{BASE}/gift-cards",
            params={"query": card["code"]},
            headers=self.headers,
        )
        self.assertEqual(listed.status_code, 200, listed.text)
        self.assertEqual([row["id"] for row in listed.json()["items"]], [card["id"]])

    def test_unknown_code_is_invalid_but_returns_200(self):
        response = self.client.get(
            f"{BASE}/gift-cards/public/validate/PB-DOESNOTEXIST"
        )
        self.assertEqual(response.status_code, 200, response.text)
        payload = response.json()
        self.assertFalse(payload["valid"])
        self.assertEqual(payload["status"], "unknown")
        self.assertTrue(payload["message"])

    def test_missing_card_returns_404_and_invalid_payload_422(self):
        missing = self.client.get(
            f"{BASE}/gift-cards/999999", headers=self.headers
        )
        self.assertEqual(missing.status_code, 404)
        invalid = self.client.post(
            f"{BASE}/gift-cards",
            json={"initial_balance": 0},
            headers=self.headers,
        )
        self.assertEqual(invalid.status_code, 422)


if __name__ == "__main__":
    unittest.main()
