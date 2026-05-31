import unittest
from unittest.mock import patch

from fastapi.testclient import TestClient

from app.core.config import settings
from app.main import app
from app.services import ops_service


class OpsReportReuseTest(unittest.TestCase):
    def _admin_headers(self, client: TestClient) -> dict[str, str]:
        login = client.post(
            "/api/v1/auth/admin/login",
            json={
                "id": settings.PIZZA_BLITZ_ADMIN_ID,
                "password": settings.PIZZA_BLITZ_ADMIN_PASSWORD,
            },
        )
        self.assertEqual(login.status_code, 200)
        return {"Authorization": f"Bearer {login.json()['access_token']}"}

    def test_final_acceptance_reuses_expensive_prerequisites(self):
        with TestClient(app) as client:
            headers = self._admin_headers(client)
            with (
                patch.object(
                    ops_service,
                    "readiness_report",
                    wraps=ops_service.readiness_report,
                ) as readiness,
                patch.object(
                    ops_service,
                    "data_quality_report",
                    wraps=ops_service.data_quality_report,
                ) as data_quality,
            ):
                response = client.get(
                    "/api/v1/restaurant/ops/final-acceptance",
                    headers=headers,
                )

            self.assertEqual(response.status_code, 200)
            self.assertEqual(readiness.call_count, 1)
            self.assertEqual(data_quality.call_count, 1)

    def test_credential_activation_reuses_nested_reports(self):
        with TestClient(app) as client:
            headers = self._admin_headers(client)
            with (
                patch.object(
                    ops_service,
                    "readiness_report",
                    wraps=ops_service.readiness_report,
                ) as readiness,
                patch.object(
                    ops_service,
                    "data_quality_report",
                    wraps=ops_service.data_quality_report,
                ) as data_quality,
            ):
                response = client.get(
                    "/api/v1/restaurant/ops/credential-activation",
                    headers=headers,
                )

            self.assertEqual(response.status_code, 200)
            self.assertEqual(readiness.call_count, 1)
            self.assertEqual(data_quality.call_count, 1)


if __name__ == "__main__":
    unittest.main()
