import asyncio
import json
import time
from datetime import UTC, datetime, timedelta

import anthropic
import httpx
import structlog

from intelstream.adapters.arxiv import ArxivAdapter
from intelstream.adapters.base import BaseAdapter, ContentData
from intelstream.adapters.rss import RSSAdapter
from intelstream.adapters.smart_blog import SmartBlogAdapter
from intelstream.adapters.substack import SubstackAdapter
from intelstream.adapters.twitter import TwitterAdapter
from intelstream.adapters.youtube import YouTubeAdapter
from intelstream.config import Settings
from intelstream.database.exceptions import DuplicateContentError
from intelstream.database.models import ContentItem, Source, SourceType
from intelstream.database.repository import Repository
from intelstream.services.summarizer import SummarizationError, SummarizationService

logger = structlog.get_logger()


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
        self._http_client = httpx.AsyncClient(timeout=self._settings.http_timeout_seconds)
        self._adapters = self._create_adapters()
        logger.debug("Content pipeline initialized")

    async def close(self) -> None:
        if self._http_client:
            await self._http_client.aclose()
        logger.debug("Content pipeline closed")

    def _create_adapters(self) -> dict[SourceType, BaseAdapter]:
        adapters: dict[SourceType, BaseAdapter] = {
            SourceType.SUBSTACK: SubstackAdapter(http_client=self._http_client),
            SourceType.RSS: RSSAdapter(http_client=self._http_client),
            SourceType.ARXIV: ArxivAdapter(http_client=self._http_client),
        }

        if self._settings.youtube_api_key:
            adapters[SourceType.YOUTUBE] = YouTubeAdapter(
                api_key=self._settings.youtube_api_key,
                http_client=self._http_client,
            )

        if self._settings.twitter_bearer_token:
            adapters[SourceType.TWITTER] = TwitterAdapter(
                bearer_token=self._settings.twitter_bearer_token,
                http_client=self._http_client,
            )

        if self._settings.anthropic_api_key and self._settings.anthropic_api_key.strip():
            anthropic_client = anthropic.AsyncAnthropic(api_key=self._settings.anthropic_api_key)
            adapters[SourceType.BLOG] = SmartBlogAdapter(
                anthropic_client=anthropic_client,
                repository=self._repository,
                http_client=self._http_client,
            )

        return adapters

    async def fetch_all_sources(self) -> int:
        sources = await self._repository.get_all_sources(active_only=True)
        logger.info("Fetching content from sources", count=len(sources))

        fetch_start = time.monotonic()
        total_new_items = 0
        sources_polled = 0
        sources_skipped = 0
        sources_failed = 0
        fetch_delay = self._settings.fetch_delay_seconds

        for i, source in enumerate(sources):
            if source.last_polled_at is not None:
                interval = self._settings.get_poll_interval(source.type)
                last_polled = source.last_polled_at
                if last_polled.tzinfo is None:
                    last_polled = last_polled.replace(tzinfo=UTC)
                next_poll_at = last_polled + timedelta(minutes=interval)
                if datetime.now(UTC) < next_poll_at:
                    logger.debug(
                        "Skipping source, not due yet",
                        source_name=source.name,
                        source_type=source.type.value,
                        next_poll_at=next_poll_at.isoformat(),
                    )
                    sources_skipped += 1
                    continue

            fetch_succeeded = False
            try:
                new_items = await self._fetch_source(source)
                total_new_items += new_items
                fetch_succeeded = True
                sources_polled += 1
            except httpx.TimeoutException:
                logger.warning(
                    "Source fetch timed out",
                    source_name=source.name,
                    source_type=source.type.value,
                )
                await self._repository.increment_failure_count(source.id)
                sources_failed += 1
            except httpx.HTTPStatusError as e:
                status = e.response.status_code
                if status == 404:
                    logger.error(
                        "Source not found (404), consider removing",
                        source_name=source.name,
                        source_type=source.type.value,
                    )
                    await self._repository.increment_failure_count(source.id)
                elif status == 429:
                    logger.warning(
                        "Rate limited by source",
                        source_name=source.name,
                        source_type=source.type.value,
                    )
                    await self._repository.increment_failure_count(source.id)
                elif status in (401, 403):
                    logger.error(
                        "Auth error fetching source, check credentials",
                        source_name=source.name,
                        source_type=source.type.value,
                        status=status,
                    )
                    await self._repository.increment_failure_count(source.id)
                elif status >= 500:
                    logger.warning(
                        "Server error fetching source",
                        source_name=source.name,
                        source_type=source.type.value,
                        status=status,
                    )
                    await self._repository.increment_failure_count(source.id)
                else:
                    logger.error(
                        "HTTP error fetching source",
                        source_name=source.name,
                        source_type=source.type.value,
                        status=status,
                    )
                sources_failed += 1
            except httpx.RequestError as e:
                logger.warning(
                    "Network error fetching source",
                    source_name=source.name,
                    source_type=source.type.value,
                    error=type(e).__name__,
                )
                await self._repository.increment_failure_count(source.id)
                sources_failed += 1
            except Exception as e:
                logger.exception(
                    "Unexpected error fetching source",
                    source_name=source.name,
                    source_type=source.type.value,
                    error=str(e),
                )
                sources_failed += 1

            if fetch_succeeded:
                await self._repository.reset_failure_count(source.id)

            if fetch_delay > 0 and i < len(sources) - 1:
                await asyncio.sleep(fetch_delay)

        await self._repository.cleanup_extraction_cache()

        elapsed = round(time.monotonic() - fetch_start, 2)
        logger.info(
            "Fetch complete",
            total_new_items=total_new_items,
            sources_polled=sources_polled,
            sources_skipped=sources_skipped,
            sources_failed=sources_failed,
            elapsed_seconds=elapsed,
        )
        return total_new_items

    async def _fetch_source(self, source: Source) -> int:
        adapter: BaseAdapter | None = None

        if source.type == SourceType.PAGE:
            if not source.extraction_profile:
                logger.warning("Page source missing extraction profile", source_name=source.name)
                return 0
            from intelstream.adapters.page import PageAdapter
            from intelstream.services.page_analyzer import ExtractionProfile

            try:
                profile_data = json.loads(source.extraction_profile)
                profile = ExtractionProfile.from_dict(profile_data)
            except (json.JSONDecodeError, KeyError) as e:
                logger.error(
                    "Invalid extraction profile",
                    source_name=source.name,
                    error=str(e),
                )
                return 0
            adapter = PageAdapter(extraction_profile=profile, http_client=self._http_client)
        else:
            adapter = self._adapters.get(source.type)

        if adapter is None:
            logger.warning("No adapter for source type", source_type=source.type.value)
            return 0

        logger.info("Fetching source", source_name=source.name, source_type=source.type.value)

        items = await adapter.fetch_latest(
            source.identifier,
            feed_url=source.feed_url,
            skip_content=source.skip_summary,
        )

        is_first_poll = source.last_polled_at is None

        new_count = 0
        for item in items:
            if not await self._repository.content_item_exists(item.external_id):
                try:
                    await self._store_content_item(source, item)
                    new_count += 1
                except DuplicateContentError:
                    logger.debug("Content item already exists", external_id=item.external_id)
                    continue

        if is_first_poll and new_count > 0:
            most_recent = await self._repository.get_most_recent_item_for_source(source.id)
            if most_recent:
                backfilled = await self._repository.mark_items_as_backfilled(
                    source_id=source.id,
                    exclude_item_id=most_recent.id,
                )
                if backfilled > 0:
                    logger.info(
                        "First poll: backfilled pre-existing items",
                        source_name=source.name,
                        backfilled_count=backfilled,
                        most_recent_title=most_recent.title,
                    )

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

        await self._handle_first_posting_backfill(items)

        items = await self._repository.get_unsummarized_content_items(limit=max_items)

        if not items:
            logger.debug("No items pending summarization")
            return 0

        logger.info("Summarizing pending items", count=len(items))
        summarize_start = time.monotonic()
        summarized_count = 0

        for item in items:
            source = await self._repository.get_source_by_id(item.source_id)
            source_name = source.name if source else "unknown"
            source_type = source.type.value if source else "unknown"

            if not item.raw_content:
                await self._repository.update_content_item_summary(item.id, "")
                summarized_count += 1
                logger.debug(
                    "Item has no content, marked ready for posting",
                    item_id=item.id,
                    title=item.title,
                    source_name=source_name,
                )
                continue

            try:
                item_start = time.monotonic()
                summary = await self._summarizer.summarize(
                    content=item.raw_content,
                    title=item.title,
                    source_type=source_type,
                    author=item.author,
                )

                await self._repository.update_content_item_summary(item.id, summary)
                summarized_count += 1
                item_elapsed = round(time.monotonic() - item_start, 2)

                logger.info(
                    "Item summarized",
                    item_id=item.id,
                    title=item.title,
                    source_name=source_name,
                    elapsed_seconds=item_elapsed,
                )

            except SummarizationError as e:
                logger.error(
                    "Summarization failed",
                    item_id=item.id,
                    title=item.title,
                    source_name=source_name,
                    error=str(e),
                )
            except Exception as e:
                logger.error(
                    "Unexpected error during summarization",
                    item_id=item.id,
                    title=item.title,
                    source_name=source_name,
                    error=str(e),
                )

            await asyncio.sleep(self._settings.summarization_delay_seconds)

        elapsed = round(time.monotonic() - summarize_start, 2)
        logger.info(
            "Summarization complete",
            summarized_count=summarized_count,
            elapsed_seconds=elapsed,
        )
        return summarized_count

    async def _handle_first_posting_backfill(self, items: list[ContentItem]) -> None:
        processed_sources: set[str] = set()

        for item in items:
            if item.source_id in processed_sources:
                continue

            has_posted = await self._repository.has_source_posted_content(item.source_id)

            if not has_posted:
                most_recent = await self._repository.get_most_recent_item_for_source(item.source_id)

                if most_recent:
                    backfilled_count = await self._repository.mark_items_as_backfilled(
                        source_id=item.source_id,
                        exclude_item_id=most_recent.id,
                    )

                    if backfilled_count > 0:
                        source = await self._repository.get_source_by_id(item.source_id)
                        source_name = source.name if source else "unknown"
                        logger.info(
                            "First posting for source - backfilled old items",
                            source_name=source_name,
                            backfilled_count=backfilled_count,
                            most_recent_title=most_recent.title,
                        )

            processed_sources.add(item.source_id)

    async def run_cycle(self) -> tuple[int, int]:
        new_items = await self.fetch_all_sources()
        summarized = await self.summarize_pending()
        return new_items, summarized
