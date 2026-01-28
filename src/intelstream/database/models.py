import enum
from datetime import UTC, datetime
from uuid import uuid4

from sqlalchemy import Boolean, DateTime, Enum, ForeignKey, Integer, String, Text
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship


class Base(DeclarativeBase):
    pass


class SourceType(enum.Enum):
    SUBSTACK = "substack"
    YOUTUBE = "youtube"
    RSS = "rss"
    PAGE = "page"
    ARXIV = "arxiv"
    BLOG = "blog"


class Source(Base):
    __tablename__ = "sources"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid4()))
    type: Mapped[SourceType] = mapped_column(Enum(SourceType), nullable=False)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    identifier: Mapped[str] = mapped_column(String(512), nullable=False, unique=True)
    guild_id: Mapped[str | None] = mapped_column(String(36), nullable=True, index=True)
    channel_id: Mapped[str | None] = mapped_column(String(36), nullable=True, index=True)
    feed_url: Mapped[str | None] = mapped_column(String(512), nullable=True)
    extraction_profile: Mapped[str | None] = mapped_column(Text, nullable=True)
    discovery_strategy: Mapped[str | None] = mapped_column(String(50), nullable=True)
    url_pattern: Mapped[str | None] = mapped_column(String(255), nullable=True)
    last_content_hash: Mapped[str | None] = mapped_column(String(64), nullable=True)
    consecutive_failures: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    poll_interval_minutes: Mapped[int] = mapped_column(Integer, default=5)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    last_polled_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=lambda: datetime.now(UTC))
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, default=lambda: datetime.now(UTC), onupdate=lambda: datetime.now(UTC)
    )

    content_items: Mapped[list["ContentItem"]] = relationship(
        "ContentItem", back_populates="source", cascade="all, delete-orphan"
    )

    def __repr__(self) -> str:
        return f"<Source(name={self.name!r}, type={self.type.value!r})>"


class ContentItem(Base):
    __tablename__ = "content_items"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid4()))
    source_id: Mapped[str] = mapped_column(String(36), ForeignKey("sources.id"), nullable=False)
    external_id: Mapped[str] = mapped_column(String(512), nullable=False, unique=True)
    title: Mapped[str] = mapped_column(String(512), nullable=False)
    original_url: Mapped[str] = mapped_column(String(1024), nullable=False)
    author: Mapped[str] = mapped_column(String(255), nullable=False)
    published_at: Mapped[datetime] = mapped_column(DateTime, nullable=False)
    raw_content: Mapped[str | None] = mapped_column(Text, nullable=True)
    summary: Mapped[str | None] = mapped_column(Text, nullable=True)
    thumbnail_url: Mapped[str | None] = mapped_column(String(1024), nullable=True)
    posted_to_discord: Mapped[bool] = mapped_column(Boolean, default=False)
    discord_message_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=lambda: datetime.now(UTC))

    source: Mapped["Source"] = relationship("Source", back_populates="content_items")

    def __repr__(self) -> str:
        return f"<ContentItem(title={self.title!r}, source_id={self.source_id!r})>"


class DiscordConfig(Base):
    __tablename__ = "discord_config"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid4()))
    guild_id: Mapped[str] = mapped_column(String(36), nullable=False, unique=True)
    channel_id: Mapped[str] = mapped_column(String(36), nullable=False)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=lambda: datetime.now(UTC))
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, default=lambda: datetime.now(UTC), onupdate=lambda: datetime.now(UTC)
    )

    def __repr__(self) -> str:
        return f"<DiscordConfig(guild_id={self.guild_id!r}, channel_id={self.channel_id!r})>"


class ExtractionCache(Base):
    __tablename__ = "extraction_cache"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid4()))
    url: Mapped[str] = mapped_column(String(1024), nullable=False, unique=True, index=True)
    content_hash: Mapped[str] = mapped_column(String(64), nullable=False)
    posts_json: Mapped[str] = mapped_column(Text, nullable=False)
    cached_at: Mapped[datetime] = mapped_column(DateTime, default=lambda: datetime.now(UTC))

    def __repr__(self) -> str:
        return f"<ExtractionCache(url={self.url!r}, cached_at={self.cached_at!r})>"


class ForwardingRule(Base):
    __tablename__ = "forwarding_rules"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid4()))
    guild_id: Mapped[str] = mapped_column(String(36), nullable=False, index=True)
    source_channel_id: Mapped[str] = mapped_column(String(36), nullable=False, index=True)
    source_type: Mapped[str] = mapped_column(String(20), nullable=False)
    destination_channel_id: Mapped[str] = mapped_column(String(36), nullable=False)
    destination_type: Mapped[str] = mapped_column(String(20), nullable=False)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    messages_forwarded: Mapped[int] = mapped_column(Integer, default=0)
    last_forwarded_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=lambda: datetime.now(UTC))

    def __repr__(self) -> str:
        return f"<ForwardingRule(source={self.source_channel_id!r}, dest={self.destination_channel_id!r})>"
