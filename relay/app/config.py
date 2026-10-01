from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_prefix="TWIN_RELAY_",
        env_file=".env",
        extra="ignore",
    )

    secret_key: str = "development-only-change-me"
    create_key: str = ""
    public_url: str = "http://localhost:8787"
    session_ttl_seconds: int = 8 * 60 * 60
    max_events: int = 5000
    max_comments: int = 5000
    ping_interval_seconds: int = 15
    pong_timeout_seconds: int = 45


settings = Settings()
