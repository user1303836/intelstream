from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

import httpx
import pytest
import respx

from intelstream.adapters.strategies.rss_discovery import RSSDiscoveryStrategy
from intelstream.utils.url_validation import SSRFError


@pytest.fixture(autouse=True)
def adapt_legacy_http_client_mocks():
    async def request(client, method, url, **kwargs):
        kwargs.pop("validate_ssrf", None)
        kwargs.pop("max_response_bytes", None)
        kwargs.pop("max_redirects", None)
        return await getattr(client, method.lower())(url, follow_redirects=False, **kwargs)

    with patch("intelstream.adapters.strategies.rss_discovery.safe_request", side_effect=request):
        yield


@pytest.fixture
def rss_strategy():
    return RSSDiscoveryStrategy()


class TestRSSDiscoveryStrategy:
    async def test_name_property(self, rss_strategy: RSSDiscoveryStrategy):
        assert rss_strategy.name == "rss"

    @respx.mock
    async def test_discover_with_rss_link_in_html(self, rss_strategy: RSSDiscoveryStrategy):
        html = """
        <html>
        <head>
            <link rel="alternate" type="application/rss+xml" href="/feed.xml">
        </head>
        <body><h1>Blog</h1></body>
        </html>
        """
        rss_content = """<?xml version="1.0"?>
        <rss version="2.0">
            <channel>
                <title>Test Blog</title>
                <item>
                    <title>Post 1</title>
                    <link>https://example.com/post-1</link>
                    <pubDate>Mon, 15 Jan 2024 12:00:00 GMT</pubDate>
                </item>
            </channel>
        </rss>
        """

        respx.get("https://example.com/blog").mock(return_value=httpx.Response(200, text=html))
        respx.get("https://example.com/feed.xml").mock(
            return_value=httpx.Response(
                200,
                text=rss_content,
                headers={"content-type": "application/rss+xml"},
            )
        )

        result = await rss_strategy.discover("https://example.com/blog")

        assert result is not None
        assert result.feed_url == "https://example.com/feed.xml"
        assert len(result.posts) == 1
        assert result.posts[0].url == "https://example.com/post-1"
        assert result.posts[0].title == "Post 1"

    @respx.mock
    async def test_discover_probes_common_paths(self, rss_strategy: RSSDiscoveryStrategy):
        html = "<html><body>No RSS link</body></html>"
        rss_content = """<?xml version="1.0"?>
        <rss version="2.0">
            <channel>
                <item>
                    <title>Found via probe</title>
                    <link>https://example.com/found</link>
                </item>
            </channel>
        </rss>
        """

        respx.get("https://example.com/blog").mock(return_value=httpx.Response(200, text=html))
        respx.head("https://example.com/feed").mock(
            return_value=httpx.Response(
                200,
                headers={"content-type": "application/rss+xml"},
            )
        )
        respx.get("https://example.com/feed").mock(
            return_value=httpx.Response(
                200,
                text=rss_content,
                headers={"content-type": "application/rss+xml"},
            )
        )

        result = await rss_strategy.discover("https://example.com/blog")

        assert result is not None
        assert result.feed_url == "https://example.com/feed"
        assert len(result.posts) == 1

    @respx.mock
    async def test_discover_returns_none_when_no_rss(self, rss_strategy: RSSDiscoveryStrategy):
        html = "<html><body>No RSS anywhere</body></html>"

        respx.get("https://example.com/").mock(return_value=httpx.Response(200, text=html))

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

        result = await rss_strategy.discover("https://example.com/")

        assert result is None

    @respx.mock
    async def test_discover_validates_feed_has_entries(self, rss_strategy: RSSDiscoveryStrategy):
        html = """
        <html>
        <head>
            <link rel="alternate" type="application/rss+xml" href="/feed.xml">
        </head>
        </html>
        """
        empty_rss = """<?xml version="1.0"?>
        <rss version="2.0">
            <channel>
                <title>Empty Blog</title>
            </channel>
        </rss>
        """

        respx.get("https://example.com/").mock(return_value=httpx.Response(200, text=html))
        respx.get("https://example.com/feed.xml").mock(
            return_value=httpx.Response(
                200,
                text=empty_rss,
                headers={"content-type": "application/rss+xml"},
            )
        )

        for path in [
            "/feed",
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

        result = await rss_strategy.discover("https://example.com/")

        assert result is None

    @respx.mock
    async def test_discover_parses_atom_feed(self, rss_strategy: RSSDiscoveryStrategy):
        html = """
        <html>
        <head>
            <link rel="alternate" type="application/atom+xml" href="/atom.xml">
        </head>
        </html>
        """
        atom_content = """<?xml version="1.0"?>
        <feed xmlns="http://www.w3.org/2005/Atom">
            <title>Atom Blog</title>
            <entry>
                <title>Atom Post</title>
                <link href="https://example.com/atom-post"/>
                <updated>2024-01-15T12:00:00Z</updated>
            </entry>
        </feed>
        """

        respx.get("https://example.com/").mock(return_value=httpx.Response(200, text=html))
        respx.get("https://example.com/atom.xml").mock(
            return_value=httpx.Response(
                200,
                text=atom_content,
                headers={"content-type": "application/atom+xml"},
            )
        )

        result = await rss_strategy.discover("https://example.com/")

        assert result is not None
        assert len(result.posts) == 1
        assert result.posts[0].title == "Atom Post"

    @respx.mock
    async def test_discover_handles_network_error(self, rss_strategy: RSSDiscoveryStrategy):
        respx.get("https://example.com/").mock(side_effect=httpx.ConnectError("Network error"))

        result = await rss_strategy.discover("https://example.com/")

        assert result is None

    async def test_fetch_html_uses_injected_client_and_handles_http_error(self):
        client = MagicMock()
        client.get = AsyncMock(side_effect=httpx.ConnectError("offline"))
        strategy = RSSDiscoveryStrategy(http_client=client)

        result = await strategy._fetch_html("https://example.com")

        assert result is None
        client.get.assert_awaited_once()

    async def test_find_rss_in_html_skips_ssrf_blocked_links(self, rss_strategy):
        html = """
        <html><head>
          <link rel="alternate" type="application/rss+xml" href="http://127.0.0.1/rss">
          <link rel="feed" href="/safe-feed.xml">
        </head></html>
        """

        with patch(
            "intelstream.adapters.strategies.rss_discovery.async_validate_url_for_ssrf",
            side_effect=[SSRFError("blocked"), None],
        ):
            result = await rss_strategy._find_rss_in_html(html, "https://example.com")

        assert result == "https://example.com/safe-feed.xml"

    async def test_find_rss_in_html_skips_irrelevant_missing_and_blocked_links(self, rss_strategy):
        html = """
        <html><head>
          <link rel="alternate" type="text/html" href="/not-a-feed">
          <link rel="alternate" type="application/rss+xml">
          <link rel="feed">
          <link rel="feed" href="http://127.0.0.1/rss">
          <link rel="feed" href="/safe-feed.xml">
        </head></html>
        """

        with patch(
            "intelstream.adapters.strategies.rss_discovery.async_validate_url_for_ssrf",
            side_effect=[SSRFError("blocked"), None],
        ):
            result = await rss_strategy._find_rss_in_html(html, "https://example.com")

        assert result == "https://example.com/safe-feed.xml"

    async def test_probe_rss_paths_accepts_feed_validated_by_body(self):
        client = MagicMock()
        client.head = AsyncMock(
            return_value=httpx.Response(200, headers={"content-type": "text/html"})
        )
        strategy = RSSDiscoveryStrategy(http_client=client)
        strategy._is_valid_feed = AsyncMock(return_value=True)

        result = await strategy._probe_rss_paths("https://example.com")

        assert result == "https://example.com/feed"
        strategy._is_valid_feed.assert_awaited_once_with("https://example.com/feed")

    async def test_probe_rss_paths_rejects_200_non_feed_responses(self):
        client = MagicMock()
        client.head = AsyncMock(
            return_value=httpx.Response(200, headers={"content-type": "text/html"})
        )
        strategy = RSSDiscoveryStrategy(http_client=client)
        strategy._is_valid_feed = AsyncMock(return_value=False)

        result = await strategy._probe_rss_paths("https://example.com")

        assert result is None
        assert client.head.await_count == 10
        assert strategy._is_valid_feed.await_count == 10

    async def test_probe_rss_paths_ignores_http_errors(self):
        client = MagicMock()
        client.head = AsyncMock(side_effect=httpx.ReadTimeout("timeout"))
        strategy = RSSDiscoveryStrategy(http_client=client)

        result = await strategy._probe_rss_paths("https://example.com")

        assert result is None
        assert client.head.await_count == 10

    async def test_is_valid_feed_rejects_bad_status_and_content_type(self):
        client = MagicMock()
        client.get = AsyncMock(
            side_effect=[
                httpx.Response(404, text="missing"),
                httpx.Response(200, text="<rss></rss>", headers={"content-type": "text/html"}),
            ]
        )
        strategy = RSSDiscoveryStrategy(http_client=client)

        assert await strategy._is_valid_feed("https://example.com/feed") is False
        assert await strategy._is_valid_feed("https://example.com/feed") is False

    @respx.mock
    async def test_is_valid_feed_with_default_client_accepts_feed_with_entries(self):
        rss_content = """<?xml version="1.0"?>
        <rss version="2.0">
          <channel>
            <item>
              <title>Post</title>
              <link>https://example.com/post</link>
            </item>
          </channel>
        </rss>
        """
        respx.get("https://example.com/feed").mock(
            return_value=httpx.Response(
                200,
                text=rss_content,
                headers={"content-type": "text/xml"},
            )
        )
        strategy = RSSDiscoveryStrategy()

        assert await strategy._is_valid_feed("https://example.com/feed") is True

    async def test_is_valid_feed_handles_http_error(self):
        client = MagicMock()
        client.get = AsyncMock(side_effect=httpx.ConnectError("offline"))
        strategy = RSSDiscoveryStrategy(http_client=client)

        assert await strategy._is_valid_feed("https://example.com/feed") is False

    async def test_parse_feed_returns_none_for_bozo_feed_without_entries(self):
        client = MagicMock()
        client.get = AsyncMock(
            return_value=httpx.Response(
                200,
                text="<rss><channel><item>",
                request=httpx.Request("GET", "https://example.com/feed"),
            )
        )
        strategy = RSSDiscoveryStrategy(http_client=client)

        with patch(
            "intelstream.adapters.strategies.rss_discovery.feedparser.parse",
            return_value=SimpleNamespace(bozo=True, entries=[]),
        ):
            assert await strategy._parse_feed("https://example.com/feed") is None

    async def test_parse_feed_skips_entries_without_links(self):
        rss_content = """<?xml version="1.0"?>
        <rss version="2.0">
          <channel>
            <item><title>No link</title></item>
          </channel>
        </rss>
        """
        client = MagicMock()
        client.get = AsyncMock(
            return_value=httpx.Response(
                200,
                text=rss_content,
                request=httpx.Request("GET", "https://example.com/feed"),
            )
        )
        strategy = RSSDiscoveryStrategy(http_client=client)

        assert await strategy._parse_feed("https://example.com/feed") is None

    async def test_parse_feed_handles_http_error(self):
        client = MagicMock()
        client.get = AsyncMock(side_effect=httpx.ConnectError("offline"))
        strategy = RSSDiscoveryStrategy(http_client=client)

        assert await strategy._parse_feed("https://example.com/feed") is None
