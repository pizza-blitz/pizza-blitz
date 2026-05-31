import unittest

from fastapi.testclient import TestClient

from app.core.config import settings
from app.main import app
from app.services.auth_service import create_access_token


ADMIN_ONLY_GETS = (
    "/api/v1/restaurant/ops/readiness",
    "/api/v1/restaurant/ops/data-quality",
    "/api/v1/restaurant/ops/production-launch",
    "/api/v1/restaurant/ops/live-environment",
    "/api/v1/restaurant/shifts/payroll-preview",
    "/api/v1/restaurant/expenses/categories",
    "/api/v1/restaurant/expenses/expenses",
    "/api/v1/restaurant/expenses/audit-command",
    "/api/v1/restaurant/sync/sync-status",
    "/api/v1/restaurant/inventory/items",
    "/api/v1/restaurant/stats/dashboard-stats",
    "/api/v1/restaurant/sales/",
    "/api/v1/restaurant/reports/reports",
    "/api/v1/restaurant/purchase-orders/",
    "/api/v1/restaurant/vendors/",
    "/api/v1/restaurant/recipes/",
)

OPERATOR_GETS = (
    "/api/v1/restaurant/ops/daily-close-command",
    "/api/v1/restaurant/orders/flow-readiness",
    "/api/v1/restaurant/shifts/attendance-command",
)

PUBLIC_GETS = (
    "/api/v1/restaurant/menu/menu-with-customizations",
    "/api/v1/restaurant/delivery/zones",
    "/api/v1/restaurant/promotions/active",
)


def staff_headers() -> dict[str, str]:
    token = create_access_token(
        subject="staff:test-operator",
        role="staff",
        display_name="Test Operator",
        expires_minutes=5,
    )["access_token"]
    return {"Authorization": f"Bearer {token}"}


class OperationalCommandSecurityTest(unittest.TestCase):
    def test_customer_checkout_reads_remain_public(self):
        with TestClient(app) as client:
            for endpoint in PUBLIC_GETS:
                with self.subTest(endpoint=endpoint):
                    response = client.get(endpoint)
                    self.assertEqual(response.status_code, 200)

    def test_anonymous_requests_cannot_read_internal_commands(self):
        with TestClient(app) as client:
            for endpoint in (*ADMIN_ONLY_GETS, *OPERATOR_GETS):
                with self.subTest(endpoint=endpoint):
                    response = client.get(endpoint)
                    self.assertEqual(response.status_code, 401)

            expense = client.post(
                "/api/v1/restaurant/expenses/expenses",
                json={
                    "date": "2026-05-31T12:00:00",
                    "category_id": 1,
                    "amount": 100,
                },
            )
            self.assertEqual(expense.status_code, 401)

            ocr = client.post(
                "/api/v1/restaurant/ocr/scan-bill",
                files={"file": ("receipt.txt", b"test receipt", "text/plain")},
            )
            self.assertEqual(ocr.status_code, 401)

    def test_admin_can_read_operational_commands(self):
        with TestClient(app) as client:
            login = client.post(
                "/api/v1/auth/admin/login",
                json={
                    "id": settings.PIZZA_BLITZ_ADMIN_ID,
                    "password": settings.PIZZA_BLITZ_ADMIN_PASSWORD,
                },
            )
            self.assertEqual(login.status_code, 200)
            headers = {"Authorization": f"Bearer {login.json()['access_token']}"}

            for endpoint in (*ADMIN_ONLY_GETS, *OPERATOR_GETS):
                with self.subTest(endpoint=endpoint):
                    response = client.get(endpoint, headers=headers)
                    self.assertEqual(response.status_code, 200)

    def test_staff_can_use_operator_commands_but_not_admin_surfaces(self):
        with TestClient(app) as client:
            headers = staff_headers()

            for endpoint in OPERATOR_GETS:
                with self.subTest(endpoint=endpoint):
                    response = client.get(endpoint, headers=headers)
                    self.assertEqual(response.status_code, 200)

            for endpoint in ADMIN_ONLY_GETS:
                with self.subTest(endpoint=endpoint):
                    response = client.get(endpoint, headers=headers)
                    self.assertEqual(response.status_code, 403)


if __name__ == "__main__":
    unittest.main()
