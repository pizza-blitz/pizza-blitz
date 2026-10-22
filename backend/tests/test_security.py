"""Two-factor authentication and granular staff permission tests."""

import os
import unittest
from contextlib import suppress

os.environ.setdefault("PYTHONDONTWRITEBYTECODE", "1")

from fastapi.testclient import TestClient

from app.core.config import settings
from app.main import app
from app.services.two_factor_service import totp_now


class SecurityTest(unittest.TestCase):
    def setUp(self):
        self._ctx = TestClient(app)
        self.client = self._ctx.__enter__()
        self.secret: str | None = None
        self.admin_headers = self.admin_login()

    def tearDown(self):
        # Never leave 2FA enabled for the shared master admin.
        with suppress(Exception):
            status = self.client.get(
                "/api/v1/auth/2fa/status", headers=self.admin_headers
            ).json()
            if status.get("enabled") and self.secret:
                self.client.post(
                    "/api/v1/auth/2fa/disable",
                    json={"code": totp_now(self.secret)},
                    headers=self.admin_headers,
                )
        self._ctx.__exit__(None, None, None)

    def admin_login(self) -> dict:
        response = self.client.post(
            "/api/v1/auth/admin/login",
            json={
                "id": settings.PIZZA_BLITZ_ADMIN_ID,
                "password": settings.PIZZA_BLITZ_ADMIN_PASSWORD,
            },
        )
        self.assertEqual(response.status_code, 200, response.text)
        return {"Authorization": f"Bearer {response.json()['access_token']}"}

    def test_two_factor_enable_challenge_recovery_and_disable(self):
        status = self.client.get(
            "/api/v1/auth/2fa/status", headers=self.admin_headers
        )
        self.assertEqual(status.status_code, 200, status.text)
        self.assertFalse(status.json()["enabled"])

        setup = self.client.post(
            "/api/v1/auth/2fa/setup", headers=self.admin_headers
        )
        self.assertEqual(setup.status_code, 200, setup.text)
        secret = setup.json()["secret"]
        self.secret = secret
        self.assertIn("otpauth://totp/", setup.json()["otpauth_uri"])

        bad_confirm = self.client.post(
            "/api/v1/auth/2fa/confirm",
            json={"code": "000000"},
            headers=self.admin_headers,
        )
        self.assertEqual(bad_confirm.status_code, 422)

        confirmed = self.client.post(
            "/api/v1/auth/2fa/confirm",
            json={"code": totp_now(secret)},
            headers=self.admin_headers,
        )
        self.assertEqual(confirmed.status_code, 200, confirmed.text)
        self.assertTrue(confirmed.json()["enabled"])
        recovery_codes = confirmed.json()["recovery_codes"]
        self.assertEqual(len(recovery_codes), 8)

        login = self.client.post(
            "/api/v1/auth/admin/login",
            json={
                "id": settings.PIZZA_BLITZ_ADMIN_ID,
                "password": settings.PIZZA_BLITZ_ADMIN_PASSWORD,
            },
        )
        self.assertEqual(login.status_code, 200, login.text)
        self.assertTrue(login.json()["two_factor_required"])
        challenge = login.json()["challenge_token"]

        reused_as_session = self.client.get(
            "/api/v1/auth/me",
            headers={"Authorization": f"Bearer {challenge}"},
        )
        self.assertEqual(reused_as_session.status_code, 401)

        wrong = self.client.post(
            "/api/v1/auth/2fa/verify",
            json={"challenge_token": challenge, "code": "000000"},
        )
        self.assertEqual(wrong.status_code, 401)

        verified = self.client.post(
            "/api/v1/auth/2fa/verify",
            json={"challenge_token": challenge, "code": totp_now(secret)},
        )
        self.assertEqual(verified.status_code, 200, verified.text)
        token = verified.json()["access_token"]
        me = self.client.get(
            "/api/v1/auth/me", headers={"Authorization": f"Bearer {token}"}
        )
        self.assertEqual(me.status_code, 200)
        self.assertEqual(me.json()["role"], "admin")

        recovery_login = self.client.post(
            "/api/v1/auth/admin/login",
            json={
                "id": settings.PIZZA_BLITZ_ADMIN_ID,
                "password": settings.PIZZA_BLITZ_ADMIN_PASSWORD,
            },
        ).json()
        recovered = self.client.post(
            "/api/v1/auth/2fa/verify",
            json={
                "challenge_token": recovery_login["challenge_token"],
                "code": recovery_codes[0],
            },
        )
        self.assertEqual(recovered.status_code, 200, recovered.text)

        repeated = self.client.post(
            "/api/v1/auth/admin/login",
            json={
                "id": settings.PIZZA_BLITZ_ADMIN_ID,
                "password": settings.PIZZA_BLITZ_ADMIN_PASSWORD,
            },
        ).json()
        reused_recovery = self.client.post(
            "/api/v1/auth/2fa/verify",
            json={
                "challenge_token": repeated["challenge_token"],
                "code": recovery_codes[0],
            },
        )
        self.assertEqual(reused_recovery.status_code, 401)

        disabled = self.client.post(
            "/api/v1/auth/2fa/disable",
            json={"code": totp_now(secret)},
            headers=self.admin_headers,
        )
        self.assertEqual(disabled.status_code, 200, disabled.text)
        final = self.client.post(
            "/api/v1/auth/admin/login",
            json={
                "id": settings.PIZZA_BLITZ_ADMIN_ID,
                "password": settings.PIZZA_BLITZ_ADMIN_PASSWORD,
            },
        )
        self.assertEqual(final.status_code, 200)
        self.assertIn("access_token", final.json())

    def test_staff_permissions_are_granular(self):
        staff_login = self.client.post(
            "/api/v1/auth/staff/login",
            json={
                "id": settings.PIZZA_BLITZ_STAFF_ID,
                "password": settings.PIZZA_BLITZ_STAFF_PASSWORD,
            },
        )
        self.assertEqual(staff_login.status_code, 200, staff_login.text)
        staff_headers = {
            "Authorization": f"Bearer {staff_login.json()['access_token']}"
        }

        denied = self.client.post(
            "/api/v1/restaurant/reports/custom",
            json={
                "start_date": "2026-01-01",
                "end_date": "2026-01-02",
                "metrics": ["revenue"],
            },
            headers=staff_headers,
        )
        self.assertEqual(denied.status_code, 403)

        current = self.client.get(
            "/api/v1/auth/permissions", headers=self.admin_headers
        ).json()
        enabled = [
            item["key"] for item in current["permissions"] if item["enabled"]
        ]
        granted = self.client.put(
            "/api/v1/auth/permissions/staff",
            json={"permissions": sorted(set(enabled + ["reports.view"]))},
            headers=self.admin_headers,
        )
        self.assertEqual(granted.status_code, 200, granted.text)

        allowed = self.client.post(
            "/api/v1/restaurant/reports/custom",
            json={
                "start_date": "2026-01-01",
                "end_date": "2026-01-02",
                "metrics": ["revenue"],
            },
            headers=staff_headers,
        )
        self.assertEqual(allowed.status_code, 200, allowed.text)

        self.client.put(
            "/api/v1/auth/permissions/staff",
            json={"permissions": sorted(set(enabled) - {"refunds.manage"})},
            headers=self.admin_headers,
        )
        refund_denied = self.client.get(
            "/api/v1/restaurant/orders/999999/refunds", headers=staff_headers
        )
        self.assertEqual(refund_denied.status_code, 403)

        self.client.put(
            "/api/v1/auth/permissions/staff",
            json={"permissions": sorted(set(enabled) | {"refunds.manage"})},
            headers=self.admin_headers,
        )
        refund_allowed = self.client.get(
            "/api/v1/restaurant/orders/999999/refunds", headers=staff_headers
        )
        self.assertEqual(refund_allowed.status_code, 404)

        self.client.put(
            "/api/v1/auth/permissions/staff",
            json={"permissions": enabled},
            headers=self.admin_headers,
        )

        forbidden = self.client.get(
            "/api/v1/auth/permissions", headers=staff_headers
        )
        self.assertEqual(forbidden.status_code, 403)


if __name__ == "__main__":
    unittest.main()
