from dataclasses import dataclass
from datetime import datetime

import httpx
import structlog
from bs4 import BeautifulSoup, Tag

from intelstream.utils.url_validation import SSRFError, validate_url_for_ssrf

logger = structlog.get_logger()

DEFAULT_TIMEOUT = 30.0
MAX_CONTENT_LENGTH = 100000


@dataclass
class WebContent:
    url: str
    title: str
    content: str
    author: str | None = None
    published_at: datetime | None = None
    thumbnail_url: str | None = None


class WebFetchError(Exception):
    pass


class WebFetcher:
    def __init__(self, http_client: httpx.AsyncClient | None = None) -> None:
        self._client = http_client
        self._owns_client = http_client is None

    async def fetch(self, url: str, skip_ssrf_check: bool = False) -> WebContent:
        if not skip_ssrf_check:
            try:
                validate_url_for_ssrf(url)
            except SSRFError as e:
                raise WebFetchError(f"URL blocked by SSRF protection: {e}") from e

        client = None
        try:
            client = self._client or httpx.AsyncClient(
                timeout=DEFAULT_TIMEOUT,
                follow_redirects=True,
                headers={
                    "User-Agent": "Mozilla/5.0 (compatible; IntelStream/1.0; +https://github.com/intelstream)"
                },
            )
            response = await client.get(url)
            response.raise_for_status()

            content_type = response.headers.get("content-type", "")
            if "text/html" not in content_type:
                raise WebFetchError(f"Unsupported content type: {content_type}")

            html = response.text
            if len(html) > MAX_CONTENT_LENGTH:
                html = html[:MAX_CONTENT_LENGTH]

            return self._parse_html(url, html)

        except httpx.HTTPStatusError as e:
            logger.warning("HTTP error fetching URL", url=url, status=e.response.status_code)
            raise WebFetchError(f"Failed to fetch URL: HTTP {e.response.status_code}") from e
        except httpx.RequestError as e:
            logger.warning("Request error fetching URL", url=url, error=str(e))
            raise WebFetchError(f"Failed to fetch URL: {e}") from e
        finally:
            if self._owns_client and client is not None:
                await client.aclose()

    def _parse_html(self, url: str, html: str) -> WebContent:
        soup = BeautifulSoup(html, "lxml")

        title = self._extract_title(soup)
        content = self._extract_content(soup)
        author = self._extract_author(soup)
        thumbnail_url = self._extract_thumbnail(soup)
        published_at = self._extract_published_date(soup)

        if not content or len(content.strip()) < 100:
            raise WebFetchError("Page doesn't have enough content to summarize")

        return WebContent(
            url=url,
            title=title,
            content=content,
            author=author,
            thumbnail_url=thumbnail_url,
            published_at=published_at,
        )

    def _extract_title(self, soup: BeautifulSoup) -> str:
        og_title = soup.find("meta", property="og:title")
        if isinstance(og_title, Tag) and og_title.get("content"):
            return str(og_title["content"])

        twitter_title = soup.find("meta", attrs={"name": "twitter:title"})
        if isinstance(twitter_title, Tag) and twitter_title.get("content"):
            return str(twitter_title["content"])

        title_tag = soup.find("title")
        if isinstance(title_tag, Tag) and title_tag.string:
            return title_tag.string.strip()

        h1 = soup.find("h1")
        if isinstance(h1, Tag):
            return h1.get_text(strip=True)

        return "Untitled"

    def _extract_content(self, soup: BeautifulSoup) -> str:
        for tag in soup.find_all(["script", "style", "nav", "header", "footer", "aside"]):
            tag.decompose()

        article = soup.find("article")
        if article:
            return article.get_text(separator="\n", strip=True)

        main = soup.find("main")
        if main:
            return main.get_text(separator="\n", strip=True)

        content_div = soup.find(
            "div", class_=lambda x: x and "content" in x.lower() if x else False
        )
        if content_div:
            return content_div.get_text(separator="\n", strip=True)

        body = soup.find("body")
        if body:
            return body.get_text(separator="\n", strip=True)

        return soup.get_text(separator="\n", strip=True)

    def _extract_author(self, soup: BeautifulSoup) -> str | None:
        author_meta = soup.find("meta", attrs={"name": "author"})
        if isinstance(author_meta, Tag) and author_meta.get("content"):
            return str(author_meta["content"])

        og_author = soup.find("meta", property="article:author")
        if isinstance(og_author, Tag) and og_author.get("content"):
            return str(og_author["content"])

        author_link = soup.find("a", rel="author")
        if isinstance(author_link, Tag):
            return author_link.get_text(strip=True)

        return None

    def _extract_thumbnail(self, soup: BeautifulSoup) -> str | None:
        og_image = soup.find("meta", property="og:image")
        if isinstance(og_image, Tag) and og_image.get("content"):
            return str(og_image["content"])

        twitter_image = soup.find("meta", attrs={"name": "twitter:image"})
        if isinstance(twitter_image, Tag) and twitter_image.get("content"):
            return str(twitter_image["content"])

        return None

    def _extract_published_date(self, soup: BeautifulSoup) -> datetime | None:
        date_meta = soup.find("meta", property="article:published_time")
        if isinstance(date_meta, Tag) and date_meta.get("content"):
            try:
                return datetime.fromisoformat(str(date_meta["content"]).replace("Z", "+00:00"))
            except ValueError:
                pass

        time_tag = soup.find("time", datetime=True)
        if isinstance(time_tag, Tag) and time_tag.get("datetime"):
            try:
                return datetime.fromisoformat(str(time_tag["datetime"]).replace("Z", "+00:00"))
            except ValueError:
                pass

        return None
