import os

from sqlalchemy import create_engine, text


def check_years() -> None:
    db_uri = os.getenv("SQLALCHEMY_DATABASE_URI", "sqlite:///./restaurant_db.sqlite")
    engine = create_engine(db_uri)
    with engine.connect() as conn:
        print("Yearly Record Breakdown:")
        result = conn.execute(
            text(
                """
                SELECT EXTRACT(YEAR FROM date) as year,
                       COUNT(*) as count,
                       SUM(total_sale) as total_sale
                FROM daily_sales
                GROUP BY year
                ORDER BY year;
                """
            )
        )
        for row in result:
            print(f"Year {int(row[0])}: {row[1]} records, Total Sale: {row[2]}")


if __name__ == "__main__":
    check_years()

