import os

from sqlalchemy import create_engine, text


def check_count() -> None:
    db_uri = os.getenv("SQLALCHEMY_DATABASE_URI", "sqlite:///:memory:")
    engine = create_engine(db_uri)
    with engine.connect() as conn:
        count = conn.execute(text("SELECT COUNT(*) FROM daily_sales;")).scalar()
        print(f"Total DailySales records: {count}")


if __name__ == "__main__":
    check_count()
