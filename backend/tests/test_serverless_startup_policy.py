import os
import unittest
from unittest.mock import patch

from app.main import (
    is_vercel_serverless_runtime,
    should_bootstrap_database_on_startup,
    should_start_scheduler,
)


class ServerlessStartupPolicyTest(unittest.TestCase):
    def test_local_runtime_keeps_self_initialization_enabled(self):
        with patch.dict(os.environ, {}, clear=True):
            self.assertFalse(is_vercel_serverless_runtime())
            self.assertTrue(should_bootstrap_database_on_startup())
            self.assertTrue(should_start_scheduler())

    def test_vercel_runtime_skips_expensive_startup_work_by_default(self):
        with patch.dict(os.environ, {"VERCEL": "1"}, clear=True):
            self.assertTrue(is_vercel_serverless_runtime())
            self.assertFalse(should_bootstrap_database_on_startup())
            self.assertFalse(should_start_scheduler())

    def test_explicit_flags_override_runtime_defaults(self):
        with patch.dict(
            os.environ,
            {
                "VERCEL": "1",
                "PIZZA_BLITZ_BOOTSTRAP_ON_STARTUP": "true",
                "PIZZA_BLITZ_SCHEDULER_ENABLED": "yes",
            },
            clear=True,
        ):
            self.assertTrue(should_bootstrap_database_on_startup())
            self.assertTrue(should_start_scheduler())


if __name__ == "__main__":
    unittest.main()
