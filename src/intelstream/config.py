from __future__ import annotations

from functools import lru_cache
from ipaddress import ip_address, ip_network
from pathlib import Path
from typing import TYPE_CHECKING, Literal

from pydantic import Field, SecretStr, field_validator, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict
from sqlalchemy.engine import make_url
from sqlalchemy.exc import ArgumentError

if TYPE_CHECKING:
    from intelstream.database.models import SourceType


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        case_sensitive=False,
        extra="ignore",
    )

    discord_bot_token: SecretStr = Field(description="Discord bot token")
    discord_guild_id: int = Field(gt=0, description="Discord guild (server) ID")
    discord_channel_id: int | None = Field(
        default=None,
        gt=0,
        description="Default Discord channel ID for posting summaries (legacy, now per-source)",
    )
    discord_owner_id: int = Field(
        gt=0, description="Discord user ID of the bot owner for DM notifications"
    )
    discord_client_secret: SecretStr | None = Field(
        default=None,
        description="Discord OAuth client secret used by the Hands Activity",
    )
    hands_enabled: bool = Field(
        default=False,
        description="Enable the Hands Discord Activity server and commands",
    )
    hands_host: str = Field(
        default="127.0.0.1",
        min_length=1,
        max_length=253,
        description="Host interface for the Hands Activity HTTP server",
    )
    hands_port: int = Field(
        default=8080,
        ge=1,
        le=65535,
        description="Port for the Hands Activity HTTP server",
    )
    hands_dev_mode: bool = Field(
        default=False,
        description="Allow local development origins for Hands",
    )
    hands_trusted_proxy_cidrs: str = Field(
        default="",
        max_length=2048,
        description="Comma-separated proxy CIDRs trusted to append client IP headers for Hands",
    )

    llm_provider: Literal["anthropic", "openai", "gemini", "kimi"] = Field(
        default="anthropic",
        description="LLM provider for summarization: anthropic, openai, gemini, or kimi",
    )

    anthropic_api_key: SecretStr | None = Field(
        default=None, description="Anthropic API key for Claude"
    )
    openai_api_key: SecretStr | None = Field(default=None, description="OpenAI API key")
    gemini_api_key: SecretStr | None = Field(default=None, description="Google Gemini API key")
    kimi_api_key: SecretStr | None = Field(default=None, description="Kimi (Moonshot AI) API key")

    youtube_api_key: SecretStr | None = Field(
        default=None, description="YouTube Data API key (optional)"
    )

    twitter_bearer_token: SecretStr | None = Field(
        default=None,
        description="X API v2 Bearer Token for Twitter monitoring (optional)",
    )

    github_token: SecretStr | None = Field(
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
        default="",
        description="Model to use for background summarization (auto-detected from llm_provider if not set)",
    )

    summary_model_interactive: str = Field(
        default="",
        description="Model to use for interactive /summarize command (auto-detected from llm_provider if not set)",
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
    article_chunk_size_chars: int = Field(
        default=1200,
        ge=200,
        le=4000,
        description="Target article chunk size used for semantic search indexing",
    )
    article_chunk_overlap_chars: int = Field(
        default=200,
        ge=0,
        le=1000,
        description="Overlap between indexed article chunks",
    )
    article_search_candidate_limit: int = Field(
        default=24,
        ge=5,
        le=100,
        description="Number of article chunks to retrieve before reranking",
    )
    article_search_min_relevance_score: float = Field(
        default=0.35,
        ge=0.0,
        le=1.0,
        description="Minimum article relevance score required to show a search result",
    )
    article_search_reranker_enabled: bool = Field(
        default=True,
        description="Enable local cross-encoder reranking for article search results",
    )
    article_search_reranker_model: str = Field(
        default="cross-encoder/ms-marco-MiniLM-L6-v2",
        description="Cross-encoder model used to rerank article search results",
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
        return key.get_secret_value()

    @property
    def discord_token(self) -> str:
        """Return the Discord token for the client connection seam."""
        return self.discord_bot_token.get_secret_value()

    _PROVIDER_MODEL_DEFAULTS: dict[str, tuple[str, str]] = {
        "anthropic": ("claude-haiku-4-5-20251001", "claude-sonnet-4-6"),
        "openai": ("gpt-5.4-mini", "gpt-5.4"),
        "gemini": ("gemini-3.5-flash", "gemini-3.1-pro-preview"),
        "kimi": ("moonshot-v1-8k", "moonshot-v1-32k"),
    }

    @model_validator(mode="after")
    def set_provider_model_defaults(self) -> Settings:
        defaults = self._PROVIDER_MODEL_DEFAULTS.get(self.llm_provider)
        if defaults:
            if not self.summary_model:
                self.summary_model = defaults[0]
            if not self.summary_model_interactive:
                self.summary_model_interactive = defaults[1]
        return self

    @model_validator(mode="after")
    def validate_llm_api_key(self) -> Settings:
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
        return self

    @field_validator(
        "discord_bot_token",
        "discord_client_secret",
        "anthropic_api_key",
        "openai_api_key",
        "gemini_api_key",
        "kimi_api_key",
        "youtube_api_key",
        "twitter_bearer_token",
        "github_token",
        mode="before",
    )
    @classmethod
    def strip_and_validate_credentials(cls, value: object) -> object:
        """Normalize configured credentials and reject blank values."""
        if value is None:
            return None
        raw_value = value.get_secret_value() if isinstance(value, SecretStr) else str(value)
        normalized = raw_value.strip()
        if not normalized:
            raise ValueError("Credential values cannot be empty or whitespace-only")
        return normalized

    @field_validator("hands_host")
    @classmethod
    def validate_hands_host(cls, value: str) -> str:
        host = value.strip()
        if not host or any(character.isspace() for character in host):
            raise ValueError("HANDS_HOST must be a nonblank host without whitespace")
        if "://" in host or "/" in host or "\\" in host or host.startswith("["):
            raise ValueError("HANDS_HOST must be a bare host name or IP address, not a URL")
        try:
            ip_address(host)
        except ValueError:
            if ":" in host:
                raise ValueError("HANDS_HOST must not include a port") from None
            labels = host.rstrip(".").split(".")
            if any(
                not label
                or len(label) > 63
                or label.startswith("-")
                or label.endswith("-")
                or not all(character.isalnum() or character == "-" for character in label)
                for label in labels
            ):
                raise ValueError("HANDS_HOST must be a valid host name or IP address") from None
        return host

    @field_validator("hands_trusted_proxy_cidrs")
    @classmethod
    def validate_hands_trusted_proxy_cidrs(cls, value: str) -> str:
        if not value.strip():
            return ""
        parts = [part.strip() for part in value.split(",")]
        if len(parts) > 16 or any(not part for part in parts):
            raise ValueError("HANDS_TRUSTED_PROXY_CIDRS must contain at most 16 CIDRs")
        try:
            networks = [ip_network(part, strict=False) for part in parts]
        except ValueError as exc:
            raise ValueError("HANDS_TRUSTED_PROXY_CIDRS contains an invalid network") from exc
        if any(network.prefixlen == 0 for network in networks):
            raise ValueError("HANDS_TRUSTED_PROXY_CIDRS must not trust the entire internet")
        return ",".join(str(network) for network in networks)

    @property
    def hands_trusted_proxies(self) -> tuple[str, ...]:
        return tuple(filter(None, self.hands_trusted_proxy_cidrs.split(",")))

    @model_validator(mode="after")
    def validate_hands_configuration(self) -> Settings:
        if self.hands_enabled and self.discord_client_secret is None:
            raise ValueError("DISCORD_CLIENT_SECRET is required when HANDS_ENABLED=true")
        return self

    @model_validator(mode="after")
    def validate_article_chunk_overlap(self) -> Settings:
        if self.article_chunk_overlap_chars >= self.article_chunk_size_chars:
            raise ValueError(
                "ARTICLE_CHUNK_OVERLAP_CHARS must be smaller than ARTICLE_CHUNK_SIZE_CHARS"
            )
        return self

    @field_validator("database_url")
    @classmethod
    def validate_database_url(cls, v: str) -> str:
        try:
            url = make_url(v)
        except ArgumentError as e:
            raise ValueError("Invalid database URL") from e
        if url.get_backend_name() != "sqlite":
            raise ValueError(f"Only SQLite databases are supported, got {url.get_backend_name()!r}")
        if url.drivername != "sqlite+aiosqlite":
            raise ValueError("SQLite database URLs must use the sqlite+aiosqlite async driver")
        if not url.database:
            raise ValueError("SQLite database path cannot be empty")
        return v

    def startup_log_context(self) -> dict[str, object]:
        """Return operational startup fields that are safe to write to logs."""
        return {
            "guild_id": self.discord_guild_id,
            "legacy_channel_restriction": self.discord_channel_id is not None,
            "llm_provider": self.llm_provider,
            "summary_model": self.summary_model,
            "summary_model_interactive": self.summary_model_interactive,
            "content_poll_interval_minutes": self.content_poll_interval_minutes,
            "search_enabled": self.search_enabled,
            "embedding_model": self.embedding_model if self.search_enabled else None,
            "youtube_enabled": self.youtube_api_key is not None,
            "twitter_enabled": self.twitter_bearer_token is not None,
            "github_enabled": self.github_token is not None,
            "hands_enabled": self.hands_enabled,
            "hands_host": self.hands_host,
            "hands_port": self.hands_port,
            "hands_dev_mode": self.hands_dev_mode,
            "hands_trusted_proxy_cidrs": self.hands_trusted_proxy_cidrs,
            "database_backend": make_url(self.database_url).get_backend_name(),
        }

    def __repr__(self) -> str:
        return (
            f"Settings("
            f"discord_bot_token={self.discord_bot_token!r}, "
            f"discord_guild_id={self.discord_guild_id}, "
            f"discord_owner_id={self.discord_owner_id}, "
            f"discord_client_secret={self.discord_client_secret!r}, "
            f"hands_enabled={self.hands_enabled}, "
            f"hands_host={self.hands_host!r}, "
            f"hands_port={self.hands_port}, "
            f"hands_dev_mode={self.hands_dev_mode}, "
            f"hands_trusted_proxy_cidrs={self.hands_trusted_proxy_cidrs!r}, "
            f"llm_provider={self.llm_provider!r}, "
            f"anthropic_api_key={self.anthropic_api_key!r}, "
            f"openai_api_key={self.openai_api_key!r}, "
            f"gemini_api_key={self.gemini_api_key!r}, "
            f"kimi_api_key={self.kimi_api_key!r}, "
            f"youtube_api_key={self.youtube_api_key!r}, "
            f"twitter_bearer_token={self.twitter_bearer_token!r}, "
            f"github_token={self.github_token!r}, "
            f"database_url={self.database_url!r}, "
            f"log_level={self.log_level!r}"
            f")"
        )


@lru_cache
def get_settings() -> Settings:
    return Settings()


def reveal_secret(value: SecretStr | str | None) -> str | None:
    """Explicitly unwrap an optional credential at an external client seam."""
    if value is None:
        return None
    raw_value = value.get_secret_value() if isinstance(value, SecretStr) else value
    normalized = raw_value.strip()
    return normalized or None


def get_database_directory(database_url: str) -> Path | None:
    """Extract the parent directory path from a SQLite database URL.

    Returns None for non-SQLite databases or :memory: databases.
    """
    try:
        url = make_url(database_url)
    except ArgumentError:
        return None
    if url.get_backend_name() != "sqlite":
        return None
    if url.database in (None, "", ":memory:"):
        return None
    return Path(url.database).parent
