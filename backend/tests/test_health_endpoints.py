"""Health and readiness probe tests used by deployment checks."""

import os
import unittest

os.environ.setdefault("PYTHONDONTWRITEBYTECODE", "1")

from fastapi.testclient import TestClient

from app.main import app


class HealthEndpointTest(unittest.TestCase):
    def test_health_and_readiness_report_database_state(self):
        with TestClient(app) as client:
            health = client.get("/health")
            self.assertEqual(health.status_code, 200)
            self.assertEqual(health.json()["status"], "ok")

            ready = client.get("/ready")
            self.assertEqual(ready.status_code, 200)
            self.assertEqual(ready.json()["status"], "ready")
            self.assertEqual(ready.json()["database"], "ok")


if __name__ == "__main__":
    unittest.main()
