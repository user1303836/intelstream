from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock, PropertyMock, patch

import pytest

from intelstream.services.llm_client import (
    GeminiLLMClient,
    LLMError,
    OpenAILLMClient,
)


class TestOpenAILLMClientEmptyChoices:
    @pytest.mark.asyncio
    async def test_empty_choices_raises_llm_error(self) -> None:
        with patch("openai.AsyncOpenAI"):
            client = OpenAILLMClient(api_key="test-key", model="gpt-4")

        mock_response = MagicMock()
        mock_response.choices = []
        client._client.chat.completions.create = AsyncMock(return_value=mock_response)

        with pytest.raises(LLMError, match="no choices returned"):
            await client.complete("system", "hello", 100)

    @pytest.mark.asyncio
    async def test_none_content_raises_llm_error(self) -> None:
        with patch("openai.AsyncOpenAI"):
            client = OpenAILLMClient(api_key="test-key", model="gpt-4")

        mock_choice = MagicMock()
        mock_choice.message.content = None
        mock_response = MagicMock()
        mock_response.choices = [mock_choice]
        client._client.chat.completions.create = AsyncMock(return_value=mock_response)

        with pytest.raises(LLMError, match="Empty response from OpenAI"):
            await client.complete("system", "hello", 100)

    @pytest.mark.asyncio
    async def test_valid_response_returns_content(self) -> None:
        with patch("openai.AsyncOpenAI"):
            client = OpenAILLMClient(api_key="test-key", model="gpt-4")

        mock_choice = MagicMock()
        mock_choice.message.content = "  Hello world  "
        mock_response = MagicMock()
        mock_response.choices = [mock_choice]
        client._client.chat.completions.create = AsyncMock(return_value=mock_response)

        result = await client.complete("system", "hello", 100)
        assert result == "Hello world"


class TestGeminiLLMClientSafetyFilter:
    @pytest.mark.asyncio
    async def test_safety_blocked_raises_llm_error(self) -> None:
        with patch("google.genai.Client"):
            client = GeminiLLMClient(api_key="test-key", model="gemini-pro")

        mock_response = MagicMock()
        type(mock_response).text = PropertyMock(
            side_effect=ValueError("Response has no candidates")
        )
        client._client.aio.models.generate_content = AsyncMock(return_value=mock_response)

        with pytest.raises(LLMError, match="blocked by safety filter"):
            await client.complete("system", "hello", 100)

    @pytest.mark.asyncio
    async def test_empty_text_raises_llm_error(self) -> None:
        with patch("google.genai.Client"):
            client = GeminiLLMClient(api_key="test-key", model="gemini-pro")

        mock_response = MagicMock()
        type(mock_response).text = PropertyMock(return_value="")
        client._client.aio.models.generate_content = AsyncMock(return_value=mock_response)

        with pytest.raises(LLMError, match="Empty response from Gemini"):
            await client.complete("system", "hello", 100)

    @pytest.mark.asyncio
    async def test_valid_response_returns_text(self) -> None:
        with patch("google.genai.Client"):
            client = GeminiLLMClient(api_key="test-key", model="gemini-pro")

        mock_response = MagicMock()
        type(mock_response).text = PropertyMock(return_value="  Hello world  ")
        client._client.aio.models.generate_content = AsyncMock(return_value=mock_response)

        result = await client.complete("system", "hello", 100)
        assert result == "Hello world"
