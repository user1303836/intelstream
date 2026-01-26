from functools import lru_cache
from pathlib import Path
from typing import Literal

from pydantic import Field, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        case_sensitive=False,
        extra="ignore",
    )

    discord_bot_token: str = Field(description="Discord bot token")
    discord_guild_id: int = Field(description="Discord guild (server) ID")
    discord_channel_id: int = Field(description="Discord channel ID for posting summaries")
    discord_owner_id: int = Field(
        description="Discord user ID of the bot owner for DM notifications"
    )

    anthropic_api_key: str = Field(description="Anthropic API key for Claude")

    youtube_api_key: str | None = Field(default=None, description="YouTube Data API key (optional)")

    database_url: str = Field(
        default="sqlite+aiosqlite:///./data/intelstream.db",
        description="Database connection URL",
    )

    default_poll_interval_minutes: int = Field(
        default=5,
        ge=1,
        le=60,
        description="Default polling interval in minutes",
    )

    log_level: Literal["DEBUG", "INFO", "WARNING", "ERROR", "CRITICAL"] = Field(
        default="INFO",
        description="Logging level",
    )

    @field_validator("database_url")
    @classmethod
    def ensure_data_directory(cls, v: str) -> str:
        if v.startswith("sqlite"):
            db_path = v.split("///")[-1]
            if db_path != ":memory:":
                path = Path(db_path)
                path.parent.mkdir(parents=True, exist_ok=True)
        return v


@lru_cache
def get_settings() -> Settings:
    return Settings()
