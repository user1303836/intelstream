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
    discord_channel_id: int | None = Field(
        default=None,
        description="Default Discord channel ID for posting summaries (legacy, now per-source)",
    )
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

    content_poll_interval_minutes: int = Field(
        default=5,
        ge=1,
        le=60,
        description="Interval for checking and posting new content",
    )

    log_level: Literal["DEBUG", "INFO", "WARNING", "ERROR", "CRITICAL"] = Field(
        default="INFO",
        description="Logging level",
    )

    summary_max_tokens: int = Field(
        default=2048,
        ge=256,
        le=8192,
        description="Maximum tokens for summary generation",
    )

    summary_max_input_length: int = Field(
        default=100000,
        ge=1000,
        le=500000,
        description="Maximum input content length for summarization",
    )

    summary_model: str = Field(
        default="claude-3-5-haiku-20241022",
        description="Model to use for background summarization",
    )

    summary_model_interactive: str = Field(
        default="claude-sonnet-4-20250514",
        description="Model to use for interactive /summarize command",
    )

    discord_max_message_length: int = Field(
        default=2000,
        ge=500,
        le=2000,
        description="Maximum Discord message length (Discord limit is 2000)",
    )

    http_timeout_seconds: float = Field(
        default=30.0,
        ge=5.0,
        le=120.0,
        description="Timeout for HTTP requests in seconds",
    )

    max_html_length: int = Field(
        default=50000,
        ge=10000,
        le=200000,
        description="Maximum HTML length for LLM processing",
    )

    summarization_delay_seconds: float = Field(
        default=0.5,
        ge=0,
        le=5.0,
        description="Delay between summarization requests to avoid rate limiting",
    )

    max_consecutive_failures: int = Field(
        default=3,
        ge=1,
        le=20,
        description="Number of consecutive failures before re-analyzing a source",
    )

    youtube_max_results: int = Field(
        default=5,
        ge=1,
        le=50,
        description="Maximum number of YouTube videos to fetch per poll",
    )

    fetch_delay_seconds: float = Field(
        default=1.0,
        ge=0,
        le=30.0,
        description="Delay between fetching sources to avoid rate limiting",
    )

    max_concurrent_forwards: int = Field(
        default=5,
        ge=1,
        le=20,
        description="Maximum concurrent message forwards",
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

    def __repr__(self) -> str:
        return (
            f"Settings("
            f"discord_bot_token='*****', "
            f"discord_guild_id={self.discord_guild_id}, "
            f"discord_owner_id={self.discord_owner_id}, "
            f"anthropic_api_key='*****', "
            f"youtube_api_key={'*****' if self.youtube_api_key else None}, "
            f"database_url={self.database_url!r}, "
            f"log_level={self.log_level!r}"
            f")"
        )


@lru_cache
def get_settings() -> Settings:
    return Settings()
