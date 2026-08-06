import json
from unittest.mock import AsyncMock, MagicMock, patch

import httpx
import pytest
import respx

from intelstream.adapters.strategies.llm_extraction import LLMExtractionStrategy
from intelstream.database.models import ExtractionCache
from intelstream.database.repository import Repository
from intelstream.services.llm_client import LLMError


@pytest.fixture
def mock_repository():
    repo = AsyncMock(spec=Repository)
    repo.get_extraction_cache = AsyncMock(return_value=None)
    repo.set_extraction_cache = AsyncMock()
    return repo


@pytest.fixture
def mock_llm_client():
    client = MagicMock()
    client.complete = AsyncMock()
    return client


@pytest.fixture
def llm_strategy(mock_llm_client, mock_repository):
    return LLMExtractionStrategy(
        llm_client=mock_llm_client,
        repository=mock_repository,
    )


class TestLLMExtractionStrategy:
    async def test_name_property(self, llm_strategy: LLMExtractionStrategy):
        assert llm_strategy.name == "llm"

    @respx.mock
    async def test_discover_extracts_posts(
        self, llm_strategy: LLMExtractionStrategy, mock_llm_client
    ):
        html = """
        <html>
        <body>
            <article><a href="/post/1">Post 1</a></article>
            <article><a href="/post/2">Post 2</a></article>
        </body>
        </html>
        """
        mock_llm_client.complete.return_value = json.dumps(
            [
                {"url": "https://example.com/post/1", "title": "Post 1"},
                {"url": "https://example.com/post/2", "title": "Post 2"},
            ]
        )

        respx.get("https://example.com/blog").mock(return_value=httpx.Response(200, text=html))

        result = await llm_strategy.discover("https://example.com/blog")

        assert result is not None
        assert len(result.posts) == 2
        assert result.posts[0].url == "https://example.com/post/1"
        assert result.posts[0].title == "Post 1"

    @respx.mock
    async def test_discover_uses_cache(
        self, llm_strategy: LLMExtractionStrategy, mock_repository, mock_llm_client
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
        mock_llm_client.complete.assert_not_called()

    @respx.mock
    async def test_discover_caches_result(
        self, llm_strategy: LLMExtractionStrategy, mock_repository, mock_llm_client
    ):
        html = "<html><body>Content</body></html>"
        mock_llm_client.complete.return_value = (
            '[{"url": "https://example.com/new", "title": "New"}]'
        )

        respx.get("https://example.com/").mock(return_value=httpx.Response(200, text=html))

        await llm_strategy.discover("https://example.com/")

        mock_repository.set_extraction_cache.assert_called_once()

    @respx.mock
    async def test_discover_handles_json_in_markdown(
        self, llm_strategy: LLMExtractionStrategy, mock_llm_client
    ):
        html = "<html><body>Content</body></html>"
        mock_llm_client.complete.return_value = (
            '```json\n[{"url": "https://example.com/wrapped", "title": "Wrapped"}]\n```'
        )

        respx.get("https://example.com/").mock(return_value=httpx.Response(200, text=html))

        result = await llm_strategy.discover("https://example.com/")

        assert result is not None
        assert len(result.posts) == 1
        assert result.posts[0].title == "Wrapped"

    @respx.mock
    async def test_discover_resolves_relative_urls(
        self, llm_strategy: LLMExtractionStrategy, mock_llm_client
    ):
        html = "<html><body>Content</body></html>"
        mock_llm_client.complete.return_value = '[{"url": "/post/relative", "title": "Relative"}]'

        respx.get("https://example.com/blog").mock(return_value=httpx.Response(200, text=html))

        result = await llm_strategy.discover("https://example.com/blog")

        assert result is not None
        assert result.posts[0].url == "https://example.com/post/relative"

    @respx.mock
    async def test_discover_returns_none_on_empty_result(
        self, llm_strategy: LLMExtractionStrategy, mock_llm_client
    ):
        html = "<html><body>No posts</body></html>"
        mock_llm_client.complete.return_value = "[]"

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
        self, llm_strategy: LLMExtractionStrategy, mock_llm_client
    ):
        html = "<html><body>Content</body></html>"
        mock_llm_client.complete.return_value = "This is not JSON"

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
        self, llm_strategy: LLMExtractionStrategy, mock_repository, mock_llm_client
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
        mock_llm_client.complete.assert_not_called()

    @respx.mock
    async def test_discover_filters_empty_urls_from_cache(
        self, llm_strategy: LLMExtractionStrategy, mock_repository, mock_llm_client
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
        mock_llm_client.complete.assert_not_called()

    @respx.mock
    async def test_discover_ignores_invalid_cache_json_and_refreshes(
        self, llm_strategy: LLMExtractionStrategy, mock_repository, mock_llm_client
    ):
        html = "<html><body>Content</body></html>"
        cached = MagicMock(spec=ExtractionCache)
        cached.content_hash = llm_strategy._get_content_hash(html)
        cached.posts_json = "{not json"
        mock_repository.get_extraction_cache.return_value = cached
        mock_llm_client.complete.return_value = (
            '[{"url": "https://example.com/fresh", "title": "Fresh"}]'
        )
        respx.get("https://example.com/").mock(return_value=httpx.Response(200, text=html))

        result = await llm_strategy.discover("https://example.com/")

        assert result is not None
        assert result.posts[0].url == "https://example.com/fresh"
        mock_repository.set_extraction_cache.assert_awaited_once()

    @respx.mock
    async def test_discover_ignores_cache_without_valid_posts(
        self, llm_strategy: LLMExtractionStrategy, mock_repository, mock_llm_client
    ):
        html = "<html><body>Content</body></html>"
        cached = MagicMock(spec=ExtractionCache)
        cached.content_hash = llm_strategy._get_content_hash(html)
        cached.posts_json = json.dumps([{"url": "", "title": "Empty"}])
        mock_repository.get_extraction_cache.return_value = cached
        mock_llm_client.complete.return_value = (
            '[{"url": "https://example.com/fresh", "title": "Fresh"}]'
        )
        respx.get("https://example.com/").mock(return_value=httpx.Response(200, text=html))

        result = await llm_strategy.discover("https://example.com/")

        assert result is not None
        assert result.posts[0].url == "https://example.com/fresh"

    @respx.mock
    async def test_discover_ignores_non_list_cache_and_refreshes(
        self, llm_strategy: LLMExtractionStrategy, mock_repository, mock_llm_client
    ):
        html = "<html><body>Content</body></html>"
        cached = MagicMock(spec=ExtractionCache)
        cached.content_hash = llm_strategy._get_content_hash(html)
        cached.posts_json = json.dumps({"url": "https://example.com/not-a-list"})
        mock_repository.get_extraction_cache.return_value = cached
        mock_llm_client.complete.return_value = (
            '[{"url": "https://example.com/fresh", "title": "Fresh"}]'
        )
        respx.get("https://example.com/").mock(return_value=httpx.Response(200, text=html))

        result = await llm_strategy.discover("https://example.com/")

        assert result is not None
        assert result.posts[0].url == "https://example.com/fresh"
        mock_repository.set_extraction_cache.assert_awaited_once()

    async def test_discover_caches_empty_result_after_timeout(
        self, llm_strategy: LLMExtractionStrategy, mock_repository
    ):
        class TimeoutContext:
            async def __aenter__(self) -> None:
                raise TimeoutError

            async def __aexit__(self, *_args: object) -> bool:
                return False

        with (
            patch.object(llm_strategy, "_fetch_html", AsyncMock(return_value="<html>slow</html>")),
            patch("intelstream.adapters.strategies.llm_extraction.asyncio.timeout") as timeout,
        ):
            timeout.return_value = TimeoutContext()
            result = await llm_strategy.discover("https://example.com/")

        assert result is None
        mock_repository.set_extraction_cache.assert_awaited_once()
        assert mock_repository.set_extraction_cache.call_args.args[2] == "[]"

    def test_get_content_hash_falls_back_to_raw_html(self, llm_strategy: LLMExtractionStrategy):
        assert llm_strategy._get_content_hash("") == (
            "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
        )

    def test_get_content_hash_strips_navigation_and_script_tags(
        self, llm_strategy: LLMExtractionStrategy
    ):
        with_noise = llm_strategy._get_content_hash(
            """
            <html>
                <body>
                    <nav>Menu</nav>
                    <script>analytics()</script>
                    <main>Useful Article Text</main>
                </body>
            </html>
            """
        )
        without_noise = llm_strategy._get_content_hash("<main>Useful Article Text</main>")

        assert with_noise == without_noise

    async def test_fetch_html_uses_injected_http_client(self, mock_repository):
        client = MagicMock()
        client.get = AsyncMock(
            return_value=httpx.Response(
                200,
                text="<html>ok</html>",
                request=httpx.Request("GET", "https://example.com/"),
            )
        )
        strategy = LLMExtractionStrategy(
            llm_client=MagicMock(),
            repository=mock_repository,
            http_client=client,
        )

        result = await strategy._fetch_html("https://example.com/")

        assert result == "<html>ok</html>"
        client.get.assert_awaited_once()

    def test_clean_html_removes_noise_tags_and_unneeded_attrs(
        self, llm_strategy: LLMExtractionStrategy
    ):
        html = """
        <main data-extra="remove" href="/kept">
            <svg><path d="M0 0" /></svg>
            <article onclick="remove()" class="post" data-href="/post">Post</article>
        </main>
        """

        cleaned = llm_strategy._clean_html(html)

        assert "<svg" not in cleaned
        assert "onclick" not in cleaned
        assert "data-extra" not in cleaned
        assert 'class="post"' in cleaned
        assert 'data-href="/post"' in cleaned

    def test_clean_html_truncates_at_recent_closing_tag(self, llm_strategy: LLMExtractionStrategy):
        settings = MagicMock()
        settings.max_html_length = 40
        html = "<html><body><p>First</p><p>Second paragraph keeps going</p></body></html>"

        with patch(
            "intelstream.adapters.strategies.llm_extraction.get_settings",
            return_value=settings,
        ):
            cleaned = llm_strategy._clean_html(html)

        assert len(cleaned) <= 40
        assert cleaned.endswith(">")

    def test_clean_html_truncates_to_previous_tag_when_close_is_stale(
        self, llm_strategy: LLMExtractionStrategy
    ):
        settings = MagicMock()
        settings.max_html_length = 1100
        html = "<html><body>" + ("x" * 1200) + "<span>tail</span></body></html>"

        with patch(
            "intelstream.adapters.strategies.llm_extraction.get_settings",
            return_value=settings,
        ):
            cleaned = llm_strategy._clean_html(html)

        assert cleaned == "<html>"

    def test_clean_html_truncates_before_open_tag_when_no_recent_close(
        self, llm_strategy: LLMExtractionStrategy
    ):
        settings = MagicMock()
        settings.max_html_length = 1200
        html = "<html><body><p>short</p>" + ("x" * 1100) + "<article" + ("y" * 200)

        with patch(
            "intelstream.adapters.strategies.llm_extraction.get_settings",
            return_value=settings,
        ):
            cleaned = llm_strategy._clean_html(html)

        assert "<article" not in cleaned

    def test_clean_html_keeps_truncated_prefix_when_no_previous_open_tag(
        self, llm_strategy: LLMExtractionStrategy
    ):
        class FakeSoup:
            def find_all(self, *_args: object, **_kwargs: object) -> list[object]:
                return []

            def __str__(self) -> str:
                return "<" + ("x" * 1200)

        settings = MagicMock()
        settings.max_html_length = 1100

        with (
            patch(
                "intelstream.adapters.strategies.llm_extraction.BeautifulSoup",
                return_value=FakeSoup(),
            ),
            patch(
                "intelstream.adapters.strategies.llm_extraction.get_settings",
                return_value=settings,
            ),
        ):
            cleaned = llm_strategy._clean_html("<html></html>")

        assert cleaned == "<" + ("x" * 1099)

    async def test_extract_with_llm_skips_ssrf_blocked_urls(
        self, llm_strategy: LLMExtractionStrategy, mock_llm_client
    ):
        mock_llm_client.complete.return_value = json.dumps(
            [
                {"url": "http://localhost/admin", "title": "Blocked"},
                {"url": "/safe", "title": "Safe"},
            ]
        )

        posts = await llm_strategy._extract_with_llm(
            "<html><body>Posts</body></html>",
            "https://example.com/blog",
        )

        assert [post.url for post in posts] == ["https://example.com/safe"]

    def test_extract_json_falls_back_from_invalid_markdown_to_embedded_array(
        self, llm_strategy: LLMExtractionStrategy
    ):
        text = (
            '```json\n{"url": "https://example.com/not-a-list"}\n```\n'
            'Fallback [{"url": "https://example.com/array", "title": "Array"}]'
        )

        result = llm_strategy._extract_json_from_response(text)

        assert result == [{"url": "https://example.com/array", "title": "Array"}]

    def test_extract_json_returns_empty_for_invalid_embedded_array(
        self, llm_strategy: LLMExtractionStrategy
    ):
        result = llm_strategy._extract_json_from_response("Noisy [not json] response")

        assert result == []

    async def test_extract_with_llm_handles_api_error(
        self, llm_strategy: LLMExtractionStrategy, mock_llm_client
    ):
        mock_llm_client.complete.side_effect = LLMError("api failed")

        assert await llm_strategy._extract_with_llm("<html></html>", "https://example.com") == []


@pytest.fixture(autouse=True)
def adapt_legacy_http_client_mocks():
    async def request(client, method, url, **kwargs):
        kwargs.pop("validate_ssrf", None)
        kwargs.pop("max_response_bytes", None)
        kwargs.pop("max_redirects", None)
        return await getattr(client, method.lower())(url, follow_redirects=False, **kwargs)

    with patch("intelstream.adapters.strategies.llm_extraction.safe_request", side_effect=request):
        yield
