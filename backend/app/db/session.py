import os
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import NullPool, StaticPool
from app.core.config import settings

connect_args = {}
engine_args = {"pool_pre_ping": True}
if settings.SQLALCHEMY_DATABASE_URI.startswith("sqlite"):
    connect_args = {"check_same_thread": False}
    if settings.SQLALCHEMY_DATABASE_URI == "sqlite:///:memory:":
        engine_args["poolclass"] = StaticPool
elif os.getenv("VERCEL") == "1" or settings.ENVIRONMENT.strip().lower() == "production":
    # In serverless environments (Vercel / AWS Lambda), use NullPool so idle
    # worker containers do not hold open pooled connections against Supabase's
    # Session Pooler (pool_size=15 limit).
    engine_args["poolclass"] = NullPool

engine = create_engine(
    settings.SQLALCHEMY_DATABASE_URI,
    connect_args=connect_args,
    **engine_args,
)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
