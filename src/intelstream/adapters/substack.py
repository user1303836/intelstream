from typing import Any

import feedparser
import httpx
import structlog

from intelstream.adapters.base import BaseAdapter, ContentData
from intelstream.utils.feed_utils import parse_feed_date

logger = structlog.get_logger()


class SubstackAdapter(BaseAdapter):
    def __init__(self, http_client: httpx.AsyncClient | None = None) -> None:
        self._client = http_client

    @property
    def source_type(self) -> str:
        return "substack"

    async def get_feed_url(self, identifier: str) -> str:
        identifier = identifier.strip().lower()
        if identifier.startswith("http"):
            if not identifier.endswith("/feed"):
                return identifier.rstrip("/") + "/feed"
            return identifier
        return f"https://{identifier}.substack.com/feed"

    async def fetch_latest(self, identifier: str, feed_url: str | None = None) -> list[ContentData]:
        url = feed_url or await self.get_feed_url(identifier)

        logger.debug("Fetching Substack feed", identifier=identifier, url=url)

        try:
            if self._client:
                response = await self._client.get(url, follow_redirects=True)
                response.raise_for_status()
                content = response.text
            else:
                async with httpx.AsyncClient() as client:
                    response = await client.get(url, follow_redirects=True)
                    response.raise_for_status()
                    content = response.text

            feed = feedparser.parse(content)

            if feed.bozo and not feed.entries:
                logger.warning(
                    "Failed to parse Substack feed",
                    identifier=identifier,
                    error=str(feed.bozo_exception),
                )
                return []

            items: list[ContentData] = []
            for entry in feed.entries:
                try:
                    item = self._parse_entry(entry, feed)
                    items.append(item)
                except Exception as e:
                    logger.warning(
                        "Failed to parse feed entry",
                        identifier=identifier,
                        entry_id=getattr(entry, "id", "unknown"),
                        error=str(e),
                    )
                    continue

            logger.info("Fetched Substack content", identifier=identifier, count=len(items))
            return items

        except httpx.HTTPStatusError as e:
            logger.error(
                "HTTP error fetching Substack feed",
                identifier=identifier,
                status_code=e.response.status_code,
            )
            raise
        except httpx.RequestError as e:
            logger.error(
                "Request error fetching Substack feed",
                identifier=identifier,
                error=str(e),
            )
            raise

    def _parse_entry(
        self, entry: feedparser.FeedParserDict, feed: feedparser.FeedParserDict
    ) -> ContentData:
        external_id: str = str(entry.get("id") or entry.get("link") or "")
        title: str = str(entry.get("title", "Untitled"))
        original_url: str = str(entry.get("link", ""))

        author: str = str(entry.get("author", ""))
        if not author:
            feed_data: Any = feed.feed
            if feed_data:
                author = str(feed_data.get("title", "Unknown Author"))
            else:
                author = "Unknown Author"

        published_at = parse_feed_date(entry)
        raw_content = self._extract_content(entry)
        thumbnail_url = self._extract_thumbnail(entry)

        return ContentData(
            external_id=external_id,
            title=title,
            original_url=original_url,
            author=author,
            published_at=published_at,
            raw_content=raw_content,
            thumbnail_url=thumbnail_url,
        )

    def _extract_content(self, entry: feedparser.FeedParserDict) -> str | None:
        if entry.get("content"):
            for content in entry.content:
                if content.get("type") in ("text/html", "text/plain"):
                    value = content.get("value")
                    return str(value) if value else None

        if entry.get("summary"):
            return str(entry.summary)

        if entry.get("description"):
            return str(entry.description)

        return None

    def _extract_thumbnail(self, entry: feedparser.FeedParserDict) -> str | None:
        if entry.get("media_content"):
            for media in entry.media_content:
                if media.get("medium") == "image" or str(media.get("type", "")).startswith(
                    "image/"
                ):
                    url = media.get("url")
                    return str(url) if url else None

        if entry.get("media_thumbnail"):
            for thumb in entry.media_thumbnail:
                url = thumb.get("url")
                if url:
                    return str(url)

        if entry.get("enclosures"):
            for enclosure in entry.enclosures:
                if str(enclosure.get("type", "")).startswith("image/"):
                    url = enclosure.get("href") or enclosure.get("url")
                    return str(url) if url else None

        return None
