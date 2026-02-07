import httpx
import pytest
import respx

from intelstream.adapters.strategies.rss_discovery import RSSDiscoveryStrategy


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
        for path in [
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
