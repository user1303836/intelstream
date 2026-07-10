import asyncio
import contextlib
import re
from dataclasses import dataclass
from datetime import UTC, datetime

import httpx
import structlog
import trafilatura
from bs4 import BeautifulSoup, Tag

from intelstream.config import get_settings
from intelstream.utils.log_safety import safe_url_for_log
from intelstream.utils.safe_http import SafeHTTPError, safe_request

logger = structlog.get_logger()

MIN_CONTENT_LENGTH = 200
MIN_SENTENCE_COUNT = 3

_NAV_KEYWORDS = frozenset(
    {
        "home",
        "about",
        "contact",
        "subscribe",
        "login",
        "register",
        "menu",
        "navigation",
        "cookie",
        "search",
        "share",
    }
)

_CSS_SELECTORS = [
    ".post-content",
    ".entry-content",
    ".article-body",
    ".article-content",
    ".gh-content",
    ".body.markup",
    "[itemprop='articleBody']",
    ".post-body",
    ".blog-content",
    ".content-body",
    ".markdown-body",
]


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
        html = await self._fetch_html(url)
        if not html:
            return ExtractedContent(text="")
        return await asyncio.to_thread(self._extract_html, html, url)

    def _extract_html(self, html: str, url: str) -> ExtractedContent:
        result = trafilatura.extract(
            html,
            include_comments=False,
            include_tables=True,
            output_format="txt",
        )

        if result and self._validate_content(result):
            metadata = trafilatura.extract_metadata(html)
            return ExtractedContent(
                text=result,
                title=metadata.title if metadata else None,
                author=metadata.author if metadata else None,
                published_at=self._parse_date(metadata.date if metadata else None),
            )

        recall_result = trafilatura.extract(
            html,
            include_comments=False,
            include_tables=True,
            output_format="txt",
            favor_recall=True,
        )

        if recall_result and self._validate_content(recall_result):
            metadata = trafilatura.extract_metadata(html)
            return ExtractedContent(
                text=recall_result,
                title=metadata.title if metadata else None,
                author=metadata.author if metadata else None,
                published_at=self._parse_date(metadata.date if metadata else None),
            )

        soup = BeautifulSoup(html, "lxml")

        article = soup.find("article")
        if article:
            text = article.get_text(separator="\n", strip=True)
            if self._validate_content(text):
                return ExtractedContent(
                    text=text,
                    title=self._extract_title(soup),
                    author=self._extract_author(soup),
                    published_at=self._extract_date(soup),
                )

        main = soup.find("main")
        if main:
            text = main.get_text(separator="\n", strip=True)
            if self._validate_content(text):
                return ExtractedContent(
                    text=text,
                    title=self._extract_title(soup),
                    author=self._extract_author(soup),
                    published_at=self._extract_date(soup),
                )

        css_text = self._extract_via_css_selectors(soup)
        if css_text and self._validate_content(css_text):
            return ExtractedContent(
                text=css_text,
                title=self._extract_title(soup),
                author=self._extract_author(soup),
                published_at=self._extract_date(soup),
            )

        largest_block = self._extract_largest_text_block(soup)
        if self._validate_content(largest_block):
            return ExtractedContent(
                text=largest_block,
                title=self._extract_title(soup),
                author=self._extract_author(soup),
                published_at=self._extract_date(soup),
            )

        logger.warning("Content extraction failed validation", url=safe_url_for_log(url))
        return ExtractedContent(
            text="",
            title=self._extract_title(soup),
            author=self._extract_author(soup),
            published_at=self._extract_date(soup),
        )

    def _validate_content(self, text: str) -> bool:
        if not text or len(text.strip()) < MIN_CONTENT_LENGTH:
            return False

        sentences = re.split(r"[.!?]+\s", text)
        if len(sentences) < MIN_SENTENCE_COUNT:
            return False

        words = text.lower().split()
        if not words:
            return False
        nav_word_count = sum(1 for w in words if w.strip(".,;:!?()[]") in _NAV_KEYWORDS)
        return nav_word_count / len(words) <= 0.3

    def _extract_via_css_selectors(self, soup: BeautifulSoup) -> str | None:
        for selector in _CSS_SELECTORS:
            element = soup.select_one(selector)
            if element:
                text = element.get_text(separator="\n", strip=True)
                if text:
                    return text
        return None

    async def _fetch_html(self, url: str) -> str | None:
        headers = {
            "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36"
        }
        try:
            if self._client:
                response = await safe_request(self._client, "GET", url, headers=headers)
            else:
                async with httpx.AsyncClient(timeout=get_settings().http_timeout_seconds) as client:
                    response = await safe_request(client, "GET", url, headers=headers)
            response.raise_for_status()
            return response.text
        except (httpx.HTTPError, SafeHTTPError) as e:
            logger.warning("Failed to fetch content", url=safe_url_for_log(url), error=str(e))
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
