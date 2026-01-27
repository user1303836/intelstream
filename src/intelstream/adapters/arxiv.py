import re
from datetime import UTC, datetime
from email.utils import parsedate_to_datetime

import feedparser
import httpx
import structlog

from intelstream.adapters.base import BaseAdapter, ContentData

logger = structlog.get_logger()

ARXIV_CATEGORIES = {
    "cs.AI": "Artificial Intelligence",
    "cs.LG": "Machine Learning",
    "cs.CL": "Computation and Language",
    "cs.CV": "Computer Vision",
    "cs.NE": "Neural and Evolutionary Computing",
    "stat.ML": "Machine Learning (Statistics)",
}


class ArxivAdapter(BaseAdapter):
    def __init__(self, http_client: httpx.AsyncClient | None = None) -> None:
        self._client = http_client

    @property
    def source_type(self) -> str:
        return "arxiv"

    async def get_feed_url(self, identifier: str) -> str:
        return f"https://arxiv.org/rss/{identifier}"

    async def fetch_latest(self, identifier: str, feed_url: str | None = None) -> list[ContentData]:
        url = feed_url or await self.get_feed_url(identifier)

        logger.debug("Fetching arxiv feed", identifier=identifier, url=url)

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
                    "Failed to parse arxiv feed",
                    identifier=identifier,
                    error=str(feed.bozo_exception),
                )
                return []

            items: list[ContentData] = []
            for entry in feed.entries:
                try:
                    item = self._parse_entry(entry)
                    items.append(item)
                except Exception as e:
                    logger.warning(
                        "Failed to parse arxiv entry",
                        identifier=identifier,
                        entry_id=getattr(entry, "id", "unknown"),
                        error=str(e),
                    )
                    continue

            logger.info("Fetched arxiv content", identifier=identifier, count=len(items))
            return items

        except httpx.HTTPStatusError as e:
            logger.error(
                "HTTP error fetching arxiv feed",
                identifier=identifier,
                status_code=e.response.status_code,
            )
            raise
        except httpx.RequestError as e:
            logger.error("Request error fetching arxiv feed", identifier=identifier, error=str(e))
            raise

    def _parse_entry(self, entry: feedparser.FeedParserDict) -> ContentData:
        external_id = self._extract_arxiv_id(entry)
        title = self._clean_title(str(entry.get("title", "Untitled")))
        original_url = str(entry.get("link", ""))
        author = self._extract_authors(entry)
        published_at = self._parse_date(entry)
        abstract = self._extract_abstract(entry)

        return ContentData(
            external_id=external_id,
            title=title,
            original_url=original_url,
            author=author,
            published_at=published_at,
            raw_content=abstract,
        )

    def _extract_arxiv_id(self, entry: feedparser.FeedParserDict) -> str:
        link = str(entry.get("link", ""))
        match = re.search(r"arxiv\.org/abs/(\d+\.\d+)", link)
        if match:
            return f"arxiv:{match.group(1)}"

        guid = str(entry.get("id", ""))
        if guid.startswith("oai:arXiv.org:"):
            arxiv_id = guid.replace("oai:arXiv.org:", "").split("v")[0]
            return f"arxiv:{arxiv_id}"

        return guid or link

    def _clean_title(self, title: str) -> str:
        cleaned = re.sub(r"^arXiv:\d+\.\d+v?\d*\s*", "", title)
        cleaned = re.sub(r"\s+", " ", cleaned).strip()
        return cleaned

    def _extract_authors(self, entry: feedparser.FeedParserDict) -> str:
        if hasattr(entry, "authors") and entry.authors:
            names = []
            for author in entry.authors:
                if isinstance(author, dict) and author.get("name"):
                    names.append(author["name"])
                elif hasattr(author, "name") and author.name:
                    names.append(author.name)
            if names:
                return ", ".join(names)

        dc_creator = entry.get("dc_creator") or entry.get("author")
        if dc_creator:
            return str(dc_creator).strip()

        return "Unknown Authors"

    def _parse_date(self, entry: feedparser.FeedParserDict) -> datetime:
        if entry.get("published_parsed"):
            parsed = entry.published_parsed
            return datetime(
                parsed[0], parsed[1], parsed[2], parsed[3], parsed[4], parsed[5], tzinfo=UTC
            )

        if entry.get("published"):
            try:
                return parsedate_to_datetime(str(entry.published))
            except (TypeError, ValueError):
                pass

        if entry.get("updated_parsed"):
            parsed = entry.updated_parsed
            return datetime(
                parsed[0], parsed[1], parsed[2], parsed[3], parsed[4], parsed[5], tzinfo=UTC
            )

        return datetime.now(UTC)

    def _extract_abstract(self, entry: feedparser.FeedParserDict) -> str | None:
        description = entry.get("summary") or entry.get("description")
        if not description:
            return None

        description = str(description)

        abstract_match = re.search(r"Abstract:\s*(.+)", description, re.DOTALL | re.IGNORECASE)
        if abstract_match:
            abstract = abstract_match.group(1).strip()
            abstract = re.sub(r"\s+", " ", abstract)
            return abstract

        return description.strip()
