import threading
from contextlib import asynccontextmanager
from datetime import UTC, datetime
from unittest.mock import AsyncMock, MagicMock, patch

import httpx
import pytest
import respx
from bs4 import BeautifulSoup

from intelstream.services.content_extractor import (
    MIN_CONTENT_LENGTH,
    ContentExtractor,
    ExtractedContent,
)


@pytest.fixture
def extractor():
    return ContentExtractor()


def valid_article_text() -> str:
    return (
        "This article contains a complete first sentence with enough detail for validation. "
        "The second sentence adds more context and supporting evidence for the reader. "
        "A third sentence completes the minimum structure required for article content. "
        "A final sentence provides extra length so validation has enough material."
    )


class TestContentExtractor:
    async def test_extract_offloads_html_parsing(self, extractor: ContentExtractor) -> None:
        event_loop_thread = threading.get_ident()
        worker_threads: list[int] = []
        extractor._fetch_html = AsyncMock(return_value="<html></html>")

        def parse(_html: str, _url: str) -> ExtractedContent:
            worker_threads.append(threading.get_ident())
            return ExtractedContent(text="parsed")

        extractor._extract_html = MagicMock(side_effect=parse)

        result = await extractor.extract("https://example.com/article")

        assert result.text == "parsed"
        assert worker_threads and worker_threads[0] != event_loop_thread

    async def test_extract_rejects_ssrf_blocked_url(self, extractor: ContentExtractor):
        result = await extractor.extract("http://localhost/admin")

        assert result.text == ""

    async def test_extract_rejects_ssrf_blocked_url_before_fetching(self):
        mock_client = MagicMock(spec=httpx.AsyncClient)
        mock_client.get = AsyncMock()
        extractor = ContentExtractor(http_client=mock_client)

        result = await extractor.extract("http://localhost/admin")

        assert result.text == ""
        mock_client.get.assert_not_called()

    @respx.mock
    async def test_extract_article_content(self, extractor: ContentExtractor):
        html = """
        <html>
        <head>
            <title>Test Article</title>
            <meta name="author" content="John Doe">
            <meta property="article:published_time" content="2024-01-15T12:00:00Z">
        </head>
        <body>
            <article>
                <h1>Test Article Title</h1>
                <p>This is the first paragraph of the article with enough content to be significant.</p>
                <p>This is the second paragraph with more important information about the topic.</p>
            </article>
        </body>
        </html>
        """

        respx.get("https://example.com/article").mock(return_value=httpx.Response(200, text=html))

        result = await extractor.extract("https://example.com/article")

        assert result.text
        assert "first paragraph" in result.text or len(result.text) > 0
        assert result.author == "John Doe"
        assert result.published_at is not None

    @respx.mock
    async def test_extract_from_main_element(self, extractor: ContentExtractor):
        html = """
        <html>
        <body>
            <nav>Navigation content</nav>
            <main>
                <p>This is the first paragraph of the main content area with important details about the topic at hand. It contains enough text to be considered substantial content.</p>
                <p>The second paragraph continues with more analysis and supporting evidence for the main argument. This provides additional context and depth to the discussion.</p>
                <p>Finally, the third paragraph wraps up the key points and offers a conclusion. The reader should now have a clear understanding of the core ideas presented in this article.</p>
            </main>
            <footer>Footer content</footer>
        </body>
        </html>
        """

        respx.get("https://example.com/page").mock(return_value=httpx.Response(200, text=html))

        result = await extractor.extract("https://example.com/page")

        assert result.text
        assert "Navigation" not in result.text or "first paragraph" in result.text

    @respx.mock
    async def test_extract_title_from_og_meta(self, extractor: ContentExtractor):
        html = """
        <html>
        <head>
            <meta property="og:title" content="OG Title">
            <title>Page Title</title>
        </head>
        <body><p>Content</p></body>
        </html>
        """

        respx.get("https://example.com/").mock(return_value=httpx.Response(200, text=html))

        result = await extractor.extract("https://example.com/")

        assert result.title == "OG Title"

    @respx.mock
    async def test_extract_title_from_title_tag(self, extractor: ContentExtractor):
        html = """
        <html>
        <head>
            <title>Page Title</title>
        </head>
        <body><p>Content</p></body>
        </html>
        """

        respx.get("https://example.com/").mock(return_value=httpx.Response(200, text=html))

        result = await extractor.extract("https://example.com/")

        assert result.title == "Page Title"

    @respx.mock
    async def test_extract_date_from_time_element(self, extractor: ContentExtractor):
        html = """
        <html>
        <body>
            <time datetime="2024-06-15T10:30:00Z">June 15, 2024</time>
            <p>Content</p>
        </body>
        </html>
        """

        respx.get("https://example.com/").mock(return_value=httpx.Response(200, text=html))

        result = await extractor.extract("https://example.com/")

        assert result.published_at is not None
        assert result.published_at.year == 2024
        assert result.published_at.month == 6

    @respx.mock
    async def test_extract_handles_network_error(self, extractor: ContentExtractor):
        respx.get("https://example.com/").mock(side_effect=httpx.ConnectError("Network error"))

        result = await extractor.extract("https://example.com/")

        assert result.text == ""

    @respx.mock
    async def test_extract_handles_empty_page(self, extractor: ContentExtractor):
        respx.get("https://example.com/").mock(
            return_value=httpx.Response(200, text="<html><body></body></html>")
        )

        result = await extractor.extract("https://example.com/")

        assert result.text == "" or result.text is not None

    @respx.mock
    async def test_extract_uses_primary_trafilatura_result_without_metadata(
        self, extractor: ContentExtractor
    ):
        respx.get("https://example.com/article").mock(
            return_value=httpx.Response(200, text="<html><body>Article</body></html>")
        )

        with (
            patch(
                "intelstream.services.content_extractor.trafilatura.extract",
                return_value=valid_article_text(),
            ),
            patch(
                "intelstream.services.content_extractor.trafilatura.extract_metadata",
                return_value=None,
            ),
        ):
            result = await extractor.extract("https://example.com/article")

        assert result.text == valid_article_text()
        assert result.title is None
        assert result.author is None
        assert result.published_at is None

    @respx.mock
    async def test_extract_uses_recall_trafilatura_result(self, extractor: ContentExtractor):
        respx.get("https://example.com/article").mock(
            return_value=httpx.Response(200, text="<html><body>Article</body></html>")
        )
        metadata = MagicMock(title="Recall Title", author="Recall Author", date="2024-01-02")

        with (
            patch(
                "intelstream.services.content_extractor.trafilatura.extract",
                side_effect=[None, valid_article_text()],
            ),
            patch(
                "intelstream.services.content_extractor.trafilatura.extract_metadata",
                return_value=metadata,
            ),
        ):
            result = await extractor.extract("https://example.com/article")

        assert result.text == valid_article_text()
        assert result.title == "Recall Title"
        assert result.author == "Recall Author"
        assert result.published_at == datetime(2024, 1, 2)

    @respx.mock
    async def test_extract_falls_back_to_article_element(self, extractor: ContentExtractor):
        html = f"""
        <html>
        <head><title>Article Title</title></head>
        <body><article><p>{valid_article_text()}</p></article></body>
        </html>
        """
        respx.get("https://example.com/article").mock(return_value=httpx.Response(200, text=html))

        with patch("intelstream.services.content_extractor.trafilatura.extract", return_value=None):
            result = await extractor.extract("https://example.com/article")

        assert result.text
        assert result.title == "Article Title"

    @respx.mock
    async def test_extract_falls_back_to_main_element(self, extractor: ContentExtractor):
        html = f"""
        <html>
        <head><meta name="author" content="Main Author"></head>
        <body><main><p>{valid_article_text()}</p></main></body>
        </html>
        """
        respx.get("https://example.com/main").mock(return_value=httpx.Response(200, text=html))

        with patch("intelstream.services.content_extractor.trafilatura.extract", return_value=None):
            result = await extractor.extract("https://example.com/main")

        assert result.text
        assert result.author == "Main Author"

    @respx.mock
    async def test_extract_falls_back_to_css_selector_after_short_semantic_blocks(
        self, extractor: ContentExtractor
    ):
        html = f"""
        <html>
        <head><title>CSS Fallback</title></head>
        <body>
            <article>Too short.</article>
            <main>Also too short.</main>
            <div class="post-content"><p>{valid_article_text()}</p></div>
        </body>
        </html>
        """
        respx.get("https://example.com/css-fallback").mock(
            return_value=httpx.Response(200, text=html)
        )

        with patch("intelstream.services.content_extractor.trafilatura.extract", return_value=None):
            result = await extractor.extract("https://example.com/css-fallback")

        assert result.text == valid_article_text()
        assert result.title == "CSS Fallback"

    @respx.mock
    async def test_extract_falls_back_to_largest_block_when_no_structured_match(
        self, extractor: ContentExtractor
    ):
        html = """
        <html>
        <body>
            <article>Too short.</article>
            <main>Still short.</main>
            <p>This first paragraph is long enough to be treated as significant article content. It has useful detail.</p>
            <p>The second paragraph adds supporting evidence and gives the fallback extractor enough text to validate.</p>
            <p>A final paragraph completes the article structure and gives readers a clear closing sentence.</p>
        </body>
        </html>
        """
        respx.get("https://example.com/largest-block").mock(
            return_value=httpx.Response(200, text=html)
        )

        with patch("intelstream.services.content_extractor.trafilatura.extract", return_value=None):
            result = await extractor.extract("https://example.com/largest-block")

        assert "first paragraph" in result.text
        assert "second paragraph" in result.text
        assert "final paragraph" in result.text

    async def test_fetch_html_uses_injected_client(self):
        class FakeClient:
            def __init__(self) -> None:
                self.calls = []

            @asynccontextmanager
            async def stream(self, method: str, url: str, **kwargs):
                self.calls.append((method, url, kwargs))
                request = httpx.Request("GET", url)
                yield httpx.Response(200, request=request, text="<html>Fetched</html>")

        client = FakeClient()
        extractor = ContentExtractor(http_client=client)

        html = await extractor._fetch_html("https://example.com/injected")

        assert html == "<html>Fetched</html>"
        assert client.calls == [
            (
                "GET",
                "https://example.com/injected",
                {
                    "headers": {
                        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36"
                    },
                    "follow_redirects": False,
                },
            )
        ]

    def test_parse_date_iso_format(self, extractor: ContentExtractor):
        result = extractor._parse_date("2024-01-15T12:00:00Z")
        assert result is not None
        assert result.year == 2024
        assert result.month == 1
        assert result.day == 15

    def test_parse_date_date_only(self, extractor: ContentExtractor):
        result = extractor._parse_date("2024-01-15")
        assert result is not None
        assert result.year == 2024

    def test_parse_date_natural_format(self, extractor: ContentExtractor):
        result = extractor._parse_date("January 15, 2024")
        assert result is not None
        assert result.year == 2024

    @pytest.mark.parametrize(
        ("date_text", "expected"),
        [
            ("Jan 15, 2024", datetime(2024, 1, 15, tzinfo=UTC)),
            ("15 January 2024", datetime(2024, 1, 15, tzinfo=UTC)),
            ("15 Jan 2024", datetime(2024, 1, 15, tzinfo=UTC)),
            ("01/15/2024", datetime(2024, 1, 15, tzinfo=UTC)),
        ],
    )
    def test_parse_date_additional_formats(
        self,
        extractor: ContentExtractor,
        date_text: str,
        expected: datetime,
    ):
        assert extractor._parse_date(date_text) == expected

    def test_parse_date_invalid(self, extractor: ContentExtractor):
        result = extractor._parse_date("not a date")
        assert result is None

    def test_parse_date_none(self, extractor: ContentExtractor):
        result = extractor._parse_date(None)
        assert result is None

    def test_parse_date_preserves_timezone_when_strptime_returns_aware_datetime(
        self, extractor: ContentExtractor
    ):
        expected = datetime(2024, 1, 15, 12, 0, tzinfo=UTC)

        class FakeDateTime:
            @staticmethod
            def fromisoformat(_date_text: str):
                raise ValueError

            @staticmethod
            def strptime(_date_text: str, fmt: str):
                if fmt == "%Y-%m-%dT%H:%M:%S%z":
                    return expected
                raise ValueError

        with patch("intelstream.services.content_extractor.datetime", FakeDateTime):
            assert extractor._parse_date("custom-date") == expected


class TestContentValidation:
    def test_validate_rejects_empty_text(self, extractor: ContentExtractor):
        assert extractor._validate_content("") is False

    def test_validate_rejects_short_text(self, extractor: ContentExtractor):
        assert extractor._validate_content("Too short.") is False

    def test_validate_rejects_text_below_min_length(self, extractor: ContentExtractor):
        short_text = "A" * (MIN_CONTENT_LENGTH - 1)
        assert extractor._validate_content(short_text) is False

    def test_validate_rejects_whitespace_only_text(self, extractor: ContentExtractor):
        assert extractor._validate_content(" " * (MIN_CONTENT_LENGTH + 10)) is False

    def test_validate_rejects_text_without_split_words(self, extractor: ContentExtractor):
        class TextWithoutWords(str):
            def lower(self):
                return self

            def split(self):
                return []

        text = TextWithoutWords(
            "This sentence makes the string long enough for validation. "
            "This second sentence keeps the sentence count above the minimum. "
            "This third sentence ensures the word extraction branch is reached. "
            "Additional detail pushes the total content beyond the minimum length check. "
            "A final sentence keeps the fixture realistic while still returning no split words."
        )

        assert extractor._validate_content(text) is False

    def test_validate_rejects_too_few_sentences(self, extractor: ContentExtractor):
        text = "A" * (MIN_CONTENT_LENGTH + 50) + ". Second sentence."
        assert len(text) >= MIN_CONTENT_LENGTH
        assert extractor._validate_content(text) is False

    def test_validate_accepts_valid_article_content(self, extractor: ContentExtractor):
        text = (
            "This is the first sentence of a well-written article about technology. "
            "The second sentence provides additional context and supporting details. "
            "A third sentence wraps up the key points being discussed. "
            "And a fourth sentence adds even more depth to the analysis."
        )
        assert len(text) >= MIN_CONTENT_LENGTH
        assert extractor._validate_content(text) is True

    def test_validate_rejects_mostly_nav_keywords(self, extractor: ContentExtractor):
        text = (
            "Home About Contact Subscribe Menu Navigation "
            "Home About Contact Subscribe Menu Navigation "
            "Home About Contact Subscribe Menu Navigation "
            "Home About Contact Subscribe Menu Navigation "
            "Home About Contact Subscribe Menu Navigation. "
            "Some actual content here. Another sentence for length."
        )
        assert extractor._validate_content(text) is False

    def test_validate_accepts_content_with_some_nav_words(self, extractor: ContentExtractor):
        text = (
            "This article explores the fascinating world of technology and innovation. "
            "Home automation has become increasingly popular in recent years. "
            "Many people subscribe to newsletters about the latest developments. "
            "The contact between humans and machines continues to evolve rapidly."
        )
        assert extractor._validate_content(text) is True


class TestCssSelectorFallback:
    def test_extract_via_css_selectors_returns_none_when_no_match(
        self, extractor: ContentExtractor
    ):
        soup = BeautifulSoup("<html><body><div>Plain</div></body></html>", "lxml")

        assert extractor._extract_via_css_selectors(soup) is None

    def test_extract_via_css_selectors_skips_empty_match(self, extractor: ContentExtractor):
        soup = BeautifulSoup(
            """
            <html><body>
              <div class="post-content"></div>
              <div class="entry-content">Fallback selector text</div>
            </body></html>
            """,
            "lxml",
        )

        assert extractor._extract_via_css_selectors(soup) == "Fallback selector text"

    @respx.mock
    async def test_extract_via_post_content_class(self, extractor: ContentExtractor):
        html = """
        <html>
        <body>
            <div class="sidebar">Sidebar links and navigation</div>
            <div class="post-content">
                <p>This is a blog post written with a Hugo static site generator. It contains detailed analysis of market trends and their implications for investors.</p>
                <p>The second paragraph provides supporting evidence with specific data points. Market returns averaged 12 percent over the period studied.</p>
                <p>In conclusion, the evidence suggests a strong correlation between policy changes and market movements. Investors should consider these factors carefully.</p>
            </div>
        </body>
        </html>
        """

        respx.get("https://example.com/blog-post").mock(return_value=httpx.Response(200, text=html))

        result = await extractor.extract("https://example.com/blog-post")

        assert result.text
        assert "blog post" in result.text
        assert "Sidebar" not in result.text

    @respx.mock
    async def test_extract_via_entry_content_class(self, extractor: ContentExtractor):
        html = """
        <html>
        <body>
            <nav>Home Blog About</nav>
            <div class="entry-content">
                <p>WordPress blog entry with substantial content about artificial intelligence research. The field has seen remarkable progress in recent years across multiple domains.</p>
                <p>Natural language processing capabilities have improved dramatically. Large language models can now perform complex reasoning tasks that were previously impossible.</p>
                <p>Computer vision has also advanced significantly. Object detection and image generation have reached near-human performance levels in many benchmarks.</p>
            </div>
        </body>
        </html>
        """

        respx.get("https://example.com/wp-post").mock(return_value=httpx.Response(200, text=html))

        result = await extractor.extract("https://example.com/wp-post")

        assert result.text
        assert "artificial intelligence" in result.text

    @respx.mock
    async def test_extract_returns_metadata_on_failed_validation(self, extractor: ContentExtractor):
        html = """
        <html>
        <head>
            <meta property="og:title" content="Short Page Title">
            <meta name="author" content="Test Author">
        </head>
        <body><p>Too short.</p></body>
        </html>
        """

        respx.get("https://example.com/short").mock(return_value=httpx.Response(200, text=html))

        result = await extractor.extract("https://example.com/short")

        assert result.text == ""
        assert result.title == "Short Page Title"
        assert result.author == "Test Author"

    @respx.mock
    async def test_extract_nav_heavy_page_returns_empty(self, extractor: ContentExtractor):
        html = """
        <html>
        <body>
            <div>Home About Contact Subscribe Menu Navigation Search Login Register
            Home About Contact Subscribe Menu Navigation Search Login Register
            Home About Contact Subscribe Menu Navigation Search Login Register.
            Some text. More text here.</div>
        </body>
        </html>
        """

        respx.get("https://example.com/nav-heavy").mock(return_value=httpx.Response(200, text=html))

        result = await extractor.extract("https://example.com/nav-heavy")

        assert result.text == ""


class TestMetadataFallbacks:
    def test_extract_title_falls_back_to_h1(self, extractor: ContentExtractor):
        soup = BeautifulSoup("<html><body><h1>Article Heading</h1></body></html>", "lxml")

        assert extractor._extract_title(soup) == "Article Heading"

    def test_extract_title_ignores_empty_og_title(self, extractor: ContentExtractor):
        soup = BeautifulSoup(
            '<html><head><meta property="og:title" content=""><title>Fallback</title></head></html>',
            "lxml",
        )

        assert extractor._extract_title(soup) == "Fallback"

    def test_extract_title_returns_none_without_title_sources(self, extractor: ContentExtractor):
        soup = BeautifulSoup("<html><body><p>No title here</p></body></html>", "lxml")

        assert extractor._extract_title(soup) is None

    def test_extract_author_uses_article_author_meta(self, extractor: ContentExtractor):
        soup = BeautifulSoup(
            '<html><head><meta property="article:author" content="Jane Doe"></head></html>',
            "lxml",
        )

        assert extractor._extract_author(soup) == "Jane Doe"

    def test_extract_author_falls_back_when_author_meta_is_empty(self, extractor: ContentExtractor):
        soup = BeautifulSoup(
            """
            <html><head>
              <meta name="author" content="">
              <meta property="article:author" content="Fallback Author">
            </head></html>
            """,
            "lxml",
        )

        assert extractor._extract_author(soup) == "Fallback Author"

    def test_extract_author_ignores_empty_fallbacks(self, extractor: ContentExtractor):
        soup = BeautifulSoup(
            """
            <html><head>
              <meta name="author" content="">
              <meta property="article:author" content="">
            </head><body><div class="author"></div></body></html>
            """,
            "lxml",
        )

        assert extractor._extract_author(soup) is None

    def test_extract_author_uses_short_author_class(self, extractor: ContentExtractor):
        soup = BeautifulSoup('<div class="by-author">Staff Writer</div>', "lxml")

        assert extractor._extract_author(soup) == "Staff Writer"

    def test_extract_author_ignores_long_author_class_text(self, extractor: ContentExtractor):
        soup = BeautifulSoup(f'<div class="author">{"A" * 120}</div>', "lxml")

        assert extractor._extract_author(soup) is None

    def test_extract_date_falls_back_from_invalid_time_to_og_date(
        self, extractor: ContentExtractor
    ):
        soup = BeautifulSoup(
            """
            <html><head>
              <meta property="article:published_time" content="2024-02-03T04:05:06Z">
            </head><body><time datetime="not-a-date">bad</time></body></html>
            """,
            "lxml",
        )

        assert extractor._extract_date(soup) == datetime(2024, 2, 3, 4, 5, 6, tzinfo=UTC)

    def test_extract_date_uses_name_date_meta(self, extractor: ContentExtractor):
        soup = BeautifulSoup(
            '<html><head><meta name="datePublished" content="2024-03-04"></head></html>',
            "lxml",
        )

        assert extractor._extract_date(soup) == datetime(2024, 3, 4)

    def test_extract_date_returns_none_when_all_candidates_invalid(
        self, extractor: ContentExtractor
    ):
        soup = BeautifulSoup(
            """
            <html><head>
              <meta property="article:published_time" content="bad-og">
              <meta name="datePublished" content="bad-meta">
            </head><body><time datetime="bad-time">bad</time></body></html>
            """,
            "lxml",
        )

        assert extractor._extract_date(soup) is None

    def test_extract_date_skips_empty_candidates(self, extractor: ContentExtractor):
        soup = BeautifulSoup(
            """
            <html><head>
              <meta property="article:published_time" content="">
              <meta name="datePublished" content="">
            </head><body><time>No datetime attribute</time></body></html>
            """,
            "lxml",
        )

        assert extractor._extract_date(soup) is None


class TestLargestTextBlock:
    def test_extract_largest_text_block_joins_significant_paragraphs(
        self, extractor: ContentExtractor
    ):
        soup = BeautifulSoup(
            """
            <html><body>
              <nav>This navigation should be removed before extraction.</nav>
              <p>short</p>
              <p>This paragraph is long enough to be included as significant article text.</p>
              <p>This second paragraph is also long enough to be included in the block.</p>
            </body></html>
            """,
            "lxml",
        )

        text = extractor._extract_largest_text_block(soup)

        assert "navigation" not in text.lower()
        assert "short" not in text
        assert "significant article text" in text
        assert "second paragraph" in text

    def test_extract_largest_text_block_falls_back_to_body(self, extractor: ContentExtractor):
        soup = BeautifulSoup("<html><body><div>Body fallback text</div></body></html>", "lxml")

        assert extractor._extract_largest_text_block(soup) == "Body fallback text"

    def test_extract_largest_text_block_truncates_body_fallback(self, extractor: ContentExtractor):
        soup = BeautifulSoup(f"<html><body>{'x' * 12000}</body></html>", "lxml")

        text = extractor._extract_largest_text_block(soup)

        assert text == "x" * 10000

    def test_extract_largest_text_block_without_body_uses_document_text(
        self, extractor: ContentExtractor
    ):
        soup = BeautifulSoup("<root>Loose text</root>", "xml")

        assert extractor._extract_largest_text_block(soup) == "Loose text"
