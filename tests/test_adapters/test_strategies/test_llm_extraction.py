import json
from unittest.mock import AsyncMock, MagicMock

import httpx
import pytest
import respx

from intelstream.adapters.strategies.llm_extraction import LLMExtractionStrategy
from intelstream.database.models import ExtractionCache
from intelstream.database.repository import Repository


@pytest.fixture
def mock_repository():
    repo = AsyncMock(spec=Repository)
    repo.get_extraction_cache = AsyncMock(return_value=None)
    repo.set_extraction_cache = AsyncMock()
    return repo


@pytest.fixture
def mock_anthropic_client():
    client = MagicMock()
    client.messages = MagicMock()
    client.messages.create = AsyncMock()
    return client


@pytest.fixture
def llm_strategy(mock_anthropic_client, mock_repository):
    return LLMExtractionStrategy(
        anthropic_client=mock_anthropic_client,
        repository=mock_repository,
    )


class TestLLMExtractionStrategy:
    async def test_name_property(self, llm_strategy: LLMExtractionStrategy):
        assert llm_strategy.name == "llm"

    @respx.mock
    async def test_discover_extracts_posts(
        self, llm_strategy: LLMExtractionStrategy, mock_anthropic_client
    ):
        html = """
        <html>
        <body>
            <article><a href="/post/1">Post 1</a></article>
            <article><a href="/post/2">Post 2</a></article>
        </body>
        </html>
        """
        llm_response = MagicMock()
        llm_response.content = [
            MagicMock(
                text=json.dumps(
                    [
                        {"url": "https://example.com/post/1", "title": "Post 1"},
                        {"url": "https://example.com/post/2", "title": "Post 2"},
                    ]
                )
            )
        ]
        mock_anthropic_client.messages.create.return_value = llm_response

        respx.get("https://example.com/blog").mock(return_value=httpx.Response(200, text=html))

        result = await llm_strategy.discover("https://example.com/blog")

        assert result is not None
        assert len(result.posts) == 2
        assert result.posts[0].url == "https://example.com/post/1"
        assert result.posts[0].title == "Post 1"

    @respx.mock
    async def test_discover_uses_cache(
        self, llm_strategy: LLMExtractionStrategy, mock_repository, mock_anthropic_client
    ):
        html = "<html><body>Content</body></html>"
        expected_hash = llm_strategy._get_content_hash(html)

        cached = MagicMock(spec=ExtractionCache)
        cached.content_hash = expected_hash
        cached.posts_json = json.dumps([{"url": "https://example.com/cached", "title": "Cached"}])

        mock_repository.get_extraction_cache.return_value = cached

        respx.get("https://example.com/").mock(return_value=httpx.Response(200, text=html))

        result = await llm_strategy.discover("https://example.com/")

        assert result is not None
        assert len(result.posts) == 1
        assert result.posts[0].url == "https://example.com/cached"
        mock_anthropic_client.messages.create.assert_not_called()

    @respx.mock
    async def test_discover_caches_result(
        self, llm_strategy: LLMExtractionStrategy, mock_repository, mock_anthropic_client
    ):
        html = "<html><body>Content</body></html>"
        llm_response = MagicMock()
        llm_response.content = [
            MagicMock(text='[{"url": "https://example.com/new", "title": "New"}]')
        ]
        mock_anthropic_client.messages.create.return_value = llm_response

        respx.get("https://example.com/").mock(return_value=httpx.Response(200, text=html))

        await llm_strategy.discover("https://example.com/")

        mock_repository.set_extraction_cache.assert_called_once()

    @respx.mock
    async def test_discover_handles_json_in_markdown(
        self, llm_strategy: LLMExtractionStrategy, mock_anthropic_client
    ):
        html = "<html><body>Content</body></html>"
        llm_response = MagicMock()
        llm_response.content = [
            MagicMock(
                text='```json\n[{"url": "https://example.com/wrapped", "title": "Wrapped"}]\n```'
            )
        ]
        mock_anthropic_client.messages.create.return_value = llm_response

        respx.get("https://example.com/").mock(return_value=httpx.Response(200, text=html))

        result = await llm_strategy.discover("https://example.com/")

        assert result is not None
        assert len(result.posts) == 1
        assert result.posts[0].title == "Wrapped"

    @respx.mock
    async def test_discover_resolves_relative_urls(
        self, llm_strategy: LLMExtractionStrategy, mock_anthropic_client
    ):
        html = "<html><body>Content</body></html>"
        llm_response = MagicMock()
        llm_response.content = [MagicMock(text='[{"url": "/post/relative", "title": "Relative"}]')]
        mock_anthropic_client.messages.create.return_value = llm_response

        respx.get("https://example.com/blog").mock(return_value=httpx.Response(200, text=html))

        result = await llm_strategy.discover("https://example.com/blog")

        assert result is not None
        assert result.posts[0].url == "https://example.com/post/relative"

    @respx.mock
    async def test_discover_returns_none_on_empty_result(
        self, llm_strategy: LLMExtractionStrategy, mock_anthropic_client
    ):
        html = "<html><body>No posts</body></html>"
        llm_response = MagicMock()
        llm_response.content = [MagicMock(text="[]")]
        mock_anthropic_client.messages.create.return_value = llm_response

        respx.get("https://example.com/").mock(return_value=httpx.Response(200, text=html))

        result = await llm_strategy.discover("https://example.com/")

        assert result is None

    @respx.mock
    async def test_discover_handles_fetch_error(self, llm_strategy: LLMExtractionStrategy):
        respx.get("https://example.com/").mock(side_effect=httpx.ConnectError("Network error"))

        result = await llm_strategy.discover("https://example.com/")

        assert result is None

    @respx.mock
    async def test_discover_handles_invalid_json(
        self, llm_strategy: LLMExtractionStrategy, mock_anthropic_client
    ):
        html = "<html><body>Content</body></html>"
        llm_response = MagicMock()
        llm_response.content = [MagicMock(text="This is not JSON")]
        mock_anthropic_client.messages.create.return_value = llm_response

        respx.get("https://example.com/").mock(return_value=httpx.Response(200, text=html))

        result = await llm_strategy.discover("https://example.com/")

        assert result is None

    async def test_extract_json_from_response_plain(self, llm_strategy: LLMExtractionStrategy):
        text = '[{"url": "test", "title": "Test"}]'
        result = llm_strategy._extract_json_from_response(text)
        assert len(result) == 1

    async def test_extract_json_from_response_with_markdown(
        self, llm_strategy: LLMExtractionStrategy
    ):
        text = 'Here is the JSON:\n```json\n[{"url": "test", "title": "Test"}]\n```'
        result = llm_strategy._extract_json_from_response(text)
        assert len(result) == 1

    async def test_extract_json_from_response_with_surrounding_text(
        self, llm_strategy: LLMExtractionStrategy
    ):
        text = 'Found these posts: [{"url": "test", "title": "Test"}] That\'s all.'
        result = llm_strategy._extract_json_from_response(text)
        assert len(result) == 1

    async def test_extract_json_filters_non_dict_items(self, llm_strategy: LLMExtractionStrategy):
        text = '["string1", "string2", {"url": "valid", "title": "Valid Post"}]'
        result = llm_strategy._extract_json_from_response(text)
        assert len(result) == 1
        assert result[0]["url"] == "valid"

    async def test_extract_json_filters_items_without_url(
        self, llm_strategy: LLMExtractionStrategy
    ):
        text = '[{"title": "No URL"}, {"url": "valid", "title": "Has URL"}]'
        result = llm_strategy._extract_json_from_response(text)
        assert len(result) == 1
        assert result[0]["url"] == "valid"

    async def test_extract_json_filters_items_with_null_url(
        self, llm_strategy: LLMExtractionStrategy
    ):
        text = '[{"url": null, "title": "Null URL"}, {"url": "valid", "title": "Valid"}]'
        result = llm_strategy._extract_json_from_response(text)
        assert len(result) == 1
        assert result[0]["url"] == "valid"

    async def test_extract_json_filters_items_with_empty_url(
        self, llm_strategy: LLMExtractionStrategy
    ):
        text = '[{"url": "", "title": "Empty URL"}, {"url": "valid", "title": "Valid"}]'
        result = llm_strategy._extract_json_from_response(text)
        assert len(result) == 1
        assert result[0]["url"] == "valid"

    async def test_extract_json_handles_non_string_title(self, llm_strategy: LLMExtractionStrategy):
        text = '[{"url": "test", "title": 123}]'
        result = llm_strategy._extract_json_from_response(text)
        assert len(result) == 1
        assert result[0]["title"] == "123"

    async def test_extract_json_returns_empty_for_non_list(
        self, llm_strategy: LLMExtractionStrategy
    ):
        text = '{"url": "test", "title": "Not a list"}'
        result = llm_strategy._extract_json_from_response(text)
        assert len(result) == 0

    @respx.mock
    async def test_discover_uses_cache_with_validated_data(
        self, llm_strategy: LLMExtractionStrategy, mock_repository, mock_anthropic_client
    ):
        html = "<html><body>Content</body></html>"
        expected_hash = llm_strategy._get_content_hash(html)

        cached = MagicMock(spec=ExtractionCache)
        cached.content_hash = expected_hash
        cached.posts_json = json.dumps(
            ["string", {"url": "https://example.com/valid", "title": "Valid"}, None]
        )

        mock_repository.get_extraction_cache.return_value = cached

        respx.get("https://example.com/").mock(return_value=httpx.Response(200, text=html))

        result = await llm_strategy.discover("https://example.com/")

        assert result is not None
        assert len(result.posts) == 1
        assert result.posts[0].url == "https://example.com/valid"
        mock_anthropic_client.messages.create.assert_not_called()

    @respx.mock
    async def test_discover_filters_empty_urls_from_cache(
        self, llm_strategy: LLMExtractionStrategy, mock_repository, mock_anthropic_client
    ):
        html = "<html><body>Content</body></html>"
        expected_hash = llm_strategy._get_content_hash(html)

        cached = MagicMock(spec=ExtractionCache)
        cached.content_hash = expected_hash
        cached.posts_json = json.dumps(
            [
                {"url": "", "title": "Empty URL"},
                {"url": "https://example.com/valid", "title": "Valid"},
            ]
        )

        mock_repository.get_extraction_cache.return_value = cached

        respx.get("https://example.com/").mock(return_value=httpx.Response(200, text=html))

        result = await llm_strategy.discover("https://example.com/")

        assert result is not None
        assert len(result.posts) == 1
        assert result.posts[0].url == "https://example.com/valid"
        mock_anthropic_client.messages.create.assert_not_called()
