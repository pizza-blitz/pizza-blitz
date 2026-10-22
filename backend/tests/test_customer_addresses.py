"""Saved customer address tests."""

import os
import unittest

os.environ.setdefault("PYTHONDONTWRITEBYTECODE", "1")

from fastapi.testclient import TestClient

from app.main import app


class CustomerAddressTest(unittest.TestCase):
    def setUp(self):
        self._ctx = TestClient(app)
        self.client = self._ctx.__enter__()

    def tearDown(self):
        self._ctx.__exit__(None, None, None)

    def token_for(self, phone: str) -> str:
        requested = self.client.post(
            "/api/v1/auth/customer/otp/request", json={"phone": phone}
        )
        self.assertEqual(requested.status_code, 200, requested.text)
        verified = self.client.post(
            "/api/v1/auth/customer/otp/verify",
            json={"phone": phone, "code": requested.json()["debug_code"]},
        )
        self.assertEqual(verified.status_code, 200, verified.text)
        return verified.json()["access_token"]

    def headers(self, phone: str) -> dict:
        return {"Authorization": f"Bearer {self.token_for(phone)}"}

    def create(self, headers: dict, **overrides):
        payload = {
            "label": "Home",
            "address_line": "12 Saved Street, Bengaluru",
            "is_default": False,
        }
        payload.update(overrides)
        return self.client.post(
            "/api/v1/restaurant/customers/me/addresses",
            json=payload,
            headers=headers,
        )

    def test_crud_and_default_handling(self):
        headers = self.headers("9812345681")
        empty = self.client.get(
            "/api/v1/restaurant/customers/me/addresses", headers=headers
        )
        self.assertEqual(empty.status_code, 200, empty.text)
        self.assertEqual(empty.json(), [])

        first = self.create(headers, label="Home")
        self.assertEqual(first.status_code, 200, first.text)
        first_id = first.json()["id"]
        self.assertTrue(first.json()["is_default"])

        second = self.create(
            headers, label="Work", address_line="44 Office Road, Bengaluru", is_default=True
        )
        self.assertEqual(second.status_code, 200, second.text)
        self.assertTrue(second.json()["is_default"])

        listed = self.client.get(
            "/api/v1/restaurant/customers/me/addresses", headers=headers
        ).json()
        self.assertEqual(len(listed), 2)
        self.assertEqual([row["label"] for row in listed], ["Work", "Home"])
        self.assertFalse(next(row for row in listed if row["id"] == first_id)["is_default"])

        updated = self.client.patch(
            f"/api/v1/restaurant/customers/me/addresses/{first_id}",
            json={"label": "Parents", "is_default": True},
            headers=headers,
        )
        self.assertEqual(updated.status_code, 200, updated.text)
        self.assertEqual(updated.json()["label"], "Parents")
        self.assertTrue(updated.json()["is_default"])

        deleted = self.client.delete(
            f"/api/v1/restaurant/customers/me/addresses/{first_id}", headers=headers
        )
        self.assertEqual(deleted.status_code, 200, deleted.text)
        remaining = self.client.get(
            "/api/v1/restaurant/customers/me/addresses", headers=headers
        ).json()
        self.assertEqual(len(remaining), 1)
        self.assertTrue(remaining[0]["is_default"])

    def test_addresses_are_scoped_to_the_customer(self):
        owner = self.headers("9812345682")
        created = self.create(owner).json()
        other = self.headers("9812345683")

        listed = self.client.get(
            "/api/v1/restaurant/customers/me/addresses", headers=other
        ).json()
        self.assertEqual(listed, [])

        patched = self.client.patch(
            f"/api/v1/restaurant/customers/me/addresses/{created['id']}",
            json={"label": "Hijack"},
            headers=other,
        )
        self.assertEqual(patched.status_code, 404)

        deleted = self.client.delete(
            f"/api/v1/restaurant/customers/me/addresses/{created['id']}",
            headers=other,
        )
        self.assertEqual(deleted.status_code, 404)

    def test_validation_and_auth(self):
        headers = self.headers("9812345684")
        self.assertEqual(
            self.create(headers, address_line="short").status_code, 422
        )
        anonymous = self.client.get("/api/v1/restaurant/customers/me/addresses")
        self.assertEqual(anonymous.status_code, 401)

    def test_address_limit(self):
        headers = self.headers("9812345685")
        for index in range(10):
            response = self.create(
                headers,
                label=f"Address {index}",
                address_line=f"{index} Long Saved Street, Bengaluru",
            )
            self.assertEqual(response.status_code, 200, response.text)
        blocked = self.create(headers, address_line="99 Overflow Street, Bengaluru")
        self.assertEqual(blocked.status_code, 422)
        self.assertIn("10", blocked.json()["detail"])


if __name__ == "__main__":
    unittest.main()
