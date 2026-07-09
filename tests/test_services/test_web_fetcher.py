from unittest.mock import AsyncMock, MagicMock, patch

import httpx
import pytest
from bs4 import BeautifulSoup

from intelstream.services import web_fetcher
from intelstream.services.web_fetcher import MAX_REDIRECTS, WebContent, WebFetcher, WebFetchError
from intelstream.utils.safe_http import SafeHTTPError
from intelstream.utils.url_validation import SSRFError, validate_url_for_ssrf


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


@pytest.fixture(autouse=True)
def adapt_legacy_client_mocks():
    async def request(client, _method, url, *, validate_ssrf=True, **_kwargs):
        if validate_ssrf:
            try:
                validate_url_for_ssrf(url)
            except SSRFError as exc:
                raise SafeHTTPError(f"URL blocked by SSRF protection: {exc}") from exc

        current_url = url
        redirects_followed = 0
        while True:
            response = await client.get(current_url, follow_redirects=False)
            if not response.is_redirect:
                return response
            if redirects_followed >= MAX_REDIRECTS:
                raise SafeHTTPError("Too many redirects")
            if response.next_request is None:
                raise SafeHTTPError("Redirect without a target URL")
            redirect_url = str(response.next_request.url)
            if validate_ssrf:
                try:
                    validate_url_for_ssrf(redirect_url)
                except SSRFError as exc:
                    raise SafeHTTPError(f"Redirect blocked by SSRF protection: {exc}") from exc
            current_url = redirect_url
            redirects_followed += 1

    with patch.object(web_fetcher, "safe_request", side_effect=request):
        yield


class TestWebFetcher:
    async def test_fetch_success(self, sample_html):
        mock_response = MagicMock(spec=httpx.Response)
        mock_response.is_redirect = False
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
        mock_response.is_redirect = False
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
        mock_response.is_redirect = False
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
        mock_response.is_redirect = False
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
        mock_response.is_redirect = False
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
        mock_response.is_redirect = False
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
        mock_response.is_redirect = False
        mock_response.headers = {"content-type": "application/json"}
        mock_response.raise_for_status = MagicMock()

        mock_client = MagicMock(spec=httpx.AsyncClient)
        mock_client.get = AsyncMock(return_value=mock_response)

        fetcher = WebFetcher(http_client=mock_client)

        with pytest.raises(WebFetchError, match="Unsupported content type"):
            await fetcher.fetch("https://example.com/api")

    async def test_fetch_raises_on_http_error(self):
        mock_response = MagicMock(spec=httpx.Response)
        mock_response.is_redirect = False
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
        mock_response.is_redirect = False
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
        mock_response.is_redirect = False
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
        mock_response.is_redirect = False
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
        mock_response.is_redirect = False
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
        mock_response.is_redirect = False
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

    async def test_fetch_truncates_oversized_html_before_parsing(self):
        mock_response = MagicMock(spec=httpx.Response)
        mock_response.is_redirect = False
        mock_response.text = "<html>" + ("x" * 200) + "</html>"
        mock_response.headers = {"content-type": "text/html"}
        mock_response.raise_for_status = MagicMock()

        mock_client = MagicMock(spec=httpx.AsyncClient)
        mock_client.get = AsyncMock(return_value=mock_response)

        fetcher = WebFetcher(http_client=mock_client)
        expected = WebContent(url="https://example.com/article", title="Title", content="content")

        with (
            patch.object(web_fetcher, "MAX_CONTENT_LENGTH", 25),
            patch.object(fetcher, "_parse_html", return_value=expected) as parse_html,
        ):
            result = await fetcher.fetch("https://example.com/article")

        assert result is expected
        assert len(parse_html.call_args.args[1]) == 25

    async def test_fetch_closes_owned_client_after_success(self, sample_html):
        mock_response = MagicMock(spec=httpx.Response)
        mock_response.is_redirect = False
        mock_response.text = sample_html
        mock_response.headers = {"content-type": "text/html"}
        mock_response.raise_for_status = MagicMock()

        mock_client = MagicMock(spec=httpx.AsyncClient)
        mock_client.get = AsyncMock(return_value=mock_response)
        mock_client.aclose = AsyncMock()

        with patch("intelstream.services.web_fetcher.httpx.AsyncClient", return_value=mock_client):
            result = await WebFetcher().fetch("https://example.com/article")

        assert isinstance(result, WebContent)
        mock_client.aclose.assert_awaited_once()

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
        mock_response.is_redirect = False
        mock_response.text = sample_html
        mock_response.headers = {"content-type": "text/html"}
        mock_response.raise_for_status = MagicMock()

        mock_client = MagicMock(spec=httpx.AsyncClient)
        mock_client.get = AsyncMock(return_value=mock_response)

        fetcher = WebFetcher(http_client=mock_client)
        result = await fetcher.fetch("http://localhost/article", skip_ssrf_check=True)
        assert isinstance(result, WebContent)

    async def test_fetch_blocks_redirect_to_private_ip(self):
        redirect_response = MagicMock(spec=httpx.Response)
        redirect_response.is_redirect = True
        mock_next_request = MagicMock()
        mock_next_request.url = "http://127.0.0.1/admin"
        redirect_response.next_request = mock_next_request

        mock_client = MagicMock(spec=httpx.AsyncClient)
        mock_client.get = AsyncMock(return_value=redirect_response)

        fetcher = WebFetcher(http_client=mock_client)
        with pytest.raises(WebFetchError, match="Redirect blocked by SSRF"):
            await fetcher.fetch("https://evil.com/redirect")

    async def test_fetch_raises_on_redirect_without_target(self):
        redirect_response = MagicMock(spec=httpx.Response)
        redirect_response.is_redirect = True
        redirect_response.next_request = None

        mock_client = MagicMock(spec=httpx.AsyncClient)
        mock_client.get = AsyncMock(return_value=redirect_response)

        fetcher = WebFetcher(http_client=mock_client)
        with pytest.raises(WebFetchError, match="Redirect without a target URL"):
            await fetcher.fetch("https://example.com/redirect", skip_ssrf_check=True)

    async def test_fetch_raises_after_too_many_redirects(self):
        redirect_response = MagicMock(spec=httpx.Response)
        redirect_response.is_redirect = True
        mock_next_request = MagicMock()
        mock_next_request.url = "https://example.com/again"
        redirect_response.next_request = mock_next_request

        mock_client = MagicMock(spec=httpx.AsyncClient)
        mock_client.get = AsyncMock(return_value=redirect_response)

        fetcher = WebFetcher(http_client=mock_client)
        with pytest.raises(WebFetchError, match="Too many redirects"):
            await fetcher.fetch("https://example.com/redirect", skip_ssrf_check=True)

        assert mock_client.get.await_count == MAX_REDIRECTS + 1

    async def test_fetch_follows_safe_redirect(self, sample_html):
        redirect_response = MagicMock(spec=httpx.Response)
        redirect_response.is_redirect = True
        mock_next_request = MagicMock()
        mock_next_request.url = "https://example.com/final"
        redirect_response.next_request = mock_next_request

        final_response = MagicMock(spec=httpx.Response)
        final_response.is_redirect = False
        final_response.text = sample_html
        final_response.headers = {"content-type": "text/html"}
        final_response.raise_for_status = MagicMock()

        mock_client = MagicMock(spec=httpx.AsyncClient)
        mock_client.get = AsyncMock(side_effect=[redirect_response, final_response])

        fetcher = WebFetcher(http_client=mock_client)
        result = await fetcher.fetch("https://example.com/article")

        assert isinstance(result, WebContent)
        assert mock_client.get.call_count == 2


class TestWebFetcherParsingHelpers:
    def test_extract_title_prefers_twitter_title_after_og_title(self):
        soup = BeautifulSoup(
            """
            <html><head>
              <meta name="twitter:title" content="Twitter Title">
              <title>Title Tag</title>
            </head></html>
            """,
            "lxml",
        )

        assert WebFetcher()._extract_title(soup) == "Twitter Title"

    def test_extract_title_falls_back_to_h1_then_untitled(self):
        fetcher = WebFetcher()

        assert fetcher._extract_title(BeautifulSoup("<h1>Heading</h1>", "lxml")) == "Heading"
        assert fetcher._extract_title(BeautifulSoup("<p>No title</p>", "lxml")) == "Untitled"

    def test_extract_content_uses_content_div_then_body_then_document(self):
        fetcher = WebFetcher()

        content_div = BeautifulSoup(
            '<html><body><div class="post-content">Div text</div><p>Body text</p></body></html>',
            "lxml",
        )
        body_only = BeautifulSoup("<html><body><p>Body text</p></body></html>", "lxml")
        loose_text = BeautifulSoup("<span>Loose text</span>", "lxml")

        assert fetcher._extract_content(content_div) == "Div text"
        assert fetcher._extract_content(body_only) == "Body text"
        assert fetcher._extract_content(loose_text) == "Loose text"

    def test_extract_content_returns_document_text_without_body(self):
        soup = BeautifulSoup("", "lxml")

        assert WebFetcher()._extract_content(soup) == ""

    def test_extract_author_uses_article_author_meta(self):
        soup = BeautifulSoup(
            '<meta property="article:author" content="Editorial Team">',
            "lxml",
        )

        assert WebFetcher()._extract_author(soup) == "Editorial Team"

    def test_extract_published_date_uses_time_when_meta_missing(self):
        soup = BeautifulSoup('<time datetime="2024-02-03T04:05:06Z">date</time>', "lxml")

        published = WebFetcher()._extract_published_date(soup)

        assert published is not None
        assert published.year == 2024
        assert published.month == 2
        assert published.day == 3

    def test_extract_published_date_ignores_invalid_dates(self):
        soup = BeautifulSoup(
            """
            <html><head><meta property="article:published_time" content="bad"></head>
            <body><time datetime="also-bad">date</time></body></html>
            """,
            "lxml",
        )

        assert WebFetcher()._extract_published_date(soup) is None
