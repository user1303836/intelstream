from unittest.mock import AsyncMock, MagicMock

import anthropic
import pytest

from intelstream.services.summarizer import (
    MAX_CONTENT_LENGTH,
    SummarizationError,
    SummarizationService,
)


@pytest.fixture
def summarizer():
    return SummarizationService(api_key="test-api-key")


@pytest.fixture
def mock_message():
    message = MagicMock()
    text_block = MagicMock()
    text_block.text = "This is the summary of the article."
    message.content = [text_block]
    return message


class TestSummarizationService:
    async def test_summarize_success(self, summarizer: SummarizationService, mock_message):
        summarizer._client.messages.create = AsyncMock(return_value=mock_message)

        result = await summarizer.summarize(
            content="This is the article content.",
            title="Test Article",
            source_type="substack",
            author="Test Author",
        )

        assert result == "This is the summary of the article."

    async def test_summarize_without_author(self, summarizer: SummarizationService, mock_message):
        summarizer._client.messages.create = AsyncMock(return_value=mock_message)

        result = await summarizer.summarize(
            content="This is the article content.",
            title="Test Article",
            source_type="rss",
        )

        assert result == "This is the summary of the article."

    async def test_summarize_empty_content_raises_error(self, summarizer: SummarizationService):
        with pytest.raises(SummarizationError, match="Cannot summarize empty content"):
            await summarizer.summarize(
                content="",
                title="Test Article",
                source_type="substack",
            )

    async def test_summarize_whitespace_only_raises_error(self, summarizer: SummarizationService):
        with pytest.raises(SummarizationError, match="Cannot summarize empty content"):
            await summarizer.summarize(
                content="   \n\t  ",
                title="Test Article",
                source_type="substack",
            )

    async def test_summarize_truncates_long_content(
        self, summarizer: SummarizationService, mock_message
    ):
        long_content = "x" * (MAX_CONTENT_LENGTH + 1000)

        mock_create = AsyncMock(return_value=mock_message)
        summarizer._client.messages.create = mock_create

        await summarizer.summarize(
            content=long_content,
            title="Test Article",
            source_type="substack",
        )

        call_args = mock_create.call_args
        prompt = call_args.kwargs["messages"][0]["content"]
        assert len(prompt) < len(long_content)

    async def test_summarize_api_error(self, summarizer: SummarizationService):
        summarizer._client.messages.create = AsyncMock(
            side_effect=anthropic.APIError(message="API Error", request=MagicMock(), body=None)
        )

        with pytest.raises(SummarizationError, match="API error"):
            await summarizer.summarize(
                content="Test content",
                title="Test Article",
                source_type="substack",
            )

    async def test_summarize_empty_response(self, summarizer: SummarizationService):
        mock_message = MagicMock()
        mock_message.content = []

        summarizer._client.messages.create = AsyncMock(return_value=mock_message)

        with pytest.raises(SummarizationError, match="Empty response"):
            await summarizer.summarize(
                content="Test content",
                title="Test Article",
                source_type="substack",
            )

    async def test_summarize_no_text_blocks(self, summarizer: SummarizationService):
        mock_message = MagicMock()
        non_text_block = MagicMock(spec=[])
        mock_message.content = [non_text_block]

        summarizer._client.messages.create = AsyncMock(return_value=mock_message)

        with pytest.raises(SummarizationError, match="No text content"):
            await summarizer.summarize(
                content="Test content",
                title="Test Article",
                source_type="substack",
            )

    async def test_summarize_null_response_content(self, summarizer: SummarizationService):
        mock_message = MagicMock()
        mock_message.content = None

        summarizer._client.messages.create = AsyncMock(return_value=mock_message)

        with pytest.raises(SummarizationError, match="Empty response"):
            await summarizer.summarize(
                content="Test content",
                title="Test Article",
                source_type="substack",
            )

    async def test_summarize_multiple_text_blocks(self, summarizer: SummarizationService):
        mock_message = MagicMock()
        block1 = MagicMock()
        block1.text = "First paragraph."
        block2 = MagicMock()
        block2.text = "Second paragraph."
        mock_message.content = [block1, block2]

        summarizer._client.messages.create = AsyncMock(return_value=mock_message)

        result = await summarizer.summarize(
            content="Test content",
            title="Test Article",
            source_type="substack",
        )

        assert result == "First paragraph.\n\nSecond paragraph."

    async def test_summarize_uses_custom_model(self, mock_message):
        custom_model = "claude-3-opus-20240229"
        summarizer = SummarizationService(api_key="test-key", model=custom_model)

        mock_create = AsyncMock(return_value=mock_message)
        summarizer._client.messages.create = mock_create

        await summarizer.summarize(
            content="Test content",
            title="Test Article",
            source_type="substack",
        )

        call_args = mock_create.call_args
        assert call_args.kwargs["model"] == custom_model

    def test_build_prompt_substack(self, summarizer: SummarizationService):
        prompt = summarizer._build_prompt(
            content="Article content here",
            title="My Substack Post",
            source_type="substack",
            author="John Doe",
        )

        assert "newsletter article" in prompt
        assert "by John Doe" in prompt
        assert "My Substack Post" in prompt
        assert "Article content here" in prompt

    def test_build_prompt_youtube(self, summarizer: SummarizationService):
        prompt = summarizer._build_prompt(
            content="Transcript here",
            title="My Video",
            source_type="youtube",
            author=None,
        )

        assert "video transcript" in prompt
        assert "My Video" in prompt
        assert "by " not in prompt

    def test_build_prompt_rss(self, summarizer: SummarizationService):
        prompt = summarizer._build_prompt(
            content="Blog content",
            title="Blog Post",
            source_type="rss",
            author="Jane Smith",
        )

        assert "blog post" in prompt
        assert "by Jane Smith" in prompt

    def test_build_prompt_unknown_source(self, summarizer: SummarizationService):
        prompt = summarizer._build_prompt(
            content="Content",
            title="Title",
            source_type="unknown",
            author=None,
        )

        assert "article" in prompt
