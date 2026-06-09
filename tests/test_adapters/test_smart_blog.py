from datetime import UTC, datetime
from unittest.mock import AsyncMock, MagicMock, patch

import httpx
import pytest
import respx

from intelstream.adapters.base import ContentData
from intelstream.adapters.smart_blog import UNKNOWN_DATE, AnalysisResult, SmartBlogAdapter
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

    async def test_analyze_site_continues_after_strategy_exception(self, adapter: SmartBlogAdapter):
        with (
            patch.object(adapter._strategies[0], "discover", new_callable=AsyncMock) as mock_rss,
            patch.object(
                adapter._strategies[1], "discover", new_callable=AsyncMock
            ) as mock_sitemap,
        ):
            mock_rss.side_effect = RuntimeError("rss failed")
            mock_sitemap.return_value = DiscoveryResult(
                posts=[
                    DiscoveredPost(url="https://example.com/post-1", title="Post 1"),
                    DiscoveredPost(url="https://example.com/post-2", title="Post 2"),
                ],
                url_pattern="/post-*",
            )

            result = await adapter.analyze_site("https://example.com/")

            assert result.success is True
            assert result.strategy == "sitemap"
            assert result.sample_posts == [
                "https://example.com/post-1",
                "https://example.com/post-2",
            ]


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

    async def test_fetch_latest_rss_success_resets_failure_count(
        self, adapter: SmartBlogAdapter, mock_repository, sample_source
    ):
        mock_repository.get_source_by_identifier.return_value = sample_source
        item = ContentData(
            external_id="post",
            title="Post",
            original_url="https://example.com/post",
            author="Author",
            published_at=datetime(2024, 1, 1, tzinfo=UTC),
        )

        with patch("intelstream.adapters.rss.RSSAdapter") as MockRSS:
            mock_rss_adapter = MagicMock()
            mock_rss_adapter.fetch_latest = AsyncMock(return_value=[item])
            MockRSS.return_value = mock_rss_adapter

            result = await adapter.fetch_latest(sample_source.identifier)

        assert result == [item]
        mock_repository.reset_failure_count.assert_awaited_with(sample_source.id)

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

    async def test_fetch_latest_reanalyzes_after_failure_threshold(
        self, adapter: SmartBlogAdapter, mock_repository, sample_source
    ):
        sample_source.discovery_strategy = "sitemap"
        sample_source.feed_url = None
        mock_repository.get_source_by_identifier.return_value = sample_source
        mock_repository.increment_failure_count.return_value = 3
        settings = MagicMock()
        settings.max_consecutive_failures = 3

        with (
            patch.object(adapter, "_discover_with_fallback", new_callable=AsyncMock) as discover,
            patch.object(adapter, "analyze_site", new_callable=AsyncMock) as analyze,
            patch("intelstream.adapters.smart_blog.get_settings", return_value=settings),
        ):
            discover.return_value = None
            analyze.return_value = AnalysisResult(
                success=True,
                strategy="rss",
                feed_url="https://example.com/feed",
                url_pattern=None,
            )

            assert await adapter.fetch_latest(sample_source.identifier) == []

        mock_repository.update_source_discovery_strategy.assert_awaited_once_with(
            source_id=sample_source.id,
            discovery_strategy="rss",
            feed_url="https://example.com/feed",
            url_pattern=None,
        )
        mock_repository.reset_failure_count.assert_awaited_with(sample_source.id)

    async def test_fetch_latest_reanalysis_failure_does_not_update_strategy(
        self, adapter: SmartBlogAdapter, mock_repository, sample_source
    ):
        sample_source.discovery_strategy = "sitemap"
        sample_source.feed_url = None
        mock_repository.get_source_by_identifier.return_value = sample_source
        mock_repository.increment_failure_count.return_value = 3
        settings = MagicMock()
        settings.max_consecutive_failures = 3

        with (
            patch.object(adapter, "_discover_with_fallback", new_callable=AsyncMock) as discover,
            patch.object(adapter, "analyze_site", new_callable=AsyncMock) as analyze,
            patch("intelstream.adapters.smart_blog.get_settings", return_value=settings),
        ):
            discover.return_value = DiscoveryResult(posts=[])
            analyze.return_value = AnalysisResult(success=False, error="no posts")

            assert await adapter.fetch_latest(sample_source.identifier) == []

        mock_repository.update_source_discovery_strategy.assert_not_called()

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

    async def test_fetch_latest_returns_empty_when_all_posts_known(
        self, adapter: SmartBlogAdapter, mock_repository, sample_source
    ):
        sample_source.discovery_strategy = "sitemap"
        sample_source.feed_url = None
        mock_repository.get_source_by_identifier.return_value = sample_source
        mock_repository.content_item_exists = AsyncMock(return_value=True)
        discovery_result = DiscoveryResult(
            posts=[DiscoveredPost(url="https://example.com/old", title="Old")]
        )

        with patch.object(
            adapter, "_discover_with_fallback", new_callable=AsyncMock
        ) as mock_discover:
            mock_discover.return_value = discovery_result

            assert await adapter.fetch_latest(sample_source.identifier) == []

    async def test_fetch_latest_uses_extraction_fallbacks_and_skips_failed_posts(
        self, adapter: SmartBlogAdapter, mock_repository, sample_source
    ):
        sample_source.discovery_strategy = "sitemap"
        sample_source.feed_url = None
        sample_source.identifier = "https://www.example.com/blog"
        mock_repository.get_source_by_identifier.return_value = sample_source
        discovery_result = DiscoveryResult(
            posts=[
                DiscoveredPost(url="https://example.com/fail", title="Fail"),
                DiscoveredPost(url="https://example.com/ok", title=None, published_at=None),
            ]
        )
        extracted = MagicMock(text="", title="", author="", published_at=None)

        with (
            patch.object(
                adapter, "_discover_with_fallback", new_callable=AsyncMock
            ) as mock_discover,
            patch.object(
                adapter._content_extractor, "extract", new_callable=AsyncMock
            ) as mock_extract,
        ):
            mock_discover.return_value = discovery_result
            mock_extract.side_effect = [RuntimeError("extract failed"), extracted]

            result = await adapter.fetch_latest(sample_source.identifier)

        assert len(result) == 1
        assert result[0].title == "Untitled"
        assert result[0].author == "Example"
        assert result[0].published_at == UNKNOWN_DATE
        assert result[0].raw_content is None


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

    async def test_discover_with_fallback_without_cached_strategy_uses_first_success(
        self, adapter: SmartBlogAdapter, mock_repository, sample_source
    ):
        with patch.object(adapter._strategies[0], "discover", new_callable=AsyncMock) as mock_rss:
            mock_rss.return_value = DiscoveryResult(
                posts=[DiscoveredPost(url="https://example.com/post", title="Post")],
                feed_url="https://example.com/feed",
            )

            result = await adapter._discover_with_fallback(
                url="https://example.com/",
                cached_strategy=None,
                url_pattern=None,
                source=sample_source,
            )

        assert result is not None
        mock_repository.update_source_discovery_strategy.assert_awaited_once_with(
            source_id=sample_source.id,
            discovery_strategy="rss",
            feed_url="https://example.com/feed",
            url_pattern=None,
        )

    async def test_discover_with_fallback_ignores_unknown_cached_strategy(
        self, adapter: SmartBlogAdapter, mock_repository, sample_source
    ):
        with patch.object(adapter._strategies[0], "discover", new_callable=AsyncMock) as mock_rss:
            mock_rss.return_value = DiscoveryResult(
                posts=[DiscoveredPost(url="https://example.com/post", title="Post")]
            )

            result = await adapter._discover_with_fallback(
                url="https://example.com/",
                cached_strategy="missing",
                url_pattern="/posts/*",
                source=sample_source,
            )

        assert result is not None
        mock_rss.assert_awaited_once_with("https://example.com/", url_pattern="/posts/*")
        mock_repository.update_source_discovery_strategy.assert_awaited_once()

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

    async def test_discover_with_fallback_continues_after_cached_strategy_error(
        self, adapter: SmartBlogAdapter, mock_repository, sample_source
    ):
        with (
            patch.object(adapter._strategies[0], "discover", new_callable=AsyncMock) as mock_rss,
            patch.object(
                adapter._strategies[1], "discover", new_callable=AsyncMock
            ) as mock_sitemap,
        ):
            mock_rss.side_effect = RuntimeError("rss failed")
            mock_sitemap.return_value = DiscoveryResult(
                posts=[DiscoveredPost(url="https://example.com/post", title="Post")]
            )

            result = await adapter._discover_with_fallback(
                url="https://example.com/",
                cached_strategy="rss",
                url_pattern="/posts/*",
                source=sample_source,
            )

        assert result is not None
        mock_sitemap.assert_awaited_once_with("https://example.com/", url_pattern="/posts/*")
        mock_repository.update_source_discovery_strategy.assert_awaited_once()

    async def test_discover_with_fallback_returns_none_after_empty_and_failed_strategies(
        self, adapter: SmartBlogAdapter, mock_repository, sample_source
    ):
        with (
            patch.object(adapter._strategies[0], "discover", new_callable=AsyncMock) as mock_rss,
            patch.object(
                adapter._strategies[1], "discover", new_callable=AsyncMock
            ) as mock_sitemap,
            patch.object(adapter._strategies[2], "discover", new_callable=AsyncMock) as mock_llm,
        ):
            mock_rss.return_value = DiscoveryResult(posts=[])
            mock_sitemap.return_value = None
            mock_llm.side_effect = RuntimeError("llm failed")

            result = await adapter._discover_with_fallback(
                url="https://example.com/",
                cached_strategy="rss",
                url_pattern=None,
                source=sample_source,
            )

        assert result is None
        mock_repository.update_source_discovery_strategy.assert_not_called()

    async def test_discover_with_fallback_can_return_without_strategy_update(
        self, adapter: SmartBlogAdapter, mock_repository, sample_source
    ):
        strategy = MagicMock()
        strategy.name = None
        strategy.discover = AsyncMock(
            return_value=DiscoveryResult(
                posts=[DiscoveredPost(url="https://example.com/post", title="Post")]
            )
        )
        adapter._strategies = [strategy]

        result = await adapter._discover_with_fallback(
            url="https://example.com/",
            cached_strategy=None,
            url_pattern=None,
            source=sample_source,
        )

        assert result is not None
        mock_repository.update_source_discovery_strategy.assert_not_called()

    def test_get_strategy_by_name_returns_none_for_unknown(self, adapter: SmartBlogAdapter):
        assert adapter._get_strategy_by_name("missing") is None

    async def test_get_site_name_extracts_domain(self, adapter: SmartBlogAdapter):
        assert adapter._get_site_name("https://www.example.com/blog") == "Example"
        assert adapter._get_site_name("https://blog.openai.com/") == "Openai"
        assert adapter._get_site_name("https://anthropic.com/research") == "Anthropic"
        assert adapter._get_site_name("http://localhost") == "Localhost"
