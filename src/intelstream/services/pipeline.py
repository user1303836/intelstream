import asyncio
import json
import time
from collections.abc import Callable
from datetime import UTC, datetime, timedelta
from typing import TYPE_CHECKING

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
from intelstream.config import Settings, reveal_secret
from intelstream.database.exceptions import DuplicateContentError
from intelstream.database.models import ArticleChunkMeta, ContentItem, Source, SourceType
from intelstream.database.repository import Repository
from intelstream.database.vector_store import ArticleChunkVector
from intelstream.services.article_search import ArticleChunker, build_article_chunk_id
from intelstream.services.summarizer import SummarizationError, SummarizationService
from intelstream.utils.safe_http import SafeHTTPError

if TYPE_CHECKING:
    from intelstream.database.vector_store import VectorStore
    from intelstream.services.embedding_service import EmbeddingService

SearchServicesGetter = Callable[[], tuple["EmbeddingService | None", "VectorStore | None"]]

logger = structlog.get_logger()


class ContentPipeline:
    def __init__(
        self,
        settings: Settings,
        repository: Repository,
        summarizer: SummarizationService | None = None,
        get_search_services: SearchServicesGetter | None = None,
    ) -> None:
        self._settings = settings
        self._repository = repository
        self._summarizer = summarizer
        self._get_search_services = get_search_services
        self._http_client: httpx.AsyncClient | None = None
        self._owned_anthropic_clients: list[anthropic.AsyncAnthropic] = []
        self._adapters: dict[SourceType, BaseAdapter] = {}
        self._article_chunker = ArticleChunker(
            chunk_size_chars=getattr(self._settings, "article_chunk_size_chars", 1200),
            overlap_chars=getattr(self._settings, "article_chunk_overlap_chars", 200),
        )

    async def initialize(self) -> None:
        configured_intervals = {
            source_type: self._settings.get_poll_interval(source_type) for source_type in SourceType
        }
        updated_sources = await self._repository.sync_source_poll_intervals(configured_intervals)
        self._http_client = httpx.AsyncClient(timeout=self._settings.http_timeout_seconds)
        self._adapters = self._create_adapters()
        logger.debug(
            "Content pipeline initialized",
            source_intervals_updated=updated_sources,
        )

    async def close(self) -> None:
        for adapter in self._adapters.values():
            try:
                await adapter.close()
            except Exception:
                logger.exception("Failed to close content adapter", adapter=adapter.source_type)
        self._adapters.clear()
        if self._http_client:
            await self._http_client.aclose()
            self._http_client = None
        for client in self._owned_anthropic_clients:
            await client.close()
        self._owned_anthropic_clients.clear()
        logger.debug("Content pipeline closed")

    def _create_adapters(self) -> dict[SourceType, BaseAdapter]:
        adapters: dict[SourceType, BaseAdapter] = {
            SourceType.SUBSTACK: SubstackAdapter(http_client=self._http_client),
            SourceType.RSS: RSSAdapter(http_client=self._http_client),
            SourceType.ARXIV: ArxivAdapter(http_client=self._http_client),
        }

        youtube_api_key = reveal_secret(self._settings.youtube_api_key)
        if youtube_api_key:
            adapters[SourceType.YOUTUBE] = YouTubeAdapter(
                api_key=youtube_api_key,
                http_client=self._http_client,
            )

        twitter_bearer_token = reveal_secret(self._settings.twitter_bearer_token)
        if twitter_bearer_token:
            adapters[SourceType.TWITTER] = TwitterAdapter(
                bearer_token=twitter_bearer_token,
                http_client=self._http_client,
            )

        anthropic_api_key = reveal_secret(self._settings.anthropic_api_key)
        if anthropic_api_key:
            anthropic_client = anthropic.AsyncAnthropic(api_key=anthropic_api_key)
            self._owned_anthropic_clients.append(anthropic_client)
            adapters[SourceType.BLOG] = SmartBlogAdapter(
                anthropic_client=anthropic_client,
                repository=self._repository,
                http_client=self._http_client,
            )
        else:
            logger.warning(
                "ANTHROPIC_API_KEY not set; Blog and Page source types will be unavailable"
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
        now = datetime.now(UTC)
        due_sources: list[Source] = []

        for source in sources:
            if source.last_polled_at is not None:
                last_polled = source.last_polled_at
                if last_polled.tzinfo is None:
                    last_polled = last_polled.replace(tzinfo=UTC)
                next_poll_at = last_polled + timedelta(minutes=source.poll_interval_minutes)
                if now < next_poll_at:
                    logger.debug(
                        "Skipping source, not due yet",
                        source_name=source.name,
                        source_type=source.type.value,
                        next_poll_at=next_poll_at.isoformat(),
                    )
                    sources_skipped += 1
                    continue
            due_sources.append(source)

        for i, source in enumerate(due_sources):
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
            except SafeHTTPError as e:
                logger.warning(
                    "Unsafe source response blocked",
                    source_name=source.name,
                    source_type=source.type.value,
                    error=str(e),
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

            if fetch_delay > 0 and i < len(due_sources) - 1:
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
        existing_ids = (
            await self._repository.get_existing_external_ids({item.external_id for item in items})
            if items
            else set()
        )
        seen_ids = set(existing_ids)
        for item in items:
            if item.external_id in seen_ids:
                continue
            try:
                await self._store_content_item(source, item)
                new_count += 1
            except DuplicateContentError:
                logger.debug("Content item already exists", external_id=item.external_id)
            seen_ids.add(item.external_id)

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
        sources_by_id = await self._repository.get_sources_by_ids(
            {item.source_id for item in items}
        )

        for item_index, item in enumerate(items):
            source = sources_by_id.get(item.source_id)
            source_name = source.name if source else "unknown"
            source_type = source.type.value if source else "unknown"

            if not item.raw_content:
                if source and source.skip_summary:
                    await self._repository.update_content_item_summary(item.id, "")
                    summarized_count += 1
                    logger.debug(
                        "Skip-summary item, marked ready for posting",
                        item_id=item.id,
                        title=item.title,
                        source_name=source_name,
                    )
                else:
                    logger.warning(
                        "Item has no content, skipping (extraction likely failed)",
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

                await self._embed_item(item.id, item.title, summary, item.raw_content)

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
                logger.exception(
                    "Unexpected error during summarization",
                    item_id=item.id,
                    title=item.title,
                    source_name=source_name,
                    error=str(e),
                )

            if item_index < len(items) - 1 and self._settings.summarization_delay_seconds > 0:
                await asyncio.sleep(self._settings.summarization_delay_seconds)

        elapsed = round(time.monotonic() - summarize_start, 2)
        logger.info(
            "Summarization complete",
            summarized_count=summarized_count,
            elapsed_seconds=elapsed,
        )
        return summarized_count

    async def _embed_item(
        self,
        item_id: str,
        title: str,
        summary: str,
        raw_content: str | None,
    ) -> None:
        if self._get_search_services is None:
            return
        embedding_service, vector_store = self._get_search_services()
        if embedding_service is None or vector_store is None:
            return
        try:
            chunks = self._article_chunker.build_chunks(
                title=title,
                raw_content=raw_content,
                summary=summary,
            )
            if not chunks:
                return

            if len(chunks) == 1:
                embeddings = [await embedding_service.embed_text(chunks[0].search_text)]
            else:
                embeddings = await embedding_service.embed_batch(
                    [chunk.search_text for chunk in chunks]
                )
            stale_chunk_ids = await self._repository.delete_article_chunk_metas_for_content_item(
                item_id
            )
            if stale_chunk_ids:
                await vector_store.delete_article_chunks(stale_chunk_ids)

            metas = [
                ArticleChunkMeta(
                    id=build_article_chunk_id(item_id, chunk.chunk_index),
                    content_item_id=item_id,
                    chunk_index=chunk.chunk_index,
                    text=chunk.text,
                )
                for chunk in chunks
            ]
            vector_items = [
                ArticleChunkVector(
                    chunk_id=meta.id,
                    content_item_id=item_id,
                    chunk_index=chunk.chunk_index,
                    text=chunk.text,
                    search_text=chunk.search_text,
                    embedding=embedding,
                )
                for meta, chunk, embedding in zip(metas, chunks, embeddings, strict=True)
            ]
            await self._repository.add_article_chunk_metas_batch(metas)
            await vector_store.upsert_article_chunks_batch(vector_items)
        except Exception as e:
            logger.exception("Failed to embed item", item_id=item_id, error=str(e))

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
