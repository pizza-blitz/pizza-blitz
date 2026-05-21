from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool
from app.core.config import settings

connect_args = {}
engine_args = {"pool_pre_ping": True}
if settings.SQLALCHEMY_DATABASE_URI.startswith("sqlite"):
    connect_args = {"check_same_thread": False}
    if settings.SQLALCHEMY_DATABASE_URI == "sqlite:///:memory:":
        engine_args["poolclass"] = StaticPool

engine = create_engine(
    settings.SQLALCHEMY_DATABASE_URI,
    connect_args=connect_args,
    **engine_args,
)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
