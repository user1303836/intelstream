import gzip
from unittest.mock import patch

import httpx
import pytest
import respx

from intelstream.adapters.strategies import sitemap_discovery
from intelstream.adapters.strategies.sitemap_discovery import SitemapDiscoveryStrategy


@pytest.fixture
def sitemap_strategy():
    return SitemapDiscoveryStrategy()


class TestSitemapDiscoveryStrategy:
    async def test_name_property(self, sitemap_strategy: SitemapDiscoveryStrategy):
        assert sitemap_strategy.name == "sitemap"

    @respx.mock
    async def test_discover_with_sitemap(self, sitemap_strategy: SitemapDiscoveryStrategy):
        sitemap = """<?xml version="1.0"?>
        <urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
            <url>
                <loc>https://example.com/blog/post-1</loc>
                <lastmod>2024-01-15</lastmod>
            </url>
            <url>
                <loc>https://example.com/blog/post-2</loc>
                <lastmod>2024-01-10</lastmod>
            </url>
            <url>
                <loc>https://example.com/about</loc>
            </url>
        </urlset>
        """

        respx.get("https://example.com/robots.txt").mock(return_value=httpx.Response(404))
        respx.get("https://example.com/sitemap.xml").mock(
            return_value=httpx.Response(200, text=sitemap)
        )

        result = await sitemap_strategy.discover("https://example.com/blog")

        assert result is not None
        assert result.url_pattern == "/blog/"
        assert len(result.posts) == 2
        assert result.posts[0].url == "https://example.com/blog/post-1"

    @respx.mock
    async def test_discover_with_robots_txt_sitemap(
        self, sitemap_strategy: SitemapDiscoveryStrategy
    ):
        robots_txt = """
        User-agent: *
        Disallow: /private/
        Sitemap: https://example.com/my-sitemap.xml
        """
        sitemap = """<?xml version="1.0"?>
        <urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
            <url><loc>https://example.com/research/paper-1</loc></url>
        </urlset>
        """

        respx.get("https://example.com/robots.txt").mock(
            return_value=httpx.Response(200, text=robots_txt)
        )
        respx.get("https://example.com/my-sitemap.xml").mock(
            return_value=httpx.Response(200, text=sitemap)
        )

        result = await sitemap_strategy.discover("https://example.com/research")

        assert result is not None
        assert len(result.posts) == 1

    @respx.mock
    async def test_discover_with_gzipped_sitemap(self, sitemap_strategy: SitemapDiscoveryStrategy):
        sitemap = """<?xml version="1.0"?>
        <urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
            <url><loc>https://example.com/blog/gzip-post</loc></url>
        </urlset>
        """
        gzipped = gzip.compress(sitemap.encode())

        respx.get("https://example.com/robots.txt").mock(return_value=httpx.Response(404))
        respx.get("https://example.com/sitemap.xml").mock(return_value=httpx.Response(404))
        respx.get("https://example.com/sitemap_index.xml").mock(return_value=httpx.Response(404))
        respx.get("https://example.com/sitemap/").mock(return_value=httpx.Response(404))
        respx.get("https://example.com/sitemaps/sitemap.xml").mock(return_value=httpx.Response(404))
        respx.get("https://example.com/sitemap.xml.gz").mock(
            return_value=httpx.Response(200, content=gzipped)
        )

        result = await sitemap_strategy.discover("https://example.com/blog", url_pattern="/blog/")

        assert result is None

    @respx.mock
    async def test_discover_with_sitemap_index(self, sitemap_strategy: SitemapDiscoveryStrategy):
        sitemap_index = """<?xml version="1.0"?>
        <sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
            <sitemap>
                <loc>https://example.com/sitemap-posts.xml</loc>
            </sitemap>
        </sitemapindex>
        """
        posts_sitemap = """<?xml version="1.0"?>
        <urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
            <url><loc>https://example.com/articles/first</loc></url>
            <url><loc>https://example.com/articles/second</loc></url>
        </urlset>
        """

        respx.get("https://example.com/robots.txt").mock(return_value=httpx.Response(404))
        respx.get("https://example.com/sitemap.xml").mock(
            return_value=httpx.Response(200, text=sitemap_index)
        )
        respx.get("https://example.com/sitemap-posts.xml").mock(
            return_value=httpx.Response(200, text=posts_sitemap)
        )

        result = await sitemap_strategy.discover("https://example.com/articles")

        assert result is not None
        assert len(result.posts) == 2

    @respx.mock
    async def test_discover_returns_none_when_no_sitemap(
        self, sitemap_strategy: SitemapDiscoveryStrategy
    ):
        respx.get("https://example.com/robots.txt").mock(return_value=httpx.Response(404))
        respx.get("https://example.com/sitemap.xml").mock(return_value=httpx.Response(404))
        respx.get("https://example.com/sitemap_index.xml").mock(return_value=httpx.Response(404))
        respx.get("https://example.com/sitemap/").mock(return_value=httpx.Response(404))
        respx.get("https://example.com/sitemaps/sitemap.xml").mock(return_value=httpx.Response(404))

        result = await sitemap_strategy.discover("https://example.com/")

        assert result is None

    @respx.mock
    async def test_discover_infers_pattern_from_url(
        self, sitemap_strategy: SitemapDiscoveryStrategy
    ):
        sitemap = """<?xml version="1.0"?>
        <urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
            <url><loc>https://example.com/news/item-1</loc></url>
            <url><loc>https://example.com/news/item-2</loc></url>
            <url><loc>https://example.com/about</loc></url>
        </urlset>
        """

        respx.get("https://example.com/robots.txt").mock(return_value=httpx.Response(404))
        respx.get("https://example.com/sitemap.xml").mock(
            return_value=httpx.Response(200, text=sitemap)
        )

        result = await sitemap_strategy.discover("https://example.com/news")

        assert result is not None
        assert result.url_pattern == "/news/"
        assert len(result.posts) == 2

    @respx.mock
    async def test_discover_uses_provided_pattern(self, sitemap_strategy: SitemapDiscoveryStrategy):
        sitemap = """<?xml version="1.0"?>
        <urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
            <url><loc>https://example.com/posts/a</loc></url>
            <url><loc>https://example.com/updates/b</loc></url>
        </urlset>
        """

        respx.get("https://example.com/robots.txt").mock(return_value=httpx.Response(404))
        respx.get("https://example.com/sitemap.xml").mock(
            return_value=httpx.Response(200, text=sitemap)
        )

        result = await sitemap_strategy.discover("https://example.com/", url_pattern="/updates/")

        assert result is not None
        assert len(result.posts) == 1
        assert result.posts[0].url == "https://example.com/updates/b"

    @respx.mock
    async def test_discover_handles_no_matching_pattern(
        self, sitemap_strategy: SitemapDiscoveryStrategy
    ):
        sitemap = """<?xml version="1.0"?>
        <urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
            <url><loc>https://example.com/page1</loc></url>
            <url><loc>https://example.com/page2</loc></url>
        </urlset>
        """

        respx.get("https://example.com/robots.txt").mock(return_value=httpx.Response(404))
        respx.get("https://example.com/sitemap.xml").mock(
            return_value=httpx.Response(200, text=sitemap)
        )

        result = await sitemap_strategy.discover("https://example.com/random-path")

        assert result is None

    @respx.mock
    async def test_rejects_oversized_compressed_sitemap(
        self, sitemap_strategy: SitemapDiscoveryStrategy
    ):
        small_xml = """<?xml version="1.0"?>
        <urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
            <url><loc>https://example.com/blog/post</loc></url>
        </urlset>
        """
        gzipped = gzip.compress(small_xml.encode())

        respx.get("https://example.com/robots.txt").mock(return_value=httpx.Response(404))
        respx.get("https://example.com/sitemap.xml").mock(
            return_value=httpx.Response(200, content=gzipped)
        )
        respx.get("https://example.com/sitemap_index.xml").mock(return_value=httpx.Response(404))
        respx.get("https://example.com/sitemap/").mock(return_value=httpx.Response(404))
        respx.get("https://example.com/sitemaps/sitemap.xml").mock(return_value=httpx.Response(404))

        with patch.object(sitemap_discovery, "MAX_COMPRESSED_SIZE", 100):
            result = await sitemap_strategy.discover(
                "https://example.com/blog", url_pattern="/blog/"
            )

        assert result is None

    @respx.mock
    async def test_rejects_oversized_decompressed_sitemap(
        self, sitemap_strategy: SitemapDiscoveryStrategy
    ):
        small_xml = """<?xml version="1.0"?>
        <urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
            <url><loc>https://example.com/blog/post</loc></url>
        </urlset>
        """
        gzipped = gzip.compress(small_xml.encode())

        respx.get("https://example.com/robots.txt").mock(return_value=httpx.Response(404))
        respx.get("https://example.com/sitemap.xml").mock(
            return_value=httpx.Response(200, content=gzipped)
        )
        respx.get("https://example.com/sitemap_index.xml").mock(return_value=httpx.Response(404))
        respx.get("https://example.com/sitemap/").mock(return_value=httpx.Response(404))
        respx.get("https://example.com/sitemaps/sitemap.xml").mock(return_value=httpx.Response(404))

        with patch.object(sitemap_discovery, "MAX_DECOMPRESSED_SIZE", 100):
            result = await sitemap_strategy.discover(
                "https://example.com/blog", url_pattern="/blog/"
            )

        assert result is None

    @respx.mock
    async def test_rejects_oversized_uncompressed_sitemap(
        self, sitemap_strategy: SitemapDiscoveryStrategy
    ):
        large_xml = """<?xml version="1.0"?>
        <urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
            <url><loc>https://example.com/blog/post</loc></url>
        </urlset>
        """

        respx.get("https://example.com/robots.txt").mock(return_value=httpx.Response(404))
        respx.get("https://example.com/sitemap.xml").mock(
            return_value=httpx.Response(200, text=large_xml)
        )
        respx.get("https://example.com/sitemap_index.xml").mock(return_value=httpx.Response(404))
        respx.get("https://example.com/sitemap/").mock(return_value=httpx.Response(404))
        respx.get("https://example.com/sitemaps/sitemap.xml").mock(return_value=httpx.Response(404))

        with patch.object(sitemap_discovery, "MAX_DECOMPRESSED_SIZE", 100):
            result = await sitemap_strategy.discover(
                "https://example.com/blog", url_pattern="/blog/"
            )

        assert result is None

    @respx.mock
    async def test_accepts_large_uncompressed_sitemap_under_limit(
        self, sitemap_strategy: SitemapDiscoveryStrategy
    ):
        """Verify uncompressed sitemaps between MAX_COMPRESSED_SIZE and MAX_DECOMPRESSED_SIZE are accepted."""
        xml = """<?xml version="1.0"?>
        <urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
            <url><loc>https://example.com/blog/post</loc></url>
        </urlset>
        """

        respx.get("https://example.com/robots.txt").mock(return_value=httpx.Response(404))
        respx.get("https://example.com/sitemap.xml").mock(
            return_value=httpx.Response(200, text=xml)
        )

        with (
            patch.object(sitemap_discovery, "MAX_COMPRESSED_SIZE", 100),
            patch.object(sitemap_discovery, "MAX_DECOMPRESSED_SIZE", 10000),
        ):
            result = await sitemap_strategy.discover(
                "https://example.com/blog", url_pattern="/blog/"
            )

        assert result is not None
        assert len(result.posts) == 1
        assert result.posts[0].url == "https://example.com/blog/post"
