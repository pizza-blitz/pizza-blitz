import json
import os
from pydantic_settings import BaseSettings

class Settings(BaseSettings):
    PROJECT_NAME: str = "Restaurant Portal API"
    API_V1_STR: str = "/api/v1"
    ENVIRONMENT: str = os.getenv("ENVIRONMENT", "development")
    # Day boundaries for sales, orders, and promotions follow this timezone,
    # independent of the host clock (Cloud Run runs in UTC by default).
    RESTAURANT_TIMEZONE: str = os.getenv("RESTAURANT_TIMEZONE", "Asia/Kolkata")

    BACKEND_CORS_ORIGINS: str = os.getenv("BACKEND_CORS_ORIGINS", "")

    @property
    def cors_origins(self) -> list[str]:
        raw = self.BACKEND_CORS_ORIGINS
        if not raw:
            return []
        if raw.strip().startswith("["):
            try:
                parsed = json.loads(raw)
                if isinstance(parsed, list):
                    return [str(origin).strip() for origin in parsed if str(origin).strip()]
            except json.JSONDecodeError:
                return []
        return [origin.strip() for origin in raw.split(",") if origin.strip()]

    SQLALCHEMY_DATABASE_URI: str = os.getenv(
        "SQLALCHEMY_DATABASE_URI",
        "sqlite:///:memory:",
    )
    BACKUP_DIR: str = os.getenv("BACKUP_DIR", "backups")
    BACKUP_RETENTION_DAYS: int = int(os.getenv("BACKUP_RETENTION_DAYS", "14"))
    SHEET_AUTO_SYNC_ENABLED: bool = os.getenv("SHEET_AUTO_SYNC_ENABLED", "false").lower() in {
        "1",
        "true",
        "yes",
        "on",
    }
    
    # In-process guard for sensitive public endpoints. A horizontally scaled
    # deployment should also use a shared limiter or a provider WAF rule.
    RATE_LIMIT_ENABLED: bool = os.getenv("RATE_LIMIT_ENABLED", "true").lower() in {
        "1",
        "true",
        "yes",
        "on",
    }
    RESTAURANT_ADMIN_ID: str = os.getenv("RESTAURANT_ADMIN_ID", "admin")
    RESTAURANT_ADMIN_PASSWORD: str = os.getenv("RESTAURANT_ADMIN_PASSWORD", "admin123")
    PIZZA_BLITZ_ADMIN_ID: str = os.getenv("PIZZA_BLITZ_ADMIN_ID", RESTAURANT_ADMIN_ID)
    PIZZA_BLITZ_ADMIN_NAME: str = os.getenv("PIZZA_BLITZ_ADMIN_NAME", "Restaurant Admin")
    PIZZA_BLITZ_ADMIN_PASSWORD: str = os.getenv(
        "PIZZA_BLITZ_ADMIN_PASSWORD",
        RESTAURANT_ADMIN_PASSWORD,
    )
    PIZZA_BLITZ_STAFF_ID: str = os.getenv("PIZZA_BLITZ_STAFF_ID", "staff")
    PIZZA_BLITZ_STAFF_PASSWORD: str = os.getenv("PIZZA_BLITZ_STAFF_PASSWORD", "staff123")
    PIZZA_BLITZ_SESSION_SECRET: str | None = os.getenv("PIZZA_BLITZ_SESSION_SECRET")
    AUTH_SECRET_KEY: str = os.getenv(
        "AUTH_SECRET_KEY",
        os.getenv("RESTAURANT_ADMIN_PASSWORD", "pizza-blitz-local-secret"),
    )
    AUTH_TOKEN_EXPIRE_MINUTES: int = int(os.getenv("AUTH_TOKEN_EXPIRE_MINUTES", "480"))
    CUSTOMER_TOKEN_EXPIRE_MINUTES: int = int(os.getenv("CUSTOMER_TOKEN_EXPIRE_MINUTES", "43200"))
    PAYMENT_PROVIDER: str = os.getenv("PAYMENT_PROVIDER", "manual")
    PAYMENT_CURRENCY: str = os.getenv("PAYMENT_CURRENCY", "INR")
    # Local site default is `localhost:3011`, the spelling a loopback-bound frontend
    # answers redirects with: started with `--hostname 127.0.0.1`, Next answers both
    # loopback spellings with `localhost`, so generated links keep the visitor on the
    # origin they are already using.
    PAYMENT_RETURN_URL: str = os.getenv("PAYMENT_RETURN_URL", "http://localhost:3011/account")
    PIZZA_BLITZ_PUBLIC_URL: str = os.getenv("PIZZA_BLITZ_PUBLIC_URL", "http://localhost:3011")
    PIZZA_BLITZ_PUBLIC_API_PREFIX: str = os.getenv("PIZZA_BLITZ_PUBLIC_API_PREFIX", "/server")
    # Transactional order-status notifications. The "console" channel records a
    # sent notification without calling an external provider (development/demo).
    ORDER_NOTIFICATIONS_ENABLED: bool = (
        os.getenv("ORDER_NOTIFICATIONS_ENABLED", "false").strip().lower() == "true"
    )
    ORDER_NOTIFICATION_CHANNEL: str = os.getenv("ORDER_NOTIFICATION_CHANNEL", "sms")
    CUSTOMER_OTP_CHANNEL: str = os.getenv("CUSTOMER_OTP_CHANNEL", "console")
    MESSAGING_WEBHOOK_TOKEN: str | None = os.getenv("MESSAGING_WEBHOOK_TOKEN")
    CUSTOMER_OTP_TTL_SECONDS: int = int(os.getenv("CUSTOMER_OTP_TTL_SECONDS", "300"))
    # Only local development and tests may echo a debug OTP. Staging and
    # production fail closed even if the channel is console or delivery fails.
    CUSTOMER_OTP_DEBUG_ENABLED: bool = (
        os.getenv("CUSTOMER_OTP_DEBUG_ENABLED", "true").strip().lower()
        in {"1", "true", "yes", "on"}
    )
    CASHFREE_APP_ID: str | None = os.getenv("CASHFREE_APP_ID")
    CASHFREE_SECRET_KEY: str | None = os.getenv("CASHFREE_SECRET_KEY")
    CASHFREE_WEBHOOK_SECRET: str | None = os.getenv("CASHFREE_WEBHOOK_SECRET")
    CASHFREE_ENVIRONMENT: str = os.getenv("CASHFREE_ENVIRONMENT", "sandbox")
    CASHFREE_API_VERSION: str = os.getenv("CASHFREE_API_VERSION", "2025-01-01")
    CASHFREE_BASE_URL: str | None = os.getenv("CASHFREE_BASE_URL")
    RAZORPAY_KEY_ID: str | None = os.getenv("RAZORPAY_KEY_ID")
    RAZORPAY_KEY_SECRET: str | None = os.getenv("RAZORPAY_KEY_SECRET")
    RAZORPAY_WEBHOOK_SECRET: str | None = os.getenv("RAZORPAY_WEBHOOK_SECRET")
    RAZORPAY_BASE_URL: str = os.getenv("RAZORPAY_BASE_URL", "https://api.razorpay.com")
    DIRECT_BANK_UPI_ID: str | None = os.getenv("DIRECT_BANK_UPI_ID")
    DIRECT_BANK_ACCOUNT_NAME: str | None = os.getenv("DIRECT_BANK_ACCOUNT_NAME")
    DIRECT_BANK_ACCOUNT_NUMBER: str | None = os.getenv("DIRECT_BANK_ACCOUNT_NUMBER")
    DIRECT_BANK_IFSC: str | None = os.getenv("DIRECT_BANK_IFSC")
    DIRECT_BANK_QR_URL: str | None = os.getenv("DIRECT_BANK_QR_URL")
    CAMPAIGN_SEND_ENABLED: bool = os.getenv("CAMPAIGN_SEND_ENABLED", "false").lower() in {
        "1",
        "true",
        "yes",
        "on",
    }
    CAMPAIGN_DEFAULT_COUNTRY_CODE: str = os.getenv("CAMPAIGN_DEFAULT_COUNTRY_CODE", "91")
    EMAIL_PROVIDER: str = os.getenv("EMAIL_PROVIDER", "resend")
    RESEND_API_KEY: str | None = os.getenv("RESEND_API_KEY")
    RESEND_FROM_EMAIL: str | None = os.getenv("RESEND_FROM_EMAIL")
    SMS_PROVIDER: str = os.getenv("SMS_PROVIDER", "twilio")
    TWILIO_ACCOUNT_SID: str | None = os.getenv("TWILIO_ACCOUNT_SID")
    TWILIO_AUTH_TOKEN: str | None = os.getenv("TWILIO_AUTH_TOKEN")
    TWILIO_FROM_NUMBER: str | None = os.getenv("TWILIO_FROM_NUMBER")
    TWILIO_MESSAGING_SERVICE_SID: str | None = os.getenv("TWILIO_MESSAGING_SERVICE_SID")
    WHATSAPP_PROVIDER: str = os.getenv("WHATSAPP_PROVIDER", "meta")
    WHATSAPP_ACCESS_TOKEN: str | None = os.getenv("WHATSAPP_ACCESS_TOKEN")
    WHATSAPP_PHONE_NUMBER_ID: str | None = os.getenv("WHATSAPP_PHONE_NUMBER_ID")
    WHATSAPP_GRAPH_VERSION: str = os.getenv("WHATSAPP_GRAPH_VERSION", "v25.0")
    WHATSAPP_TEMPLATE_NAME: str | None = os.getenv("WHATSAPP_TEMPLATE_NAME")
    WHATSAPP_TEMPLATE_LANGUAGE: str = os.getenv("WHATSAPP_TEMPLATE_LANGUAGE", "en_US")
    SOCIAL_PUBLISH_ENABLED: bool = os.getenv("SOCIAL_PUBLISH_ENABLED", "false").lower() in {
        "1",
        "true",
        "yes",
        "on",
    }
    META_GRAPH_VERSION: str = os.getenv("META_GRAPH_VERSION", "v25.0")
    FACEBOOK_PAGE_ID: str | None = os.getenv("FACEBOOK_PAGE_ID")
    FACEBOOK_PAGE_ACCESS_TOKEN: str | None = os.getenv("FACEBOOK_PAGE_ACCESS_TOKEN")
    INSTAGRAM_BUSINESS_ACCOUNT_ID: str | None = os.getenv("INSTAGRAM_BUSINESS_ACCOUNT_ID")
    INSTAGRAM_ACCESS_TOKEN: str | None = os.getenv("INSTAGRAM_ACCESS_TOKEN")
    ADS_LAUNCH_ENABLED: bool = os.getenv("ADS_LAUNCH_ENABLED", "false").lower() in {
        "1",
        "true",
        "yes",
        "on",
    }
    META_AD_ACCOUNT_ID: str | None = os.getenv("META_AD_ACCOUNT_ID")
    META_AD_ACCESS_TOKEN: str | None = os.getenv("META_AD_ACCESS_TOKEN")

    class Config:
        case_sensitive = True
        env_file = ".env"

try:
    settings = Settings()
except Exception:
    settings = Settings(_env_file=".env", _env_file_encoding="utf-8")


# Values that ship in the repository for local development. Production must
# never start on any of them.
WEAK_SECRET_VALUES = {
    "",
    "admin123",
    "change-me",
    "change-this-long-random-secret",
    "pizza-blitz-local-secret",
    "pizza-blitz-local-session-secret",
}


def validate_production_settings() -> None:
    """Refuse to boot production on local default secrets or a throwaway database.

    A deploy that forgets AUTH_SECRET_KEY would otherwise sign admin tokens
    with a repository default that anyone can read. A deploy that forgets
    SQLALCHEMY_DATABASE_URI would otherwise start happily on `sqlite:///:memory:`,
    accept orders into RAM, and lose every one of them when the platform
    recycles the process. Failing at startup is the only safe outcome, and it is
    reported as one actionable error.

    A Vercel preview with SQLite is deliberately outside this guard: it boots so
    the storefront can be shown, and `checkout_readiness_payload()` refuses order
    capture with a 503 instead. `ENVIRONMENT=production` is what marks a deploy
    as a real restaurant rather than a preview.
    """
    if settings.ENVIRONMENT.strip().lower() != "production":
        return

    problems: list[str] = []
    if settings.AUTH_SECRET_KEY in WEAK_SECRET_VALUES:
        problems.append("AUTH_SECRET_KEY")
    if settings.RESTAURANT_ADMIN_PASSWORD in WEAK_SECRET_VALUES:
        problems.append("RESTAURANT_ADMIN_PASSWORD")
    if settings.PIZZA_BLITZ_ADMIN_PASSWORD in WEAK_SECRET_VALUES:
        problems.append("PIZZA_BLITZ_ADMIN_PASSWORD")
    if not settings.PIZZA_BLITZ_SESSION_SECRET or (
        settings.PIZZA_BLITZ_SESSION_SECRET in WEAK_SECRET_VALUES
    ):
        problems.append("PIZZA_BLITZ_SESSION_SECRET")
    if settings.SQLALCHEMY_DATABASE_URI.strip().lower().startswith("sqlite"):
        problems.append(
            "SQLALCHEMY_DATABASE_URI (production needs a Postgres URL; "
            "SQLite is for local runs only)"
        )
    if problems:
        raise RuntimeError(
            "Refusing to start in production with unsafe settings: "
            + ", ".join(problems)
            + ". Set strong unique values for these environment variables."
        )
