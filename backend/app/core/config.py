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
        "sqlite:///./restaurant_db.sqlite",
    )
    
    RESTAURANT_ADMIN_ID: str = os.getenv("RESTAURANT_ADMIN_ID", "admin")
    RESTAURANT_ADMIN_PASSWORD: str = os.getenv("RESTAURANT_ADMIN_PASSWORD", "admin123")

    class Config:
        case_sensitive = True
        env_file = ".env"

try:
    settings = Settings()
except Exception:
    settings = Settings(_env_file=".env", _env_file_encoding="utf-8")
