import unittest

from fastapi.testclient import TestClient

from app.db.session import SessionLocal
from app.main import app
from app.models.domain import Customer
from app.services.auth_service import create_access_token


def admin_headers() -> dict[str, str]:
    token = create_access_token(
        subject="admin:csv-dry-run-test",
        role="admin",
        display_name="CSV Dry Run Test",
        expires_minutes=5,
    )["access_token"]
    return {"Authorization": f"Bearer {token}"}


class CustomerCsvDryRunTest(unittest.TestCase):
    def test_admin_can_preview_csv_conflicts_without_writing_customers(self):
        csv_text = "\n".join(
            [
                "name,phone,email,marketing_opt_in,notes",
                "Preview Existing,9876500011,existing@example.com,yes,first row",
                "Preview Duplicate,9876500011,duplicate@example.com,no,duplicate row",
                "Preview New,9876500022,new@example.com,true,new row",
                "Preview Invalid,,not-an-email,maybe,bad row",
            ]
        )
        with TestClient(app) as client:
            headers = admin_headers()
            created = client.post(
                "/api/v1/restaurant/customers/",
                headers=headers,
                json={
                    "name": "Existing Customer",
                    "phone": "9876500011",
                    "email": "saved@example.com",
                    "opt_in_marketing": True,
                },
            )
            self.assertEqual(created.status_code, 200)

            before = client.get("/api/v1/restaurant/customers/summary", headers=headers).json()
            anonymous = client.post(
                "/api/v1/restaurant/customers/import/validate",
                json={"csv_text": csv_text},
            )
            preview = client.post(
                "/api/v1/restaurant/customers/import/validate",
                headers=headers,
                json={"csv_text": csv_text},
            )
            after = client.get("/api/v1/restaurant/customers/summary", headers=headers).json()
            with SessionLocal() as db:
                db.query(Customer).filter(Customer.id == created.json()["id"]).delete()
                db.commit()

        self.assertEqual(anonymous.status_code, 401)
        self.assertEqual(preview.status_code, 200)
        payload = preview.json()
        self.assertTrue(payload["dry_run"])
        self.assertEqual(payload["writes_performed"], 0)
        self.assertFalse(payload["ready_for_review"])
        self.assertEqual(payload["summary"]["rows_total"], 4)
        self.assertEqual(payload["summary"]["rows_invalid"], 1)
        self.assertEqual(payload["summary"]["duplicate_phone_groups"], 1)
        self.assertEqual(payload["summary"]["existing_customer_matches"], 2)
        self.assertEqual(before["total_customers"], after["total_customers"])

    def test_export_compatible_headers_can_pass_dry_run(self):
        csv_text = "\n".join(
            [
                "id,name,phone,email,marketing_opt_in,total_orders,total_spend,first_seen_at,last_order_at,notes",
                ",Preview Ready,9876500033,ready@example.com,yes,0,0,,,clean preview",
            ]
        )
        with TestClient(app) as client:
            preview = client.post(
                "/api/v1/restaurant/customers/import/validate",
                headers=admin_headers(),
                json={"csv_text": csv_text},
            )

        self.assertEqual(preview.status_code, 200)
        payload = preview.json()
        self.assertTrue(payload["ready_for_review"])
        self.assertEqual(payload["summary"]["rows_total"], 1)
        self.assertEqual(payload["summary"]["rows_valid"], 1)
        self.assertEqual(payload["headers"]["ignored"], [])


if __name__ == "__main__":
    unittest.main()
