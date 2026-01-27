import contextlib
import re
from datetime import UTC, datetime
from urllib.parse import urljoin

import httpx
import structlog
from bs4 import BeautifulSoup, Tag

from intelstream.adapters.base import BaseAdapter, ContentData
from intelstream.services.page_analyzer import ExtractionProfile

logger = structlog.get_logger()


class PageAdapter(BaseAdapter):
    def __init__(
        self,
        extraction_profile: ExtractionProfile,
        http_client: httpx.AsyncClient | None = None,
    ) -> None:
        self._profile = extraction_profile
        self._client = http_client

    @property
    def source_type(self) -> str:
        return "page"

    async def get_feed_url(self, identifier: str) -> str:
        return identifier

    async def fetch_latest(
        self,
        identifier: str,
        feed_url: str | None = None,
        max_results: int = 20,
    ) -> list[ContentData]:
        url = feed_url or identifier

        logger.debug(
            "Fetching page content",
            url=url,
            site_name=self._profile.site_name,
        )

        try:
            html = await self._fetch_html(url)
            items = self._extract_posts(html, url)

            if max_results:
                items = items[:max_results]

            logger.info(
                "Fetched page content",
                url=url,
                site_name=self._profile.site_name,
                count=len(items),
            )

            return items

        except httpx.HTTPStatusError as e:
            logger.error(
                "HTTP error fetching page",
                url=url,
                status_code=e.response.status_code,
            )
            raise
        except httpx.RequestError as e:
            logger.error("Request error fetching page", url=url, error=str(e))
            raise

    async def _fetch_html(self, url: str) -> str:
        headers = {
            "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36"
        }

        if self._client:
            response = await self._client.get(url, headers=headers, follow_redirects=True)
        else:
            async with httpx.AsyncClient(timeout=30.0) as client:
                response = await client.get(url, headers=headers, follow_redirects=True)

        response.raise_for_status()
        return response.text

    def _extract_posts(self, html: str, page_url: str) -> list[ContentData]:
        soup = BeautifulSoup(html, "lxml")
        posts = soup.select(self._profile.post_selector)

        items: list[ContentData] = []
        base_url = self._profile.base_url or page_url

        for post in posts:
            try:
                item = self._parse_post(post, base_url)
                if item:
                    items.append(item)
            except Exception as e:
                logger.warning(
                    "Failed to parse post element",
                    site_name=self._profile.site_name,
                    error=str(e),
                )
                continue

        return items

    def _parse_post(self, post: Tag, base_url: str) -> ContentData | None:
        title_elem = post.select_one(self._profile.title_selector)
        if not title_elem:
            return None

        title = title_elem.get_text(strip=True)
        if not title:
            return None

        url_elem = post.select_one(self._profile.url_selector)
        if not url_elem:
            return None

        url_value = url_elem.get(self._profile.url_attribute)
        if not url_value:
            return None

        original_url = str(url_value)
        if not original_url.startswith(("http://", "https://")):
            original_url = urljoin(base_url, original_url)

        external_id = original_url

        published_at = self._extract_date(post)
        author = self._extract_author(post)

        return ContentData(
            external_id=external_id,
            title=title,
            original_url=original_url,
            author=author or self._profile.site_name,
            published_at=published_at,
            raw_content=None,
            thumbnail_url=None,
        )

    def _extract_date(self, post: Tag) -> datetime:
        if not self._profile.date_selector:
            return datetime.now(UTC)

        date_elem = post.select_one(self._profile.date_selector)
        if not date_elem:
            return datetime.now(UTC)

        date_str: str | None = None
        if self._profile.date_attribute:
            attr_value = date_elem.get(self._profile.date_attribute)
            if attr_value:
                date_str = str(attr_value)
        else:
            date_str = date_elem.get_text(strip=True)

        if not date_str:
            return datetime.now(UTC)

        return self._parse_date_string(date_str)

    def _parse_date_string(self, date_str: str) -> datetime:
        date_str = date_str.replace("Z", "+00:00")

        with contextlib.suppress(ValueError):
            return datetime.fromisoformat(date_str)

        date_formats = [
            "%Y-%m-%d",
            "%B %d, %Y",
            "%b %d, %Y",
            "%d %B %Y",
            "%d %b %Y",
            "%m/%d/%Y",
            "%d/%m/%Y",
        ]

        for fmt in date_formats:
            with contextlib.suppress(ValueError):
                dt = datetime.strptime(date_str, fmt)
                return dt.replace(tzinfo=UTC)

        date_match = re.search(r"(\w+)\s+(\d{1,2}),?\s+(\d{4})", date_str)
        if date_match:
            with contextlib.suppress(ValueError):
                month_str, day, year = date_match.groups()
                parsed = datetime.strptime(f"{month_str} {day}, {year}", "%B %d, %Y")
                return parsed.replace(tzinfo=UTC)

        return datetime.now(UTC)

    def _extract_author(self, post: Tag) -> str | None:
        if not self._profile.author_selector:
            return None

        author_elem = post.select_one(self._profile.author_selector)
        if not author_elem:
            return None

        return author_elem.get_text(strip=True) or None
