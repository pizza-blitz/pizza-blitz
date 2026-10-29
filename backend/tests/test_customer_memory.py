"""The concierge remembers a verified guest and never an unproved phone number.

Two separate promises are tested here:

1. Memory is only read or written after ownership of the phone number is
   proved, using the same rule as order history.
2. What was remembered changes the conversation: greetings mention it,
   recommendations avoid a saved allergen, and an explicit add is warned about.
"""

import base64
import hashlib
import hmac
import json
import os
import time
import unittest

os.environ.setdefault("PYTHONDONTWRITEBYTECODE", "1")

from fastapi.testclient import TestClient

from app.core.config import settings
from app.db.session import SessionLocal
from app.main import app
from app.models.domain import CustomerMemory, MenuItem
from app.services.customer_memory_service import (
    filter_recommendations,
    remember_from_turn,
)

BASE = "/api/v1/restaurant/assistant"


def portal_cookie_token(payload: dict) -> str:
    secret = settings.PIZZA_BLITZ_ADMIN_PASSWORD
    payload_part = (
        base64.urlsafe_b64encode(json.dumps(payload).encode("utf-8"))
        .decode("utf-8")
        .rstrip("=")
    )
    signature = hmac.new(
        secret.encode("utf-8"), payload_part.encode("utf-8"), hashlib.sha256
    ).digest()
    signature_part = base64.urlsafe_b64encode(signature).decode("utf-8").rstrip("=")
    return f"{payload_part}.{signature_part}"


def customer_headers(phone: str) -> dict:
    token = portal_cookie_token(
        {
            "role": "customer",
            "subject": f"customer:{phone}",
            "displayName": "Memory Probe",
            "phone": phone,
            "exp": 9999999999,
        }
    )
    return {"cookie": f"pb_customer_session={token}"}


class CustomerMemoryTest(unittest.TestCase):
    def setUp(self):
        self._ctx = TestClient(app)
        self.client = self._ctx.__enter__()
        # A distinct number per test keeps the shared in-memory database clean.
        self.phone = "98" + str(int(time.time() * 1000))[-8:]
        self.other_phone = "97" + str(int(time.time() * 1000))[-8:]
        self.headers = customer_headers(self.phone)
        self._allergen_item_id = None
        self._allergen_backup = None

    def tearDown(self):
        db = SessionLocal()
        try:
            db.query(CustomerMemory).filter(
                CustomerMemory.phone.in_([self.phone, self.other_phone])
            ).delete(synchronize_session=False)
            if self._allergen_item_id is not None:
                item = (
                    db.query(MenuItem)
                    .filter(MenuItem.id == self._allergen_item_id)
                    .first()
                )
                if item is not None:
                    item.allergens = self._allergen_backup
            db.commit()
        finally:
            db.close()
        self._ctx.__exit__(None, None, None)

    def create_order(self, phone: str) -> int:
        created = self.client.post(
            "/api/v1/restaurant/orders/",
            json={
                "order_type": "takeaway",
                "customer_name": "Memory Probe",
                "customer_phone": phone,
                "payment_method": "cash",
                "items": [{"name": "Garlic Bread", "quantity": 1, "price": 119}],
            },
        )
        self.assertEqual(created.status_code, 200, created.text)
        return created.json()["order_id"]

    def put_memory(self, payload: dict, headers: dict | None = None):
        return self.client.put(
            f"{BASE}/memory",
            json=payload,
            headers=self.headers if headers is None else headers,
        )

    def test_anonymous_phone_is_not_proof(self):
        anonymous = self.client.get(f"{BASE}/memory", params={"phone": self.phone})
        self.assertEqual(anonymous.status_code, 401, anonymous.text)

        put = self.put_memory({"phone": self.phone, "allergies": ["peanuts"]}, headers={})
        self.assertEqual(put.status_code, 401, put.text)

        # Chat still works for a stranger, it just cannot read or write memory.
        chat = self.client.post(
            f"{BASE}/chat",
            json={"message": "I'm allergic to peanuts", "phone": self.phone},
        )
        self.assertEqual(chat.status_code, 200, chat.text)
        self.assertFalse(chat.json()["memory_linked"])
        db = SessionLocal()
        try:
            stored = (
                db.query(CustomerMemory)
                .filter(CustomerMemory.phone == self.phone)
                .first()
            )
            self.assertIsNone(stored)
        finally:
            db.close()

    def test_verified_session_saves_and_recalls_an_allergy(self):
        listed = self.client.get(f"{BASE}/memory", headers=self.headers)
        self.assertEqual(listed.status_code, 200, listed.text)
        self.assertFalse(listed.json()["memory"]["known"])

        chat = self.client.post(
            f"{BASE}/chat",
            json={"message": "I'm allergic to peanuts and shellfish", "display_name": "Asha"},
            headers=self.headers,
        )
        self.assertEqual(chat.status_code, 200, chat.text)
        body = chat.json()
        self.assertTrue(body["memory_linked"])
        self.assertIn("allergies", body["memory_changed"])
        self.assertIn("saved your allergies", body["reply"])
        self.assertEqual(body["memory"]["allergies"], ["peanuts", "shellfish"])

        # A later visit with no allergy mention gets the memory back.
        greeting = self.client.post(
            f"{BASE}/chat", json={"message": "hi"}, headers=self.headers
        )
        self.assertEqual(greeting.status_code, 200, greeting.text)
        self.assertIn("I remember you avoid", greeting.json()["reply"])
        self.assertIn("peanuts", greeting.json()["reply"])
        self.assertIn("shellfish", greeting.json()["reply"])
        self.assertTrue(greeting.json()["memory"]["known"])

    def test_order_id_proof_works_without_a_session(self):
        order_id = self.create_order(self.phone)
        saved = self.put_memory(
            {
                "phone": self.phone,
                "order_id": order_id,
                "allergies": ["dairy"],
            },
            headers={},
        )
        self.assertEqual(saved.status_code, 200, saved.text)
        self.assertEqual(saved.json()["memory"]["allergies"], ["dairy"])

        wrong = self.put_memory(
            {
                "phone": self.phone,
                "order_id": order_id + 999999,
                "allergies": ["dairy"],
            },
            headers={},
        )
        self.assertEqual(wrong.status_code, 401, wrong.text)

    def test_a_consented_memory_surfaces_the_usual_order(self):
        saved = self.put_memory({"allergies": ["peanuts"]})
        self.assertEqual(saved.status_code, 200, saved.text)

        self.create_order(self.phone)

        memory = self.client.get(f"{BASE}/memory", headers=self.headers).json()["memory"]
        self.assertTrue(memory["known"])
        self.assertIn("Garlic Bread", memory["last_order_summary"])
        self.assertIn("pickup", memory["last_order_summary"])
        self.assertEqual(memory["usual_fulfillment"], "pickup")
        self.assertIn("Garlic Bread", memory["favourite_items"])
        self.assertIn("peanuts", memory["allergies"])

        greeting = self.client.post(
            f"{BASE}/chat", json={"message": "hi"}, headers=self.headers
        )
        self.assertEqual(greeting.status_code, 200, greeting.text)
        reply = greeting.json()["reply"]
        self.assertIn("Last time:", reply)
        self.assertIn("Garlic Bread", reply)
        self.assertIn("Want the same", reply)

    def test_an_order_without_consent_does_not_create_a_memory(self):
        self.create_order(self.other_phone)
        db = SessionLocal()
        try:
            stored = (
                db.query(CustomerMemory)
                .filter(CustomerMemory.phone == self.other_phone)
                .first()
            )
            self.assertIsNone(stored)
        finally:
            db.close()

        listed = self.client.get(
            f"{BASE}/memory", headers=customer_headers(self.other_phone)
        )
        self.assertEqual(listed.status_code, 200, listed.text)
        memory = listed.json()["memory"]
        self.assertFalse(memory["known"])
        self.assertIsNone(memory["last_order_summary"])

    def test_another_customer_cannot_read_or_clear_the_memory(self):
        self.assertEqual(
            self.put_memory({"allergies": ["peanuts"]}).status_code, 200
        )
        stranger = customer_headers(self.other_phone)
        read = self.client.get(
            f"{BASE}/memory", params={"phone": self.phone}, headers=stranger
        )
        self.assertEqual(read.status_code, 403, read.text)
        write = self.put_memory(
            {"phone": self.phone, "allergies": ["nothing"]}, headers=stranger
        )
        self.assertEqual(write.status_code, 403, write.text)
        # With no phone named, a session may only write its own memory.
        own = self.put_memory({"allergies": ["nothing"]}, headers=stranger)
        self.assertEqual(own.status_code, 200, own.text)
        self.assertEqual(own.json()["phone"], self.other_phone)

    def test_forgetting_deletes_the_row(self):
        self.assertEqual(
            self.put_memory({"allergies": ["peanuts"]}).status_code, 200
        )
        deleted = self.client.delete(f"{BASE}/memory", headers=self.headers)
        self.assertEqual(deleted.status_code, 200, deleted.text)
        self.assertTrue(deleted.json()["forgotten"])
        after = self.client.get(f"{BASE}/memory", headers=self.headers)
        self.assertFalse(after.json()["memory"]["known"])
        db = SessionLocal()
        try:
            self.assertIsNone(
                db.query(CustomerMemory)
                .filter(CustomerMemory.phone == self.phone)
                .first()
            )
        finally:
            db.close()

    def test_saved_allergen_removes_a_matching_menu_item_from_recommendations(self):
        db = SessionLocal()
        try:
            item = (
                db.query(MenuItem)
                .filter(MenuItem.is_available.is_(True))
                .order_by(MenuItem.id.asc())
                .first()
            )
            self.assertIsNotNone(item)
            self._allergen_item_id = item.id
            self._allergen_backup = list(item.allergens or [])
            item.allergens = ["peanuts"]
            db.commit()
            item_name = item.name
        finally:
            db.close()

        self.assertEqual(
            self.put_memory({"allergies": ["peanuts"]}).status_code, 200
        )

        ask = self.client.post(
            f"{BASE}/chat", json={"message": "recommend something"}, headers=self.headers
        )
        self.assertEqual(ask.status_code, 200, ask.text)
        for row in ask.json()["recommendations"]:
            self.assertNotIn("peanuts", [str(value).lower() for value in row["allergens"]])

        add = self.client.post(
            f"{BASE}/chat",
            json={"message": f"add {item_name}"},
            headers=self.headers,
        )
        self.assertEqual(add.status_code, 200, add.text)
        self.assertIn("Heads up", add.json()["reply"])


class MemoryPhraseTest(unittest.TestCase):
    def setUp(self):
        self._ctx = TestClient(app)
        self._build = self._ctx.__enter__()

    def tearDown(self):
        self._ctx.__exit__(None, None, None)

    def test_negation_needs_an_allergen_word(self):
        self.assertEqual(remember_from_turn.__module__, "app.services.customer_memory_service")
        db = SessionLocal()
        try:
            phone = "96" + str(int(time.time() * 1000))[-8:]
            result = remember_from_turn(db, phone, "no thanks, just the bill")
            self.assertEqual(result["changed"], [])
            result = remember_from_turn(db, phone, "no onions and no peanuts please")
            self.assertIn("allergies", result["changed"])
            stored = result["memory"]["allergies"]
            self.assertIn("onions", stored)
            self.assertIn("peanuts", stored)
            db.query(CustomerMemory).filter(CustomerMemory.phone == phone).delete()
            db.commit()
        finally:
            db.close()

    def test_dietary_preference_is_stored(self):
        db = SessionLocal()
        try:
            phone = "95" + str(int(time.time() * 1000))[-8:]
            result = remember_from_turn(db, phone, "I only eat vegetarian food")
            self.assertIn("dietary_preferences", result["changed"])
            self.assertIn("vegetarian", result["memory"]["dietary_preferences"])
            db.query(CustomerMemory).filter(CustomerMemory.phone == phone).delete()
            db.commit()
        finally:
            db.close()

    def test_preference_clause_does_not_become_an_allergy(self):
        db = SessionLocal()
        try:
            phone = "94" + str(int(time.time() * 1000))[-8:]
            result = remember_from_turn(
                db,
                phone,
                "I'm allergic to peanuts and shellfish, and I prefer vegetarian food",
            )
            self.assertEqual(result["memory"]["allergies"], ["peanuts", "shellfish"])
            self.assertEqual(result["memory"]["dietary_preferences"], ["vegetarian"])
            db.query(CustomerMemory).filter(CustomerMemory.phone == phone).delete()
            db.commit()
        finally:
            db.close()

    def test_filter_withholds_a_declared_allergen(self):
        safe, withheld = filter_recommendations(
            [
                {"name": "Cheese pizza", "allergens": ["dairy", "gluten"]},
                {"name": "Fruit cup", "allergens": ["citrus"]},
            ],
            ["dairy"],
        )
        self.assertEqual([row["name"] for row in safe], ["Fruit cup"])
        self.assertEqual(withheld[0]["name"], "Cheese pizza")
        self.assertEqual(withheld[0]["withheld_for"], "dairy")
