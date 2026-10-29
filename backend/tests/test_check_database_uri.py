"""Tests for the database URL preflight script."""

import os
import tempfile
import unittest
from pathlib import Path

os.environ.setdefault("PYTHONDONTWRITEBYTECODE", "1")

import check_database_uri as preflight

SUPABASE_SESSION = (
    "postgresql+psycopg2://postgres.abcdefgh:secret-pass@"
    "aws-0-ap-south-1.pooler.supabase.com:5432/postgres?sslmode=require"
)


class RedactTest(unittest.TestCase):
    def test_password_is_hidden(self):
        shown = preflight.redact(SUPABASE_SESSION)
        self.assertNotIn("secret-pass", shown)
        self.assertIn(":***@", shown)
        self.assertIn("pooler.supabase.com:5432", shown)
        self.assertIn("sslmode=require", shown)

    def test_url_without_password_is_unchanged(self):
        self.assertEqual(preflight.redact("sqlite:///local.db"), "sqlite:///local.db")


class InspectUriTest(unittest.TestCase):
    def test_supabase_session_pooler_is_clean(self):
        problems, _ = preflight.inspect_uri(SUPABASE_SESSION)
        self.assertEqual(problems, [])

    def test_empty_uri_is_blocked(self):
        problems, _ = preflight.inspect_uri("   ")
        self.assertEqual(len(problems), 1)

    def test_sqlite_is_blocked_with_the_reason(self):
        problems, _ = preflight.inspect_uri("sqlite:///:memory:")
        self.assertEqual(len(problems), 1)
        self.assertIn("RAM", problems[0])

    def test_non_postgres_scheme_is_blocked(self):
        problems, _ = preflight.inspect_uri("mysql://user:pass@host/db")
        self.assertEqual(len(problems), 1)
        self.assertIn("Postgres", problems[0])

    def test_plain_postgresql_scheme_is_a_note_not_a_blocker(self):
        problems, notes = preflight.inspect_uri(
            "postgresql://user:pass@db.example.com:5432/pizza"
        )
        self.assertEqual(problems, [])
        self.assertTrue(any("psycopg2" in note for note in notes))

    def test_transaction_pooler_port_is_a_note(self):
        problems, notes = preflight.inspect_uri(
            "postgresql+psycopg2://postgres.ref:pass@aws-0.pooler.supabase.com:6543/postgres"
        )
        self.assertEqual(problems, [])
        self.assertTrue(any("6543" in note for note in notes))

    def test_supabase_without_ssl_is_a_note(self):
        problems, notes = preflight.inspect_uri(
            "postgresql+psycopg2://postgres.ref:pass@aws-0.pooler.supabase.com:5432/postgres"
        )
        self.assertEqual(problems, [])
        self.assertTrue(any("sslmode=require" in note for note in notes))

    def test_supabase_with_ssl_disabled_is_blocked(self):
        problems, _ = preflight.inspect_uri(
            "postgresql+psycopg2://postgres.ref:pass@aws-0.pooler.supabase.com:5432/postgres?sslmode=disable"
        )
        self.assertEqual(len(problems), 1)
        self.assertIn("sslmode", problems[0])


class ReadUriTest(unittest.TestCase):
    def test_reads_from_explicit_file(self):
        with tempfile.TemporaryDirectory() as directory:
            env_file = Path(directory) / ".env.deploy.local"
            env_file.write_text(
                "# comment\nSQLALCHEMY_DATABASE_URI=" + SUPABASE_SESSION + "\n",
                encoding="utf-8",
            )
            original = os.environ.pop("SQLALCHEMY_DATABASE_URI", None)
            try:
                uri, source = preflight.read_uri(str(env_file))
            finally:
                if original is not None:
                    os.environ["SQLALCHEMY_DATABASE_URI"] = original
        self.assertEqual(uri, SUPABASE_SESSION)
        self.assertIn(".env.deploy.local", source)

    def test_environment_variable_wins(self):
        original = os.environ.get("SQLALCHEMY_DATABASE_URI")
        os.environ["SQLALCHEMY_DATABASE_URI"] = SUPABASE_SESSION
        try:
            uri, source = preflight.read_uri(None)
        finally:
            if original is None:
                os.environ.pop("SQLALCHEMY_DATABASE_URI", None)
            else:
                os.environ["SQLALCHEMY_DATABASE_URI"] = original
        self.assertEqual(uri, SUPABASE_SESSION)
        self.assertIn("environment", source)


if __name__ == "__main__":
    unittest.main()
