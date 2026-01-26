import asyncio

import httpx
import structlog

from intelstream.adapters.base import BaseAdapter, ContentData
from intelstream.adapters.rss import RSSAdapter
from intelstream.adapters.substack import SubstackAdapter
from intelstream.adapters.youtube import YouTubeAdapter
from intelstream.config import Settings
from intelstream.database.models import Source, SourceType
from intelstream.database.repository import Repository
from intelstream.services.summarizer import SummarizationError, SummarizationService

logger = structlog.get_logger()

SUMMARIZATION_DELAY_SECONDS = 0.5


class ContentPipeline:
    def __init__(
        self,
        settings: Settings,
        repository: Repository,
        summarizer: SummarizationService | None = None,
    ) -> None:
        self._settings = settings
        self._repository = repository
        self._summarizer = summarizer
        self._http_client: httpx.AsyncClient | None = None
        self._adapters: dict[SourceType, BaseAdapter] = {}

    async def initialize(self) -> None:
        self._http_client = httpx.AsyncClient(timeout=30.0)
        self._adapters = self._create_adapters()
        logger.info("Content pipeline initialized")

    async def close(self) -> None:
        if self._http_client:
            await self._http_client.aclose()
        logger.info("Content pipeline closed")

    def _create_adapters(self) -> dict[SourceType, BaseAdapter]:
        adapters: dict[SourceType, BaseAdapter] = {
            SourceType.SUBSTACK: SubstackAdapter(http_client=self._http_client),
            SourceType.RSS: RSSAdapter(http_client=self._http_client),
        }

        if self._settings.youtube_api_key:
            adapters[SourceType.YOUTUBE] = YouTubeAdapter(
                api_key=self._settings.youtube_api_key,
                http_client=self._http_client,
            )

        return adapters

    async def fetch_all_sources(self) -> int:
        sources = await self._repository.get_all_sources(active_only=True)
        logger.info("Fetching content from sources", count=len(sources))

        total_new_items = 0

        for source in sources:
            try:
                new_items = await self._fetch_source(source)
                total_new_items += new_items
            except Exception as e:
                logger.error(
                    "Failed to fetch source",
                    source_name=source.name,
                    source_type=source.type.value,
                    error=str(e),
                )

        logger.info("Fetch complete", total_new_items=total_new_items)
        return total_new_items

    async def _fetch_source(self, source: Source) -> int:
        adapter = self._adapters.get(source.type)

        if adapter is None:
            logger.warning("No adapter for source type", source_type=source.type.value)
            return 0

        logger.debug("Fetching source", source_name=source.name)

        items = await adapter.fetch_latest(source.identifier, feed_url=source.feed_url)

        new_count = 0
        for item in items:
            if not await self._repository.content_item_exists(item.external_id):
                await self._store_content_item(source, item)
                new_count += 1

        await self._repository.update_source_last_polled(source.id)

        logger.info(
            "Source fetched",
            source_name=source.name,
            total_items=len(items),
            new_items=new_count,
        )

        return new_count

    async def _store_content_item(self, source: Source, item: ContentData) -> None:
        await self._repository.add_content_item(
            source_id=source.id,
            external_id=item.external_id,
            title=item.title,
            original_url=item.original_url,
            author=item.author,
            published_at=item.published_at,
            raw_content=item.raw_content,
            thumbnail_url=item.thumbnail_url,
        )

    async def summarize_pending(self, max_items: int = 10) -> int:
        if self._summarizer is None:
            logger.warning("Summarizer not configured, skipping summarization")
            return 0

        items = await self._repository.get_unsummarized_content_items(limit=max_items)
        logger.info("Summarizing pending items", count=len(items))

        summarized_count = 0

        for item in items:
            if not item.raw_content:
                logger.debug("Skipping item without raw content", item_id=item.id)
                continue

            try:
                source = await self._repository.get_source_by_id(item.source_id)
                source_type = source.type.value if source else "unknown"

                summary = await self._summarizer.summarize(
                    content=item.raw_content,
                    title=item.title,
                    source_type=source_type,
                    author=item.author,
                )

                await self._repository.update_content_item_summary(item.id, summary)
                summarized_count += 1

                logger.debug("Item summarized", item_id=item.id, title=item.title)

            except SummarizationError as e:
                logger.error(
                    "Summarization failed",
                    item_id=item.id,
                    title=item.title,
                    error=str(e),
                )
            except Exception as e:
                logger.error(
                    "Unexpected error during summarization",
                    item_id=item.id,
                    error=str(e),
                )

            await asyncio.sleep(SUMMARIZATION_DELAY_SECONDS)

        logger.info("Summarization complete", summarized_count=summarized_count)
        return summarized_count

    async def run_cycle(self) -> tuple[int, int]:
        new_items = await self.fetch_all_sources()
        summarized = await self.summarize_pending()
        return new_items, summarized
