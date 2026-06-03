import unittest
from unittest.mock import patch

from fastapi.testclient import TestClient

from app.core.config import settings
from app.main import app
from app.services import ops_service


def _probe_response(*, status_code=200, payload=None, headers=None):
    return {
        "ok": 200 <= status_code < 400,
        "status_code": status_code,
        "headers": headers or {},
        "payload": payload,
        "body_preview": "",
        "duration_ms": 12,
    }


class LiveDeploymentProbeTest(unittest.TestCase):
    def test_live_deployment_probe_passes_public_health_checkout_cors_and_order_page(self):
        base_url = settings.PIZZA_BLITZ_PUBLIC_URL.rstrip("/")

        def fake_probe(url, *, headers=None, timeout=5):
            del timeout
            if headers and headers.get("Origin") == base_url:
                return _probe_response(
                    headers={
                        "access-control-allow-origin": base_url,
                        "access-control-allow-credentials": "true",
                    },
                    payload={"status": "ok", "project": "Restaurant Portal API"},
                )
            if url.endswith("/checkout-readiness"):
                return _probe_response(
                    payload={
                        "accepting_orders": True,
                        "database_ready": True,
                        "environment": "production",
                    }
                )
            if url.endswith("/order"):
                return _probe_response(payload=None)
            return _probe_response(payload={"status": "ok", "project": "Restaurant Portal API"})

        with patch.object(ops_service, "_http_probe", side_effect=fake_probe):
            proof = ops_service.run_live_deployment_probe(None)

        self.assertEqual(proof["status"], "pass")
        self.assertEqual(proof["score"], 100)
        self.assertEqual(proof["checks_passed"], 4)

    def test_live_deployment_proof_endpoint_is_admin_only_and_records_event(self):
        fake_proof = {
            "generated_at": "2026-06-03T00:00:00",
            "base_url": "https://pizza-blitz.vercel.app",
            "api_prefix": "/server",
            "status": "pass",
            "score": 100,
            "checks_total": 4,
            "checks_passed": 4,
            "checks": [],
            "next_actions": [],
        }
        with TestClient(app) as client:
            anonymous = client.post("/api/v1/restaurant/ops/live-deployment-proof/run")
            self.assertEqual(anonymous.status_code, 401)

            login = client.post(
                "/api/v1/auth/admin/login",
                json={
                    "id": settings.PIZZA_BLITZ_ADMIN_ID,
                    "password": settings.PIZZA_BLITZ_ADMIN_PASSWORD,
                },
            )
            self.assertEqual(login.status_code, 200)
            headers = {"Authorization": f"Bearer {login.json()['access_token']}"}
            with patch(
                "app.api.api_v1.endpoints.ops.run_live_deployment_probe",
                return_value=fake_proof,
            ):
                response = client.post(
                    "/api/v1/restaurant/ops/live-deployment-proof/run",
                    headers=headers,
                )

            self.assertEqual(response.status_code, 200)
            self.assertEqual(response.json()["proof"]["status"], "pass")
            self.assertEqual(response.json()["event"]["event_type"], "deployment")
            self.assertEqual(response.json()["event"]["action"], "live_deployment_probe")

    def test_live_deployment_proof_lifts_production_operations_readiness(self):
        checks = [
            {"key": "admin_password", "status": "pass"},
            {"key": "staff_password", "status": "pass"},
            {"key": "auth_secret", "status": "pass"},
            {"key": "portal_session_secret", "status": "pass"},
            {"key": "cors_origins", "status": "warn"},
        ]
        go_live_items = [
            {"key": f"gate_{index}", "status": "pass" if index < 3 else "warn"}
            for index in range(4)
        ]
        with (
            patch.object(ops_service, "_count", return_value=1),
            patch.object(
                ops_service,
                "_kitchen_station_metrics",
                return_value={
                    "stationed_orders": 1,
                    "station_count": 3,
                    "stationed_lines": 1,
                },
            ),
            patch.object(
                ops_service,
                "_employee_attendance_metrics",
                return_value={
                    "shift_count": 4,
                    "leave_count": 3,
                    "staff_count": 7,
                    "covered_role_count": 4,
                },
            ),
            patch.object(
                ops_service,
                "_expense_audit_metrics",
                return_value={
                    "expense_count": 2,
                    "category_count": 8,
                    "expense_signal_days": 1,
                    "high_risk_days": 0,
                },
            ),
            patch.object(
                ops_service,
                "campaign_provider_status",
                return_value={"configured": False},
            ),
            patch.object(
                ops_service,
                "social_provider_status",
                return_value={"configured": False},
            ),
            patch.object(
                ops_service,
                "ad_provider_status",
                return_value={"configured": False},
            ),
        ):
            modules = ops_service._launch_module_readiness(
                None,
                checks=checks,
                payment_status={"provider": "manual"},
                backup_freshness={"status": "pass"},
                live_deployment={"status": "pass", "score": 100},
                go_live_items=go_live_items,
            )

        production = next(module for module in modules if module["key"] == "production_operations")
        self.assertEqual(production["status"], "pass")
        self.assertGreaterEqual(production["score"], 85)
        self.assertIn("Keep live deployment proof fresh", production["next_actions"][0])


if __name__ == "__main__":
    unittest.main()
