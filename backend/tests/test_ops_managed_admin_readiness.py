import os
import unittest
from unittest.mock import MagicMock, patch

from app.services import ops_service


class ManagedAdminReadinessTest(unittest.TestCase):
    def test_managed_admin_satisfies_admin_check_and_manifest_requirements(self):
        db = MagicMock()
        cleared_admin_env = {
            "RESTAURANT_ADMIN_ID": "",
            "RESTAURANT_ADMIN_PASSWORD": "",
            "PIZZA_BLITZ_ADMIN_ID": "",
            "PIZZA_BLITZ_ADMIN_PASSWORD": "",
        }
        with (
            patch.object(
                ops_service,
                "has_managed_admin_credentials",
                return_value=True,
            ),
            patch.dict(os.environ, cleared_admin_env, clear=False),
        ):
            check = ops_service._admin_password_check("production", db)
            manifest = ops_service._environment_manifest(db)
            summary = ops_service._environment_summary(manifest)

        self.assertEqual(check["status"], "pass")
        self.assertIn("Managed master admin", check["detail"])
        security_group = next(
            group for group in manifest if group["key"] == "security"
        )
        admin_variables = [
            variable
            for variable in security_group["variables"]
            if variable["name"]
            in {"RESTAURANT_ADMIN_ID", "RESTAURANT_ADMIN_PASSWORD"}
        ]
        self.assertEqual(len(admin_variables), 2)
        for variable in admin_variables:
            self.assertFalse(variable["required"])
            self.assertFalse(variable["configured"])
            self.assertEqual(
                variable["requirement_satisfied_by"],
                "managed_admin_credential",
            )
            self.assertNotIn(variable["name"], summary["missing_required"])

    def test_managed_admin_can_be_counter_fallback_before_staff_handoff(self):
        db = MagicMock()
        with (
            patch.object(
                ops_service,
                "has_managed_admin_credentials",
                return_value=True,
            ),
            patch.object(
                ops_service,
                "has_managed_staff_credentials",
                return_value=False,
            ),
            patch.object(ops_service, "_configured_env_value", return_value=""),
        ):
            check = ops_service._staff_password_check("production", db)

        self.assertEqual(check["status"], "warn")
        self.assertIn("Master admin credentials can enter", check["detail"])


if __name__ == "__main__":
    unittest.main()
