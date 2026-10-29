"""Conversational ordering assistant: grounded answers and executable cart actions."""

import base64
import hashlib
import hmac
import json
import os
import time
import unittest
from datetime import timedelta
from unittest.mock import patch

os.environ.setdefault("PYTHONDONTWRITEBYTECODE", "1")

from fastapi.testclient import TestClient

from app.core.clock import business_today
from app.core.config import settings
from app.db.session import SessionLocal
from app.main import app
from app.models.domain import MenuItem, Promotion

BASE = "/api/v1/restaurant/assistant"


def customer_headers(phone: str) -> dict:
    """A signed customer session, minted the same way the portal proxy does."""
    secret = settings.PIZZA_BLITZ_ADMIN_PASSWORD
    payload_part = (
        base64.urlsafe_b64encode(
            json.dumps(
                {
                    "role": "customer",
                    "subject": f"customer:{phone}",
                    "displayName": "Order Status Probe",
                    "phone": phone,
                    "exp": 9999999999,
                }
            ).encode("utf-8")
        )
        .decode("utf-8")
        .rstrip("=")
    )
    signature = hmac.new(
        secret.encode("utf-8"), payload_part.encode("utf-8"), hashlib.sha256
    ).digest()
    signature_part = base64.urlsafe_b64encode(signature).decode("utf-8").rstrip("=")
    return {"cookie": f"pb_customer_session={payload_part}.{signature_part}"}


class AssistantTest(unittest.TestCase):
    def setUp(self):
        self._ctx = TestClient(app)
        self.client = self._ctx.__enter__()
        db = SessionLocal()
        try:
            code = f"BLAZE{str(int(time.time() * 1000))[-6:]}"
            promotion = Promotion(
                name="Assistant live offer",
                code=code,
                start_date=business_today(),
                end_date=business_today() + timedelta(days=5),
                description="10% off the assistant cart.",
                discount_type="percentage",
                discount_value=10,
                audience="all_customers",
                channel="web",
                status="active",
            )
            db.add(promotion)
            db.commit()
            db.refresh(promotion)
            self.promo_id = promotion.id
            self.code = code
        finally:
            db.close()

    def tearDown(self):
        db = SessionLocal()
        try:
            db.query(Promotion).filter(Promotion.id == self.promo_id).delete()
            db.commit()
        finally:
            db.close()
        self._ctx.__exit__(None, None, None)

    def chat(self, message, cart=None, fulfillment="pickup", coupon_code=None):
        response = self.client.post(
            f"{BASE}/chat",
            json={
                "message": message,
                "cart": cart or [],
                "fulfillment": fulfillment,
                "coupon_code": coupon_code,
            },
        )
        self.assertEqual(response.status_code, 200, response.text)
        return response.json()

    def chat_as(self, phone: str, message: str) -> dict:
        response = self.client.post(
            f"{BASE}/chat",
            json={"message": message},
            headers=customer_headers(phone),
        )
        self.assertEqual(response.status_code, 200, response.text)
        return response.json()

    def place_pickup_order(self, phone: str) -> int:
        response = self.client.post(
            "/api/v1/restaurant/orders/",
            json={
                "order_type": "pickup",
                "customer_name": "Concierge Order Probe",
                "customer_phone": phone,
                "payment_method": "cash",
                "items": [{"name": "Garlic Bread", "quantity": 1, "price": 119}],
            },
        )
        self.assertEqual(response.status_code, 200, response.text)
        return response.json()["order_id"]

    def menu_item(self, name: str) -> MenuItem:
        db = SessionLocal()
        try:
            item = db.query(MenuItem).filter(MenuItem.name == name).first()
            self.assertIsNotNone(item, name)
            return item
        finally:
            db.close()

    def cart_payload(self, payload):
        return [
            {
                "menu_item_id": line["menu_item_id"],
                "quantity": line["quantity"],
                "selected_options": line["selected_options"],
            }
            for line in payload["cart"]["lines"]
        ]

    def test_config_and_greeting_are_public_and_do_not_leak_cost(self):
        config = self.client.get(f"{BASE}/config")
        self.assertEqual(config.status_code, 200, config.text)
        self.assertEqual(config.json()["name"], "Blaze")
        self.assertIn("greeting", config.json())
        self.assertIsInstance(config.json()["llm_configured"], bool)

        payload = self.chat("")
        self.assertEqual(payload["intent"], "greeting")
        self.assertTrue(payload["reply"])
        self.assertGreaterEqual(len(payload["recommendations"]), 1)
        self.assertNotIn("cost_price", str(payload))
        self.assertNotIn("cost_price", config.text)
        self.assertIn("store", payload)
        self.assertTrue(payload["suggestions"])

    def test_add_multiple_items_then_start_checkout(self):
        payload = self.chat("add two margherita pizzas and garlic bread")
        self.assertEqual(payload["intent"], "add_item")
        self.assertEqual([action["type"] for action in payload["actions"]], ["add_item", "add_item"])
        self.assertEqual(payload["cart"]["count"], 3)
        self.assertEqual(payload["cart"]["subtotal"], 517.0)
        self.assertEqual(len(payload["cart"]["lines"]), 2)
        self.assertEqual(payload["cart"]["lines"][0]["quantity"], 2)

        checkout = self.chat("checkout", cart=self.cart_payload(payload))
        self.assertEqual(checkout["intent"], "checkout")
        self.assertIn("start_checkout", [action["type"] for action in checkout["actions"]])
        self.assertEqual(checkout["cart"]["count"], 3)
        self.assertIn("preloaded", checkout["reply"].lower())

        empty = self.chat("checkout")
        self.assertEqual(empty["intent"], "checkout")
        self.assertEqual(empty["cart"]["count"], 0)
        self.assertNotIn("start_checkout", [action["type"] for action in empty["actions"]])

    def test_offer_listing_and_explicit_coupon_discount(self):
        margherita = self.menu_item("Margherita Pizza (R)")
        cart = [{"menu_item_id": margherita.id, "quantity": 2}]

        offers = self.chat("what offers are on?", cart=cart)
        self.assertEqual(offers["intent"], "offers")
        self.assertIn("apply_coupon", [action["type"] for action in offers["actions"]])

        applied = self.chat(f"apply {self.code}", cart=cart)
        self.assertEqual(applied["intent"], "offers")
        self.assertEqual(applied["cart"]["coupon"]["code"], self.code)
        self.assertAlmostEqual(applied["cart"]["discount"], 39.8, places=2)
        self.assertLess(applied["cart"]["total"], applied["cart"]["subtotal"])
        self.assertIn(
            {"type": "apply_coupon", "code": self.code, "label": "10% off"},
            [
                {key: action[key] for key in ("type", "code", "label") if key in action}
                for action in applied["actions"]
            ],
        )

    def test_recommendation_respects_diet_and_budget(self):
        payload = self.chat("recommend something vegetarian under 300")
        self.assertEqual(payload["intent"], "recommend")
        self.assertGreaterEqual(len(payload["recommendations"]), 1)
        for row in payload["recommendations"]:
            self.assertLessEqual(row["price"], 300)
            self.assertTrue(row["reason"])
            self.assertNotIn("cost_price", row)
        self.assertTrue(payload["suggestions"][0].lower().startswith("add "))

    def test_delivery_tracking_and_store_answers(self):
        delivery = self.chat("do you deliver?")
        self.assertEqual(delivery["intent"], "delivery")
        self.assertEqual(delivery["fulfillment"], "delivery")
        self.assertIn("set_fulfillment", [action["type"] for action in delivery["actions"]])
        self.assertIn("fee", delivery["reply"].lower())

        tracking = self.chat("track my order")
        self.assertEqual(tracking["intent"], "tracking")
        self.assertIn("open_tracking", [action["type"] for action in tracking["actions"]])

        store = self.chat("where are you?")
        self.assertEqual(store["intent"], "store_info")
        self.assertTrue(store["reply"])

    def test_an_order_that_mentions_delivery_still_adds_the_items(self):
        # The avatar used to answer the word "delivery" with the zone list and
        # drop the food. A streamed order has to win over the zone explainer.
        payload = self.chat("I want one margherita pizza and garlic bread for delivery")
        self.assertEqual(payload["intent"], "add_item")
        self.assertEqual(payload["fulfillment"], "delivery")
        self.assertEqual(payload["cart"]["count"], 2)
        names = [line["name"] for line in payload["cart"]["lines"]]
        self.assertIn("Margherita Pizza (R)", names)
        self.assertIn("add_item", [action["type"] for action in payload["actions"]])
        self.assertNotIn("delivery zones", payload["reply"].lower())

    def test_use_delivery_chip_acknowledges_and_moves_on(self):
        added = self.chat("two margherita pizzas")
        self.assertEqual(added["cart"]["count"], 2)

        confirmed = self.chat("Delivery, please", cart=self.cart_payload(added))
        self.assertEqual(confirmed["intent"], "set_fulfillment")
        self.assertEqual(confirmed["fulfillment"], "delivery")
        self.assertEqual(confirmed["cart"]["count"], 2)
        self.assertNotIn("we deliver to", confirmed["reply"].lower())
        self.assertIn(
            "start_checkout", [action["type"] for action in confirmed["actions"]]
        )

        empty = self.chat("Use delivery")
        self.assertEqual(empty["intent"], "set_fulfillment")
        self.assertEqual(empty["fulfillment"], "delivery")
        self.assertEqual(empty["cart"]["count"], 0)
        self.assertIn("what you'd like", empty["reply"].lower())
        self.assertGreaterEqual(len(empty["recommendations"]), 1)

    def test_invalid_cart_lines_are_dropped_and_reported(self):
        payload = self.chat(
            "what's in my cart",
            cart=[{"menu_item_id": 999999, "quantity": 2}],
        )
        self.assertEqual(payload["intent"], "cart_review")
        self.assertEqual(payload["cart"]["count"], 0)
        self.assertIn("no longer on the menu", payload["reply"].lower())

    def test_generic_food_words_do_not_guess_a_variant(self):
        payload = self.chat("add a pizza")
        self.assertEqual(payload["intent"], "recommend")
        self.assertEqual(payload["cart"]["count"], 0)
        self.assertIn("picks", payload["reply"].lower())

        matched = self.chat("add two margherita")
        self.assertEqual(matched["cart"]["count"], 2)
        self.assertEqual(matched["cart"]["lines"][0]["name"], "Margherita Pizza (R)")

    def test_implicit_order_lists_work_but_questions_do_not_add(self):
        payload = self.chat("two margherita pizzas and garlic bread")
        self.assertEqual(payload["intent"], "add_item")
        self.assertEqual(payload["cart"]["count"], 3)
        self.assertEqual(len(payload["cart"]["lines"]), 2)
        self.assertEqual(payload["cart"]["lines"][0]["quantity"], 2)

        question = self.chat("is the margherita spicy?")
        self.assertNotEqual(question["intent"], "add_item")
        self.assertEqual(question["cart"]["count"], 0)

        single = self.chat("garlic bread")
        self.assertEqual(single["cart"]["count"], 0)

    def test_gemini_answer_is_optional_and_failure_falls_back(self):
        with patch.dict(
            os.environ,
            {"GEMINI_API_KEY": "assistant-test-key", "ASSISTANT_LLM_ENABLED": "true"},
        ):
            with patch("app.services.assistant_service.generate_text") as generate:
                generate.return_value = "Our dough rests for 48 hours before it is stretched."
                live = self.chat("how long does your dough rest?")
            self.assertEqual(live["intent"], "question")
            self.assertEqual(live["source"], "gemini")
            self.assertIn("48 hours", live["reply"])
            self.assertTrue(live["llm"]["used"])

            with patch("app.services.assistant_service.generate_text") as failing:
                failing.side_effect = RuntimeError("provider unavailable")
                fallback = self.chat("how long does your dough rest?")
            self.assertEqual(fallback["source"], "rules")
            self.assertFalse(fallback["llm"]["used"])
            self.assertTrue(fallback["reply"])

    def test_signed_in_guest_gets_their_live_order_status(self):
        phone = "96" + str(int(time.time() * 1000))[-8:]
        order_id = self.place_pickup_order(phone)

        payload = self.chat_as(phone, "Where is my order?")
        self.assertEqual(payload["intent"], "tracking")
        self.assertIn(f"Order #{order_id}", payload["reply"])
        self.assertIn("Kitchen", payload["reply"])
        self.assertIn("ETA 20-25 min", payload["reply"])
        action = next(item for item in payload["actions"] if item["type"] == "open_tracking")
        self.assertEqual(action["order_id"], order_id)
        self.assertEqual(action["href"], f"/track?order={order_id}&phone={phone}")

    def test_greeting_names_the_live_order(self):
        phone = "95" + str(int(time.time() * 1000))[-8:]
        order_id = self.place_pickup_order(phone)

        response = self.client.post(
            f"{BASE}/chat", json={"message": ""}, headers=customer_headers(phone)
        )
        self.assertEqual(response.status_code, 200, response.text)
        reply = response.json()["reply"]
        self.assertIn(f"Order #{order_id}", reply)
        self.assertIn("Tap Track my order", reply)

    def test_another_customer_never_sees_the_order(self):
        owner = "94" + str(int(time.time() * 1000))[-8:]
        other = "93" + str(int(time.time() * 1000))[-8:]
        order_id = self.place_pickup_order(owner)

        payload = self.chat_as(other, "Where is my order?")
        self.assertNotIn(f"Order #{order_id}", payload["reply"])
        self.assertIn("order id and the phone number", payload["reply"])
        action = next(item for item in payload["actions"] if item["type"] == "open_tracking")
        self.assertNotIn("order_id", action)
        self.assertNotIn("href", action)

    def test_signed_in_guest_can_repeat_their_last_order(self):
        phone = "92" + str(int(time.time() * 1000))[-8:]
        order_id = self.place_pickup_order(phone)

        payload = self.chat_as(phone, "Repeat my usual")
        self.assertEqual(payload["intent"], "repeat_order")
        self.assertIn(f"Order #{order_id}", payload["reply"])
        added = [action for action in payload["actions"] if action["type"] == "add_item"]
        self.assertEqual(len(added), 1)
        self.assertEqual(added[0]["item"]["name"], "Garlic Bread")
        self.assertEqual(added[0]["quantity"], 1)
        self.assertEqual(payload["cart"]["count"], 1)
        self.assertEqual(payload["cart"]["lines"][0]["name"], "Garlic Bread")

    def test_repeat_requires_a_verified_phone(self):
        payload = self.chat("Repeat my usual")
        self.assertEqual(payload["intent"], "repeat_order")
        self.assertFalse(
            [action for action in payload["actions"] if action["type"] == "add_item"]
        )
        self.assertIn("confirm your phone", payload["reply"])
        self.assertTrue(
            any(
                action["type"] == "open_url" and action["url"] == "/account"
                for action in payload["actions"]
            )
        )

    def test_repeat_never_uses_another_customers_order(self):
        owner = "91" + str(int(time.time() * 1000))[-8:]
        other = "90" + str(int(time.time() * 1000))[-8:]
        order_id = self.place_pickup_order(owner)

        payload = self.chat_as(other, "Repeat my usual")
        self.assertEqual(payload["intent"], "repeat_order")
        self.assertNotIn(f"Order #{order_id}", payload["reply"])
        self.assertIn("don't have a past order", payload["reply"])
        self.assertFalse(
            [action for action in payload["actions"] if action["type"] == "add_item"]
        )

    def test_message_length_and_cart_size_are_bounded(self):
        response = self.client.post(
            f"{BASE}/chat",
            json={"message": "x" * 501},
        )
        self.assertEqual(response.status_code, 422, response.text)

        response = self.client.post(
            f"{BASE}/chat",
            json={
                "message": "hello",
                "cart": [
                    {"menu_item_id": 1, "quantity": 1}
                    for _ in range(31)
                ],
            },
        )
        self.assertEqual(response.status_code, 422, response.text)


if __name__ == "__main__":
    unittest.main()
