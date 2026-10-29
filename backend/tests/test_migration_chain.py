"""Migration-chain tests for the database production actually uses.

The 326-test suite runs on in-memory SQLite built from the model metadata, so it
never executes a single migration. A deployed Pizza Blitz does: `alembic upgrade
head` is the only thing that creates the tables behind a real Postgres. These
tests render the whole chain in offline mode against the Postgres dialect, which
needs no server, and prove three things that were previously only assumed:

- the revisions form one unbranching chain with exactly one head;
- every migration renders as valid Postgres statements, including the generated
  `daily_sales.profit` column, which SQLite cannot express;
- the rendered chain reaches the revision the application was built against.
"""

import contextlib
import io
import os
import unittest
os.environ.setdefault("PYTHONDONTWRITEBYTECODE", "1")

from alembic import command
from alembic.config import Config
from alembic.script import ScriptDirectory

from app.core.config import settings

BACKEND_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
POSTGRES_URL = "postgresql+psycopg2://restaurant:secret@127.0.0.1:5432/pizza_blitz"


def alembic_config() -> Config:
    config = Config(os.path.join(BACKEND_ROOT, "alembic.ini"))
    config.set_main_option("script_location", os.path.join(BACKEND_ROOT, "alembic"))
    return config


class MigrationChainTest(unittest.TestCase):
    def setUp(self):
        self.original_uri = settings.SQLALCHEMY_DATABASE_URI

    def tearDown(self):
        settings.SQLALCHEMY_DATABASE_URI = self.original_uri

    def test_chain_has_exactly_one_head(self):
        heads = ScriptDirectory.from_config(alembic_config()).get_heads()
        self.assertEqual(
            len(heads),
            1,
            f"Migration branches must be merged before deploying, found {heads}.",
        )

    def test_revisions_form_an_unbranching_chain(self):
        script = ScriptDirectory.from_config(alembic_config())
        revisions = list(script.walk_revisions())
        self.assertGreater(len(revisions), 50)
        for revision in revisions:
            down_revision = revision.down_revision
            if down_revision is None:
                continue  # the base revision, which has no parent
            self.assertIsInstance(
                down_revision,
                str,
                f"{revision.revision} branches from more than one revision.",
            )

    def render_chain(self) -> str:
        """Render `alembic upgrade head` as SQL without touching a database.

        Alembic configures its own log handlers from alembic.ini when env.py
        runs, so both streams are captured: SQL on stdout, progress on stderr.
        """
        settings.SQLALCHEMY_DATABASE_URI = POSTGRES_URL
        stdout, stderr = io.StringIO(), io.StringIO()
        with contextlib.redirect_stdout(stdout), contextlib.redirect_stderr(stderr):
            command.upgrade(alembic_config(), "head", sql=True)
        return stdout.getvalue()

    def test_full_chain_renders_for_postgres(self):
        sql = self.render_chain()

        self.assertIn("CREATE TABLE orders", sql)
        self.assertIn("CREATE TABLE daily_sales", sql)
        self.assertIn("alembic_version", sql)
        # SQLite silently renders an empty generated expression; Postgres must
        # receive the arithmetic the column is defined by.
        self.assertIn("GENERATED ALWAYS AS (total_sale - total_expense) STORED", sql)
        self.assertNotIn("GENERATED ALWAYS AS ()", sql)
        self.assertNotIn("sqlite", sql.lower())

    def test_rendered_chain_ends_at_the_current_head(self):
        head = ScriptDirectory.from_config(alembic_config()).get_current_head()
        self.assertIn(head, self.render_chain())


if __name__ == "__main__":
    unittest.main()
