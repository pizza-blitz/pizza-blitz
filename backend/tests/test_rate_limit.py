"""Rate-limit regression tests for sensitive public endpoints."""

import os
import unittest
from types import SimpleNamespace
from unittest.mock import patch

os.environ.setdefault("PYTHONDONTWRITEBYTECODE", "1")

from fastapi import HTTPException
from fastapi.testclient import TestClient

from app.core import rate_limit
from app.core.config import settings
from app.main import app


class StubRequest:
    def __init__(self, host="203.0.113.9", forwarded=None):
        self.headers = {"x-forwarded-for": forwarded} if forwarded else {}
        self.client = SimpleNamespace(host=host)


class RateLimitUnitTest(unittest.TestCase):
    def setUp(self):
        rate_limit.reset_rate_limits()
        self.original = settings.RATE_LIMIT_ENABLED
        settings.RATE_LIMIT_ENABLED = True

    def tearDown(self):
        settings.RATE_LIMIT_ENABLED = self.original
        rate_limit.reset_rate_limits()

    def test_blocks_after_limit_and_sets_retry_after(self):
        request = StubRequest()
        for _ in range(3):
            rate_limit.enforce_rate_limit(request, "unit", 3)
        with self.assertRaises(HTTPException) as context:
            rate_limit.enforce_rate_limit(request, "unit", 3)
        self.assertEqual(context.exception.status_code, 429)
        self.assertIn("Retry-After", context.exception.headers)

    def test_buckets_are_isolated_by_client_and_name(self):
        first = StubRequest(host="203.0.113.1")
        second = StubRequest(host="203.0.113.2")
        for _ in range(2):
            rate_limit.enforce_rate_limit(first, "unit", 2)
        # A different client and a different bucket each get their own window.
        rate_limit.enforce_rate_limit(second, "unit", 2)
        rate_limit.enforce_rate_limit(first, "other", 2)

    def test_forwarded_for_header_is_used(self):
        proxy_a = StubRequest(forwarded="198.51.100.7, 10.0.0.1")
        proxy_b = StubRequest(forwarded="198.51.100.8, 10.0.0.1")
        for _ in range(2):
            rate_limit.enforce_rate_limit(proxy_a, "unit", 2)
        rate_limit.enforce_rate_limit(proxy_b, "unit", 2)

    def test_disabled_limiter_allows_everything(self):
        settings.RATE_LIMIT_ENABLED = False
        request = StubRequest()
        for _ in range(10):
            rate_limit.enforce_rate_limit(request, "unit", 1)


class RateLimitWiringTest(unittest.TestCase):
    def test_public_endpoints_enforce_a_limit(self):
        with patch(
            "app.api.api_v1.endpoints.orders.enforce_rate_limit"
        ) as orders_limit, patch(
            "app.api.api_v1.endpoints.auth.enforce_rate_limit"
        ) as auth_limit:
            with TestClient(app) as client:
                client.get(
                    "/api/v1/restaurant/orders/customer-history/9333333333"
                )
                client.post(
                    "/api/v1/restaurant/orders/",
                    json={"order_type": "takeaway", "items": []},
                )
                client.post(
                    "/api/v1/auth/admin/login",
                    json={"id": "admin", "password": "wrong"},
                )
            self.assertTrue(orders_limit.called)
            self.assertTrue(auth_limit.called)


if __name__ == "__main__":
    unittest.main()
