import json
from unittest.mock import AsyncMock, MagicMock, patch

import anthropic
import httpx
import pytest

from intelstream.services.page_analyzer import (
    ExtractionProfile,
    PageAnalysisError,
    PageAnalyzer,
)


@pytest.fixture
def sample_html() -> str:
    return """
    <html>
    <head>
        <title>Test Blog</title>
        <script>console.log('test');</script>
        <style>.hidden { display: none; }</style>
    </head>
    <body>
        <nav>Navigation</nav>
        <main>
            <article class="post-card">
                <h3 class="post-title">First Article</h3>
                <a class="post-link" href="/articles/first">Read more</a>
                <time class="post-date" datetime="2024-01-15">Jan 15, 2024</time>
            </article>
            <article class="post-card">
                <h3 class="post-title">Second Article</h3>
                <a class="post-link" href="/articles/second">Read more</a>
                <time class="post-date" datetime="2024-01-10">Jan 10, 2024</time>
            </article>
        </main>
    </body>
    </html>
    """


@pytest.fixture
def valid_llm_response() -> dict:
    return {
        "site_name": "Test Blog",
        "post_selector": "article.post-card",
        "title_selector": "h3.post-title",
        "url_selector": "a.post-link",
        "url_attribute": "href",
        "date_selector": "time.post-date",
        "date_attribute": "datetime",
        "author_selector": None,
        "base_url": "https://example.com",
    }


class TestPageAnalyzer:
    async def test_analyze_rejects_invalid_url_format(self) -> None:
        analyzer = PageAnalyzer(api_key="test-key")

        with pytest.raises(PageAnalysisError, match="Invalid URL format"):
            await analyzer.analyze("not-a-valid-url")

    async def test_analyze_rejects_non_http_scheme(self) -> None:
        analyzer = PageAnalyzer(api_key="test-key")

        with pytest.raises(PageAnalysisError, match="must use http or https"):
            await analyzer.analyze("ftp://example.com/blog")

    async def test_analyze_success(self, sample_html: str, valid_llm_response: dict) -> None:
        mock_http_client = MagicMock(spec=httpx.AsyncClient)
        mock_response = MagicMock()
        mock_response.text = sample_html
        mock_response.raise_for_status = MagicMock()
        mock_http_client.get = AsyncMock(return_value=mock_response)

        mock_anthropic_response = MagicMock()
        mock_text_block = MagicMock()
        mock_text_block.text = json.dumps(valid_llm_response)
        mock_anthropic_response.content = [mock_text_block]

        analyzer = PageAnalyzer(api_key="test-key", http_client=mock_http_client)
        analyzer._client.messages.create = AsyncMock(return_value=mock_anthropic_response)

        profile = await analyzer.analyze("https://example.com/blog")

        assert profile.site_name == "Test Blog"
        assert profile.post_selector == "article.post-card"
        assert profile.title_selector == "h3.post-title"

    async def test_analyze_http_error(self) -> None:
        mock_http_client = MagicMock(spec=httpx.AsyncClient)
        mock_response = MagicMock()
        mock_response.status_code = 404
        mock_response.raise_for_status = MagicMock(
            side_effect=httpx.HTTPStatusError(
                "Not found", request=MagicMock(), response=mock_response
            )
        )
        mock_http_client.get = AsyncMock(return_value=mock_response)

        analyzer = PageAnalyzer(api_key="test-key", http_client=mock_http_client)

        with pytest.raises(PageAnalysisError, match="Failed to fetch page"):
            await analyzer.analyze("https://example.com/blog")

    async def test_analyze_llm_returns_error(self, sample_html: str) -> None:
        mock_http_client = MagicMock(spec=httpx.AsyncClient)
        mock_response = MagicMock()
        mock_response.text = sample_html
        mock_response.raise_for_status = MagicMock()
        mock_http_client.get = AsyncMock(return_value=mock_response)

        mock_anthropic_response = MagicMock()
        mock_text_block = MagicMock()
        mock_text_block.text = json.dumps({"error": "Could not identify post listing pattern"})
        mock_anthropic_response.content = [mock_text_block]

        analyzer = PageAnalyzer(api_key="test-key", http_client=mock_http_client)
        analyzer._client.messages.create = AsyncMock(return_value=mock_anthropic_response)

        with pytest.raises(PageAnalysisError, match="Could not identify"):
            await analyzer.analyze("https://example.com/blog")

    async def test_analyze_llm_invalid_json(self, sample_html: str) -> None:
        mock_http_client = MagicMock(spec=httpx.AsyncClient)
        mock_response = MagicMock()
        mock_response.text = sample_html
        mock_response.raise_for_status = MagicMock()
        mock_http_client.get = AsyncMock(return_value=mock_response)

        mock_anthropic_response = MagicMock()
        mock_text_block = MagicMock()
        mock_text_block.text = "This is not valid JSON"
        mock_anthropic_response.content = [mock_text_block]

        analyzer = PageAnalyzer(api_key="test-key", http_client=mock_http_client)
        analyzer._client.messages.create = AsyncMock(return_value=mock_anthropic_response)

        with pytest.raises(PageAnalysisError, match="invalid JSON"):
            await analyzer.analyze("https://example.com/blog")

    async def test_analyze_llm_missing_required_field(self, sample_html: str) -> None:
        mock_http_client = MagicMock(spec=httpx.AsyncClient)
        mock_response = MagicMock()
        mock_response.text = sample_html
        mock_response.raise_for_status = MagicMock()
        mock_http_client.get = AsyncMock(return_value=mock_response)

        incomplete_response = {
            "site_name": "Test Blog",
            "post_selector": "article.post-card",
        }
        mock_anthropic_response = MagicMock()
        mock_text_block = MagicMock()
        mock_text_block.text = json.dumps(incomplete_response)
        mock_anthropic_response.content = [mock_text_block]

        analyzer = PageAnalyzer(api_key="test-key", http_client=mock_http_client)
        analyzer._client.messages.create = AsyncMock(return_value=mock_anthropic_response)

        with pytest.raises(PageAnalysisError, match="Missing required field"):
            await analyzer.analyze("https://example.com/blog")

    async def test_analyze_validation_fails_no_posts(self, valid_llm_response: dict) -> None:
        html = "<html><body><div>No matching posts</div></body></html>"

        mock_http_client = MagicMock(spec=httpx.AsyncClient)
        mock_response = MagicMock()
        mock_response.text = html
        mock_response.raise_for_status = MagicMock()
        mock_http_client.get = AsyncMock(return_value=mock_response)

        mock_anthropic_response = MagicMock()
        mock_text_block = MagicMock()
        mock_text_block.text = json.dumps(valid_llm_response)
        mock_anthropic_response.content = [mock_text_block]

        analyzer = PageAnalyzer(api_key="test-key", http_client=mock_http_client)
        analyzer._client.messages.create = AsyncMock(return_value=mock_anthropic_response)

        with pytest.raises(PageAnalysisError, match="Profile validation failed"):
            await analyzer.analyze("https://example.com/blog")

    async def test_analyze_api_error(self, sample_html: str) -> None:
        mock_http_client = MagicMock(spec=httpx.AsyncClient)
        mock_response = MagicMock()
        mock_response.text = sample_html
        mock_response.raise_for_status = MagicMock()
        mock_http_client.get = AsyncMock(return_value=mock_response)

        analyzer = PageAnalyzer(api_key="test-key", http_client=mock_http_client)
        analyzer._client.messages.create = AsyncMock(
            side_effect=anthropic.APIError(message="API Error", request=MagicMock(), body=None)
        )

        with pytest.raises(PageAnalysisError, match="LLM API error"):
            await analyzer.analyze("https://example.com/blog")

    async def test_analyze_without_http_client(
        self, sample_html: str, valid_llm_response: dict
    ) -> None:
        with patch("intelstream.services.page_analyzer.httpx.AsyncClient") as mock_client_class:
            mock_client = MagicMock()
            mock_response = MagicMock()
            mock_response.text = sample_html
            mock_response.raise_for_status = MagicMock()
            mock_client.get = AsyncMock(return_value=mock_response)
            mock_client.__aenter__ = AsyncMock(return_value=mock_client)
            mock_client.__aexit__ = AsyncMock(return_value=None)
            mock_client_class.return_value = mock_client

            mock_anthropic_response = MagicMock()
            mock_text_block = MagicMock()
            mock_text_block.text = json.dumps(valid_llm_response)
            mock_anthropic_response.content = [mock_text_block]

            analyzer = PageAnalyzer(api_key="test-key")
            analyzer._client.messages.create = AsyncMock(return_value=mock_anthropic_response)

            profile = await analyzer.analyze("https://example.com/blog")
            assert profile.site_name == "Test Blog"

    def test_clean_html_removes_scripts(self) -> None:
        html = """
        <html>
        <head><script>alert('xss')</script></head>
        <body>
            <article class="post">
                <h1>Title</h1>
                <script>console.log('test');</script>
            </article>
        </body>
        </html>
        """
        analyzer = PageAnalyzer(api_key="test-key")
        cleaned = analyzer._clean_html(html)

        assert "<script>" not in cleaned
        assert "alert" not in cleaned
        assert "console.log" not in cleaned

    def test_clean_html_removes_styles(self) -> None:
        html = """
        <html>
        <head><style>.hidden { display: none; }</style></head>
        <body>
            <article class="post">Content</article>
        </body>
        </html>
        """
        analyzer = PageAnalyzer(api_key="test-key")
        cleaned = analyzer._clean_html(html)

        assert "<style>" not in cleaned
        assert "display: none" not in cleaned

    def test_clean_html_preserves_important_attributes(self) -> None:
        html = """
        <html>
        <body>
            <article class="post" id="post-1" data-tracking="abc">
                <a href="/link" class="link">Click</a>
                <time datetime="2024-01-15">Jan 15</time>
            </article>
        </body>
        </html>
        """
        analyzer = PageAnalyzer(api_key="test-key")
        cleaned = analyzer._clean_html(html)

        assert 'class="post"' in cleaned
        assert 'id="post-1"' in cleaned
        assert 'href="/link"' in cleaned
        assert 'datetime="2024-01-15"' in cleaned
        assert "data-tracking" not in cleaned

    def test_validate_profile_valid(self, sample_html: str) -> None:
        profile = ExtractionProfile(
            site_name="Test",
            post_selector="article.post-card",
            title_selector="h3.post-title",
            url_selector="a.post-link",
            url_attribute="href",
        )
        analyzer = PageAnalyzer(api_key="test-key")
        result = analyzer._validate_profile(sample_html, profile)

        assert result["valid"] is True
        assert result["post_count"] == 2

    def test_validate_profile_no_matching_posts(self, sample_html: str) -> None:
        profile = ExtractionProfile(
            site_name="Test",
            post_selector="div.nonexistent",
            title_selector="h1",
            url_selector="a",
            url_attribute="href",
        )
        analyzer = PageAnalyzer(api_key="test-key")
        result = analyzer._validate_profile(sample_html, profile)

        assert result["valid"] is False
        assert "No elements found" in result["reason"]

    def test_validate_profile_cannot_extract_data(self) -> None:
        html = """
        <html>
        <body>
            <article class="post">
                <span>No title or link here</span>
            </article>
        </body>
        </html>
        """
        profile = ExtractionProfile(
            site_name="Test",
            post_selector="article.post",
            title_selector="h2.title",
            url_selector="a.link",
            url_attribute="href",
        )
        analyzer = PageAnalyzer(api_key="test-key")
        result = analyzer._validate_profile(html, profile)

        assert result["valid"] is False
        assert "Could not extract" in result["reason"]

    async def test_analyze_extracts_json_from_markdown(
        self, sample_html: str, valid_llm_response: dict
    ) -> None:
        mock_http_client = MagicMock(spec=httpx.AsyncClient)
        mock_response = MagicMock()
        mock_response.text = sample_html
        mock_response.raise_for_status = MagicMock()
        mock_http_client.get = AsyncMock(return_value=mock_response)

        mock_anthropic_response = MagicMock()
        mock_text_block = MagicMock()
        mock_text_block.text = f"```json\n{json.dumps(valid_llm_response)}\n```"
        mock_anthropic_response.content = [mock_text_block]

        analyzer = PageAnalyzer(api_key="test-key", http_client=mock_http_client)
        analyzer._client.messages.create = AsyncMock(return_value=mock_anthropic_response)

        profile = await analyzer.analyze("https://example.com/blog")

        assert profile.site_name == "Test Blog"

    def test_validate_profile_invalid_post_selector(self, sample_html: str) -> None:
        profile = ExtractionProfile(
            site_name="Test",
            post_selector="[invalid selector syntax",
            title_selector="h3",
            url_selector="a",
            url_attribute="href",
        )
        analyzer = PageAnalyzer(api_key="test-key")
        result = analyzer._validate_profile(sample_html, profile)

        assert result["valid"] is False
        assert "Invalid CSS selector" in result["reason"]

    def test_validate_profile_invalid_title_selector(self, sample_html: str) -> None:
        profile = ExtractionProfile(
            site_name="Test",
            post_selector="article.post-card",
            title_selector="h3[unclosed",
            url_selector="a.post-link",
            url_attribute="href",
        )
        analyzer = PageAnalyzer(api_key="test-key")
        result = analyzer._validate_profile(sample_html, profile)

        assert result["valid"] is False
        assert "Invalid CSS selector" in result["reason"]
