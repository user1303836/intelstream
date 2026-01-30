import gzip
import re
from datetime import UTC, datetime
from urllib.parse import urljoin, urlparse
from xml.etree import ElementTree

import httpx
import structlog

from intelstream.adapters.strategies.base import (
    DiscoveredPost,
    DiscoveryResult,
    DiscoveryStrategy,
)
from intelstream.config import get_settings

logger = structlog.get_logger()

MAX_SITEMAP_URLS = 10000
MAX_SUB_SITEMAPS = 10
MAX_COMPRESSED_SIZE = 10 * 1024 * 1024  # 10MB compressed
MAX_DECOMPRESSED_SIZE = 50 * 1024 * 1024  # 50MB decompressed

SITEMAP_PATHS = [
    "/sitemap.xml",
    "/sitemap_index.xml",
    "/sitemap/",
    "/sitemaps/sitemap.xml",
]

BLOG_PATH_PATTERNS = [
    "blog",
    "research",
    "posts",
    "articles",
    "news",
    "updates",
    "insights",
    "announcements",
]

SITEMAP_NS = {
    "sm": "http://www.sitemaps.org/schemas/sitemap/0.9",
}


class SitemapDiscoveryStrategy(DiscoveryStrategy):
    def __init__(self, http_client: httpx.AsyncClient | None = None) -> None:
        self._client = http_client

    @property
    def name(self) -> str:
        return "sitemap"

    async def discover(
        self,
        url: str,
        url_pattern: str | None = None,
    ) -> DiscoveryResult | None:
        parsed = urlparse(url)
        base_url = f"{parsed.scheme}://{parsed.netloc}"

        sitemap_url = await self._find_sitemap(base_url)
        if not sitemap_url:
            logger.debug("No sitemap found", url=url)
            return None

        all_urls = await self._parse_sitemap(sitemap_url)
        if not all_urls:
            return None

        if not url_pattern:
            url_pattern = self._infer_pattern(url, all_urls)

        if not url_pattern:
            logger.debug("Could not infer URL pattern from sitemap", url=url)
            return None

        post_urls = [u for u in all_urls if isinstance(u["url"], str) and url_pattern in u["url"]]
        if not post_urls:
            logger.debug("No URLs match pattern in sitemap", url=url, pattern=url_pattern)
            return None

        posts = []
        for u in post_urls:
            url_str = u["url"]
            lastmod = u.get("lastmod")
            if isinstance(url_str, str):
                published = lastmod if isinstance(lastmod, datetime) else None
                posts.append(DiscoveredPost(url=url_str, title="", published_at=published))

        logger.info(
            "Sitemap discovery successful",
            url=url,
            sitemap_url=sitemap_url,
            pattern=url_pattern,
            post_count=len(posts),
        )

        return DiscoveryResult(posts=posts, url_pattern=url_pattern)

    async def _find_sitemap(self, base_url: str) -> str | None:
        robots_sitemap = await self._check_robots_txt(base_url)
        if robots_sitemap:
            return robots_sitemap

        for path in SITEMAP_PATHS:
            sitemap_url = urljoin(base_url, path)
            if await self._is_valid_sitemap(sitemap_url):
                return sitemap_url

        return None

    async def _check_robots_txt(self, base_url: str) -> str | None:
        robots_url = urljoin(base_url, "/robots.txt")
        try:
            if self._client:
                response = await self._client.get(robots_url, follow_redirects=True)
            else:
                async with httpx.AsyncClient(timeout=get_settings().http_timeout_seconds) as client:
                    response = await client.get(robots_url, follow_redirects=True)

            if response.status_code != 200:
                return None

            for line in response.text.split("\n"):
                line = line.strip()
                if line.lower().startswith("sitemap:"):
                    sitemap_url = line.split(":", 1)[1].strip()
                    return sitemap_url

        except httpx.HTTPError:
            pass

        return None

    async def _is_valid_sitemap(self, url: str) -> bool:
        try:
            if self._client:
                response = await self._client.get(url, follow_redirects=True)
            else:
                async with httpx.AsyncClient(timeout=get_settings().http_timeout_seconds) as client:
                    response = await client.get(url, follow_redirects=True)

            if response.status_code != 200:
                return False

            content = response.text[:500]
            return "<urlset" in content or "<sitemapindex" in content

        except httpx.HTTPError:
            return False

    async def _parse_sitemap(self, sitemap_url: str) -> list[dict[str, str | datetime | None]]:
        try:
            if self._client:
                response = await self._client.get(sitemap_url, follow_redirects=True)
            else:
                async with httpx.AsyncClient(timeout=get_settings().http_timeout_seconds) as client:
                    response = await client.get(sitemap_url, follow_redirects=True)

            response.raise_for_status()

            content = response.content

            if sitemap_url.endswith(".gz") or content[:2] == b"\x1f\x8b":
                if len(content) > MAX_COMPRESSED_SIZE:
                    logger.warning(
                        "Compressed sitemap too large",
                        url=sitemap_url,
                        size=len(content),
                        limit=MAX_COMPRESSED_SIZE,
                    )
                    return []
                content = gzip.decompress(content)
                if len(content) > MAX_DECOMPRESSED_SIZE:
                    logger.warning(
                        "Decompressed sitemap too large",
                        url=sitemap_url,
                        size=len(content),
                        limit=MAX_DECOMPRESSED_SIZE,
                    )
                    return []
                xml_text = content.decode("utf-8")
            else:
                if len(content) > MAX_DECOMPRESSED_SIZE:
                    logger.warning(
                        "Sitemap too large",
                        url=sitemap_url,
                        size=len(content),
                        limit=MAX_DECOMPRESSED_SIZE,
                    )
                    return []
                xml_text = response.text

            root = ElementTree.fromstring(xml_text)

            if root.tag.endswith("sitemapindex"):
                return await self._parse_sitemap_index(root)

            return self._parse_urlset(root)

        except (httpx.HTTPError, ElementTree.ParseError, gzip.BadGzipFile) as e:
            logger.debug("Failed to parse sitemap", url=sitemap_url, error=str(e))
            return []

    async def _parse_sitemap_index(
        self, root: ElementTree.Element
    ) -> list[dict[str, str | datetime | None]]:
        all_urls: list[dict[str, str | datetime | None]] = []
        sitemap_count = 0

        for sitemap in root.findall("sm:sitemap", SITEMAP_NS):
            if sitemap_count >= MAX_SUB_SITEMAPS:
                break
            loc = sitemap.find("sm:loc", SITEMAP_NS)
            if loc is not None and loc.text:
                child_urls = await self._parse_sitemap(loc.text)
                all_urls.extend(child_urls)
                sitemap_count += 1
                if len(all_urls) >= MAX_SITEMAP_URLS:
                    break

        for sitemap in root.findall("sitemap"):
            if sitemap_count >= MAX_SUB_SITEMAPS:
                break
            loc = sitemap.find("loc")
            if loc is not None and loc.text:
                child_urls = await self._parse_sitemap(loc.text)
                all_urls.extend(child_urls)
                sitemap_count += 1
                if len(all_urls) >= MAX_SITEMAP_URLS:
                    break

        return all_urls[:MAX_SITEMAP_URLS]

    def _parse_urlset(self, root: ElementTree.Element) -> list[dict[str, str | datetime | None]]:
        urls: list[dict[str, str | datetime | None]] = []

        for url_elem in root.findall("sm:url", SITEMAP_NS):
            loc = url_elem.find("sm:loc", SITEMAP_NS)
            lastmod_elem = url_elem.find("sm:lastmod", SITEMAP_NS)

            if loc is not None and loc.text:
                lastmod = self._parse_lastmod(
                    lastmod_elem.text if lastmod_elem is not None else None
                )
                urls.append({"url": loc.text, "lastmod": lastmod})

        for url_elem in root.findall("url"):
            loc = url_elem.find("loc")
            lastmod_elem = url_elem.find("lastmod")

            if loc is not None and loc.text:
                lastmod = self._parse_lastmod(
                    lastmod_elem.text if lastmod_elem is not None else None
                )
                urls.append({"url": loc.text, "lastmod": lastmod})

        return urls

    def _parse_lastmod(self, lastmod: str | None) -> datetime | None:
        if not lastmod:
            return None

        formats = [
            "%Y-%m-%dT%H:%M:%S%z",
            "%Y-%m-%dT%H:%M:%SZ",
            "%Y-%m-%dT%H:%M:%S",
            "%Y-%m-%d",
        ]

        lastmod = lastmod.replace("Z", "+00:00")

        for fmt in formats:
            try:
                dt = datetime.strptime(lastmod, fmt)
                if dt.tzinfo is None:
                    dt = dt.replace(tzinfo=UTC)
                return dt
            except ValueError:
                continue

        return None

    def _infer_pattern(
        self, page_url: str, all_urls: list[dict[str, str | datetime | None]]
    ) -> str | None:
        parsed = urlparse(page_url)
        path_parts = parsed.path.strip("/").split("/")

        for part in path_parts:
            if part.lower() in BLOG_PATH_PATTERNS:
                return f"/{part}/"

        url_strings = [u["url"] for u in all_urls if isinstance(u["url"], str)]
        for pattern in BLOG_PATH_PATTERNS:
            pattern_urls = [u for u in url_strings if f"/{pattern}/" in u.lower()]
            if len(pattern_urls) >= 2:
                for u in url_strings:
                    if f"/{pattern}/" in u.lower():
                        match = re.search(rf"/({pattern})/", u, re.IGNORECASE)
                        if match:
                            return f"/{match.group(1)}/"

        return None
