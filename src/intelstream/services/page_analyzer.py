import json
import re
from dataclasses import dataclass
from typing import Any
from urllib.parse import urlparse

import anthropic
import httpx
import structlog
from bs4 import BeautifulSoup
from soupsieve import SelectorSyntaxError
from tenacity import (
    retry,
    retry_if_exception_type,
    stop_after_attempt,
    wait_exponential,
)

from intelstream.config import get_settings

logger = structlog.get_logger()

DEFAULT_MODEL = "claude-sonnet-4-20250514"


@dataclass
class ExtractionProfile:
    site_name: str
    post_selector: str
    title_selector: str
    url_selector: str
    url_attribute: str
    date_selector: str | None = None
    date_attribute: str | None = None
    author_selector: str | None = None
    base_url: str | None = None

    def to_dict(self) -> dict[str, Any]:
        return {
            "site_name": self.site_name,
            "post_selector": self.post_selector,
            "title_selector": self.title_selector,
            "url_selector": self.url_selector,
            "url_attribute": self.url_attribute,
            "date_selector": self.date_selector,
            "date_attribute": self.date_attribute,
            "author_selector": self.author_selector,
            "base_url": self.base_url,
        }

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> "ExtractionProfile":
        return cls(
            site_name=data["site_name"],
            post_selector=data["post_selector"],
            title_selector=data["title_selector"],
            url_selector=data["url_selector"],
            url_attribute=data["url_attribute"],
            date_selector=data.get("date_selector"),
            date_attribute=data.get("date_attribute"),
            author_selector=data.get("author_selector"),
            base_url=data.get("base_url"),
        )


class PageAnalysisError(Exception):
    pass


ANALYSIS_SYSTEM_PROMPT = """You are an expert web scraper that analyzes HTML to identify blog post/article listing patterns.

Your task is to examine the provided HTML and determine CSS selectors that can be used to extract blog posts or articles from the page.

You must respond with ONLY a valid JSON object (no markdown, no explanation) with these fields:
- site_name: A human-readable name for the site
- post_selector: CSS selector for the container element of each post/article
- title_selector: CSS selector for the title WITHIN each post container (relative to post_selector)
- url_selector: CSS selector for the link element WITHIN each post container (relative to post_selector)
- url_attribute: The attribute containing the URL (usually "href")
- date_selector: CSS selector for the date element (relative to post_selector), or null if not found
- date_attribute: The attribute containing the date (e.g., "datetime"), or null if date is in text content
- author_selector: CSS selector for the author (relative to post_selector), or null if not found
- base_url: The base URL for resolving relative links

Example response:
{"site_name": "Anthropic Research", "post_selector": "article.post-card", "title_selector": "h3.title", "url_selector": "a.post-link", "url_attribute": "href", "date_selector": "time", "date_attribute": "datetime", "author_selector": null, "base_url": "https://www.anthropic.com"}

IMPORTANT:
- The selectors for title, url, date, and author should be RELATIVE to the post container (not absolute from document root)
- Look for repeating patterns that represent individual posts/articles
- Common patterns: article tags, divs with "post", "card", "entry" classes
- If you cannot identify a clear post listing pattern, respond with: {"error": "Could not identify post listing pattern"}"""


class PageAnalyzer:
    def __init__(
        self,
        api_key: str,
        http_client: httpx.AsyncClient | None = None,
        model: str = DEFAULT_MODEL,
    ) -> None:
        self._client = anthropic.AsyncAnthropic(api_key=api_key)
        self._http_client = http_client
        self._model = model

    async def analyze(self, url: str) -> ExtractionProfile:
        parsed_url = urlparse(url)
        if not parsed_url.scheme or not parsed_url.netloc:
            raise PageAnalysisError(f"Invalid URL format: {url}")
        if parsed_url.scheme not in ("http", "https"):
            raise PageAnalysisError(f"URL must use http or https scheme: {url}")

        logger.info("Analyzing page structure", url=url)

        html = await self._fetch_html(url)
        cleaned_html = self._clean_html(html)

        profile_data = await self._extract_profile_with_llm(url, cleaned_html)

        profile = ExtractionProfile.from_dict(profile_data)

        validation_result = self._validate_profile(html, profile)
        if not validation_result["valid"]:
            raise PageAnalysisError(f"Profile validation failed: {validation_result['reason']}")

        logger.info(
            "Page analysis complete",
            url=url,
            site_name=profile.site_name,
            posts_found=validation_result["post_count"],
        )

        return profile

    async def _fetch_html(self, url: str) -> str:
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

        except httpx.HTTPStatusError as e:
            raise PageAnalysisError(f"Failed to fetch page: HTTP {e.response.status_code}") from e
        except httpx.RequestError as e:
            raise PageAnalysisError(f"Failed to fetch page: {e}") from e

    def _clean_html(self, html: str) -> str:
        soup = BeautifulSoup(html, "lxml")

        for tag in soup.find_all(["script", "style", "noscript", "svg", "path"]):
            tag.decompose()

        for tag in soup.find_all(True):
            attrs_to_remove = []
            for attr in tag.attrs:
                if attr not in ["class", "id", "href", "datetime", "data-date", "rel"]:
                    attrs_to_remove.append(attr)
            for attr in attrs_to_remove:
                del tag[attr]

        cleaned = str(soup)

        max_html_length = get_settings().max_html_length
        if len(cleaned) > max_html_length:
            cleaned = cleaned[:max_html_length]
            logger.warning(
                "HTML truncated for analysis",
                original_length=len(html),
                truncated_length=max_html_length,
            )

        return cleaned

    @retry(
        retry=retry_if_exception_type(anthropic.RateLimitError),
        wait=wait_exponential(multiplier=1, min=4, max=60),
        stop=stop_after_attempt(3),
    )
    async def _extract_profile_with_llm(self, url: str, html: str) -> dict[str, Any]:
        sanitized_url = re.sub(r"[\x00-\x1f\x7f-\x9f]", "", url).strip()

        user_prompt = f"""Analyze this page and provide CSS selectors to extract blog posts/articles.

URL: {sanitized_url}

HTML:
{html}

Respond with ONLY a JSON object, no markdown formatting."""

        try:
            message = await self._client.messages.create(
                model=self._model,
                max_tokens=1024,
                system=ANALYSIS_SYSTEM_PROMPT,
                messages=[{"role": "user", "content": user_prompt}],
            )

            response_text = ""
            for block in message.content:
                if hasattr(block, "text"):
                    response_text += block.text

            response_text = response_text.strip()

            json_match = re.search(r"\{.*\}", response_text, re.DOTALL)
            if json_match:
                response_text = json_match.group()

            try:
                data: dict[str, Any] = json.loads(response_text)
            except json.JSONDecodeError as e:
                logger.error(
                    "Failed to parse LLM response as JSON",
                    response=response_text[:500],
                    error=str(e),
                )
                raise PageAnalysisError("LLM returned invalid JSON response") from e

            if "error" in data:
                raise PageAnalysisError(data["error"])

            required_fields = [
                "site_name",
                "post_selector",
                "title_selector",
                "url_selector",
                "url_attribute",
            ]
            for field in required_fields:
                if field not in data:
                    raise PageAnalysisError(f"Missing required field: {field}")

            return data

        except anthropic.APIError as e:
            logger.error("Anthropic API error during page analysis", error=str(e))
            raise PageAnalysisError(f"LLM API error: {e}") from e

    def _validate_profile(self, html: str, profile: ExtractionProfile) -> dict[str, Any]:
        soup = BeautifulSoup(html, "lxml")

        try:
            posts = soup.select(profile.post_selector)
        except (SelectorSyntaxError, ValueError) as e:
            logger.warning(
                "Invalid CSS selector from LLM",
                selector=profile.post_selector,
                error=str(e),
            )
            return {
                "valid": False,
                "reason": f"Invalid CSS selector: {profile.post_selector}",
                "post_count": 0,
            }

        if not posts:
            return {
                "valid": False,
                "reason": f"No elements found with selector: {profile.post_selector}",
                "post_count": 0,
            }

        valid_posts = 0
        for post in posts[:10]:
            try:
                title_elem = post.select_one(profile.title_selector)
                url_elem = post.select_one(profile.url_selector)
            except (SelectorSyntaxError, ValueError) as e:
                logger.warning(
                    "Invalid CSS selector from LLM",
                    title_selector=profile.title_selector,
                    url_selector=profile.url_selector,
                    error=str(e),
                )
                return {
                    "valid": False,
                    "reason": f"Invalid CSS selector in title or url: {e}",
                    "post_count": 0,
                }

            if title_elem and url_elem:
                url_value = url_elem.get(profile.url_attribute)
                if url_value:
                    valid_posts += 1

        if valid_posts == 0:
            return {
                "valid": False,
                "reason": "Could not extract title and URL from any post",
                "post_count": 0,
            }

        return {"valid": True, "reason": None, "post_count": valid_posts}
