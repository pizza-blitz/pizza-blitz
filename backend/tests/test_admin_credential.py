import unittest

from fastapi.testclient import TestClient

from app.core.config import settings
from app.main import app


class ManagedAdminCredentialTest(unittest.TestCase):
    def test_owner_can_rotate_and_use_managed_admin_credential(self):
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

            saved = client.post(
                "/api/v1/auth/admin/credential",
                headers=headers,
                json={
                    "id": "master-admin-proof",
                    "password": "Master-Admin-Proof-123!",
                    "display_name": "Master Admin Proof",
                    "is_active": True,
                },
            )
            self.assertEqual(saved.status_code, 200)
            self.assertTrue(saved.json()["configured"])
            self.assertEqual(saved.json()["admin_id"], "master-admin-proof")
            self.assertEqual(saved.json()["source"], "managed")

            managed_login = client.post(
                "/api/v1/auth/admin/portal-verify",
                json={
                    "id": "master-admin-proof",
                    "password": "Master-Admin-Proof-123!",
                },
            )
            self.assertEqual(managed_login.status_code, 200)
            self.assertEqual(managed_login.json()["source"], "managed")

            wrong_password = client.post(
                "/api/v1/auth/admin/portal-verify",
                json={
                    "id": "master-admin-proof",
                    "password": "wrong-password",
                },
            )
            self.assertEqual(wrong_password.status_code, 401)

            status = client.get("/api/v1/auth/admin/credential", headers=headers)
            self.assertEqual(status.status_code, 200)
            self.assertEqual(status.json()["admin_id"], "master-admin-proof")
            self.assertIsNotNone(status.json()["last_login_at"])


if __name__ == "__main__":
    unittest.main()
