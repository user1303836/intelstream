from datetime import UTC, datetime

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from intelstream.database.models import Base, ContentItem, DiscordConfig, Source, SourceType


class Repository:
    def __init__(self, database_url: str) -> None:
        self._engine = create_async_engine(database_url, echo=False)
        self._session_factory: async_sessionmaker[AsyncSession] = async_sessionmaker(
            self._engine, class_=AsyncSession, expire_on_commit=False
        )

    async def initialize(self) -> None:
        async with self._engine.begin() as conn:
            await conn.run_sync(Base.metadata.create_all)

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
    ) -> Source:
        async with self.session() as session:
            source = Source(
                type=source_type,
                name=name,
                identifier=identifier,
                feed_url=feed_url,
                poll_interval_minutes=poll_interval_minutes,
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

    async def get_all_sources(self, active_only: bool = True) -> list[Source]:
        async with self.session() as session:
            query = select(Source)
            if active_only:
                query = query.where(Source.is_active == True)  # noqa: E712
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

    async def get_unsummarized_content_items(self, limit: int = 10) -> list[ContentItem]:
        async with self.session() as session:
            result = await session.execute(
                select(ContentItem)
                .where(ContentItem.summary.is_(None))
                .where(ContentItem.raw_content.isnot(None))
                .order_by(ContentItem.created_at.asc())
                .limit(limit)
            )
            return list(result.scalars().all())

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
