import os

from sqlalchemy import create_engine, text


def diagnose() -> None:
    db_uri = os.getenv("SQLALCHEMY_DATABASE_URI", "sqlite:///:memory:")
    engine = create_engine(db_uri)

    with engine.connect() as conn:
        print("--- DIAGNOSTICS START ---")
        sales = conn.execute(
            text("SELECT COUNT(*), MIN(date), MAX(date) FROM daily_sales")
        ).fetchone()
        print(
            f"daily_sales: COUNT={sales[0]}, MIN_DATE={sales[1]}, MAX_DATE={sales[2]}"
        )

        expenses = conn.execute(text("SELECT COUNT(*) FROM expenses")).fetchone()
        print(f"expenses: COUNT={expenses[0]}")
        print("--- DIAGNOSTICS END ---")


if __name__ == "__main__":
    diagnose()
