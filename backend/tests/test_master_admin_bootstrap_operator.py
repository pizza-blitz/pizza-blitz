import io
import unittest
from unittest.mock import patch

from fastapi.testclient import TestClient

from app.db.session import SessionLocal
from app.main import app
from app.models.domain import OperationalAuditEvent
from app.services.auth_service import verify_managed_admin_credentials
from bootstrap_master_admin import configure_master_admin, read_password


class MasterAdminBootstrapOperatorTest(unittest.TestCase):
    def test_operator_cli_configures_hashed_master_and_requires_explicit_rotation(self):
        password = "Operator-Master-Proof-123!"
        with TestClient(app):
            with SessionLocal() as db:
                credential = configure_master_admin(
                    db=db,
                    admin_id="operator-master-proof",
                    display_name="Operator Master Proof",
                    password=password,
                    rotate_existing=True,
                )
                self.assertNotIn(password, credential.password_hash)
                self.assertNotEqual(password, credential.password_hash)

                managed = verify_managed_admin_credentials(
                    admin_id="operator-master-proof",
                    password=password,
                    db=db,
                )
                self.assertIsNotNone(managed)

                with self.assertRaisesRegex(ValueError, "rotate-existing"):
                    configure_master_admin(
                        db=db,
                        admin_id="operator-master-replacement",
                        display_name="Operator Master Replacement",
                        password="Operator-Master-Replacement-123!",
                    )

                audit = (
                    db.query(OperationalAuditEvent)
                    .filter(OperationalAuditEvent.resource_id == "operator-master-proof")
                    .order_by(OperationalAuditEvent.id.desc())
                    .first()
                )
                self.assertIsNotNone(audit)
                self.assertEqual(audit.event_type, "credential")
                self.assertIn(audit.action, {"admin_credential_bootstrap", "admin_credential_rotate"})
                self.assertEqual(audit.actor_subject, "operator-cli")

    def test_password_stdin_reads_one_line_without_logging(self):
        with patch("sys.stdin", io.StringIO("Controlled-Proof-Password-123!\nignored\n")):
            password = read_password(password_stdin=True)

        self.assertEqual(password, "Controlled-Proof-Password-123!")


if __name__ == "__main__":
    unittest.main()
