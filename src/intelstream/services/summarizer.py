from typing import Any

import anthropic
import structlog
from tenacity import (
    retry,
    retry_if_exception_type,
    stop_after_attempt,
    wait_exponential,
)

logger = structlog.get_logger()

DEFAULT_MODEL = "claude-sonnet-4-20250514"
MAX_CONTENT_LENGTH = 100000


class SummarizationError(Exception):
    pass


class SummarizationService:
    def __init__(self, api_key: str, model: str = DEFAULT_MODEL) -> None:
        self._client = anthropic.AsyncAnthropic(api_key=api_key)
        self._model = model

    @retry(
        retry=retry_if_exception_type(anthropic.RateLimitError),
        wait=wait_exponential(multiplier=1, min=4, max=60),
        stop=stop_after_attempt(3),
    )
    async def summarize(
        self,
        content: str,
        title: str,
        source_type: str,
        author: str | None = None,
    ) -> str:
        if not content or not content.strip():
            raise SummarizationError("Cannot summarize empty content")

        truncated_content = content[:MAX_CONTENT_LENGTH]
        if len(content) > MAX_CONTENT_LENGTH:
            logger.warning(
                "Content truncated for summarization",
                original_length=len(content),
                truncated_length=MAX_CONTENT_LENGTH,
            )

        prompt = self._build_prompt(truncated_content, title, source_type, author)

        try:
            logger.debug("Requesting summary from Anthropic", title=title, model=self._model)

            message = await self._client.messages.create(
                model=self._model,
                max_tokens=1024,
                messages=[{"role": "user", "content": prompt}],
            )

            summary = self._extract_summary(message)

            logger.info("Summary generated", title=title, summary_length=len(summary))

            return summary

        except anthropic.RateLimitError:
            logger.warning("Rate limited by Anthropic API, retrying...")
            raise
        except anthropic.APIError as e:
            logger.error("Anthropic API error", error=str(e))
            raise SummarizationError(f"API error: {e}") from e

    def _build_prompt(
        self,
        content: str,
        title: str,
        source_type: str,
        author: str | None,
    ) -> str:
        source_context = {
            "substack": "newsletter article",
            "youtube": "video transcript",
            "rss": "blog post",
        }.get(source_type, "article")

        author_info = f" by {author}" if author else ""

        return f"""Summarize the following {source_context}{author_info} titled "{title}".

Provide a concise summary (2-4 paragraphs) that captures:
- The main topic and key points
- Any important insights or conclusions
- Why this might be interesting or relevant

Write in a clear, engaging style suitable for a Discord message. Do not use headers or bullet points.

Content:
{content}

Summary:"""

    def _extract_summary(self, message: Any) -> str:
        if not message.content:
            raise SummarizationError("Empty response from API")

        text_blocks = [block.text for block in message.content if hasattr(block, "text")]

        if not text_blocks:
            raise SummarizationError("No text content in API response")

        return "\n\n".join(text_blocks).strip()
