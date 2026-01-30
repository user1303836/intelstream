import asyncio
import hashlib
import json
import re
from urllib.parse import urljoin, urlparse

import anthropic
import httpx
import structlog
from bs4 import BeautifulSoup
from tenacity import (
    retry,
    retry_if_exception_type,
    stop_after_attempt,
    wait_exponential,
)

from intelstream.adapters.strategies.base import (
    DiscoveredPost,
    DiscoveryResult,
    DiscoveryStrategy,
)
from intelstream.config import get_settings
from intelstream.database.repository import Repository

logger = structlog.get_logger()

DEFAULT_MODEL = "claude-3-5-haiku-20241022"
LLM_EXTRACTION_TIMEOUT_SECONDS = 120

EXTRACTION_PROMPT = """Analyze this HTML and extract all blog posts/articles listed on the page.

For each post, return:
- url: The full URL to the post (resolve relative URLs using base: {base_url})
- title: The post title

Return ONLY a valid JSON array: [{{"url": "...", "title": "..."}}, ...]
If no posts found, return empty array: []

Only include actual blog/article posts, not navigation links, footers, or other page elements.
Look for repeating patterns that represent individual posts or article cards.

HTML:
{html}"""


class LLMExtractionStrategy(DiscoveryStrategy):
    def __init__(
        self,
        anthropic_client: anthropic.AsyncAnthropic,
        repository: Repository,
        http_client: httpx.AsyncClient | None = None,
        model: str = DEFAULT_MODEL,
    ) -> None:
        self._client = anthropic_client
        self._repository = repository
        self._http_client = http_client
        self._model = model

    @property
    def name(self) -> str:
        return "llm"

    async def discover(
        self,
        url: str,
        url_pattern: str | None = None,  # noqa: ARG002
    ) -> DiscoveryResult | None:
        html = await self._fetch_html(url)
        if not html:
            return None

        content_hash = self._get_content_hash(html)

        cached = await self._repository.get_extraction_cache(url)
        if cached and cached.content_hash == content_hash:
            try:
                posts_data = json.loads(cached.posts_json)
                posts = [DiscoveredPost(url=p["url"], title=p.get("title", "")) for p in posts_data]
                logger.debug(
                    "Using cached LLM extraction",
                    url=url,
                    post_count=len(posts),
                )
                return DiscoveryResult(posts=posts) if posts else None
            except (json.JSONDecodeError, KeyError):
                pass

        try:
            async with asyncio.timeout(LLM_EXTRACTION_TIMEOUT_SECONDS):
                posts = await self._extract_with_llm(html, url)
        except TimeoutError:
            logger.error(
                "LLM extraction timed out",
                url=url,
                timeout_seconds=LLM_EXTRACTION_TIMEOUT_SECONDS,
            )
            posts = []

        posts_json = json.dumps([{"url": p.url, "title": p.title} for p in posts])
        await self._repository.set_extraction_cache(url, content_hash, posts_json)

        if not posts:
            logger.debug("LLM extraction found no posts", url=url)
            return None

        logger.info(
            "LLM extraction successful",
            url=url,
            post_count=len(posts),
        )
        return DiscoveryResult(posts=posts)

    def _get_content_hash(self, html: str) -> str:
        soup = BeautifulSoup(html, "lxml")

        for tag in soup.find_all(
            ["script", "style", "nav", "header", "footer", "aside", "noscript"]
        ):
            tag.decompose()

        main = soup.find("main") or soup.find("article") or soup.find(id="content") or soup.body

        if main:
            text = " ".join(main.get_text().split())
            return hashlib.md5(text.encode()).hexdigest()

        return hashlib.md5(html.encode()).hexdigest()

    async def _fetch_html(self, url: str) -> str | None:
        headers = {
            "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36"
        }
        try:
            if self._http_client:
                response = await self._http_client.get(url, headers=headers, follow_redirects=True)
            else:
                async with httpx.AsyncClient(timeout=get_settings().http_timeout_seconds) as client:
                    response = await client.get(url, headers=headers, follow_redirects=True)
            response.raise_for_status()
            return response.text
        except httpx.HTTPError as e:
            logger.debug("Failed to fetch HTML", url=url, error=str(e))
            return None

    def _clean_html(self, html: str) -> str:
        soup = BeautifulSoup(html, "lxml")

        for tag in soup.find_all(["script", "style", "noscript", "svg", "path", "iframe"]):
            tag.decompose()

        for tag in soup.find_all(True):
            attrs_to_remove = []
            for attr in tag.attrs:
                if attr not in ["class", "id", "href", "data-href", "rel"]:
                    attrs_to_remove.append(attr)
            for attr in attrs_to_remove:
                del tag[attr]

        cleaned = str(soup)

        max_html_length = get_settings().max_html_length
        if len(cleaned) > max_html_length:
            truncated = cleaned[:max_html_length]
            last_close = truncated.rfind(">")
            if last_close > max_html_length - 1000:
                truncated = truncated[: last_close + 1]
            else:
                last_open = truncated.rfind("<")
                if last_open > 0:
                    truncated = truncated[:last_open]
            cleaned = truncated

        return cleaned

    @retry(
        retry=retry_if_exception_type(anthropic.RateLimitError),
        wait=wait_exponential(multiplier=1, min=4, max=60),
        stop=stop_after_attempt(3),
    )
    async def _extract_with_llm(self, html: str, url: str) -> list[DiscoveredPost]:
        parsed = urlparse(url)
        base_url = f"{parsed.scheme}://{parsed.netloc}"

        cleaned_html = self._clean_html(html)

        prompt = EXTRACTION_PROMPT.format(base_url=base_url, html=cleaned_html)

        try:
            message = await self._client.messages.create(
                model=self._model,
                max_tokens=4000,
                messages=[{"role": "user", "content": prompt}],
            )

            response_text = ""
            for block in message.content:
                if hasattr(block, "text"):
                    response_text += block.text

            response_text = response_text.strip()

            posts_data = self._extract_json_from_response(response_text)

            posts: list[DiscoveredPost] = []
            for p in posts_data:
                post_url = p.get("url", "")
                if not post_url:
                    continue

                if not post_url.startswith(("http://", "https://")):
                    post_url = urljoin(base_url, post_url)

                posts.append(DiscoveredPost(url=post_url, title=p.get("title", "")))

            return posts

        except anthropic.APIError as e:
            logger.error("Anthropic API error during extraction", url=url, error=str(e))
            return []

    def _extract_json_from_response(self, text: str) -> list[dict[str, str]]:
        def parse_and_validate(data: str) -> list[dict[str, str]] | None:
            try:
                parsed = json.loads(data)
                if isinstance(parsed, list):
                    return parsed
            except json.JSONDecodeError:
                pass
            return None

        result = parse_and_validate(text)
        if result is not None:
            return result

        json_match = re.search(r"```(?:json)?\s*([\s\S]*?)\s*```", text)
        if json_match:
            result = parse_and_validate(json_match.group(1))
            if result is not None:
                return result

        array_match = re.search(r"\[[\s\S]*\]", text)
        if array_match:
            result = parse_and_validate(array_match.group(0))
            if result is not None:
                return result

        logger.warning("Failed to extract JSON from LLM response", response_preview=text[:200])
        return []
