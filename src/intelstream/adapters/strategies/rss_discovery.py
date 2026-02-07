import asyncio
import re
from urllib.parse import urljoin, urlparse

import feedparser
import httpx
import structlog
from bs4 import BeautifulSoup

from intelstream.adapters.strategies.base import (
    DiscoveredPost,
    DiscoveryResult,
    DiscoveryStrategy,
)
from intelstream.config import get_settings
from intelstream.utils.feed_utils import parse_feed_date
from intelstream.utils.url_validation import SSRFError, validate_url_for_ssrf

logger = structlog.get_logger()

RSS_PATHS = [
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
]


class RSSDiscoveryStrategy(DiscoveryStrategy):
    def __init__(self, http_client: httpx.AsyncClient | None = None) -> None:
        self._client = http_client

    @property
    def name(self) -> str:
        return "rss"

    async def discover(
        self,
        url: str,
        url_pattern: str | None = None,  # noqa: ARG002
    ) -> DiscoveryResult | None:
        parsed = urlparse(url)
        base_url = f"{parsed.scheme}://{parsed.netloc}"

        html = await self._fetch_html(url)
        if not html:
            return None

        rss_url = self._find_rss_in_html(html, base_url)

        if not rss_url:
            rss_url = await self._probe_rss_paths(base_url)

        if not rss_url:
            logger.debug("No RSS feed found", url=url)
            return None

        posts = await self._parse_feed(rss_url)
        if not posts:
            return None

        logger.info("RSS feed discovered", url=url, rss_url=rss_url, post_count=len(posts))
        return DiscoveryResult(posts=posts, feed_url=rss_url)

    async def _fetch_html(self, url: str) -> str | None:
        headers = {
            "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36"
        }
        try:
            if self._client:
                response = await self._client.get(url, headers=headers, follow_redirects=True)
            else:
                async with httpx.AsyncClient(timeout=get_settings().http_timeout_seconds) as client:
                    response = await client.get(url, headers=headers, follow_redirects=True)
            response.raise_for_status()
            return response.text
        except httpx.HTTPError as e:
            logger.debug("Failed to fetch HTML", url=url, error=str(e))
            return None

    def _find_rss_in_html(self, html: str, base_url: str) -> str | None:
        soup = BeautifulSoup(html, "lxml")

        for link in soup.find_all("link", rel="alternate"):
            link_type = str(link.get("type", ""))
            if "rss" in link_type or "atom" in link_type:
                href = link.get("href")
                if href:
                    feed_url = urljoin(base_url, str(href))
                    try:
                        validate_url_for_ssrf(feed_url)
                        return feed_url
                    except SSRFError:
                        logger.warning("Skipping RSS URL blocked by SSRF protection", url=feed_url)
                        continue

        for link in soup.find_all("link", rel=re.compile(r"feed", re.IGNORECASE)):
            href = link.get("href")
            if href:
                feed_url = urljoin(base_url, str(href))
                try:
                    validate_url_for_ssrf(feed_url)
                    return feed_url
                except SSRFError:
                    logger.warning("Skipping RSS URL blocked by SSRF protection", url=feed_url)
                    continue

        return None

    async def _probe_rss_paths(self, base_url: str) -> str | None:
        headers = {
            "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36"
        }

        async def check_path(path: str) -> str | None:
            probe_url = urljoin(base_url, path)
            try:
                if self._client:
                    response = await self._client.head(
                        probe_url, headers=headers, follow_redirects=True
                    )
                else:
                    async with httpx.AsyncClient(
                        timeout=get_settings().http_timeout_seconds
                    ) as client:
                        response = await client.head(
                            probe_url, headers=headers, follow_redirects=True
                        )

                if response.status_code == 200:
                    content_type = response.headers.get("content-type", "").lower()
                    if any(
                        t in content_type for t in ["xml", "rss", "atom", "text/plain"]
                    ) or await self._is_valid_feed(probe_url):
                        return probe_url
            except httpx.HTTPError:
                pass
            return None

        results = await asyncio.gather(*(check_path(path) for path in RSS_PATHS))
        for result in results:
            if result:
                return result

        return None

    async def _is_valid_feed(self, url: str) -> bool:
        try:
            if self._client:
                response = await self._client.get(url, follow_redirects=True)
            else:
                async with httpx.AsyncClient(timeout=get_settings().http_timeout_seconds) as client:
                    response = await client.get(url, follow_redirects=True)

            if response.status_code != 200:
                return False

            content_type = response.headers.get("content-type", "").lower()
            if not any(t in content_type for t in ["xml", "rss", "atom", "text/plain", "text/xml"]):
                return False

            feed = feedparser.parse(response.text)
            return len(feed.entries) > 0

        except httpx.HTTPError:
            return False

    async def _parse_feed(self, rss_url: str) -> list[DiscoveredPost] | None:
        try:
            if self._client:
                response = await self._client.get(rss_url, follow_redirects=True)
            else:
                async with httpx.AsyncClient(timeout=get_settings().http_timeout_seconds) as client:
                    response = await client.get(rss_url, follow_redirects=True)

            response.raise_for_status()
            feed = feedparser.parse(response.text)

            if feed.bozo and not feed.entries:
                return None

            posts: list[DiscoveredPost] = []
            for entry in feed.entries:
                post_url = str(entry.get("link", ""))
                if not post_url:
                    continue

                title = str(entry.get("title", ""))
                published_at = parse_feed_date(entry)

                posts.append(DiscoveredPost(url=post_url, title=title, published_at=published_at))

            return posts if posts else None

        except httpx.HTTPError as e:
            logger.debug("Failed to parse RSS feed", rss_url=rss_url, error=str(e))
            return None
