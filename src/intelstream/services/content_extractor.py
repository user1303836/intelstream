import contextlib
import re
from dataclasses import dataclass
from datetime import UTC, datetime

import httpx
import structlog
import trafilatura
from bs4 import BeautifulSoup, Tag

from intelstream.config import get_settings
from intelstream.utils.url_validation import SSRFError, validate_url_for_ssrf

logger = structlog.get_logger()


@dataclass
class ExtractedContent:
    text: str
    title: str | None = None
    author: str | None = None
    published_at: datetime | None = None


class ContentExtractor:
    def __init__(self, http_client: httpx.AsyncClient | None = None) -> None:
        self._client = http_client

    async def extract(self, url: str) -> ExtractedContent:
        try:
            validate_url_for_ssrf(url)
        except SSRFError:
            logger.warning("Skipping URL blocked by SSRF protection", url=url)
            return ExtractedContent(text="")

        html = await self._fetch_html(url)
        if not html:
            return ExtractedContent(text="")

        result = trafilatura.extract(
            html,
            include_comments=False,
            include_tables=True,
            output_format="txt",
        )

        if result:
            metadata = trafilatura.extract_metadata(html)
            return ExtractedContent(
                text=result,
                title=metadata.title if metadata else None,
                author=metadata.author if metadata else None,
                published_at=self._parse_date(metadata.date if metadata else None),
            )

        soup = BeautifulSoup(html, "lxml")

        article = soup.find("article")
        if article:
            return ExtractedContent(
                text=article.get_text(separator="\n", strip=True),
                title=self._extract_title(soup),
                author=self._extract_author(soup),
                published_at=self._extract_date(soup),
            )

        main = soup.find("main")
        if main:
            return ExtractedContent(
                text=main.get_text(separator="\n", strip=True),
                title=self._extract_title(soup),
                author=self._extract_author(soup),
                published_at=self._extract_date(soup),
            )

        return ExtractedContent(
            text=self._extract_largest_text_block(soup),
            title=self._extract_title(soup),
            author=self._extract_author(soup),
            published_at=self._extract_date(soup),
        )

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
            logger.warning("Failed to fetch content", url=url, error=str(e))
            return None

    def _extract_title(self, soup: BeautifulSoup) -> str | None:
        og_title = soup.find("meta", property="og:title")
        if isinstance(og_title, Tag):
            content = og_title.get("content")
            if content:
                return str(content)

        title_tag = soup.find("title")
        if title_tag:
            return title_tag.get_text(strip=True)

        h1 = soup.find("h1")
        if h1:
            return h1.get_text(strip=True)

        return None

    def _extract_author(self, soup: BeautifulSoup) -> str | None:
        author_meta = soup.find("meta", attrs={"name": "author"})
        if isinstance(author_meta, Tag):
            content = author_meta.get("content")
            if content:
                return str(content)

        og_author = soup.find("meta", property="article:author")
        if isinstance(og_author, Tag):
            content = og_author.get("content")
            if content:
                return str(content)

        author_elem = soup.find(class_=re.compile(r"author", re.IGNORECASE))
        if author_elem:
            text = author_elem.get_text(strip=True)
            if text and len(text) < 100:
                return text

        return None

    def _extract_date(self, soup: BeautifulSoup) -> datetime | None:
        time_elem = soup.find("time")
        if isinstance(time_elem, Tag):
            datetime_attr = time_elem.get("datetime")
            if datetime_attr:
                parsed = self._parse_date(str(datetime_attr))
                if parsed:
                    return parsed

        og_date = soup.find("meta", property="article:published_time")
        if isinstance(og_date, Tag):
            content = og_date.get("content")
            if content:
                parsed = self._parse_date(str(content))
                if parsed:
                    return parsed

        date_meta = soup.find("meta", attrs={"name": re.compile(r"date", re.IGNORECASE)})
        if isinstance(date_meta, Tag):
            content = date_meta.get("content")
            if content:
                parsed = self._parse_date(str(content))
                if parsed:
                    return parsed

        return None

    def _parse_date(self, date_str: str | None) -> datetime | None:
        if not date_str:
            return None

        date_str = date_str.strip().replace("Z", "+00:00")

        with contextlib.suppress(ValueError):
            return datetime.fromisoformat(date_str)

        formats = [
            "%Y-%m-%dT%H:%M:%S%z",
            "%Y-%m-%dT%H:%M:%S",
            "%Y-%m-%d",
            "%B %d, %Y",
            "%b %d, %Y",
            "%d %B %Y",
            "%d %b %Y",
            "%m/%d/%Y",
        ]

        for fmt in formats:
            with contextlib.suppress(ValueError):
                dt = datetime.strptime(date_str, fmt)
                if dt.tzinfo is None:
                    dt = dt.replace(tzinfo=UTC)
                return dt

        return None

    def _extract_largest_text_block(self, soup: BeautifulSoup) -> str:
        for tag in soup.find_all(["script", "style", "nav", "header", "footer", "aside"]):
            tag.decompose()

        paragraphs = soup.find_all("p")
        if paragraphs:
            texts = [p.get_text(strip=True) for p in paragraphs]
            significant_texts = [t for t in texts if len(t) > 50]
            if significant_texts:
                return "\n\n".join(significant_texts)

        body = soup.find("body")
        if body:
            return body.get_text(separator="\n", strip=True)[:10000]

        return soup.get_text(separator="\n", strip=True)[:10000]
