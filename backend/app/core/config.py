import os
from pydantic_settings import BaseSettings
from typing import List, Union, Any
from pydantic import AnyHttpUrl, validator

class Settings(BaseSettings):
    PROJECT_NAME: str = "Restaurant Portal API"
    API_V1_STR: str = "/api/v1"
    
    BACKEND_CORS_ORIGINS: List[AnyHttpUrl] = []

    @validator("BACKEND_CORS_ORIGINS", pre=True)
    def assemble_cors_origins(cls, v: Union[str, List[str]]) -> Union[List[str], str]:
        if isinstance(v, str) and not v.startswith("["):
            return [i.strip() for i in v.split(",") if i.strip()]
        elif isinstance(v, (list, str)):
            return v
        raise ValueError(v)

    SQLALCHEMY_DATABASE_URI: str = os.getenv(
        "SQLALCHEMY_DATABASE_URI",
        "sqlite:///:memory:",
    )
    
    RESTAURANT_ADMIN_ID: str = os.getenv("RESTAURANT_ADMIN_ID", "admin")
    RESTAURANT_ADMIN_PASSWORD: str = os.getenv("RESTAURANT_ADMIN_PASSWORD", "admin123")
    PAYMENT_PROVIDER: str = os.getenv("PAYMENT_PROVIDER", "manual")
    PAYMENT_CURRENCY: str = os.getenv("PAYMENT_CURRENCY", "INR")
    PAYMENT_RETURN_URL: str = os.getenv("PAYMENT_RETURN_URL", "http://localhost:3000/account")
    CASHFREE_APP_ID: str | None = os.getenv("CASHFREE_APP_ID")
    CASHFREE_SECRET_KEY: str | None = os.getenv("CASHFREE_SECRET_KEY")
    CASHFREE_WEBHOOK_SECRET: str | None = os.getenv("CASHFREE_WEBHOOK_SECRET")
    RAZORPAY_KEY_ID: str | None = os.getenv("RAZORPAY_KEY_ID")
    RAZORPAY_KEY_SECRET: str | None = os.getenv("RAZORPAY_KEY_SECRET")
    RAZORPAY_WEBHOOK_SECRET: str | None = os.getenv("RAZORPAY_WEBHOOK_SECRET")

    class Config:
        case_sensitive = True
        env_file = ".env"

try:
    settings = Settings()
except Exception:
    settings = Settings(_env_file=".env", _env_file_encoding="utf-8")
