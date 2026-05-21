import os
from sqlalchemy import create_engine, text

def run_seed():
    db_uri = os.getenv("SQLALCHEMY_DATABASE_URI")
    if not db_uri:
        print("Error: SQLALCHEMY_DATABASE_URI not set")
        return

    with open("master_seed.sql", "r") as f:
        sql = f.read()

    engine = create_engine(db_uri)
    with engine.connect() as conn:
        print(f"Executing SQL seed script...")
        conn.execute(text(sql))
        conn.commit()
        print("Database seeded successfully!")

if __name__ == "__main__":
    run_seed()
