from __future__ import annotations

import enum
from typing import Any

import structlog

logger = structlog.get_logger()


class LLMProvider(enum.StrEnum):
    ANTHROPIC = "anthropic"
    OPENAI = "openai"
    GEMINI = "gemini"
    KIMI = "kimi"


class LLMError(Exception):
    pass


class LLMRateLimitError(LLMError):
    pass


class LLMClient:
    """Unified async interface for LLM providers."""

    async def complete(self, system: str, user_message: str, max_tokens: int) -> str:
        raise NotImplementedError

    async def close(self) -> None:
        pass


class AnthropicLLMClient(LLMClient):
    def __init__(self, api_key: str, model: str) -> None:
        import anthropic

        self._client = anthropic.AsyncAnthropic(api_key=api_key)
        self._model = model

    async def complete(self, system: str, user_message: str, max_tokens: int) -> str:
        import anthropic

        try:
            message = await self._client.messages.create(
                model=self._model,
                max_tokens=max_tokens,
                system=system,
                messages=[{"role": "user", "content": user_message}],
            )
        except anthropic.RateLimitError as e:
            raise LLMRateLimitError(str(e)) from e
        except anthropic.APIError as e:
            raise LLMError(f"Anthropic API error: {e}") from e

        if not message.content:
            raise LLMError("Empty response from Anthropic")

        text_blocks = [block.text for block in message.content if hasattr(block, "text")]
        if not text_blocks:
            raise LLMError("No text content in Anthropic response")

        return "\n\n".join(text_blocks).strip()

    async def close(self) -> None:
        await self._client.close()


class OpenAILLMClient(LLMClient):
    def __init__(self, api_key: str, model: str, base_url: str | None = None) -> None:
        import openai

        kwargs: dict[str, Any] = {"api_key": api_key}
        if base_url:
            kwargs["base_url"] = base_url
        self._client = openai.AsyncOpenAI(**kwargs)
        self._model = model

    async def complete(self, system: str, user_message: str, max_tokens: int) -> str:
        import openai

        try:
            response = await self._client.chat.completions.create(
                model=self._model,
                max_tokens=max_tokens,
                messages=[
                    {"role": "system", "content": system},
                    {"role": "user", "content": user_message},
                ],
            )
        except openai.RateLimitError as e:
            raise LLMRateLimitError(str(e)) from e
        except openai.APIError as e:
            raise LLMError(f"OpenAI API error: {e}") from e

        content = response.choices[0].message.content
        if not content:
            raise LLMError("Empty response from OpenAI")
        return content.strip()

    async def close(self) -> None:
        await self._client.close()


class GeminiLLMClient(LLMClient):
    def __init__(self, api_key: str, model: str) -> None:
        from google import genai

        self._client = genai.Client(api_key=api_key)
        self._model = model

    async def complete(self, system: str, user_message: str, max_tokens: int) -> str:
        from google.genai import types

        try:
            response = await self._client.aio.models.generate_content(
                model=self._model,
                config=types.GenerateContentConfig(
                    system_instruction=system,
                    max_output_tokens=max_tokens,
                ),
                contents=user_message,
            )
        except Exception as e:
            error_name = type(e).__name__
            if "ResourceExhausted" in error_name or "429" in str(e):
                raise LLMRateLimitError(str(e)) from e
            raise LLMError(f"Gemini API error: {e}") from e

        if not response.text:
            raise LLMError("Empty response from Gemini")
        return response.text.strip()


def create_llm_client(
    provider: LLMProvider | str,
    api_key: str,
    model: str,
) -> LLMClient:
    if isinstance(provider, str):
        provider = LLMProvider(provider)

    if provider == LLMProvider.ANTHROPIC:
        return AnthropicLLMClient(api_key=api_key, model=model)

    if provider == LLMProvider.OPENAI:
        return OpenAILLMClient(api_key=api_key, model=model)

    if provider == LLMProvider.GEMINI:
        return GeminiLLMClient(api_key=api_key, model=model)

    if provider == LLMProvider.KIMI:
        return OpenAILLMClient(
            api_key=api_key,
            model=model,
            base_url="https://api.moonshot.cn/v1",
        )

    raise ValueError(f"Unknown LLM provider: {provider}")
