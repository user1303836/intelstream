from __future__ import annotations

from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, PropertyMock, patch

import pytest

from intelstream.services.llm_client import (
    AnthropicLLMClient,
    GeminiLLMClient,
    LLMClient,
    LLMError,
    LLMProvider,
    LLMRateLimitError,
    OpenAILLMClient,
    create_llm_client,
)


class TestBaseLLMClient:
    @pytest.mark.asyncio
    async def test_complete_must_be_implemented(self) -> None:
        with pytest.raises(NotImplementedError):
            await LLMClient().complete("system", "hello", 100)

    @pytest.mark.asyncio
    async def test_close_is_noop(self) -> None:
        await LLMClient().close()


class TestCreateLLMClient:
    def test_creates_provider_from_string(self) -> None:
        with patch("intelstream.services.llm_client.AnthropicLLMClient") as client_cls:
            client = create_llm_client("anthropic", api_key="key", model="claude")

        assert client == client_cls.return_value
        client_cls.assert_called_once_with(api_key="key", model="claude")

    def test_anthropic_provider_enum_creates_anthropic_client(self) -> None:
        with patch("anthropic.AsyncAnthropic") as anthropic_cls:
            client = create_llm_client(LLMProvider.ANTHROPIC, api_key="key", model="claude")

        assert isinstance(client, AnthropicLLMClient)
        anthropic_cls.assert_called_once_with(api_key="key")

    def test_openai_provider_enum_creates_openai_client(self) -> None:
        with patch("openai.AsyncOpenAI") as openai_cls:
            client = create_llm_client(LLMProvider.OPENAI, api_key="key", model="gpt-4o")

        assert isinstance(client, OpenAILLMClient)
        openai_cls.assert_called_once_with(api_key="key")

    def test_gemini_provider_enum_creates_gemini_client(self) -> None:
        with patch("google.genai.Client") as gemini_cls:
            client = create_llm_client(LLMProvider.GEMINI, api_key="key", model="gemini-pro")

        assert isinstance(client, GeminiLLMClient)
        gemini_cls.assert_called_once_with(api_key="key")

    def test_kimi_uses_moonshot_openai_base_url(self) -> None:
        with patch("openai.AsyncOpenAI") as openai_cls:
            client = create_llm_client(LLMProvider.KIMI, api_key="key", model="moonshot")

        assert isinstance(client, OpenAILLMClient)
        openai_cls.assert_called_once_with(
            api_key="key",
            base_url="https://api.moonshot.cn/v1",
        )

    def test_rejects_invalid_provider_string(self) -> None:
        with pytest.raises(ValueError, match="not-a-provider"):
            create_llm_client("not-a-provider", api_key="key", model="model")

    def test_rejects_unknown_provider_object(self) -> None:
        class UnknownProvider:
            def __str__(self) -> str:
                return "custom-provider"

        with pytest.raises(ValueError, match="custom-provider"):
            create_llm_client(UnknownProvider(), api_key="key", model="model")  # type: ignore[arg-type]


class TestAnthropicLLMClient:
    @pytest.mark.asyncio
    async def test_valid_response_joins_text_blocks(self) -> None:
        with patch("anthropic.AsyncAnthropic"):
            client = AnthropicLLMClient(api_key="test-key", model="claude")

        mock_message = MagicMock()
        mock_message.content = [
            SimpleNamespace(text="  first  "),
            object(),
            SimpleNamespace(text="second"),
        ]
        client._client.messages.create = AsyncMock(return_value=mock_message)

        result = await client.complete("system", "hello", 100)

        assert result == "first  \n\nsecond"
        client._client.messages.create.assert_awaited_once_with(
            model="claude",
            max_tokens=100,
            system="system",
            messages=[{"role": "user", "content": "hello"}],
        )

    @pytest.mark.asyncio
    async def test_empty_content_raises_llm_error(self) -> None:
        with patch("anthropic.AsyncAnthropic"):
            client = AnthropicLLMClient(api_key="test-key", model="claude")

        mock_message = MagicMock()
        mock_message.content = []
        client._client.messages.create = AsyncMock(return_value=mock_message)

        with pytest.raises(LLMError, match="Empty response from Anthropic"):
            await client.complete("system", "hello", 100)

    @pytest.mark.asyncio
    async def test_no_text_blocks_raises_llm_error(self) -> None:
        with patch("anthropic.AsyncAnthropic"):
            client = AnthropicLLMClient(api_key="test-key", model="claude")

        mock_message = MagicMock()
        mock_message.content = [object()]
        client._client.messages.create = AsyncMock(return_value=mock_message)

        with pytest.raises(LLMError, match="No text content"):
            await client.complete("system", "hello", 100)

    @pytest.mark.asyncio
    async def test_rate_limit_error_is_normalized(self) -> None:
        class FakeRateLimitError(Exception):
            pass

        with patch("anthropic.AsyncAnthropic"):
            client = AnthropicLLMClient(api_key="test-key", model="claude")

        client._client.messages.create = AsyncMock(side_effect=FakeRateLimitError("slow down"))

        with (
            patch("anthropic.RateLimitError", FakeRateLimitError),
            pytest.raises(LLMRateLimitError, match="slow down"),
        ):
            await client.complete("system", "hello", 100)

    @pytest.mark.asyncio
    async def test_api_error_is_normalized(self) -> None:
        class FakeAPIError(Exception):
            pass

        with patch("anthropic.AsyncAnthropic"):
            client = AnthropicLLMClient(api_key="test-key", model="claude")

        client._client.messages.create = AsyncMock(side_effect=FakeAPIError("bad gateway"))

        with (
            patch("anthropic.APIError", FakeAPIError),
            pytest.raises(LLMError, match="Anthropic API error: bad gateway"),
        ):
            await client.complete("system", "hello", 100)

    @pytest.mark.asyncio
    async def test_close_closes_underlying_client(self) -> None:
        with patch("anthropic.AsyncAnthropic"):
            client = AnthropicLLMClient(api_key="test-key", model="claude")

        client._client.close = AsyncMock()

        await client.close()

        client._client.close.assert_awaited_once()


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

    @pytest.mark.asyncio
    async def test_request_includes_system_and_user_messages(self) -> None:
        with patch("openai.AsyncOpenAI"):
            client = OpenAILLMClient(api_key="test-key", model="gpt-4")

        mock_choice = MagicMock()
        mock_choice.message.content = "ok"
        mock_response = MagicMock()
        mock_response.choices = [mock_choice]
        client._client.chat.completions.create = AsyncMock(return_value=mock_response)

        await client.complete("system prompt", "user prompt", 321)

        client._client.chat.completions.create.assert_awaited_once_with(
            model="gpt-4",
            max_tokens=321,
            messages=[
                {"role": "system", "content": "system prompt"},
                {"role": "user", "content": "user prompt"},
            ],
        )

    @pytest.mark.asyncio
    async def test_rate_limit_error_is_normalized(self) -> None:
        class FakeRateLimitError(Exception):
            pass

        with patch("openai.AsyncOpenAI"):
            client = OpenAILLMClient(api_key="test-key", model="gpt-4")

        client._client.chat.completions.create = AsyncMock(
            side_effect=FakeRateLimitError("limited")
        )

        with (
            patch("openai.RateLimitError", FakeRateLimitError),
            pytest.raises(LLMRateLimitError, match="limited"),
        ):
            await client.complete("system", "hello", 100)

    @pytest.mark.asyncio
    async def test_api_error_is_normalized(self) -> None:
        class FakeAPIError(Exception):
            pass

        with patch("openai.AsyncOpenAI"):
            client = OpenAILLMClient(api_key="test-key", model="gpt-4")

        client._client.chat.completions.create = AsyncMock(side_effect=FakeAPIError("bad"))

        with (
            patch("openai.APIError", FakeAPIError),
            pytest.raises(LLMError, match="OpenAI API error: bad"),
        ):
            await client.complete("system", "hello", 100)

    @pytest.mark.asyncio
    async def test_close_closes_underlying_client(self) -> None:
        with patch("openai.AsyncOpenAI"):
            client = OpenAILLMClient(api_key="test-key", model="gpt-4")

        client._client.close = AsyncMock()

        await client.close()

        client._client.close.assert_awaited_once()


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

    @pytest.mark.asyncio
    async def test_resource_exhausted_error_is_rate_limit(self) -> None:
        class ResourceExhaustedError(Exception):
            pass

        with patch("google.genai.Client"):
            client = GeminiLLMClient(api_key="test-key", model="gemini-pro")

        client._client.aio.models.generate_content = AsyncMock(
            side_effect=ResourceExhaustedError("quota exhausted")
        )

        with pytest.raises(LLMRateLimitError, match="quota exhausted"):
            await client.complete("system", "hello", 100)

    @pytest.mark.asyncio
    async def test_429_error_is_rate_limit(self) -> None:
        with patch("google.genai.Client"):
            client = GeminiLLMClient(api_key="test-key", model="gemini-pro")

        client._client.aio.models.generate_content = AsyncMock(side_effect=RuntimeError("429"))

        with pytest.raises(LLMRateLimitError, match="429"):
            await client.complete("system", "hello", 100)

    @pytest.mark.asyncio
    async def test_generic_error_is_normalized(self) -> None:
        with patch("google.genai.Client"):
            client = GeminiLLMClient(api_key="test-key", model="gemini-pro")

        client._client.aio.models.generate_content = AsyncMock(
            side_effect=RuntimeError("backend down")
        )

        with pytest.raises(LLMError, match="Gemini API error: backend down"):
            await client.complete("system", "hello", 100)
