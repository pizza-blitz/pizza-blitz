"""Marketing journeys: order trigger, enrollment and delayed send steps."""

import os
import unittest
from unittest.mock import patch

os.environ.setdefault("PYTHONDONTWRITEBYTECODE", "1")

from fastapi.testclient import TestClient

from app.core.config import settings
from app.db.session import SessionLocal
from app.main import app
from app.models.domain import Customer, JourneyEnrollment, MarketingJourney
from app.services.campaign_dispatch_service import CampaignProviderResult
from app.services.journey_service import enroll_manual, get_journey


class MarketingJourneyTest(unittest.TestCase):
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

    def tearDown(self):
        self._ctx.__exit__(None, None, None)

    def create_order(self, phone: str) -> int:
        created = self.client.post(
            "/api/v1/restaurant/orders/",
            json={
                "order_type": "takeaway",
                "customer_name": "Journey Proof Guest",
                "customer_phone": phone,
                "payment_method": "cash",
                "items": [{"name": "Garlic Bread", "quantity": 1, "price": 119}],
            },
        )
        self.assertEqual(created.status_code, 200, created.text)
        return created.json()["order_id"]

    def test_order_completion_enrolls_and_runs_journey(self):
        phone = f"9195{str(id(self))[-8:]}"
        created = self.client.post(
            "/api/v1/restaurant/journeys",
            json={
                "name": "Post-order thank you proof",
                "description": "Thank the guest after a completed order.",
                "trigger": "order_completed",
                "status": "active",
                "steps": [
                    {"type": "delay", "hours": 0},
                    {
                        "type": "condition",
                        "field": "order_total",
                        "operator": ">=",
                        "value": 100,
                    },
                    {
                        "type": "send",
                        "channel": "whatsapp",
                        "body": "Thanks for ordering from Pizza Blitz!",
                    },
                ],
            },
            headers=self.headers,
        )
        self.assertEqual(created.status_code, 201, created.text)
        journey = created.json()["journey"]
        self.assertEqual(journey["trigger"], "order_completed")
        self.assertEqual(len(journey["steps"]), 3)

        order_id = self.create_order(phone)
        ready = self.client.patch(
            f"/api/v1/restaurant/orders/{order_id}/status",
            json={"status": "ready"},
            headers=self.headers,
        )
        self.assertEqual(ready.status_code, 200, ready.text)
        closed = self.client.patch(
            f"/api/v1/restaurant/orders/{order_id}/close",
            headers=self.headers,
        )
        self.assertEqual(closed.status_code, 200, closed.text)

        detail = self.client.get(
            f"/api/v1/restaurant/journeys/{journey['id']}",
            headers=self.headers,
        )
        self.assertEqual(detail.status_code, 200, detail.text)
        enrollments = detail.json()["journey"]["recent_enrollments"]
        self.assertTrue(
            any(item["trigger_ref"] == f"order:{order_id}:order_completed" for item in enrollments)
        )

        with patch(
            "app.services.journey_service.send_campaign_message",
            return_value=CampaignProviderResult(
                provider="meta-whatsapp", status="sent", external_id="journey-proof"
            ),
        ):
            run = self.client.post(
                "/api/v1/restaurant/journeys/run-due", headers=self.headers
            )
        self.assertEqual(run.status_code, 200, run.text)
        self.assertGreaterEqual(run.json()["processed"], 1)

        after = self.client.get(
            f"/api/v1/restaurant/journeys/{journey['id']}",
            headers=self.headers,
        ).json()["journey"]
        enrollment = next(
            item
            for item in after["recent_enrollments"]
            if item["trigger_ref"] == f"order:{order_id}:order_completed"
        )
        self.assertEqual(enrollment["status"], "completed")
        self.assertTrue(
            any(event["step_type"] == "send" and event["status"] == "sent" for event in enrollment["events"])
        )
        self.assertTrue(
            any(
                event["step_type"] == "condition" and event["status"] == "passed"
                for event in enrollment["events"]
            )
        )
        self.assertGreaterEqual(after["completed_count"], 1)
        self.assertAlmostEqual(after["attributed_revenue"], 124.95, places=2)

    def test_condition_stops_enrollment_when_order_is_below_threshold(self):
        phone = f"9193{str(id(self))[-8:]}"
        created = self.client.post(
            "/api/v1/restaurant/journeys",
            json={
                "name": "High value only proof",
                "trigger": "order_completed",
                "status": "active",
                "steps": [
                    {
                        "type": "condition",
                        "field": "order_total",
                        "operator": ">=",
                        "value": 1000,
                    },
                    {
                        "type": "send",
                        "channel": "whatsapp",
                        "body": "This should not send for a small order.",
                    },
                ],
            },
            headers=self.headers,
        )
        self.assertEqual(created.status_code, 201, created.text)
        journey = created.json()["journey"]
        order_id = self.create_order(phone)
        self.client.patch(
            f"/api/v1/restaurant/orders/{order_id}/status",
            json={"status": "ready"},
            headers=self.headers,
        )
        self.client.patch(
            f"/api/v1/restaurant/orders/{order_id}/close",
            headers=self.headers,
        )
        run = self.client.post(
            "/api/v1/restaurant/journeys/run-due", headers=self.headers
        )
        self.assertEqual(run.status_code, 200, run.text)
        after = self.client.get(
            f"/api/v1/restaurant/journeys/{journey['id']}", headers=self.headers
        ).json()["journey"]
        enrollment = next(
            item
            for item in after["recent_enrollments"]
            if item["trigger_ref"] == f"order:{order_id}:order_completed"
        )
        self.assertEqual(enrollment["status"], "stopped")
        self.assertTrue(
            any(
                event["step_type"] == "condition" and event["status"] == "stopped"
                for event in enrollment["events"]
            )
        )
        self.assertFalse(
            any(event["step_type"] == "send" for event in enrollment["events"])
        )

    def test_ab_variant_routes_only_matching_send(self):
        created = self.client.post(
            "/api/v1/restaurant/journeys",
            json={
                "name": "A/B creative proof",
                "trigger": "manual",
                "status": "active",
                "steps": [
                    {
                        "type": "send",
                        "channel": "whatsapp",
                        "variant": "A",
                        "body": "Variant A message",
                    },
                    {
                        "type": "send",
                        "channel": "whatsapp",
                        "variant": "B",
                        "body": "Variant B message",
                    },
                ],
            },
            headers=self.headers,
        )
        self.assertEqual(created.status_code, 201, created.text)
        journey_id = created.json()["journey"]["id"]

        session = SessionLocal()
        try:
            with patch(
                "app.services.journey_service._pick_variant",
                side_effect=["A", "B"],
            ):
                first = enroll_manual(
                    session,
                    get_journey(session, journey_id),
                    destination="919811110001",
                    name="Variant A Guest",
                    trigger_ref="ab:first",
                )
                second = enroll_manual(
                    session,
                    get_journey(session, journey_id),
                    destination="919811110002",
                    name="Variant B Guest",
                    trigger_ref="ab:second",
                )
        finally:
            session.close()
        self.assertEqual(first["context"]["variant"], "A")
        self.assertEqual(second["context"]["variant"], "B")

        with patch(
            "app.services.journey_service.send_campaign_message",
            return_value=CampaignProviderResult(
                provider="meta-whatsapp", status="sent", external_id="ab-proof"
            ),
        ):
            run = self.client.post(
                "/api/v1/restaurant/journeys/run-due", headers=self.headers
            )
        self.assertEqual(run.status_code, 200, run.text)
        detail = self.client.get(
            f"/api/v1/restaurant/journeys/{journey_id}", headers=self.headers
        ).json()["journey"]
        variant_a = next(
            item for item in detail["recent_enrollments"] if item["trigger_ref"] == "ab:first"
        )
        variant_b = next(
            item for item in detail["recent_enrollments"] if item["trigger_ref"] == "ab:second"
        )
        self.assertEqual(variant_a["status"], "completed")
        self.assertEqual(variant_b["status"], "completed")
        self.assertTrue(
            any(event["status"] == "sent" for event in variant_a["events"])
        )
        self.assertTrue(
            any(event["status"] == "skipped" for event in variant_b["events"])
        )
        self.assertEqual(
            {row["variant"] for row in detail["variants"]}, {"A", "B"}
        )

    def test_frequency_cap_skips_second_send_for_same_customer(self):
        phone = f"9192{str(id(self))[-8:]}"
        session = SessionLocal()
        try:
            customer = Customer(name="Frequency Guest", phone=phone)
            session.add(customer)
            session.commit()
            session.refresh(customer)
            customer_id = customer.id
        finally:
            session.close()

        for name in ("Cap journey one", "Cap journey two"):
            created = self.client.post(
                "/api/v1/restaurant/journeys",
                json={
                    "name": name,
                    "trigger": "manual",
                    "status": "active",
                    "max_sends_per_customer": 1,
                    "frequency_window_hours": 24,
                    "steps": [
                        {
                            "type": "send",
                            "channel": "whatsapp",
                            "body": f"{name} message",
                        }
                    ],
                },
                headers=self.headers,
            )
            self.assertEqual(created.status_code, 201, created.text)
            journey_id = created.json()["journey"]["id"]
            session = SessionLocal()
            try:
                enroll_manual(
                    session,
                    get_journey(session, journey_id),
                    destination=phone,
                    name="Frequency Guest",
                    customer_id=customer_id,
                    trigger_ref=f"cap:{name}",
                )
            finally:
                session.close()

        with patch(
            "app.services.journey_service.send_campaign_message",
            return_value=CampaignProviderResult(
                provider="meta-whatsapp", status="sent", external_id="cap-proof"
            ),
        ):
            run = self.client.post(
                "/api/v1/restaurant/journeys/run-due", headers=self.headers
            )
        self.assertEqual(run.status_code, 200, run.text)

        session = SessionLocal()
        try:
            events = (
                session.query(Customer)
                .filter(Customer.id == customer_id)
                .first()
            )
            self.assertIsNotNone(events)
            sent = 0
            capped = 0
            for name in ("Cap journey one", "Cap journey two"):
                journey = (
                    session.query(MarketingJourney)
                    .filter(MarketingJourney.name == name)
                    .first()
                )
                enrollments = (
                    session.query(JourneyEnrollment)
                    .filter(JourneyEnrollment.journey_id == journey.id)
                    .all()
                )
                for enrollment in enrollments:
                    for event in enrollment.events:
                        if event.status == "sent":
                            sent += 1
                        if event.status == "skipped" and "Frequency cap" in (event.detail or ""):
                            capped += 1
            self.assertEqual(sent, 1)
            self.assertEqual(capped, 1)
        finally:
            session.close()

    def test_manual_enrollment_rejects_draft_journey(self):
        created = self.client.post(
            "/api/v1/restaurant/journeys",
            json={
                "name": "Draft journey proof",
                "trigger": "manual",
                "steps": [{"type": "send", "channel": "sms", "body": "Hello"}],
            },
            headers=self.headers,
        )
        journey = created.json()["journey"]
        response = self.client.post(
            f"/api/v1/restaurant/journeys/{journey['id']}/enroll",
            json={"destination": "919500000001", "name": "Draft Guest"},
            headers=self.headers,
        )
        self.assertEqual(response.status_code, 422, response.text)


if __name__ == "__main__":
    unittest.main()
