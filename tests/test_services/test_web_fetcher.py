from unittest.mock import AsyncMock, MagicMock, patch

import httpx
import pytest

from intelstream.services.web_fetcher import WebContent, WebFetcher, WebFetchError


@pytest.fixture
def sample_html():
    return """
    <!DOCTYPE html>
    <html>
    <head>
        <title>Test Article Title</title>
        <meta property="og:title" content="OG Title">
        <meta property="og:image" content="https://example.com/image.jpg">
        <meta name="author" content="John Doe">
        <meta property="article:published_time" content="2024-01-15T12:00:00Z">
    </head>
    <body>
        <header>Navigation content</header>
        <article>
            <h1>Article Headline</h1>
            <p>This is the main content of the article. It contains enough text to pass the minimum content length requirement for summarization.</p>
            <p>More content here to ensure we have enough text for the validation to pass.</p>
        </article>
        <footer>Footer content</footer>
    </body>
    </html>
    """


@pytest.fixture
def minimal_html():
    return """
    <!DOCTYPE html>
    <html>
    <head><title>Short Page</title></head>
    <body><p>Too short</p></body>
    </html>
    """


class TestWebFetcher:
    async def test_fetch_success(self, sample_html):
        mock_response = MagicMock(spec=httpx.Response)
        mock_response.text = sample_html
        mock_response.headers = {"content-type": "text/html; charset=utf-8"}
        mock_response.raise_for_status = MagicMock()

        mock_client = MagicMock(spec=httpx.AsyncClient)
        mock_client.get = AsyncMock(return_value=mock_response)

        fetcher = WebFetcher(http_client=mock_client)
        result = await fetcher.fetch("https://example.com/article")

        assert isinstance(result, WebContent)
        assert result.url == "https://example.com/article"
        assert result.title == "OG Title"
        assert result.author == "John Doe"
        assert result.thumbnail_url == "https://example.com/image.jpg"
        assert "main content" in result.content

    async def test_fetch_extracts_title_from_og_tag(self, sample_html):
        mock_response = MagicMock(spec=httpx.Response)
        mock_response.text = sample_html
        mock_response.headers = {"content-type": "text/html"}
        mock_response.raise_for_status = MagicMock()

        mock_client = MagicMock(spec=httpx.AsyncClient)
        mock_client.get = AsyncMock(return_value=mock_response)

        fetcher = WebFetcher(http_client=mock_client)
        result = await fetcher.fetch("https://example.com/article")

        assert result.title == "OG Title"

    async def test_fetch_extracts_title_from_title_tag(self):
        html = """
        <html>
        <head><title>Title Tag Content</title></head>
        <body><article><p>Enough content here to pass validation. This is a test article with sufficient text that exceeds the minimum one hundred character requirement for content validation.</p></article></body>
        </html>
        """

        mock_response = MagicMock(spec=httpx.Response)
        mock_response.text = html
        mock_response.headers = {"content-type": "text/html"}
        mock_response.raise_for_status = MagicMock()

        mock_client = MagicMock(spec=httpx.AsyncClient)
        mock_client.get = AsyncMock(return_value=mock_response)

        fetcher = WebFetcher(http_client=mock_client)
        result = await fetcher.fetch("https://example.com/article")

        assert result.title == "Title Tag Content"

    async def test_fetch_extracts_content_from_article_tag(self, sample_html):
        mock_response = MagicMock(spec=httpx.Response)
        mock_response.text = sample_html
        mock_response.headers = {"content-type": "text/html"}
        mock_response.raise_for_status = MagicMock()

        mock_client = MagicMock(spec=httpx.AsyncClient)
        mock_client.get = AsyncMock(return_value=mock_response)

        fetcher = WebFetcher(http_client=mock_client)
        result = await fetcher.fetch("https://example.com/article")

        assert "Article Headline" in result.content
        assert "main content" in result.content
        assert "Navigation content" not in result.content

    async def test_fetch_extracts_published_date(self, sample_html):
        mock_response = MagicMock(spec=httpx.Response)
        mock_response.text = sample_html
        mock_response.headers = {"content-type": "text/html"}
        mock_response.raise_for_status = MagicMock()

        mock_client = MagicMock(spec=httpx.AsyncClient)
        mock_client.get = AsyncMock(return_value=mock_response)

        fetcher = WebFetcher(http_client=mock_client)
        result = await fetcher.fetch("https://example.com/article")

        assert result.published_at is not None
        assert result.published_at.year == 2024
        assert result.published_at.month == 1
        assert result.published_at.day == 15

    async def test_fetch_raises_on_insufficient_content(self, minimal_html):
        mock_response = MagicMock(spec=httpx.Response)
        mock_response.text = minimal_html
        mock_response.headers = {"content-type": "text/html"}
        mock_response.raise_for_status = MagicMock()

        mock_client = MagicMock(spec=httpx.AsyncClient)
        mock_client.get = AsyncMock(return_value=mock_response)

        fetcher = WebFetcher(http_client=mock_client)

        with pytest.raises(WebFetchError, match="doesn't have enough content"):
            await fetcher.fetch("https://example.com/short")

    async def test_fetch_raises_on_non_html_content(self):
        mock_response = MagicMock(spec=httpx.Response)
        mock_response.headers = {"content-type": "application/json"}
        mock_response.raise_for_status = MagicMock()

        mock_client = MagicMock(spec=httpx.AsyncClient)
        mock_client.get = AsyncMock(return_value=mock_response)

        fetcher = WebFetcher(http_client=mock_client)

        with pytest.raises(WebFetchError, match="Unsupported content type"):
            await fetcher.fetch("https://example.com/api")

    async def test_fetch_raises_on_http_error(self):
        mock_response = MagicMock(spec=httpx.Response)
        mock_response.status_code = 404
        mock_response.raise_for_status = MagicMock(
            side_effect=httpx.HTTPStatusError(
                "Not Found", request=MagicMock(), response=mock_response
            )
        )

        mock_client = MagicMock(spec=httpx.AsyncClient)
        mock_client.get = AsyncMock(return_value=mock_response)

        fetcher = WebFetcher(http_client=mock_client)

        with pytest.raises(WebFetchError, match="HTTP 404"):
            await fetcher.fetch("https://example.com/notfound")

    async def test_fetch_raises_on_request_error(self):
        mock_client = MagicMock(spec=httpx.AsyncClient)
        mock_client.get = AsyncMock(side_effect=httpx.RequestError("Connection failed"))

        fetcher = WebFetcher(http_client=mock_client)

        with pytest.raises(WebFetchError, match="Failed to fetch"):
            await fetcher.fetch("https://example.com/error")

    async def test_fetch_handles_missing_author(self):
        html = """
        <html>
        <head><title>No Author Article</title></head>
        <body><article><p>Content without author metadata. This article has enough text here to pass the validation requirement which requires at least one hundred characters of content.</p></article></body>
        </html>
        """

        mock_response = MagicMock(spec=httpx.Response)
        mock_response.text = html
        mock_response.headers = {"content-type": "text/html"}
        mock_response.raise_for_status = MagicMock()

        mock_client = MagicMock(spec=httpx.AsyncClient)
        mock_client.get = AsyncMock(return_value=mock_response)

        fetcher = WebFetcher(http_client=mock_client)
        result = await fetcher.fetch("https://example.com/article")

        assert result.author is None

    async def test_fetch_handles_missing_thumbnail(self):
        html = """
        <html>
        <head><title>No Image Article</title></head>
        <body><article><p>Content without thumbnail metadata. This article has enough text here to pass the validation requirement which requires at least one hundred characters of content.</p></article></body>
        </html>
        """

        mock_response = MagicMock(spec=httpx.Response)
        mock_response.text = html
        mock_response.headers = {"content-type": "text/html"}
        mock_response.raise_for_status = MagicMock()

        mock_client = MagicMock(spec=httpx.AsyncClient)
        mock_client.get = AsyncMock(return_value=mock_response)

        fetcher = WebFetcher(http_client=mock_client)
        result = await fetcher.fetch("https://example.com/article")

        assert result.thumbnail_url is None

    async def test_fetch_extracts_author_from_rel_link(self):
        html = """
        <html>
        <head><title>Article</title></head>
        <body>
            <a rel="author">Jane Smith</a>
            <article><p>Content with author link. This article has enough text here to pass the validation requirement which requires at least one hundred characters of content.</p></article>
        </body>
        </html>
        """

        mock_response = MagicMock(spec=httpx.Response)
        mock_response.text = html
        mock_response.headers = {"content-type": "text/html"}
        mock_response.raise_for_status = MagicMock()

        mock_client = MagicMock(spec=httpx.AsyncClient)
        mock_client.get = AsyncMock(return_value=mock_response)

        fetcher = WebFetcher(http_client=mock_client)
        result = await fetcher.fetch("https://example.com/article")

        assert result.author == "Jane Smith"

    async def test_fetch_extracts_content_from_main_tag(self):
        html = """
        <html>
        <head><title>Article</title></head>
        <body>
            <nav>Navigation</nav>
            <main>
                <p>Main content area with enough text for validation to pass successfully. This content exceeds the minimum one hundred character requirement for content validation in the web fetcher.</p>
            </main>
        </body>
        </html>
        """

        mock_response = MagicMock(spec=httpx.Response)
        mock_response.text = html
        mock_response.headers = {"content-type": "text/html"}
        mock_response.raise_for_status = MagicMock()

        mock_client = MagicMock(spec=httpx.AsyncClient)
        mock_client.get = AsyncMock(return_value=mock_response)

        fetcher = WebFetcher(http_client=mock_client)
        result = await fetcher.fetch("https://example.com/article")

        assert "Main content area" in result.content
        assert "Navigation" not in result.content

    async def test_fetch_extracts_thumbnail_from_twitter_meta(self):
        html = """
        <html>
        <head>
            <title>Article</title>
            <meta name="twitter:image" content="https://example.com/twitter-image.jpg">
        </head>
        <body><article><p>Content with twitter image. This article has enough text here to pass the validation requirement which requires at least one hundred characters of content.</p></article></body>
        </html>
        """

        mock_response = MagicMock(spec=httpx.Response)
        mock_response.text = html
        mock_response.headers = {"content-type": "text/html"}
        mock_response.raise_for_status = MagicMock()

        mock_client = MagicMock(spec=httpx.AsyncClient)
        mock_client.get = AsyncMock(return_value=mock_response)

        fetcher = WebFetcher(http_client=mock_client)
        result = await fetcher.fetch("https://example.com/article")

        assert result.thumbnail_url == "https://example.com/twitter-image.jpg"

    async def test_fetch_no_nameerror_when_client_creation_fails(self):
        with patch(
            "intelstream.services.web_fetcher.httpx.AsyncClient",
            side_effect=RuntimeError("Client creation failed"),
        ):
            fetcher = WebFetcher()
            with pytest.raises(RuntimeError, match="Client creation failed"):
                await fetcher.fetch("https://example.com/article")

    async def test_fetch_rejects_localhost_url(self):
        fetcher = WebFetcher()
        with pytest.raises(WebFetchError, match="SSRF"):
            await fetcher.fetch("http://localhost/admin")

    async def test_fetch_rejects_private_ip(self):
        fetcher = WebFetcher()
        with pytest.raises(WebFetchError, match="SSRF"):
            await fetcher.fetch("http://192.168.1.1/admin")

    async def test_fetch_allows_skip_ssrf_check(self, sample_html):
        mock_response = MagicMock(spec=httpx.Response)
        mock_response.text = sample_html
        mock_response.headers = {"content-type": "text/html"}
        mock_response.raise_for_status = MagicMock()

        mock_client = MagicMock(spec=httpx.AsyncClient)
        mock_client.get = AsyncMock(return_value=mock_response)

        fetcher = WebFetcher(http_client=mock_client)
        result = await fetcher.fetch("http://localhost/article", skip_ssrf_check=True)
        assert isinstance(result, WebContent)
