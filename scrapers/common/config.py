from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file="../.env", extra="ignore")

    redis_url: str = "redis://127.0.0.1:6379"
    the_odds_api_key: str = ""
    betfair_app_key: str = ""
    proxy_provider: str = "none"
    proxy_user: str = ""
    proxy_pass: str = ""
    proxy_host: str = ""
    proxy_port: str = ""


settings = Settings()
