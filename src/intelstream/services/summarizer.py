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

MODEL_MAX_OUTPUT_TOKENS: dict[str, int] = {
    "claude-3-5-haiku-20241022": 8192,
    "claude-3-5-sonnet-20241022": 8192,
    "claude-sonnet-4-20250514": 16384,
    "claude-3-opus-20240229": 4096,
    "claude-3-haiku-20240307": 4096,
    "claude-3-sonnet-20240229": 4096,
}
DEFAULT_MODEL_MAX_OUTPUT_TOKENS = 4096

SYSTEM_PROMPT = """You are a content summarizer for a Discord channel. Your job is to extract the key insights from articles, videos, and posts in a structured format.

Guidelines:
- Extract the INSIGHTS, not just topics. Each bullet should convey a takeaway.
- Be specific and concrete. Include numbers, names, and examples where relevant.
- Use sub-bullets for supporting evidence, examples, or important caveats.
- Keep the thesis to one sentence that captures the main argument or finding.
- Aim for 4-8 key arguments depending on content length and density.
- Write in a neutral, analytical tone."""

CHAT_SUMMARY_SYSTEM_PROMPT = """You are summarizing a Discord channel conversation. Your job is to extract the key highlights, decisions, and important discussions from the message history provided.

Guidelines:
- Focus on substance: decisions made, questions asked, links shared, and key opinions expressed.
- Group related messages into coherent topics.
- Mention usernames when attributing opinions or actions.
- Skip small talk, greetings, and reactions unless they are relevant to a topic.
- Be concise but thorough."""

ARXIV_PROMPT_ADDITION = """
This is an academic research paper abstract. Focus on:
1. What problem does this paper solve?
2. What is the key innovation or finding?
3. Why does this matter for practitioners?
Keep technical jargon minimal - explain for a smart but non-expert audience."""

_REFUSAL_PATTERNS = [
    "i'm unable to access",
    "i don't have the ability to browse",
    "i cannot access",
    "i can't access",
    "please paste the article",
    "please provide the article",
    "i don't have access to",
    "i cannot browse",
    "i can't browse",
    "i'm not able to access",
    "unable to retrieve the article",
    "i cannot retrieve",
]


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
        self._max_input_length = max_input_length
        self._system_prompt = SYSTEM_PROMPT

        model_limit = MODEL_MAX_OUTPUT_TOKENS.get(model, DEFAULT_MODEL_MAX_OUTPUT_TOKENS)
        if max_tokens > model_limit:
            logger.warning(
                "max_tokens exceeds model limit, clamping",
                requested=max_tokens,
                model=model,
                model_limit=model_limit,
            )
            self._max_tokens = model_limit
        else:
            self._max_tokens = max_tokens

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
            self._check_for_refusal(summary, title)

            logger.info("Summary generated", title=title, summary_length=len(summary))

            return summary

        except anthropic.RateLimitError:
            logger.warning("Rate limited by Anthropic API, retrying...")
            raise
        except anthropic.APIError as e:
            logger.error("Anthropic API error", error=str(e))
            raise SummarizationError(f"API error: {e}") from e

    @retry(
        retry=retry_if_exception_type(anthropic.RateLimitError),
        wait=wait_exponential(multiplier=1, min=4, max=60),
        stop=stop_after_attempt(3),
    )
    async def summarize_chat(self, messages_text: str, message_count: int) -> str:
        if not messages_text or not messages_text.strip():
            raise SummarizationError("Cannot summarize empty messages")

        truncated = messages_text[: self._max_input_length]
        if len(messages_text) > self._max_input_length:
            logger.warning(
                "Chat messages truncated for summarization",
                original_length=len(messages_text),
                truncated_length=self._max_input_length,
            )

        prompt = (
            f"Summarize the following {message_count} messages from a Discord channel.\n\n"
            "Format your response as:\n\n"
            "**Key Topics**\n"
            "- **[Topic]:** [What was discussed and any conclusions]\n\n"
            "**Notable Highlights**\n"
            "- [Important announcements, decisions, or links shared]\n\n"
            "**Active Participants:** [list of most active users]\n\n"
            f"--- Messages ---\n{truncated}"
        )

        try:
            logger.debug(
                "Requesting chat summary from Anthropic",
                message_count=message_count,
                model=self._model,
            )

            message = await self._client.messages.create(
                model=self._model,
                max_tokens=self._max_tokens,
                system=CHAT_SUMMARY_SYSTEM_PROMPT,
                messages=[{"role": "user", "content": prompt}],
            )

            return self._extract_summary(message)

        except anthropic.RateLimitError:
            logger.warning("Rate limited by Anthropic API, retrying...")
            raise
        except anthropic.APIError as e:
            logger.error("Anthropic API error during chat summary", error=str(e))
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
            "blog": "blog post",
            "web": "article",
            "arxiv": "research paper abstract",
            "twitter": "tweet",
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

    def _check_for_refusal(self, summary: str, title: str) -> None:
        summary_lower = summary.lower()
        for pattern in _REFUSAL_PATTERNS:
            if pattern in summary_lower:
                logger.warning(
                    "Summarizer returned refusal response",
                    title=title,
                    pattern=pattern,
                )
                raise SummarizationError(
                    f"Model refused to summarize content (matched: '{pattern}')"
                )

    def _extract_summary(self, message: Any) -> str:
        if not message.content:
            raise SummarizationError("Empty response from API")

        text_blocks = [block.text for block in message.content if hasattr(block, "text")]

        if not text_blocks:
            raise SummarizationError("No text content in API response")

        return "\n\n".join(text_blocks).strip()
