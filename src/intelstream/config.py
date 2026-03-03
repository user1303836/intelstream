from __future__ import annotations

from functools import lru_cache
from pathlib import Path
from typing import TYPE_CHECKING, Literal

from pydantic import Field, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

if TYPE_CHECKING:
    from intelstream.database.models import SourceType


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        case_sensitive=False,
        extra="ignore",
    )

    discord_bot_token: str = Field(min_length=1, description="Discord bot token")
    discord_guild_id: int = Field(description="Discord guild (server) ID")
    discord_channel_id: int | None = Field(
        default=None,
        description="Default Discord channel ID for posting summaries (legacy, now per-source)",
    )
    discord_owner_id: int = Field(
        description="Discord user ID of the bot owner for DM notifications"
    )

    llm_provider: str = Field(
        default="anthropic",
        description="LLM provider for summarization: anthropic, openai, gemini, or kimi",
    )

    anthropic_api_key: str | None = Field(default=None, description="Anthropic API key for Claude")
    openai_api_key: str | None = Field(default=None, description="OpenAI API key")
    gemini_api_key: str | None = Field(default=None, description="Google Gemini API key")
    kimi_api_key: str | None = Field(default=None, description="Kimi (Moonshot AI) API key")

    youtube_api_key: str | None = Field(default=None, description="YouTube Data API key (optional)")

    twitter_bearer_token: str | None = Field(
        default=None, description="X API v2 Bearer Token for Twitter monitoring (optional)"
    )

    github_token: str | None = Field(
        default=None, description="GitHub Personal Access Token (optional)"
    )

    github_poll_interval_minutes: int = Field(
        default=5,
        ge=1,
        le=60,
        description="Polling interval for GitHub repositories in minutes",
    )

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
        ge=0.1,
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

    substack_poll_interval_minutes: int | None = Field(
        default=None,
        ge=1,
        le=1440,
        description="Polling interval for Substack sources (falls back to DEFAULT_POLL_INTERVAL_MINUTES)",
    )
    youtube_poll_interval_minutes: int | None = Field(
        default=None,
        ge=1,
        le=1440,
        description="Polling interval for YouTube sources (falls back to DEFAULT_POLL_INTERVAL_MINUTES)",
    )
    rss_poll_interval_minutes: int | None = Field(
        default=None,
        ge=1,
        le=1440,
        description="Polling interval for RSS sources (falls back to DEFAULT_POLL_INTERVAL_MINUTES)",
    )
    arxiv_poll_interval_minutes: int | None = Field(
        default=None,
        ge=1,
        le=1440,
        description="Polling interval for Arxiv sources (falls back to DEFAULT_POLL_INTERVAL_MINUTES)",
    )
    blog_poll_interval_minutes: int | None = Field(
        default=None,
        ge=1,
        le=1440,
        description="Polling interval for Blog sources (falls back to DEFAULT_POLL_INTERVAL_MINUTES)",
    )
    twitter_poll_interval_minutes: int | None = Field(
        default=None,
        ge=1,
        le=1440,
        description="Polling interval for Twitter sources (falls back to DEFAULT_POLL_INTERVAL_MINUTES)",
    )
    page_poll_interval_minutes: int | None = Field(
        default=None,
        ge=1,
        le=1440,
        description="Polling interval for Page sources (falls back to DEFAULT_POLL_INTERVAL_MINUTES)",
    )

    embedding_model: str = Field(
        default="all-MiniLM-L6-v2",
        description="Sentence-transformers model for embeddings",
    )
    embedding_dimensions: int = Field(
        default=384,
        ge=1,
        description="Embedding vector dimensions (must match the model)",
    )
    search_result_limit: int = Field(
        default=5,
        ge=1,
        le=25,
        description="Max search results per query",
    )
    zvec_data_dir: str = Field(
        default="data/vectors",
        description="Directory for zvec vector data files",
    )
    search_enabled: bool = Field(
        default=True,
        description="Enable semantic search features",
    )

    lore_chunk_gap_minutes: int = Field(
        default=10,
        ge=1,
        le=60,
        description="Time gap in minutes that triggers a new chunk boundary",
    )
    lore_chunk_max_messages: int = Field(
        default=20,
        ge=5,
        le=100,
        description="Maximum messages per chunk before forced split",
    )
    lore_search_results: int = Field(
        default=15,
        ge=1,
        le=50,
        description="Number of chunks to retrieve per lore query",
    )
    lore_auto_resume: bool = Field(
        default=True,
        description="Auto-resume in-progress ingestion on bot restart",
    )

    def get_poll_interval(self, source_type: SourceType) -> int:
        from intelstream.database.models import SourceType

        intervals: dict[SourceType, int | None] = {
            SourceType.SUBSTACK: self.substack_poll_interval_minutes,
            SourceType.YOUTUBE: self.youtube_poll_interval_minutes,
            SourceType.RSS: self.rss_poll_interval_minutes,
            SourceType.ARXIV: self.arxiv_poll_interval_minutes,
            SourceType.BLOG: self.blog_poll_interval_minutes,
            SourceType.TWITTER: self.twitter_poll_interval_minutes,
            SourceType.PAGE: self.page_poll_interval_minutes,
        }
        return intervals.get(source_type) or self.default_poll_interval_minutes

    @property
    def llm_api_key(self) -> str:
        """Return the API key for the configured LLM provider."""
        keys = {
            "anthropic": self.anthropic_api_key,
            "openai": self.openai_api_key,
            "gemini": self.gemini_api_key,
            "kimi": self.kimi_api_key,
        }
        key = keys.get(self.llm_provider)
        if not key:
            raise ValueError(
                f"No API key configured for LLM provider '{self.llm_provider}'. "
                f"Set the corresponding environment variable "
                f"(e.g., ANTHROPIC_API_KEY, OPENAI_API_KEY, GEMINI_API_KEY, KIMI_API_KEY)."
            )
        return key

    @field_validator("database_url")
    @classmethod
    def validate_database_url(cls, v: str) -> str:
        if v.startswith("sqlite"):
            db_path = v.split("///")[-1]
            if db_path == "":
                raise ValueError("SQLite database path cannot be empty")
        return v

    def __repr__(self) -> str:
        return (
            f"Settings("
            f"discord_bot_token='*****', "
            f"discord_guild_id={self.discord_guild_id}, "
            f"discord_owner_id={self.discord_owner_id}, "
            f"llm_provider={self.llm_provider!r}, "
            f"anthropic_api_key={'*****' if self.anthropic_api_key else None}, "
            f"openai_api_key={'*****' if self.openai_api_key else None}, "
            f"gemini_api_key={'*****' if self.gemini_api_key else None}, "
            f"kimi_api_key={'*****' if self.kimi_api_key else None}, "
            f"youtube_api_key={'*****' if self.youtube_api_key else None}, "
            f"twitter_bearer_token={'*****' if self.twitter_bearer_token else None}, "
            f"github_token={'*****' if self.github_token else None}, "
            f"database_url={self.database_url!r}, "
            f"log_level={self.log_level!r}"
            f")"
        )


@lru_cache
def get_settings() -> Settings:
    return Settings()


def get_database_directory(database_url: str) -> Path | None:
    """Extract the parent directory path from a SQLite database URL.

    Returns None for non-SQLite databases or :memory: databases.
    """
    if not database_url.startswith("sqlite"):
        return None

    db_path = database_url.split("///")[-1]
    if db_path == ":memory:" or not db_path:
        return None

    return Path(db_path).parent
