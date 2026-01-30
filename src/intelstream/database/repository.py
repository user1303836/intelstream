from datetime import UTC, datetime

from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import (
    AsyncConnection,
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)

from intelstream.database.models import (
    Base,
    ContentItem,
    DiscordConfig,
    ExtractionCache,
    ForwardingRule,
    Source,
    SourceType,
)

SOURCES_MIGRATIONS: list[tuple[str, str]] = [
    ("discovery_strategy", "VARCHAR(50)"),
    ("url_pattern", "VARCHAR(255)"),
    ("last_content_hash", "VARCHAR(64)"),
    ("consecutive_failures", "INTEGER DEFAULT 0"),
    ("guild_id", "VARCHAR(36)"),
    ("channel_id", "VARCHAR(36)"),
]

MIN_POLL_INTERVAL_MINUTES = 1
MAX_POLL_INTERVAL_MINUTES = 60


class Repository:
    def __init__(self, database_url: str) -> None:
        self._engine = create_async_engine(database_url, echo=False)
        self._session_factory: async_sessionmaker[AsyncSession] = async_sessionmaker(
            self._engine, class_=AsyncSession, expire_on_commit=False
        )

    async def initialize(self) -> None:
        async with self._engine.begin() as conn:
            await conn.run_sync(Base.metadata.create_all)
            await self._migrate_sources_table(conn)

    async def _migrate_sources_table(self, conn: AsyncConnection) -> None:
        result = await conn.execute(text("PRAGMA table_info(sources)"))
        existing_columns = {row[1] for row in result.fetchall()}

        for column_name, column_type in SOURCES_MIGRATIONS:
            if column_name not in existing_columns:
                await conn.execute(
                    text(f"ALTER TABLE sources ADD COLUMN {column_name} {column_type}")
                )

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
            )
            session.add(source)
            await session.commit()
            await session.refresh(source)
            return source

    async def get_source_by_identifier(self, identifier: str) -> Source | None:
        async with self.session() as session:
            result = await session.execute(select(Source).where(Source.identifier == identifier))
            return result.scalar_one_or_none()

    async def get_source_by_id(self, source_id: str) -> Source | None:
        async with self.session() as session:
            result = await session.execute(select(Source).where(Source.id == source_id))
            return result.scalar_one_or_none()

    async def get_source_by_name(self, name: str) -> Source | None:
        async with self.session() as session:
            result = await session.execute(select(Source).where(Source.name == name))
            return result.scalar_one_or_none()

    async def get_all_sources(
        self, active_only: bool = True, channel_id: str | None = None
    ) -> list[Source]:
        async with self.session() as session:
            query = select(Source)
            if active_only:
                query = query.where(Source.is_active == True)  # noqa: E712
            if channel_id is not None:
                query = query.where(Source.channel_id == channel_id)
            result = await session.execute(query)
            return list(result.scalars().all())

    async def update_source_last_polled(self, source_id: str) -> None:
        async with self.session() as session:
            result = await session.execute(select(Source).where(Source.id == source_id))
            source = result.scalar_one_or_none()
            if source:
                source.last_polled_at = datetime.now(UTC)
                await session.commit()

    async def set_source_active(self, identifier: str, is_active: bool) -> Source | None:
        async with self.session() as session:
            result = await session.execute(select(Source).where(Source.identifier == identifier))
            source = result.scalar_one_or_none()
            if source:
                source.is_active = is_active
                await session.commit()
                await session.refresh(source)
            return source

    async def delete_source(self, identifier: str) -> bool:
        async with self.session() as session:
            result = await session.execute(select(Source).where(Source.identifier == identifier))
            source = result.scalar_one_or_none()
            if source:
                await session.delete(source)
                await session.commit()
                return True
            return False

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
            await session.commit()
            await session.refresh(content_item)
            return content_item

    async def get_content_item_by_external_id(self, external_id: str) -> ContentItem | None:
        async with self.session() as session:
            result = await session.execute(
                select(ContentItem).where(ContentItem.external_id == external_id)
            )
            return result.scalar_one_or_none()

    async def content_item_exists(self, external_id: str) -> bool:
        return await self.get_content_item_by_external_id(external_id) is not None

    async def get_unposted_content_items(self) -> list[ContentItem]:
        async with self.session() as session:
            result = await session.execute(
                select(ContentItem)
                .where(ContentItem.posted_to_discord == False)  # noqa: E712
                .where(ContentItem.summary.isnot(None))
                .order_by(ContentItem.published_at.asc())
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
            query = (
                select(ContentItem)
                .where(ContentItem.source_id == source_id)
                .where(ContentItem.posted_to_discord == False)  # noqa: E712
                .where(ContentItem.summary.is_(None))
            )
            if exclude_item_id:
                query = query.where(ContentItem.id != exclude_item_id)

            result = await session.execute(query)
            items = list(result.scalars().all())

            for item in items:
                item.posted_to_discord = True
                item.discord_message_id = "backfilled"

            await session.commit()
            return len(items)

    async def update_content_item_summary(self, content_id: str, summary: str) -> None:
        async with self.session() as session:
            result = await session.execute(select(ContentItem).where(ContentItem.id == content_id))
            content_item = result.scalar_one_or_none()
            if content_item:
                content_item.summary = summary
                await session.commit()

    async def mark_content_item_posted(self, content_id: str, discord_message_id: str) -> None:
        async with self.session() as session:
            result = await session.execute(select(ContentItem).where(ContentItem.id == content_id))
            content_item = result.scalar_one_or_none()
            if content_item:
                content_item.posted_to_discord = True
                content_item.discord_message_id = discord_message_id
                await session.commit()

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
        async with self.session() as session:
            result = await session.execute(
                select(DiscordConfig).where(DiscordConfig.guild_id == guild_id)
            )
            config = result.scalar_one_or_none()
            if config:
                config.channel_id = channel_id
                await session.commit()
                await session.refresh(config)
            else:
                config = DiscordConfig(guild_id=guild_id, channel_id=channel_id)
                session.add(config)
                await session.commit()
                await session.refresh(config)
            return config

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
    ) -> None:
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

    async def update_source_content_hash(self, source_id: str, content_hash: str) -> None:
        async with self.session() as session:
            result = await session.execute(select(Source).where(Source.id == source_id))
            source = result.scalar_one_or_none()
            if source:
                source.last_content_hash = content_hash
                await session.commit()

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
                return source.consecutive_failures
            return 0

    async def reset_failure_count(self, source_id: str) -> None:
        async with self.session() as session:
            result = await session.execute(select(Source).where(Source.id == source_id))
            source = result.scalar_one_or_none()
            if source and (source.consecutive_failures or 0) > 0:
                source.consecutive_failures = 0
                await session.commit()

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

    async def increment_forwarding_count(self, rule_id: str) -> None:
        async with self.session() as session:
            result = await session.execute(
                select(ForwardingRule).where(ForwardingRule.id == rule_id)
            )
            rule = result.scalar_one_or_none()
            if rule:
                rule.messages_forwarded = (rule.messages_forwarded or 0) + 1
                rule.last_forwarded_at = datetime.now(UTC)
                await session.commit()

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
                await session.delete(rule)
                await session.commit()
                return True
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
