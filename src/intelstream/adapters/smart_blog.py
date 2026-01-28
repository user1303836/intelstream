from dataclasses import dataclass
from datetime import UTC, datetime

import anthropic
import httpx
import structlog

from intelstream.adapters.base import BaseAdapter, ContentData
from intelstream.adapters.strategies import (
    DiscoveredPost,
    DiscoveryResult,
    DiscoveryStrategy,
    LLMExtractionStrategy,
    RSSDiscoveryStrategy,
    SitemapDiscoveryStrategy,
)
from intelstream.database.models import Source
from intelstream.database.repository import Repository
from intelstream.services.content_extractor import ContentExtractor

logger = structlog.get_logger()

MAX_CONSECUTIVE_FAILURES = 3
UNKNOWN_DATE = datetime(1970, 1, 1, tzinfo=UTC)


@dataclass
class AnalysisResult:
    success: bool
    strategy: str | None = None
    post_count: int = 0
    sample_posts: list[str] | None = None
    feed_url: str | None = None
    url_pattern: str | None = None
    error: str | None = None


class SmartBlogAdapter(BaseAdapter):
    def __init__(
        self,
        anthropic_client: anthropic.AsyncAnthropic,
        repository: Repository,
        http_client: httpx.AsyncClient | None = None,
    ) -> None:
        self._anthropic = anthropic_client
        self._repository = repository
        self._http_client = http_client
        self._content_extractor = ContentExtractor(http_client=http_client)
        self._strategies: list[DiscoveryStrategy] = [
            RSSDiscoveryStrategy(http_client=http_client),
            SitemapDiscoveryStrategy(http_client=http_client),
            LLMExtractionStrategy(
                anthropic_client=anthropic_client,
                repository=repository,
                http_client=http_client,
            ),
        ]

    @property
    def source_type(self) -> str:
        return "blog"

    async def get_feed_url(self, identifier: str) -> str:
        return identifier

    async def analyze_site(self, url: str) -> AnalysisResult:
        logger.info("Analyzing site for blog content", url=url)

        for strategy in self._strategies:
            try:
                result = await strategy.discover(url)
                if result and result.posts:
                    sample_urls = [p.url for p in result.posts[:5]]
                    return AnalysisResult(
                        success=True,
                        strategy=strategy.name,
                        post_count=len(result.posts),
                        sample_posts=sample_urls,
                        feed_url=result.feed_url,
                        url_pattern=result.url_pattern,
                    )
            except Exception as e:
                logger.warning(
                    "Strategy failed during analysis",
                    strategy=strategy.name,
                    url=url,
                    error=str(e),
                )
                continue

        return AnalysisResult(
            success=False,
            error="Unable to find blog posts on this page. "
            "The page may not contain a recognizable blog/article listing.",
        )

    async def fetch_latest(
        self,
        identifier: str,
        feed_url: str | None = None,  # noqa: ARG002
    ) -> list[ContentData]:
        source = await self._repository.get_source_by_identifier(identifier)
        if not source:
            logger.warning("Source not found", identifier=identifier)
            return []

        strategy_name = source.discovery_strategy
        url_pattern = source.url_pattern

        if strategy_name == "rss" and source.feed_url:
            items = await self._fetch_via_rss(source)
            if items:
                await self._repository.reset_failure_count(source.id)
            return items

        result = await self._discover_with_fallback(identifier, strategy_name, url_pattern, source)

        if not result or not result.posts:
            failures = await self._repository.increment_failure_count(source.id)
            if failures >= MAX_CONSECUTIVE_FAILURES:
                logger.info(
                    "Re-analyzing source after consecutive failures",
                    identifier=identifier,
                    failures=failures,
                )
                analysis = await self.analyze_site(identifier)
                if analysis.success and analysis.strategy:
                    await self._repository.update_source_discovery_strategy(
                        source_id=source.id,
                        discovery_strategy=analysis.strategy,
                        feed_url=analysis.feed_url,
                        url_pattern=analysis.url_pattern,
                    )
                    await self._repository.reset_failure_count(source.id)
            return []

        await self._repository.reset_failure_count(source.id)

        new_posts: list[DiscoveredPost] = []
        for post in result.posts:
            if not await self._repository.content_item_exists(post.url):
                new_posts.append(post)

        if not new_posts:
            logger.debug("No new posts found", identifier=identifier)
            return []

        content_items: list[ContentData] = []
        for post in new_posts:
            try:
                extracted = await self._content_extractor.extract(post.url)
                content_items.append(
                    ContentData(
                        external_id=post.url,
                        title=post.title or extracted.title or "Untitled",
                        original_url=post.url,
                        author=extracted.author or self._get_site_name(identifier),
                        published_at=post.published_at or extracted.published_at or UNKNOWN_DATE,
                        raw_content=extracted.text or None,
                        thumbnail_url=None,
                    )
                )
            except Exception as e:
                logger.warning(
                    "Failed to extract content from post",
                    url=post.url,
                    error=str(e),
                )
                continue

        logger.info(
            "Fetched blog content",
            identifier=identifier,
            new_posts=len(content_items),
        )
        return content_items

    async def _fetch_via_rss(self, source: Source) -> list[ContentData]:
        from intelstream.adapters.rss import RSSAdapter

        rss_adapter = RSSAdapter(http_client=self._http_client)
        return await rss_adapter.fetch_latest(
            identifier=source.identifier,
            feed_url=source.feed_url,
        )

    async def _discover_with_fallback(
        self,
        url: str,
        cached_strategy: str | None,
        url_pattern: str | None,
        source: Source,
    ) -> DiscoveryResult | None:
        if cached_strategy:
            strategy = self._get_strategy_by_name(cached_strategy)
            if strategy:
                try:
                    result = await strategy.discover(url, url_pattern=url_pattern)
                    if result and result.posts:
                        return result
                except Exception as e:
                    logger.warning(
                        "Cached strategy failed, trying fallback",
                        strategy=cached_strategy,
                        url=url,
                        error=str(e),
                    )

        for strategy in self._strategies:
            if cached_strategy and strategy.name == cached_strategy:
                continue

            try:
                result = await strategy.discover(url, url_pattern=url_pattern)
                if result and result.posts:
                    if strategy.name != cached_strategy:
                        logger.info(
                            "Fallback strategy succeeded, updating source",
                            old_strategy=cached_strategy,
                            new_strategy=strategy.name,
                            url=url,
                        )
                        await self._repository.update_source_discovery_strategy(
                            source_id=source.id,
                            discovery_strategy=strategy.name,
                            feed_url=result.feed_url,
                            url_pattern=result.url_pattern,
                        )
                    return result
            except Exception as e:
                logger.warning(
                    "Fallback strategy failed",
                    strategy=strategy.name,
                    url=url,
                    error=str(e),
                )
                continue

        return None

    def _get_strategy_by_name(self, name: str) -> DiscoveryStrategy | None:
        for strategy in self._strategies:
            if strategy.name == name:
                return strategy
        return None

    def _get_site_name(self, url: str) -> str:
        from urllib.parse import urlparse

        parsed = urlparse(url)
        domain = parsed.netloc
        if domain.startswith("www."):
            domain = domain[4:]
        parts = domain.split(".")
        if len(parts) >= 2:
            return parts[-2].title()
        return domain.title()
