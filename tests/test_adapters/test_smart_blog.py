from datetime import UTC, datetime
from unittest.mock import AsyncMock, MagicMock, patch

import httpx
import pytest
import respx

from intelstream.adapters.smart_blog import SmartBlogAdapter
from intelstream.adapters.strategies.base import DiscoveredPost, DiscoveryResult
from intelstream.database.models import Source, SourceType
from intelstream.database.repository import Repository


@pytest.fixture
def mock_repository():
    repo = AsyncMock(spec=Repository)
    repo.get_source_by_identifier = AsyncMock(return_value=None)
    repo.get_known_urls_for_source = AsyncMock(return_value=set())
    repo.content_item_exists = AsyncMock(return_value=False)
    repo.get_extraction_cache = AsyncMock(return_value=None)
    repo.set_extraction_cache = AsyncMock()
    repo.update_source_discovery_strategy = AsyncMock()
    repo.increment_failure_count = AsyncMock(return_value=1)
    repo.reset_failure_count = AsyncMock()
    return repo


@pytest.fixture
def mock_anthropic_client():
    client = MagicMock()
    client.messages = MagicMock()
    client.messages.create = AsyncMock()
    return client


@pytest.fixture
def adapter(mock_anthropic_client, mock_repository):
    return SmartBlogAdapter(
        anthropic_client=mock_anthropic_client,
        repository=mock_repository,
    )


@pytest.fixture
def sample_source():
    source = MagicMock(spec=Source)
    source.id = "source-123"
    source.identifier = "https://example.com/blog"
    source.type = SourceType.BLOG
    source.discovery_strategy = "rss"
    source.feed_url = "https://example.com/feed.xml"
    source.url_pattern = None
    source.consecutive_failures = 0
    return source


class TestSmartBlogAdapterAnalysis:
    async def test_source_type_property(self, adapter: SmartBlogAdapter):
        assert adapter.source_type == "blog"

    async def test_get_feed_url(self, adapter: SmartBlogAdapter):
        result = await adapter.get_feed_url("https://example.com/blog")
        assert result == "https://example.com/blog"

    @respx.mock
    async def test_analyze_site_with_rss(self, adapter: SmartBlogAdapter):
        html = """
        <html><head>
        <link rel="alternate" type="application/rss+xml" href="/feed.xml">
        </head></html>
        """
        rss = """<?xml version="1.0"?>
        <rss version="2.0"><channel>
        <item><title>Post</title><link>https://example.com/post</link></item>
        </channel></rss>
        """

        respx.get("https://example.com/blog").mock(return_value=httpx.Response(200, text=html))
        respx.get("https://example.com/feed.xml").mock(
            return_value=httpx.Response(
                200, text=rss, headers={"content-type": "application/rss+xml"}
            )
        )

        result = await adapter.analyze_site("https://example.com/blog")

        assert result.success is True
        assert result.strategy == "rss"
        assert result.post_count == 1
        assert result.feed_url == "https://example.com/feed.xml"

    @respx.mock
    async def test_analyze_site_with_sitemap(self, adapter: SmartBlogAdapter):
        html = "<html><body>No RSS</body></html>"
        sitemap = """<?xml version="1.0"?>
        <urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
        <url><loc>https://example.com/blog/post-1</loc></url>
        <url><loc>https://example.com/blog/post-2</loc></url>
        </urlset>
        """

        respx.get("https://example.com/blog").mock(return_value=httpx.Response(200, text=html))
        for path in [
            "/feed",
            "/feed.xml",
            "/rss",
            "/rss.xml",
            "/atom.xml",
            "/blog/feed",
            "/blog/rss",
            "/research/feed",
            "/index.xml",
            "/feeds/posts/default",
        ]:
            respx.head(f"https://example.com{path}").mock(return_value=httpx.Response(404))

        respx.get("https://example.com/robots.txt").mock(return_value=httpx.Response(404))
        respx.get("https://example.com/sitemap.xml").mock(
            return_value=httpx.Response(200, text=sitemap)
        )

        result = await adapter.analyze_site("https://example.com/blog")

        assert result.success is True
        assert result.strategy == "sitemap"
        assert result.post_count == 2

    async def test_analyze_site_failure(self, adapter: SmartBlogAdapter):
        with (
            patch.object(adapter._strategies[0], "discover", new_callable=AsyncMock) as mock_rss,
            patch.object(
                adapter._strategies[1], "discover", new_callable=AsyncMock
            ) as mock_sitemap,
            patch.object(adapter._strategies[2], "discover", new_callable=AsyncMock) as mock_llm,
        ):
            mock_rss.return_value = None
            mock_sitemap.return_value = None
            mock_llm.return_value = None

            result = await adapter.analyze_site("https://example.com/")

            assert result.success is False
            assert "Unable to find blog posts" in result.error


class TestSmartBlogAdapterFetchLatest:
    async def test_fetch_latest_source_not_found(self, adapter: SmartBlogAdapter, mock_repository):
        mock_repository.get_source_by_identifier.return_value = None

        result = await adapter.fetch_latest("https://unknown.com/")

        assert result == []

    async def test_fetch_latest_uses_rss_for_rss_strategy(
        self, adapter: SmartBlogAdapter, mock_repository, sample_source
    ):
        mock_repository.get_source_by_identifier.return_value = sample_source

        with patch("intelstream.adapters.rss.RSSAdapter") as MockRSS:
            mock_rss_adapter = MagicMock()
            mock_rss_adapter.fetch_latest = AsyncMock(return_value=[])
            MockRSS.return_value = mock_rss_adapter

            result = await adapter.fetch_latest(sample_source.identifier)

            assert result == []

    async def test_fetch_latest_increments_failure_on_empty_result(
        self, adapter: SmartBlogAdapter, mock_repository, sample_source
    ):
        sample_source.discovery_strategy = "sitemap"
        sample_source.feed_url = None
        mock_repository.get_source_by_identifier.return_value = sample_source

        with patch.object(
            adapter, "_discover_with_fallback", new_callable=AsyncMock
        ) as mock_discover:
            mock_discover.return_value = None

            await adapter.fetch_latest(sample_source.identifier)

            mock_repository.increment_failure_count.assert_called_once_with(sample_source.id)

    async def test_fetch_latest_resets_failure_on_success(
        self, adapter: SmartBlogAdapter, mock_repository, sample_source
    ):
        sample_source.discovery_strategy = "sitemap"
        sample_source.feed_url = None
        mock_repository.get_source_by_identifier.return_value = sample_source
        mock_repository.get_known_urls_for_source.return_value = set()

        discovery_result = DiscoveryResult(
            posts=[DiscoveredPost(url="https://example.com/new", title="New Post")],
        )

        with (
            patch.object(
                adapter, "_discover_with_fallback", new_callable=AsyncMock
            ) as mock_discover,
            patch.object(
                adapter._content_extractor, "extract", new_callable=AsyncMock
            ) as mock_extract,
        ):
            mock_discover.return_value = discovery_result
            mock_extract.return_value = MagicMock(
                text="Content",
                title="New Post",
                author="Author",
                published_at=datetime.now(UTC),
            )

            result = await adapter.fetch_latest(sample_source.identifier)

            mock_repository.reset_failure_count.assert_called()
            assert len(result) == 1

    async def test_fetch_latest_filters_known_urls(
        self, adapter: SmartBlogAdapter, mock_repository, sample_source
    ):
        sample_source.discovery_strategy = "sitemap"
        sample_source.feed_url = None
        mock_repository.get_source_by_identifier.return_value = sample_source

        async def check_exists(url: str) -> bool:
            return url == "https://example.com/old"

        mock_repository.content_item_exists = AsyncMock(side_effect=check_exists)

        discovery_result = DiscoveryResult(
            posts=[
                DiscoveredPost(url="https://example.com/old", title="Old"),
                DiscoveredPost(url="https://example.com/new", title="New"),
            ],
        )

        with (
            patch.object(
                adapter, "_discover_with_fallback", new_callable=AsyncMock
            ) as mock_discover,
            patch.object(
                adapter._content_extractor, "extract", new_callable=AsyncMock
            ) as mock_extract,
        ):
            mock_discover.return_value = discovery_result
            mock_extract.return_value = MagicMock(
                text="Content",
                title="New",
                author="Author",
                published_at=datetime.now(UTC),
            )

            result = await adapter.fetch_latest(sample_source.identifier)

            assert len(result) == 1
            assert result[0].original_url == "https://example.com/new"


class TestSmartBlogAdapterFallback:
    async def test_discover_with_fallback_tries_cached_strategy_first(
        self, adapter: SmartBlogAdapter, sample_source
    ):
        with patch.object(adapter._strategies[0], "discover", new_callable=AsyncMock) as mock_rss:
            mock_rss.return_value = DiscoveryResult(
                posts=[DiscoveredPost(url="https://example.com/post", title="Post")]
            )

            result = await adapter._discover_with_fallback(
                url="https://example.com/",
                cached_strategy="rss",
                url_pattern=None,
                source=sample_source,
            )

            assert result is not None
            mock_rss.assert_called_once()

    async def test_discover_with_fallback_tries_other_strategies(
        self, adapter: SmartBlogAdapter, mock_repository, sample_source
    ):
        with (
            patch.object(adapter._strategies[0], "discover", new_callable=AsyncMock) as mock_rss,
            patch.object(
                adapter._strategies[1], "discover", new_callable=AsyncMock
            ) as mock_sitemap,
        ):
            mock_rss.return_value = None
            mock_sitemap.return_value = DiscoveryResult(
                posts=[DiscoveredPost(url="https://example.com/post", title="Post")]
            )

            result = await adapter._discover_with_fallback(
                url="https://example.com/",
                cached_strategy="rss",
                url_pattern=None,
                source=sample_source,
            )

            assert result is not None
            mock_repository.update_source_discovery_strategy.assert_called_once()

    async def test_get_site_name_extracts_domain(self, adapter: SmartBlogAdapter):
        assert adapter._get_site_name("https://www.example.com/blog") == "Example"
        assert adapter._get_site_name("https://blog.openai.com/") == "Openai"
        assert adapter._get_site_name("https://anthropic.com/research") == "Anthropic"
