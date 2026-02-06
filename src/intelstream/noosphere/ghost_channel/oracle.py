from __future__ import annotations

from dataclasses import dataclass

import structlog

logger = structlog.get_logger(__name__)

GHOST_ORACLE_SYSTEM_PROMPT = (
    "You are a pareidolic oracle. You receive questions and generate responses "
    "as if you were a pattern-recognition engine interpreting structured noise. "
    "Your outputs should feel uncannily relevant to the question while being "
    "explicitly non-factual. You are a Rorschach test, not an authority. "
    "Keep responses to 1-2 sentences. Be cryptic but evocative."
)


@dataclass
class OracleResponse:
    question: str
    response: str
    fragments_used: list[str]


class GhostOracle:
    """Generates pareidolic oracle responses using LLM with high temperature.

    The oracle produces pattern-like responses that feel relevant to questions
    while being explicitly non-factual. Uses community data fragments as
    source material for pattern-matching.
    """

    def __init__(
        self,
        temperature: float = 0.9,
        top_p: float = 0.95,
    ):
        self.temperature = temperature
        self.top_p = top_p

    async def generate_response(
        self,
        question: str,
        fragments: list[str] | None = None,
        anthropic_client: object | None = None,
    ) -> OracleResponse:
        """Generate an oracle response. Falls back to template if no LLM client."""
        used_fragments = fragments[:3] if fragments else []

        if anthropic_client is not None:
            response_text = await self._llm_response(question, used_fragments, anthropic_client)
        else:
            response_text = self._template_response(question, used_fragments)

        return OracleResponse(
            question=question,
            response=response_text,
            fragments_used=used_fragments,
        )

    async def _llm_response(
        self,
        question: str,
        fragments: list[str],
        client: object,
    ) -> str:
        fragment_context = ""
        if fragments:
            fragment_context = "\n\nPatterns detected in the noise: " + " | ".join(fragments)

        user_message = f"The questioner asks: {question}{fragment_context}"

        try:
            from anthropic import AsyncAnthropic

            if not isinstance(client, AsyncAnthropic):
                return self._template_response(question, fragments)

            response = await client.messages.create(
                model="claude-3-5-haiku-20241022",
                max_tokens=150,
                temperature=self.temperature,
                top_p=self.top_p,
                system=GHOST_ORACLE_SYSTEM_PROMPT,
                messages=[{"role": "user", "content": user_message}],
            )

            if response.content and len(response.content) > 0:
                return response.content[0].text  # type: ignore[union-attr]
        except Exception:
            logger.exception("Ghost oracle LLM call failed, using template fallback")

        return self._template_response(question, fragments)

    def _template_response(self, question: str, fragments: list[str]) -> str:
        words = question.lower().split()
        key_word = max(words, key=len) if words else "silence"

        if fragments:
            return (
                f"The noise arranges itself around '{key_word}'. A pattern emerges: {fragments[0]}"
            )
        return (
            f"In the static, the shape of '{key_word}' repeats. "
            "Whether this means anything is your decision, not the oracle's."
        )
