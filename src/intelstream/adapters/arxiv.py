import re

import feedparser
import httpx
import structlog
from bs4 import BeautifulSoup, Tag

from intelstream.adapters.base import BaseAdapter, ContentData
from intelstream.utils.feed_utils import parse_feed_date

logger = structlog.get_logger()

EXCLUDED_SECTIONS = {"references", "appendix", "acknowledgments", "acknowledgements"}

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
                    item = await self._parse_entry(entry)
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

    async def _parse_entry(self, entry: feedparser.FeedParserDict) -> ContentData:
        external_id = self._extract_arxiv_id(entry)
        title = self._clean_title(str(entry.get("title", "Untitled")))
        original_url = str(entry.get("link", ""))
        author = self._extract_authors(entry)
        published_at = parse_feed_date(entry)
        abstract = self._extract_abstract(entry)

        arxiv_id = external_id.replace("arxiv:", "") if external_id.startswith("arxiv:") else None
        full_content = None

        if arxiv_id:
            full_content = await self._fetch_html_content(arxiv_id)

        return ContentData(
            external_id=external_id,
            title=title,
            original_url=original_url,
            author=author,
            published_at=published_at,
            raw_content=full_content or abstract,
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

    async def _fetch_html_content(self, arxiv_id: str) -> str | None:
        html_url = f"https://arxiv.org/html/{arxiv_id}"

        logger.debug("Fetching arxiv HTML content", arxiv_id=arxiv_id, url=html_url)

        try:
            if self._client:
                response = await self._client.get(html_url, follow_redirects=True)
            else:
                async with httpx.AsyncClient() as client:
                    response = await client.get(html_url, follow_redirects=True)

            if response.status_code == 404:
                logger.debug("HTML version not available", arxiv_id=arxiv_id)
                return None

            response.raise_for_status()

            content = self._extract_paper_content(response.text)
            if content:
                logger.info(
                    "Extracted HTML content",
                    arxiv_id=arxiv_id,
                    content_length=len(content),
                )
            return content

        except httpx.HTTPStatusError as e:
            logger.warning(
                "HTTP error fetching arxiv HTML",
                arxiv_id=arxiv_id,
                status_code=e.response.status_code,
            )
            return None
        except httpx.RequestError as e:
            logger.warning("Request error fetching arxiv HTML", arxiv_id=arxiv_id, error=str(e))
            return None

    def _extract_paper_content(self, html: str) -> str | None:
        soup = BeautifulSoup(html, "lxml")

        for element in soup.find_all(["script", "style", "nav", "header", "footer"]):
            element.decompose()

        for section in soup.find_all(["section", "div"]):
            heading = section.find(["h1", "h2", "h3", "h4"])
            if heading:
                heading_text = heading.get_text().lower().strip()
                heading_text = re.sub(r"^[\d.]+\s*", "", heading_text)
                if any(excluded in heading_text for excluded in EXCLUDED_SECTIONS):
                    section.decompose()

        article = soup.find("article")
        if article and isinstance(article, Tag):
            content_element = article
        else:
            main = soup.find("main")
            if main and isinstance(main, Tag):
                content_element = main
            else:
                body = soup.find("body")
                if body and isinstance(body, Tag):
                    content_element = body
                else:
                    return None

        paragraphs = []
        for element in content_element.find_all(["p", "h1", "h2", "h3", "h4", "li"]):
            text = element.get_text(separator=" ", strip=True)
            if text and len(text) > 20:
                paragraphs.append(text)

        if not paragraphs:
            return None

        content = "\n\n".join(paragraphs)
        content = re.sub(r"\n\s*\n", "\n\n", content)

        return content.strip() if content.strip() else None
