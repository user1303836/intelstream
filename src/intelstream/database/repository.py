import asyncio
import json
from datetime import UTC, datetime, timedelta

import structlog
from sqlalchemy import and_, delete, exists, func, insert, or_, select, text, update
from sqlalchemy.dialects.sqlite import insert as sqlite_insert
from sqlalchemy.engine import make_url
from sqlalchemy.exc import ArgumentError, IntegrityError, OperationalError
from sqlalchemy.ext.asyncio import (
    AsyncConnection,
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)

from intelstream.database.exceptions import (
    DatabaseConnectionError,
    DuplicateContentError,
    DuplicateSourceError,
    SourceNotFoundError,
)
from intelstream.database.models import (
    ArticleChunkMeta,
    Base,
    ContentItem,
    DiscordConfig,
    ExtractionCache,
    ForwardingRule,
    GitHubRepo,
    HandsMatch,
    HandsRating,
    IngestionProgress,
    MessageChunkMeta,
    PauseReason,
    Source,
    SourceType,
    SuckBoobsStats,
)
from intelstream.hands.rating import DEFAULT_RATING, calculate_elo
from intelstream.hands.types import FinishMethod, MatchResult

logger = structlog.get_logger()

SOURCES_MIGRATIONS: list[tuple[str, str]] = [
    ("discovery_strategy", "VARCHAR(50)"),
    ("url_pattern", "VARCHAR(255)"),
    ("last_content_hash", "VARCHAR(64)"),
    ("consecutive_failures", "INTEGER DEFAULT 0"),
    ("guild_id", "VARCHAR(36)"),
    ("channel_id", "VARCHAR(36)"),
    ("pause_reason", "VARCHAR(32) DEFAULT 'none'"),
    ("skip_summary", "BOOLEAN DEFAULT 0"),
]

CONTENT_ITEM_INDEX_MIGRATIONS: tuple[str, ...] = (
    "CREATE INDEX IF NOT EXISTS ix_content_items_source_published "
    "ON content_items (source_id, published_at)",
    "CREATE INDEX IF NOT EXISTS ix_content_items_unsummarized_created "
    "ON content_items (created_at) WHERE summary IS NULL",
    "CREATE INDEX IF NOT EXISTS ix_content_items_unposted_published "
    "ON content_items (published_at, id) "
    "WHERE posted_to_discord = 0 AND summary IS NOT NULL",
)

MIN_POLL_INTERVAL_MINUTES = 1
MAX_POLL_INTERVAL_MINUTES = 1440
SQLITE_IN_BATCH_SIZE = 900


class Repository:
    def __init__(self, database_url: str) -> None:
        try:
            url = make_url(database_url)
        except ArgumentError as e:
            raise ValueError("Invalid database URL") from e
        if url.get_backend_name() != "sqlite":
            raise ValueError(f"Only SQLite databases are supported. Got: {url.get_backend_name()}")
        if url.drivername != "sqlite+aiosqlite":
            raise ValueError("SQLite database URLs must use the sqlite+aiosqlite async driver")
        self._engine = create_async_engine(
            database_url,
            echo=False,
            connect_args={"timeout": 30},
        )
        self._session_factory: async_sessionmaker[AsyncSession] = async_sessionmaker(
            self._engine, class_=AsyncSession, expire_on_commit=False
        )
        self._hands_write_lock = asyncio.Lock()

    async def initialize(self) -> None:
        logger.info("Initializing database")
        async with self._engine.begin() as conn:
            await conn.run_sync(Base.metadata.create_all)
            await self._migrate_sources_table(conn)
            await self._migrate_content_item_indexes(conn)
        logger.info("Database initialization complete")

    async def _migrate_sources_table(self, conn: AsyncConnection) -> None:
        result = await conn.execute(text("PRAGMA table_info(sources)"))
        existing_columns = {row[1] for row in result.fetchall()}

        for column_name, column_type in SOURCES_MIGRATIONS:
            if column_name not in existing_columns:
                logger.info("Applying migration", column=column_name)
                await conn.execute(
                    text(f"ALTER TABLE sources ADD COLUMN {column_name} {column_type}")
                )

    async def _migrate_content_item_indexes(self, conn: AsyncConnection) -> None:
        for statement in CONTENT_ITEM_INDEX_MIGRATIONS:
            await conn.execute(text(statement))

    async def migrate_sources_to_channel(self, guild_id: str, channel_id: str) -> int:
        """Assign existing sources without a channel to the specified guild and channel."""
        async with self.session() as session:
            result = await session.execute(select(Source).where(Source.channel_id.is_(None)))
            sources = list(result.scalars().all())

            for source in sources:
                source.guild_id = guild_id
                source.channel_id = channel_id

            await session.commit()
            return len(sources)

    async def close(self) -> None:
        await self._engine.dispose()

    def session(self) -> AsyncSession:
        return self._session_factory()

    async def add_source(
        self,
        source_type: SourceType,
        name: str,
        identifier: str,
        feed_url: str | None = None,
        poll_interval_minutes: int = 5,
        extraction_profile: str | None = None,
        discovery_strategy: str | None = None,
        url_pattern: str | None = None,
        guild_id: str | None = None,
        channel_id: str | None = None,
        skip_summary: bool = False,
    ) -> Source:
        if not MIN_POLL_INTERVAL_MINUTES <= poll_interval_minutes <= MAX_POLL_INTERVAL_MINUTES:
            raise ValueError(
                f"poll_interval_minutes must be between {MIN_POLL_INTERVAL_MINUTES} and "
                f"{MAX_POLL_INTERVAL_MINUTES}, got {poll_interval_minutes}"
            )

        async with self.session() as session:
            source = Source(
                type=source_type,
                name=name,
                identifier=identifier,
                feed_url=feed_url,
                poll_interval_minutes=poll_interval_minutes,
                extraction_profile=extraction_profile,
                discovery_strategy=discovery_strategy,
                url_pattern=url_pattern,
                guild_id=guild_id,
                channel_id=channel_id,
                skip_summary=skip_summary,
            )
            session.add(source)
            try:
                await session.commit()
            except IntegrityError as e:
                await session.rollback()
                logger.warning("Duplicate source", identifier=identifier, error=str(e))
                raise DuplicateSourceError(identifier) from e
            await session.refresh(source)
            logger.info(
                "Source added",
                source_id=source.id,
                name=name,
                type=source_type.value,
                identifier=identifier,
            )
            return source

    async def get_source_by_identifier(self, identifier: str) -> Source | None:
        async with self.session() as session:
            result = await session.execute(select(Source).where(Source.identifier == identifier))
            return result.scalar_one_or_none()

    async def get_source_by_id(self, source_id: str) -> Source | None:
        async with self.session() as session:
            result = await session.execute(select(Source).where(Source.id == source_id))
            return result.scalar_one_or_none()

    async def get_sources_by_ids(self, source_ids: set[str]) -> dict[str, Source]:
        if not source_ids:
            return {}
        async with self.session() as session:
            result = await session.execute(select(Source).where(Source.id.in_(source_ids)))
            sources = result.scalars().all()
            return {source.id: source for source in sources}

    async def get_source_by_name(self, name: str) -> Source | None:
        async with self.session() as session:
            result = await session.execute(select(Source).where(Source.name == name))
            return result.scalar_one_or_none()

    async def get_all_sources(
        self,
        active_only: bool = True,
        channel_id: str | None = None,
        guild_id: str | None = None,
    ) -> list[Source]:
        async with self.session() as session:
            query = select(Source)
            if active_only:
                query = query.where(Source.is_active == True)  # noqa: E712
            if channel_id is not None:
                query = query.where(Source.channel_id == channel_id)
            if guild_id is not None:
                query = query.where(Source.guild_id == guild_id)
            result = await session.execute(query)
            return list(result.scalars().all())

    async def sync_source_poll_intervals(self, intervals: dict[SourceType, int]) -> int:
        """Persist configured per-type intervals without rewriting unchanged rows."""
        updated = 0
        async with self.session() as session:
            for source_type, interval in intervals.items():
                if not MIN_POLL_INTERVAL_MINUTES <= interval <= MAX_POLL_INTERVAL_MINUTES:
                    raise ValueError(
                        "poll_interval_minutes must be between "
                        f"{MIN_POLL_INTERVAL_MINUTES} and {MAX_POLL_INTERVAL_MINUTES}, "
                        f"got {interval}"
                    )
                result = await session.execute(
                    update(Source)
                    .where(
                        Source.type == source_type,
                        Source.poll_interval_minutes != interval,
                    )
                    .values(poll_interval_minutes=interval)
                )
                updated += int(getattr(result, "rowcount", 0) or 0)
            await session.commit()
        return updated

    async def update_source_last_polled(self, source_id: str) -> bool:
        async with self.session() as session:
            result = await session.execute(select(Source).where(Source.id == source_id))
            source = result.scalar_one_or_none()
            if source:
                source.last_polled_at = datetime.now(UTC)
                await session.commit()
                return True
            return False

    async def set_source_active(
        self,
        identifier: str,
        is_active: bool,
        pause_reason: PauseReason | None = None,
    ) -> Source:
        async with self.session() as session:
            result = await session.execute(select(Source).where(Source.identifier == identifier))
            source = result.scalar_one_or_none()
            if not source:
                logger.warning("Source not found for active state change", identifier=identifier)
                raise SourceNotFoundError(identifier)
            source.is_active = is_active
            if pause_reason is not None:
                source.pause_reason = pause_reason.value
            elif is_active:
                source.pause_reason = PauseReason.NONE.value
            try:
                await session.commit()
            except OperationalError as e:
                await session.rollback()
                logger.error("Database error updating source", identifier=identifier, error=str(e))
                raise DatabaseConnectionError(f"Failed to update source: {e}") from e
            await session.refresh(source)
            logger.info(
                "Source active state changed",
                source_id=source.id,
                identifier=identifier,
                is_active=is_active,
                pause_reason=source.pause_reason,
            )
            return source

    async def get_content_count_for_source(self, source_id: str) -> int:
        async with self.session() as session:
            result = await session.execute(
                select(func.count())
                .select_from(ContentItem)
                .where(ContentItem.source_id == source_id)
            )
            return result.scalar_one()

    async def delete_source(self, identifier: str) -> bool:
        async with self.session() as session:
            result = await session.execute(select(Source).where(Source.identifier == identifier))
            source = result.scalar_one_or_none()
            if not source:
                logger.warning("Source not found for deletion", identifier=identifier)
                raise SourceNotFoundError(identifier)
            source_id = source.id
            await session.delete(source)
            try:
                await session.commit()
            except OperationalError as e:
                await session.rollback()
                logger.error("Database error deleting source", identifier=identifier, error=str(e))
                raise DatabaseConnectionError(f"Failed to delete source: {e}") from e
            logger.info("Source deleted", source_id=source_id, identifier=identifier)
            return True

    async def add_content_item(
        self,
        source_id: str,
        external_id: str,
        title: str,
        original_url: str,
        author: str,
        published_at: datetime,
        raw_content: str | None = None,
        thumbnail_url: str | None = None,
    ) -> ContentItem:
        async with self.session() as session:
            content_item = ContentItem(
                source_id=source_id,
                external_id=external_id,
                title=title,
                original_url=original_url,
                author=author,
                published_at=published_at,
                raw_content=raw_content,
                thumbnail_url=thumbnail_url,
            )
            session.add(content_item)
            try:
                await session.commit()
            except IntegrityError as e:
                await session.rollback()
                logger.debug("Duplicate content item", external_id=external_id)
                raise DuplicateContentError(external_id) from e
            await session.refresh(content_item)
            logger.debug(
                "Content item added",
                content_id=content_item.id,
                source_id=source_id,
                external_id=external_id,
                title=title,
            )
            return content_item

    async def get_content_item_by_external_id(self, external_id: str) -> ContentItem | None:
        async with self.session() as session:
            result = await session.execute(
                select(ContentItem).where(ContentItem.external_id == external_id)
            )
            return result.scalar_one_or_none()

    async def get_content_items_by_ids(self, item_ids: list[str]) -> list[ContentItem]:
        if not item_ids:
            return []
        async with self.session() as session:
            result = await session.execute(select(ContentItem).where(ContentItem.id.in_(item_ids)))
            items = list(result.scalars().all())
            id_order = {item_id: idx for idx, item_id in enumerate(item_ids)}
            items.sort(key=lambda item: id_order.get(item.id, len(item_ids)))
            return items

    async def get_summarized_content_items(
        self, offset: int = 0, limit: int = 100
    ) -> list[ContentItem]:
        async with self.session() as session:
            result = await session.execute(
                select(ContentItem)
                .where(ContentItem.summary.isnot(None))
                .where(ContentItem.summary != "")
                .order_by(ContentItem.created_at.asc())
                .offset(offset)
                .limit(limit)
            )
            return list(result.scalars().all())

    async def count_summarized_content_items(self) -> int:
        async with self.session() as session:
            result = await session.execute(
                select(func.count())
                .select_from(ContentItem)
                .where(ContentItem.summary.isnot(None))
                .where(ContentItem.summary != "")
            )
            return int(result.scalar_one())

    async def add_article_chunk_metas_batch(self, chunks: list[ArticleChunkMeta]) -> None:
        if not chunks:
            return
        async with self.session() as session:
            embedded_at = datetime.now(UTC)
            await session.execute(
                insert(ArticleChunkMeta),
                [
                    {
                        "id": chunk.id,
                        "content_item_id": chunk.content_item_id,
                        "chunk_index": chunk.chunk_index,
                        "text": chunk.text,
                        "embedded_at": chunk.embedded_at or embedded_at,
                    }
                    for chunk in chunks
                ],
            )
            await session.commit()

    async def count_article_chunk_metas(self) -> int:
        async with self.session() as session:
            result = await session.execute(select(func.count()).select_from(ArticleChunkMeta))
            return int(result.scalar_one())

    async def count_article_chunk_items(self) -> int:
        async with self.session() as session:
            result = await session.execute(
                select(func.count(func.distinct(ArticleChunkMeta.content_item_id)))
            )
            return int(result.scalar_one())

    async def get_article_chunk_metas_for_content_item(
        self, content_item_id: str
    ) -> list[ArticleChunkMeta]:
        async with self.session() as session:
            result = await session.execute(
                select(ArticleChunkMeta)
                .where(ArticleChunkMeta.content_item_id == content_item_id)
                .order_by(ArticleChunkMeta.chunk_index.asc())
            )
            return list(result.scalars().all())

    async def delete_article_chunk_metas_for_content_item(self, content_item_id: str) -> list[str]:
        async with self.session() as session:
            result = await session.execute(
                select(ArticleChunkMeta.id).where(
                    ArticleChunkMeta.content_item_id == content_item_id
                )
            )
            chunk_ids = list(result.scalars().all())
            await session.execute(
                delete(ArticleChunkMeta).where(ArticleChunkMeta.content_item_id == content_item_id)
            )
            await session.commit()
            return chunk_ids

    async def delete_all_article_chunk_metas(self) -> int:
        async with self.session() as session:
            result = await session.execute(select(func.count()).select_from(ArticleChunkMeta))
            deleted = int(result.scalar_one())
            await session.execute(delete(ArticleChunkMeta))
            await session.commit()
            return deleted

    async def content_item_exists(self, external_id: str) -> bool:
        async with self.session() as session:
            result = await session.execute(
                select(exists().where(ContentItem.external_id == external_id))
            )
            return result.scalar_one()

    async def get_existing_external_ids(self, external_ids: set[str]) -> set[str]:
        if not external_ids:
            return set()

        identifiers = list(external_ids)
        existing: set[str] = set()
        async with self.session() as session:
            for start in range(0, len(identifiers), SQLITE_IN_BATCH_SIZE):
                batch = identifiers[start : start + SQLITE_IN_BATCH_SIZE]
                result = await session.execute(
                    select(ContentItem.external_id).where(ContentItem.external_id.in_(batch))
                )
                existing.update(result.scalars().all())
        return existing

    async def get_unposted_content_items(
        self,
        limit: int = 10,
        *,
        after_published_at: datetime | None = None,
        after_id: str | None = None,
    ) -> list[ContentItem]:
        async with self.session() as session:
            query = (
                select(ContentItem)
                .where(ContentItem.posted_to_discord == False)  # noqa: E712
                .where(ContentItem.summary.isnot(None))
            )
            if after_published_at is not None and after_id is not None:
                query = query.where(
                    or_(
                        ContentItem.published_at > after_published_at,
                        and_(
                            ContentItem.published_at == after_published_at,
                            ContentItem.id > after_id,
                        ),
                    )
                )
            result = await session.execute(
                query.order_by(ContentItem.published_at.asc(), ContentItem.id.asc()).limit(limit)
            )
            return list(result.scalars().all())

    async def get_sources_for_guild(self, guild_id: str) -> list[Source]:
        async with self.session() as session:
            result = await session.execute(
                select(Source).where(Source.guild_id == guild_id).where(Source.is_active == True)  # noqa: E712
            )
            return list(result.scalars().all())

    async def get_unsummarized_content_items(self, limit: int = 10) -> list[ContentItem]:
        async with self.session() as session:
            result = await session.execute(
                select(ContentItem)
                .where(ContentItem.summary.is_(None))
                .order_by(ContentItem.created_at.asc())
                .limit(limit)
            )
            return list(result.scalars().all())

    async def has_source_posted_content(self, source_id: str) -> bool:
        async with self.session() as session:
            result = await session.execute(
                select(ContentItem.id)
                .where(ContentItem.source_id == source_id)
                .where(ContentItem.posted_to_discord == True)  # noqa: E712
                .limit(1)
            )
            return result.scalar_one_or_none() is not None

    async def get_most_recent_item_for_source(self, source_id: str) -> ContentItem | None:
        async with self.session() as session:
            result = await session.execute(
                select(ContentItem)
                .where(ContentItem.source_id == source_id)
                .order_by(ContentItem.published_at.desc())
                .limit(1)
            )
            return result.scalar_one_or_none()

    async def mark_items_as_backfilled(
        self, source_id: str, exclude_item_id: str | None = None
    ) -> int:
        async with self.session() as session:
            statement = (
                update(ContentItem)
                .where(ContentItem.source_id == source_id)
                .where(ContentItem.posted_to_discord == False)  # noqa: E712
                .where(ContentItem.summary.is_(None))
                .values(posted_to_discord=True, discord_message_id="backfilled")
            )
            if exclude_item_id:
                statement = statement.where(ContentItem.id != exclude_item_id)

            result = await session.execute(statement)
            await session.commit()
            return int(getattr(result, "rowcount", 0) or 0)

    async def update_content_item_summary(self, content_id: str, summary: str) -> bool:
        async with self.session() as session:
            result = await session.execute(select(ContentItem).where(ContentItem.id == content_id))
            content_item = result.scalar_one_or_none()
            if content_item:
                content_item.summary = summary
                await session.commit()
                logger.debug("Content item summary updated", content_id=content_id)
                return True
            logger.warning("Content item not found for summary update", content_id=content_id)
            return False

    async def mark_content_item_posted(self, content_id: str, discord_message_id: str) -> bool:
        async with self.session() as session:
            result = await session.execute(select(ContentItem).where(ContentItem.id == content_id))
            content_item = result.scalar_one_or_none()
            if content_item:
                content_item.posted_to_discord = True
                content_item.discord_message_id = discord_message_id
                await session.commit()
                logger.debug(
                    "Content item marked as posted",
                    content_id=content_id,
                    discord_message_id=discord_message_id,
                )
                return True
            logger.warning("Content item not found for posting", content_id=content_id)
            return False

    async def get_latest_content_for_source(self, source_id: str) -> ContentItem | None:
        async with self.session() as session:
            result = await session.execute(
                select(ContentItem)
                .where(ContentItem.source_id == source_id)
                .order_by(ContentItem.published_at.desc())
                .limit(1)
            )
            return result.scalar_one_or_none()

    async def get_or_create_discord_config(self, guild_id: str, channel_id: str) -> DiscordConfig:
        for _ in range(3):
            async with self.session() as session:
                result = await session.execute(
                    select(DiscordConfig).where(DiscordConfig.guild_id == guild_id)
                )
                config = result.scalar_one_or_none()
                if config:
                    config.channel_id = channel_id
                    await session.commit()
                    await session.refresh(config)
                    return config

                config = DiscordConfig(guild_id=guild_id, channel_id=channel_id)
                session.add(config)
                try:
                    await session.commit()
                    await session.refresh(config)
                    return config
                except IntegrityError:
                    await session.rollback()

        raise RuntimeError(f"Failed to get or create discord config for guild {guild_id}")

    async def get_discord_config(self, guild_id: str) -> DiscordConfig | None:
        async with self.session() as session:
            result = await session.execute(
                select(DiscordConfig).where(DiscordConfig.guild_id == guild_id)
            )
            return result.scalar_one_or_none()

    async def update_source_discovery_strategy(
        self,
        source_id: str,
        discovery_strategy: str,
        feed_url: str | None = None,
        url_pattern: str | None = None,
    ) -> bool:
        async with self.session() as session:
            result = await session.execute(select(Source).where(Source.id == source_id))
            source = result.scalar_one_or_none()
            if source:
                source.discovery_strategy = discovery_strategy
                if feed_url is not None:
                    source.feed_url = feed_url
                if url_pattern is not None:
                    source.url_pattern = url_pattern
                await session.commit()
                return True
            return False

    async def update_source_content_hash(self, source_id: str, content_hash: str) -> bool:
        async with self.session() as session:
            result = await session.execute(select(Source).where(Source.id == source_id))
            source = result.scalar_one_or_none()
            if source:
                source.last_content_hash = content_hash
                await session.commit()
                return True
            return False

    async def get_extraction_cache(self, url: str) -> ExtractionCache | None:
        async with self.session() as session:
            result = await session.execute(
                select(ExtractionCache).where(ExtractionCache.url == url)
            )
            return result.scalar_one_or_none()

    async def set_extraction_cache(
        self, url: str, content_hash: str, posts_json: str
    ) -> ExtractionCache:
        async with self.session() as session:
            result = await session.execute(
                select(ExtractionCache).where(ExtractionCache.url == url)
            )
            cache = result.scalar_one_or_none()
            if cache:
                cache.content_hash = content_hash
                cache.posts_json = posts_json
                cache.cached_at = datetime.now(UTC)
            else:
                cache = ExtractionCache(
                    url=url,
                    content_hash=content_hash,
                    posts_json=posts_json,
                )
                session.add(cache)
            await session.commit()
            await session.refresh(cache)
            return cache

    async def cleanup_extraction_cache(self, max_age_days: int = 7) -> int:
        cutoff = datetime.now(UTC) - timedelta(days=max_age_days)
        async with self.session() as session:
            expired = ExtractionCache.cached_at < cutoff
            result = await session.execute(
                select(func.count()).select_from(ExtractionCache).where(expired)
            )
            removed = int(result.scalar_one())
            if removed:
                await session.execute(delete(ExtractionCache).where(expired))
            await session.commit()
            if removed:
                logger.info("Cleaned up extraction cache", removed=removed)
            return removed

    async def get_known_urls_for_source(self, source_id: str) -> set[str]:
        async with self.session() as session:
            result = await session.execute(
                select(ContentItem.original_url).where(ContentItem.source_id == source_id)
            )
            return {row[0] for row in result.all()}

    async def increment_failure_count(self, source_id: str) -> int:
        async with self.session() as session:
            result = await session.execute(select(Source).where(Source.id == source_id))
            source = result.scalar_one_or_none()
            if source:
                source.consecutive_failures = (source.consecutive_failures or 0) + 1
                await session.commit()
                logger.debug(
                    "Source failure count incremented",
                    source_id=source_id,
                    consecutive_failures=source.consecutive_failures,
                )
                return source.consecutive_failures
            logger.warning("Source not found for failure count increment", source_id=source_id)
            return 0

    async def reset_failure_count(self, source_id: str) -> bool:
        async with self.session() as session:
            result = await session.execute(select(Source).where(Source.id == source_id))
            source = result.scalar_one_or_none()
            if source:
                if (source.consecutive_failures or 0) > 0:
                    source.consecutive_failures = 0
                    await session.commit()
                return True
            return False

    async def add_forwarding_rule(
        self,
        guild_id: str,
        source_channel_id: str,
        source_type: str,
        destination_channel_id: str,
        destination_type: str,
    ) -> ForwardingRule:
        async with self.session() as session:
            rule = ForwardingRule(
                guild_id=guild_id,
                source_channel_id=source_channel_id,
                source_type=source_type,
                destination_channel_id=destination_channel_id,
                destination_type=destination_type,
            )
            session.add(rule)
            await session.commit()
            await session.refresh(rule)
            logger.info(
                "Forwarding rule added",
                rule_id=rule.id,
                guild_id=guild_id,
                source_channel_id=source_channel_id,
                destination_channel_id=destination_channel_id,
            )
            return rule

    async def get_forwarding_rules_for_source(self, source_channel_id: str) -> list[ForwardingRule]:
        async with self.session() as session:
            result = await session.execute(
                select(ForwardingRule)
                .where(ForwardingRule.source_channel_id == source_channel_id)
                .where(ForwardingRule.is_active == True)  # noqa: E712
            )
            return list(result.scalars().all())

    async def get_forwarding_rules_for_guild(self, guild_id: str) -> list[ForwardingRule]:
        async with self.session() as session:
            result = await session.execute(
                select(ForwardingRule)
                .where(ForwardingRule.guild_id == guild_id)
                .order_by(ForwardingRule.created_at.desc())
            )
            return list(result.scalars().all())

    async def increment_forwarding_count(self, rule_id: str) -> bool:
        async with self.session() as session:
            result = await session.execute(
                select(ForwardingRule).where(ForwardingRule.id == rule_id)
            )
            rule = result.scalar_one_or_none()
            if rule:
                rule.messages_forwarded = (rule.messages_forwarded or 0) + 1
                rule.last_forwarded_at = datetime.now(UTC)
                await session.commit()
                return True
            return False

    async def delete_forwarding_rule(
        self, guild_id: str, source_channel_id: str, destination_channel_id: str
    ) -> bool:
        async with self.session() as session:
            result = await session.execute(
                select(ForwardingRule)
                .where(ForwardingRule.guild_id == guild_id)
                .where(ForwardingRule.source_channel_id == source_channel_id)
                .where(ForwardingRule.destination_channel_id == destination_channel_id)
            )
            rule = result.scalar_one_or_none()
            if rule:
                rule_id = rule.id
                await session.delete(rule)
                await session.commit()
                logger.info(
                    "Forwarding rule deleted",
                    rule_id=rule_id,
                    guild_id=guild_id,
                    source_channel_id=source_channel_id,
                    destination_channel_id=destination_channel_id,
                )
                return True
            logger.warning(
                "Forwarding rule not found for deletion",
                guild_id=guild_id,
                source_channel_id=source_channel_id,
                destination_channel_id=destination_channel_id,
            )
            return False

    async def set_forwarding_rule_active(
        self, guild_id: str, source_channel_id: str, destination_channel_id: str, is_active: bool
    ) -> bool:
        async with self.session() as session:
            result = await session.execute(
                select(ForwardingRule)
                .where(ForwardingRule.guild_id == guild_id)
                .where(ForwardingRule.source_channel_id == source_channel_id)
                .where(ForwardingRule.destination_channel_id == destination_channel_id)
            )
            rule = result.scalar_one_or_none()
            if rule:
                rule.is_active = is_active
                await session.commit()
                return True
            return False

    async def get_or_create_hands_rating(self, guild_id: str, user_id: str) -> HandsRating:
        async with self._hands_write_lock, self.session() as session:
            await session.execute(
                sqlite_insert(HandsRating)
                .values(
                    guild_id=guild_id,
                    user_id=user_id,
                    rating=DEFAULT_RATING,
                    best_rating=DEFAULT_RATING,
                )
                .on_conflict_do_nothing(index_elements=["guild_id", "user_id"])
            )
            await session.commit()
            result = await session.execute(
                select(HandsRating)
                .where(HandsRating.guild_id == guild_id)
                .where(HandsRating.user_id == user_id)
            )
            return result.scalar_one()

    async def get_hands_rating(self, guild_id: str, user_id: str) -> HandsRating | None:
        async with self.session() as session:
            result = await session.execute(
                select(HandsRating)
                .where(HandsRating.guild_id == guild_id)
                .where(HandsRating.user_id == user_id)
            )
            return result.scalar_one_or_none()

    async def get_hands_leaderboard(self, guild_id: str, limit: int = 10) -> list[HandsRating]:
        if not 1 <= limit <= 100:
            raise ValueError("limit must be between 1 and 100")
        async with self.session() as session:
            result = await session.execute(
                select(HandsRating)
                .where(HandsRating.guild_id == guild_id)
                .order_by(
                    HandsRating.rating.desc(),
                    HandsRating.wins.desc(),
                    HandsRating.bouts.desc(),
                    HandsRating.user_id.asc(),
                )
                .limit(limit)
            )
            return list(result.scalars().all())

    async def get_hands_rank(self, guild_id: str, user_id: str) -> int:
        rating = await self.get_or_create_hands_rating(guild_id, user_id)
        async with self.session() as session:
            ahead = await session.scalar(
                select(func.count())
                .select_from(HandsRating)
                .where(HandsRating.guild_id == guild_id)
                .where(
                    or_(
                        HandsRating.rating > rating.rating,
                        and_(
                            HandsRating.rating == rating.rating,
                            HandsRating.wins > rating.wins,
                        ),
                        and_(
                            HandsRating.rating == rating.rating,
                            HandsRating.wins == rating.wins,
                            HandsRating.bouts > rating.bouts,
                        ),
                        and_(
                            HandsRating.rating == rating.rating,
                            HandsRating.wins == rating.wins,
                            HandsRating.bouts == rating.bouts,
                            HandsRating.user_id < rating.user_id,
                        ),
                    )
                )
            )
            return int(ahead or 0) + 1

    async def get_hands_match(self, match_id: str) -> HandsMatch | None:
        async with self.session() as session:
            result = await session.execute(
                select(HandsMatch).where(HandsMatch.match_id == match_id)
            )
            return result.scalar_one_or_none()

    async def record_hands_match(self, match_result: MatchResult) -> HandsMatch:
        self._validate_hands_result(match_result)
        async with self._hands_write_lock:
            return await self._record_hands_match_locked(match_result)

    async def _record_hands_match_locked(self, match_result: MatchResult) -> HandsMatch:
        try:
            async with self.session() as session, session.begin():
                existing_result = await session.execute(
                    select(HandsMatch).where(HandsMatch.match_id == match_result.match_id)
                )
                existing = existing_result.scalar_one_or_none()
                if existing is not None:
                    return existing

                for user_id in (match_result.player_one_id, match_result.player_two_id):
                    await session.execute(
                        sqlite_insert(HandsRating)
                        .values(
                            guild_id=match_result.guild_id,
                            user_id=user_id,
                            rating=DEFAULT_RATING,
                            best_rating=DEFAULT_RATING,
                        )
                        .on_conflict_do_nothing(index_elements=["guild_id", "user_id"])
                    )

                ratings_result = await session.execute(
                    select(HandsRating).where(
                        HandsRating.guild_id == match_result.guild_id,
                        HandsRating.user_id.in_(
                            (match_result.player_one_id, match_result.player_two_id)
                        ),
                    )
                )
                ratings = {rating.user_id: rating for rating in ratings_result.scalars().all()}
                one = ratings[match_result.player_one_id]
                two = ratings[match_result.player_two_id]
                one_score = (
                    0.5
                    if match_result.winner_id is None
                    else (1.0 if match_result.winner_id == one.user_id else 0.0)
                )
                elo = calculate_elo(one.rating, two.rating, one_score)
                scorecard_json = json.dumps(
                    [
                        {
                            "judge": card.judge,
                            "player_one": list(card.player_one),
                            "player_two": list(card.player_two),
                        }
                        for card in match_result.scorecards
                    ],
                    separators=(",", ":"),
                    sort_keys=True,
                )
                result_json = json.dumps(
                    {
                        "player_one_damage": match_result.player_one_damage,
                        "player_one_knockdowns": match_result.player_one_knockdowns,
                        "player_two_damage": match_result.player_two_damage,
                        "player_two_knockdowns": match_result.player_two_knockdowns,
                    },
                    separators=(",", ":"),
                    sort_keys=True,
                )
                match = HandsMatch(
                    match_id=match_result.match_id,
                    activity_instance_id=match_result.activity_instance_id,
                    guild_id=match_result.guild_id,
                    player_one_id=one.user_id,
                    player_two_id=two.user_id,
                    winner_id=match_result.winner_id,
                    finish_method=match_result.finish_method.value,
                    round_number=match_result.round_number,
                    finish_tick=match_result.tick,
                    player_one_rating_before=elo.player_one_before,
                    player_one_rating_after=elo.player_one_after,
                    player_two_rating_before=elo.player_two_before,
                    player_two_rating_after=elo.player_two_after,
                    result_json=result_json,
                    scorecard_json=scorecard_json,
                )
                session.add(match)
                await session.flush()

                one.rating = elo.player_one_after
                two.rating = elo.player_two_after
                one.best_rating = max(one.best_rating, one.rating)
                two.best_rating = max(two.best_rating, two.rating)
                one.bouts += 1
                two.bouts += 1
                one.knockdowns += match_result.player_two_knockdowns
                two.knockdowns += match_result.player_one_knockdowns
                self._apply_hands_outcome(one, two, match_result)
                return match
        except IntegrityError:
            existing = await self.get_hands_match(match_result.match_id)
            if existing is not None:
                return existing
            raise

    @staticmethod
    def _validate_hands_result(match_result: MatchResult) -> None:
        bounded_identifiers = (
            ("match_id", match_result.match_id, 64),
            ("activity_instance_id", match_result.activity_instance_id, 255),
            ("guild_id", match_result.guild_id, 36),
            ("player_one_id", match_result.player_one_id, 36),
            ("player_two_id", match_result.player_two_id, 36),
        )
        for name, value, maximum in bounded_identifiers:
            if not value or len(value) > maximum:
                raise ValueError(f"{name} must contain between 1 and {maximum} characters")
        if match_result.player_one_id == match_result.player_two_id:
            raise ValueError("a Hands match requires two distinct players")
        if match_result.winner_id not in (
            None,
            match_result.player_one_id,
            match_result.player_two_id,
        ):
            raise ValueError("winner must be one of the match players")
        if match_result.finish_method is FinishMethod.DRAW and match_result.winner_id is not None:
            raise ValueError("a draw cannot have a winner")
        if match_result.finish_method is not FinishMethod.DRAW and match_result.winner_id is None:
            raise ValueError("only a draw may omit the winner")
        if match_result.round_number < 1 or match_result.tick < 0:
            raise ValueError("round and tick values are invalid")
        if (
            min(
                match_result.player_one_knockdowns,
                match_result.player_two_knockdowns,
                match_result.player_one_damage,
                match_result.player_two_damage,
            )
            < 0
        ):
            raise ValueError("damage and knockdown totals cannot be negative")

    @staticmethod
    def _apply_hands_outcome(one: HandsRating, two: HandsRating, match_result: MatchResult) -> None:
        if match_result.winner_id is None:
            one.draws += 1
            two.draws += 1
            one.current_streak = 0
            two.current_streak = 0
            return
        winner, loser = (one, two) if match_result.winner_id == one.user_id else (two, one)
        winner.wins += 1
        winner.current_streak += 1
        loser.losses += 1
        loser.current_streak = 0
        if match_result.finish_method in (
            FinishMethod.KO,
            FinishMethod.FLASH_KO,
            FinishMethod.TKO,
        ):
            winner.knockouts += 1

    async def record_suck_boobs_usage(
        self, guild_id: str, user_id: str, pinged_user_id: str
    ) -> None:
        async with self.session() as session:
            user_result = await session.execute(
                select(SuckBoobsStats)
                .where(SuckBoobsStats.guild_id == guild_id)
                .where(SuckBoobsStats.user_id == user_id)
            )
            user_stat = user_result.scalar_one_or_none()
            if user_stat:
                user_stat.times_used += 1
            else:
                user_stat = SuckBoobsStats(guild_id=guild_id, user_id=user_id, times_used=1)
                session.add(user_stat)

            pinged_result = await session.execute(
                select(SuckBoobsStats)
                .where(SuckBoobsStats.guild_id == guild_id)
                .where(SuckBoobsStats.user_id == pinged_user_id)
            )
            pinged_stat = pinged_result.scalar_one_or_none()
            if pinged_stat:
                pinged_stat.times_pinged += 1
            else:
                pinged_stat = SuckBoobsStats(
                    guild_id=guild_id, user_id=pinged_user_id, times_pinged=1
                )
                session.add(pinged_stat)

            await session.commit()

    async def get_suck_boobs_leaderboard(
        self, guild_id: str, limit: int = 10
    ) -> tuple[list[SuckBoobsStats], list[SuckBoobsStats]]:
        async with self.session() as session:
            used_result = await session.execute(
                select(SuckBoobsStats)
                .where(SuckBoobsStats.guild_id == guild_id)
                .where(SuckBoobsStats.times_used > 0)
                .order_by(SuckBoobsStats.times_used.desc())
                .limit(limit)
            )
            top_users = list(used_result.scalars().all())

            pinged_result = await session.execute(
                select(SuckBoobsStats)
                .where(SuckBoobsStats.guild_id == guild_id)
                .where(SuckBoobsStats.times_pinged > 0)
                .order_by(SuckBoobsStats.times_pinged.desc())
                .limit(limit)
            )
            top_pinged = list(pinged_result.scalars().all())

            return top_users, top_pinged

    async def get_content_stats(self, guild_id: str | None = None) -> dict[str, int]:
        """Get content statistics: total items fetched and total posted."""
        async with self.session() as session:
            if guild_id:
                source_ids_result = await session.execute(
                    select(Source.id).where(Source.guild_id == guild_id)
                )
                source_ids = [row[0] for row in source_ids_result.all()]
                if not source_ids:
                    return {"total_fetched": 0, "total_posted": 0}

                total_count = await session.scalar(
                    select(func.count(ContentItem.id)).where(ContentItem.source_id.in_(source_ids))
                )
                posted_count = await session.scalar(
                    select(func.count(ContentItem.id))
                    .where(ContentItem.source_id.in_(source_ids))
                    .where(ContentItem.posted_to_discord == True)  # noqa: E712
                )
                return {"total_fetched": total_count or 0, "total_posted": posted_count or 0}
            else:
                total_count = await session.scalar(select(func.count(ContentItem.id)))
                posted_count = await session.scalar(
                    select(func.count(ContentItem.id)).where(
                        ContentItem.posted_to_discord == True  # noqa: E712
                    )
                )
                return {"total_fetched": total_count or 0, "total_posted": posted_count or 0}

    async def get_last_posted_content(self, guild_id: str | None = None) -> ContentItem | None:
        """Get the most recently posted content item."""
        async with self.session() as session:
            query = (
                select(ContentItem)
                .where(ContentItem.posted_to_discord == True)  # noqa: E712
                .where(ContentItem.discord_message_id != "backfilled")
            )

            if guild_id:
                source_ids_result = await session.execute(
                    select(Source.id).where(Source.guild_id == guild_id)
                )
                source_ids = [row[0] for row in source_ids_result.all()]
                if not source_ids:
                    return None
                query = query.where(ContentItem.source_id.in_(source_ids))

            query = query.order_by(ContentItem.created_at.desc()).limit(1)
            result = await session.execute(query)
            return result.scalar_one_or_none()

    async def add_github_repo(
        self,
        guild_id: str,
        channel_id: str,
        owner: str,
        repo: str,
        track_commits: bool = True,
        track_prs: bool = True,
        track_issues: bool = True,
    ) -> GitHubRepo:
        async with self.session() as session:
            github_repo = GitHubRepo(
                guild_id=guild_id,
                channel_id=channel_id,
                owner=owner,
                repo=repo,
                track_commits=track_commits,
                track_prs=track_prs,
                track_issues=track_issues,
            )
            session.add(github_repo)
            await session.commit()
            await session.refresh(github_repo)
            return github_repo

    async def get_github_repo(self, guild_id: str, owner: str, repo: str) -> GitHubRepo | None:
        async with self.session() as session:
            result = await session.execute(
                select(GitHubRepo)
                .where(GitHubRepo.guild_id == guild_id)
                .where(GitHubRepo.owner == owner)
                .where(GitHubRepo.repo == repo)
            )
            return result.scalar_one_or_none()

    async def get_github_repos_for_channel(self, channel_id: str) -> list[GitHubRepo]:
        async with self.session() as session:
            result = await session.execute(
                select(GitHubRepo).where(GitHubRepo.channel_id == channel_id)
            )
            return list(result.scalars().all())

    async def get_github_repos_for_guild(self, guild_id: str) -> list[GitHubRepo]:
        async with self.session() as session:
            result = await session.execute(
                select(GitHubRepo).where(GitHubRepo.guild_id == guild_id)
            )
            return list(result.scalars().all())

    async def get_all_github_repos(self, active_only: bool = True) -> list[GitHubRepo]:
        async with self.session() as session:
            query = select(GitHubRepo)
            if active_only:
                query = query.where(GitHubRepo.is_active == True)  # noqa: E712
            result = await session.execute(query)
            return list(result.scalars().all())

    async def delete_github_repo(self, guild_id: str, owner: str, repo: str) -> bool:
        async with self.session() as session:
            result = await session.execute(
                select(GitHubRepo)
                .where(GitHubRepo.guild_id == guild_id)
                .where(GitHubRepo.owner == owner)
                .where(GitHubRepo.repo == repo)
            )
            github_repo = result.scalar_one_or_none()
            if github_repo:
                repo_id = github_repo.id
                await session.delete(github_repo)
                await session.commit()
                logger.info(
                    "GitHub repo deleted",
                    repo_id=repo_id,
                    owner=owner,
                    repo=repo,
                )
                return True
            logger.warning("GitHub repo not found for deletion", owner=owner, repo=repo)
            return False

    async def update_github_repo_state(
        self,
        repo_id: str,
        last_commit_sha: str | None = None,
        last_pr_number: int | None = None,
        last_issue_number: int | None = None,
    ) -> bool:
        async with self.session() as session:
            result = await session.execute(select(GitHubRepo).where(GitHubRepo.id == repo_id))
            github_repo = result.scalar_one_or_none()
            if github_repo:
                if last_commit_sha is not None:
                    github_repo.last_commit_sha = last_commit_sha
                if last_pr_number is not None:
                    github_repo.last_pr_number = last_pr_number
                if last_issue_number is not None:
                    github_repo.last_issue_number = last_issue_number
                github_repo.last_polled_at = datetime.now(UTC)
                await session.commit()
                return True
            return False

    async def increment_github_failure(self, repo_id: str) -> int:
        async with self.session() as session:
            result = await session.execute(select(GitHubRepo).where(GitHubRepo.id == repo_id))
            github_repo = result.scalar_one_or_none()
            if github_repo:
                github_repo.consecutive_failures = (github_repo.consecutive_failures or 0) + 1
                await session.commit()
                return github_repo.consecutive_failures
            return 0

    async def reset_github_failure(self, repo_id: str) -> bool:
        async with self.session() as session:
            result = await session.execute(select(GitHubRepo).where(GitHubRepo.id == repo_id))
            github_repo = result.scalar_one_or_none()
            if github_repo:
                if (github_repo.consecutive_failures or 0) > 0:
                    github_repo.consecutive_failures = 0
                    await session.commit()
                return True
            return False

    async def set_github_repo_active(self, repo_id: str, is_active: bool) -> bool:
        async with self.session() as session:
            result = await session.execute(select(GitHubRepo).where(GitHubRepo.id == repo_id))
            github_repo = result.scalar_one_or_none()
            if github_repo:
                github_repo.is_active = is_active
                await session.commit()
                return True
            return False

    async def add_message_chunk_meta(self, chunk: MessageChunkMeta) -> MessageChunkMeta:
        async with self.session() as session:
            session.add(chunk)
            await session.commit()
            await session.refresh(chunk)
            return chunk

    async def add_message_chunk_metas_batch(self, chunks: list[MessageChunkMeta]) -> None:
        if not chunks:
            return
        async with self.session() as session:
            session.add_all(chunks)
            await session.commit()

    async def count_message_chunk_metas(self, guild_id: str | None = None) -> int:
        async with self.session() as session:
            query = select(func.count()).select_from(MessageChunkMeta)
            if guild_id is not None:
                query = query.where(MessageChunkMeta.guild_id == guild_id)
            result = await session.execute(query)
            return int(result.scalar_one())

    async def get_message_chunk_metas_batch(
        self,
        offset: int = 0,
        limit: int = 100,
        guild_id: str | None = None,
    ) -> list[MessageChunkMeta]:
        async with self.session() as session:
            query = select(MessageChunkMeta)
            if guild_id is not None:
                query = query.where(MessageChunkMeta.guild_id == guild_id)
            result = await session.execute(
                query.order_by(MessageChunkMeta.start_timestamp.asc(), MessageChunkMeta.id.asc())
                .offset(offset)
                .limit(limit)
            )
            return list(result.scalars().all())

    async def get_message_chunk_guild_ids(self) -> list[str]:
        async with self.session() as session:
            result = await session.execute(
                select(MessageChunkMeta.guild_id)
                .distinct()
                .order_by(MessageChunkMeta.guild_id.asc())
            )
            return [str(guild_id) for guild_id in result.scalars().all()]

    async def get_message_chunk_metas_by_ids(self, chunk_ids: list[str]) -> list[MessageChunkMeta]:
        if not chunk_ids:
            return []
        async with self.session() as session:
            result = await session.execute(
                select(MessageChunkMeta).where(MessageChunkMeta.id.in_(chunk_ids))
            )
            return list(result.scalars().all())

    async def get_message_chunk_metas_for_channel(
        self, guild_id: str, channel_id: str
    ) -> list[MessageChunkMeta]:
        async with self.session() as session:
            result = await session.execute(
                select(MessageChunkMeta)
                .where(MessageChunkMeta.guild_id == guild_id)
                .where(MessageChunkMeta.channel_id == channel_id)
                .order_by(MessageChunkMeta.start_timestamp.asc())
            )
            return list(result.scalars().all())

    async def delete_message_chunk_metas_for_channel(
        self, guild_id: str, channel_id: str
    ) -> list[str]:
        async with self.session() as session:
            result = await session.execute(
                select(MessageChunkMeta)
                .where(MessageChunkMeta.guild_id == guild_id)
                .where(MessageChunkMeta.channel_id == channel_id)
            )
            chunks = list(result.scalars().all())
            chunk_ids = [c.id for c in chunks]
            for chunk in chunks:
                await session.delete(chunk)
            await session.commit()
            return chunk_ids

    async def get_or_create_ingestion_progress(
        self, guild_id: str, channel_id: str
    ) -> IngestionProgress:
        async with self.session() as session:
            result = await session.execute(
                select(IngestionProgress)
                .where(IngestionProgress.guild_id == guild_id)
                .where(IngestionProgress.channel_id == channel_id)
            )
            progress = result.scalar_one_or_none()
            if progress:
                return progress
            progress = IngestionProgress(guild_id=guild_id, channel_id=channel_id)
            session.add(progress)
            try:
                await session.commit()
            except IntegrityError:
                await session.rollback()
                result = await session.execute(
                    select(IngestionProgress)
                    .where(IngestionProgress.guild_id == guild_id)
                    .where(IngestionProgress.channel_id == channel_id)
                )
                progress = result.scalar_one()
            await session.refresh(progress)
            return progress

    async def update_ingestion_progress(
        self,
        guild_id: str,
        channel_id: str,
        last_message_id: str | None = None,
        total_fetched: int | None = None,
        status: str | None = None,
    ) -> bool:
        async with self.session() as session:
            result = await session.execute(
                select(IngestionProgress)
                .where(IngestionProgress.guild_id == guild_id)
                .where(IngestionProgress.channel_id == channel_id)
            )
            progress = result.scalar_one_or_none()
            if not progress:
                return False
            if last_message_id is not None:
                progress.last_message_id = last_message_id
            if total_fetched is not None:
                progress.total_fetched = total_fetched
            if status is not None:
                progress.status = status
                if status == "in_progress" and progress.started_at is None:
                    progress.started_at = datetime.now(UTC)
                elif status == "completed":
                    progress.completed_at = datetime.now(UTC)
            await session.commit()
            return True

    async def get_ingestion_progress_for_guild(self, guild_id: str) -> list[IngestionProgress]:
        async with self.session() as session:
            result = await session.execute(
                select(IngestionProgress).where(IngestionProgress.guild_id == guild_id)
            )
            return list(result.scalars().all())

    async def get_in_progress_ingestions(self) -> list[IngestionProgress]:
        async with self.session() as session:
            result = await session.execute(
                select(IngestionProgress).where(
                    IngestionProgress.status.in_(("in_progress", "paused"))
                )
            )
            return list(result.scalars().all())
