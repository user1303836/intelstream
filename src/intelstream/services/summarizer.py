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

SYSTEM_PROMPT = """You are a content summarizer for a Discord channel. Your job is to extract the key insights from articles, videos, and posts in a structured format.

Guidelines:
- Extract the INSIGHTS, not just topics. Each bullet should convey a takeaway.
- Be specific and concrete. Include numbers, names, and examples where relevant.
- Use sub-bullets for supporting evidence, examples, or important caveats.
- Keep the thesis to one sentence that captures the main argument or finding.
- Aim for 4-8 key arguments depending on content length and density.
- Write in a neutral, analytical tone."""

ARXIV_PROMPT_ADDITION = """
This is an academic research paper abstract. Focus on:
1. What problem does this paper solve?
2. What is the key innovation or finding?
3. Why does this matter for practitioners?
Keep technical jargon minimal - explain for a smart but non-expert audience."""


class SummarizationError(Exception):
    pass


class SummarizationService:
    def __init__(
        self,
        api_key: str,
        model: str = "claude-sonnet-4-20250514",
        max_tokens: int = 2048,
        max_input_length: int = 100000,
    ) -> None:
        self._client = anthropic.AsyncAnthropic(api_key=api_key)
        self._model = model
        self._max_tokens = max_tokens
        self._max_input_length = max_input_length
        self._system_prompt = SYSTEM_PROMPT

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

        truncated_content = content[: self._max_input_length]
        if len(content) > self._max_input_length:
            logger.warning(
                "Content truncated for summarization",
                original_length=len(content),
                truncated_length=self._max_input_length,
            )

        prompt = self._build_prompt(truncated_content, title, source_type, author)

        try:
            logger.debug("Requesting summary from Anthropic", title=title, model=self._model)

            message = await self._client.messages.create(
                model=self._model,
                max_tokens=self._max_tokens,
                system=self._system_prompt,
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
        content_type = {
            "substack": "newsletter article",
            "youtube": "video transcript",
            "rss": "blog post",
            "web": "article",
            "arxiv": "research paper abstract",
        }.get(source_type, "article")

        author_info = author if author else "Unknown"

        source_specific_guidance = ""
        if source_type == "arxiv":
            source_specific_guidance = ARXIV_PROMPT_ADDITION

        return f"""Summarize the following {content_type} from {author_info}:{source_specific_guidance}

Title: {title}

Content:
{content}

Format your response EXACTLY as follows:

**Thesis:** [One sentence capturing the central argument or main finding]

**Key Arguments**
- **[Insight or key concept]:** [Explanation of this point and why it matters]
  - [Supporting detail, evidence, example, or caveat]
  - [Additional detail if needed]
- **[Insight or key concept]:** [Explanation of this point and why it matters]
  - [Supporting detail, evidence, example, or caveat]"""

    def _extract_summary(self, message: Any) -> str:
        if not message.content:
            raise SummarizationError("Empty response from API")

        text_blocks = [block.text for block in message.content if hasattr(block, "text")]

        if not text_blocks:
            raise SummarizationError("No text content in API response")

        return "\n\n".join(text_blocks).strip()
