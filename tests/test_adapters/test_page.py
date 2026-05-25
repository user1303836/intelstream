from datetime import UTC, datetime
from unittest.mock import AsyncMock, MagicMock, patch

import httpx
import pytest
from bs4 import BeautifulSoup

from intelstream.adapters.base import ContentData
from intelstream.adapters.page import PageAdapter
from intelstream.services.page_analyzer import ExtractionProfile


@pytest.fixture
def sample_profile() -> ExtractionProfile:
    return ExtractionProfile(
        site_name="Test Blog",
        post_selector="article.post",
        title_selector="h2.title",
        url_selector="a.link",
        url_attribute="href",
        date_selector="time",
        date_attribute="datetime",
        author_selector="span.author",
        base_url="https://example.com",
    )


@pytest.fixture
def sample_html() -> str:
    return """
    <html>
    <body>
        <article class="post">
            <h2 class="title">First Post Title</h2>
            <a class="link" href="/posts/first-post">Read more</a>
            <time datetime="2024-01-15T12:00:00Z">January 15, 2024</time>
            <span class="author">John Doe</span>
        </article>
        <article class="post">
            <h2 class="title">Second Post Title</h2>
            <a class="link" href="https://example.com/posts/second-post">Read more</a>
            <time datetime="2024-01-10T10:00:00Z">January 10, 2024</time>
            <span class="author">Jane Smith</span>
        </article>
        <article class="post">
            <h2 class="title">Third Post Title</h2>
            <a class="link" href="/posts/third-post">Read more</a>
        </article>
    </body>
    </html>
    """


class TestPageAdapter:
    async def test_source_type(self, sample_profile: ExtractionProfile) -> None:
        adapter = PageAdapter(extraction_profile=sample_profile)
        assert adapter.source_type == "page"

    async def test_get_feed_url_returns_identifier(self, sample_profile: ExtractionProfile) -> None:
        adapter = PageAdapter(extraction_profile=sample_profile)
        url = await adapter.get_feed_url("https://example.com/blog")
        assert url == "https://example.com/blog"

    async def test_fetch_latest_extracts_posts(
        self, sample_profile: ExtractionProfile, sample_html: str
    ) -> None:
        mock_client = MagicMock(spec=httpx.AsyncClient)
        mock_response = MagicMock()
        mock_response.text = sample_html
        mock_response.raise_for_status = MagicMock()
        mock_client.get = AsyncMock(return_value=mock_response)

        adapter = PageAdapter(extraction_profile=sample_profile, http_client=mock_client)
        items = await adapter.fetch_latest("https://example.com/blog")

        assert len(items) == 3
        assert items[0].title == "First Post Title"
        assert items[0].original_url == "https://example.com/posts/first-post"
        assert items[0].author == "John Doe"
        assert items[0].published_at == datetime(2024, 1, 15, 12, 0, 0, tzinfo=UTC)

    async def test_fetch_latest_resolves_relative_urls(
        self, sample_profile: ExtractionProfile, sample_html: str
    ) -> None:
        mock_client = MagicMock(spec=httpx.AsyncClient)
        mock_response = MagicMock()
        mock_response.text = sample_html
        mock_response.raise_for_status = MagicMock()
        mock_client.get = AsyncMock(return_value=mock_response)

        adapter = PageAdapter(extraction_profile=sample_profile, http_client=mock_client)
        items = await adapter.fetch_latest("https://example.com/blog")

        assert items[0].original_url == "https://example.com/posts/first-post"
        assert items[1].original_url == "https://example.com/posts/second-post"

    async def test_fetch_latest_handles_missing_author(
        self, sample_profile: ExtractionProfile, sample_html: str
    ) -> None:
        mock_client = MagicMock(spec=httpx.AsyncClient)
        mock_response = MagicMock()
        mock_response.text = sample_html
        mock_response.raise_for_status = MagicMock()
        mock_client.get = AsyncMock(return_value=mock_response)

        adapter = PageAdapter(extraction_profile=sample_profile, http_client=mock_client)
        items = await adapter.fetch_latest("https://example.com/blog")

        assert items[2].author == "Test Blog"

    async def test_fetch_latest_handles_missing_date(
        self, sample_profile: ExtractionProfile, sample_html: str
    ) -> None:
        mock_client = MagicMock(spec=httpx.AsyncClient)
        mock_response = MagicMock()
        mock_response.text = sample_html
        mock_response.raise_for_status = MagicMock()
        mock_client.get = AsyncMock(return_value=mock_response)

        adapter = PageAdapter(extraction_profile=sample_profile, http_client=mock_client)
        items = await adapter.fetch_latest("https://example.com/blog")

        assert items[2].published_at.tzinfo == UTC
        assert (datetime.now(UTC) - items[2].published_at).total_seconds() < 5

    async def test_fetch_latest_handles_http_error(self, sample_profile: ExtractionProfile) -> None:
        mock_client = MagicMock(spec=httpx.AsyncClient)
        mock_response = MagicMock()
        mock_response.status_code = 404
        mock_response.raise_for_status = MagicMock(
            side_effect=httpx.HTTPStatusError(
                "Not found", request=MagicMock(), response=mock_response
            )
        )
        mock_client.get = AsyncMock(return_value=mock_response)

        adapter = PageAdapter(extraction_profile=sample_profile, http_client=mock_client)

        with pytest.raises(httpx.HTTPStatusError):
            await adapter.fetch_latest("https://example.com/blog")

    async def test_fetch_latest_handles_request_error(
        self, sample_profile: ExtractionProfile
    ) -> None:
        mock_client = MagicMock(spec=httpx.AsyncClient)
        mock_client.get = AsyncMock(side_effect=httpx.ConnectError("offline", request=MagicMock()))
        adapter = PageAdapter(extraction_profile=sample_profile, http_client=mock_client)

        with pytest.raises(httpx.ConnectError, match="offline"):
            await adapter.fetch_latest("https://example.com/blog")

    async def test_fetch_latest_without_http_client(
        self, sample_profile: ExtractionProfile, sample_html: str
    ) -> None:
        with patch("intelstream.adapters.page.httpx.AsyncClient") as mock_client_class:
            mock_client = MagicMock()
            mock_response = MagicMock()
            mock_response.text = sample_html
            mock_response.raise_for_status = MagicMock()
            mock_client.get = AsyncMock(return_value=mock_response)
            mock_client.__aenter__ = AsyncMock(return_value=mock_client)
            mock_client.__aexit__ = AsyncMock(return_value=None)
            mock_client_class.return_value = mock_client

            adapter = PageAdapter(extraction_profile=sample_profile)
            items = await adapter.fetch_latest("https://example.com/blog")

            assert len(items) == 3

    async def test_fetch_latest_with_no_matching_posts(
        self, sample_profile: ExtractionProfile
    ) -> None:
        html = "<html><body><div>No posts here</div></body></html>"

        mock_client = MagicMock(spec=httpx.AsyncClient)
        mock_response = MagicMock()
        mock_response.text = html
        mock_response.raise_for_status = MagicMock()
        mock_client.get = AsyncMock(return_value=mock_response)

        adapter = PageAdapter(extraction_profile=sample_profile, http_client=mock_client)
        items = await adapter.fetch_latest("https://example.com/blog")

        assert len(items) == 0

    async def test_fetch_latest_skips_posts_without_title(
        self, sample_profile: ExtractionProfile
    ) -> None:
        html = """
        <html>
        <body>
            <article class="post">
                <h2 class="title"></h2>
                <a class="link" href="/posts/empty-title">Read more</a>
            </article>
            <article class="post">
                <h2 class="title">Valid Title</h2>
                <a class="link" href="/posts/valid">Read more</a>
            </article>
        </body>
        </html>
        """

        mock_client = MagicMock(spec=httpx.AsyncClient)
        mock_response = MagicMock()
        mock_response.text = html
        mock_response.raise_for_status = MagicMock()
        mock_client.get = AsyncMock(return_value=mock_response)

        adapter = PageAdapter(extraction_profile=sample_profile, http_client=mock_client)
        items = await adapter.fetch_latest("https://example.com/blog")

        assert len(items) == 1
        assert items[0].title == "Valid Title"

    def test_extract_posts_continues_after_parse_error(
        self, sample_profile: ExtractionProfile, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        html = """
        <article class="post"><h2 class="title">Bad</h2></article>
        <article class="post"><h2 class="title">Good</h2></article>
        """
        adapter = PageAdapter(extraction_profile=sample_profile)
        recovered = ContentData(
            external_id="good",
            title="Good",
            original_url="https://example.com/good",
            author="Author",
            published_at=datetime(2024, 1, 1, tzinfo=UTC),
        )
        calls = 0

        def fake_parse_post(_post: object, _base_url: str) -> ContentData:
            nonlocal calls
            calls += 1
            if calls == 1:
                raise ValueError("bad post")
            return recovered

        monkeypatch.setattr(adapter, "_parse_post", fake_parse_post)

        assert adapter._extract_posts(html, "https://example.com") == [recovered]

    def test_parse_post_skips_missing_url_element(self, sample_profile: ExtractionProfile) -> None:
        soup = BeautifulSoup(
            '<article class="post"><h2 class="title">No URL</h2></article>',
            "lxml",
        )
        adapter = PageAdapter(extraction_profile=sample_profile)

        assert adapter._parse_post(soup.select_one("article.post"), "https://example.com") is None

    def test_parse_post_skips_missing_title_element(
        self, sample_profile: ExtractionProfile
    ) -> None:
        soup = BeautifulSoup(
            """
            <article class="post">
              <a class="link" href="/posts/no-title">Read more</a>
            </article>
            """,
            "lxml",
        )
        adapter = PageAdapter(extraction_profile=sample_profile)

        assert adapter._parse_post(soup.select_one("article.post"), "https://example.com") is None

    def test_parse_post_skips_missing_url_attribute(
        self, sample_profile: ExtractionProfile
    ) -> None:
        soup = BeautifulSoup(
            """
            <article class="post">
              <h2 class="title">No Href</h2>
              <a class="link">Read more</a>
            </article>
            """,
            "lxml",
        )
        adapter = PageAdapter(extraction_profile=sample_profile)

        assert adapter._parse_post(soup.select_one("article.post"), "https://example.com") is None

    def test_parse_date_string_iso_format(self, sample_profile: ExtractionProfile) -> None:
        adapter = PageAdapter(extraction_profile=sample_profile)
        result = adapter._parse_date_string("2024-01-15T12:00:00Z")
        assert result == datetime(2024, 1, 15, 12, 0, 0, tzinfo=UTC)

    def test_parse_date_string_simple_date(self, sample_profile: ExtractionProfile) -> None:
        adapter = PageAdapter(extraction_profile=sample_profile)
        result = adapter._parse_date_string("2024-01-15")
        assert result.year == 2024
        assert result.month == 1
        assert result.day == 15

    def test_parse_date_string_month_name(self, sample_profile: ExtractionProfile) -> None:
        adapter = PageAdapter(extraction_profile=sample_profile)
        result = adapter._parse_date_string("January 15, 2024")
        assert result.year == 2024
        assert result.month == 1
        assert result.day == 15

    def test_parse_date_string_abbreviated_month(self, sample_profile: ExtractionProfile) -> None:
        adapter = PageAdapter(extraction_profile=sample_profile)
        result = adapter._parse_date_string("Jan 15, 2024")
        assert result.year == 2024
        assert result.month == 1
        assert result.day == 15

    def test_parse_date_string_day_first_formats(self, sample_profile: ExtractionProfile) -> None:
        adapter = PageAdapter(extraction_profile=sample_profile)

        full_month = adapter._parse_date_string("15 January 2024")
        short_month = adapter._parse_date_string("15 Jan 2024")

        assert full_month == datetime(2024, 1, 15, tzinfo=UTC)
        assert short_month == datetime(2024, 1, 15, tzinfo=UTC)

    def test_parse_date_string_numeric_formats(self, sample_profile: ExtractionProfile) -> None:
        adapter = PageAdapter(extraction_profile=sample_profile)

        us_date = adapter._parse_date_string("01/15/2024")
        day_first = adapter._parse_date_string("15/01/2024")

        assert us_date == datetime(2024, 1, 15, tzinfo=UTC)
        assert day_first == datetime(2024, 1, 15, tzinfo=UTC)

    def test_parse_date_string_extracts_embedded_month_date(
        self, sample_profile: ExtractionProfile
    ) -> None:
        adapter = PageAdapter(extraction_profile=sample_profile)

        result = adapter._parse_date_string("Published January 15 2024 by Editorial")

        assert result == datetime(2024, 1, 15, tzinfo=UTC)

    def test_parse_date_string_extracts_embedded_abbreviated_month_date(
        self, sample_profile: ExtractionProfile
    ) -> None:
        adapter = PageAdapter(extraction_profile=sample_profile)

        result = adapter._parse_date_string("Published Jan 15 2024 by Editorial")

        assert result == datetime(2024, 1, 15, tzinfo=UTC)

    def test_parse_date_string_invalid_embedded_month_returns_now(
        self, sample_profile: ExtractionProfile
    ) -> None:
        adapter = PageAdapter(extraction_profile=sample_profile)

        result = adapter._parse_date_string("Published Notamonth 15 2024")

        assert (datetime.now(UTC) - result).total_seconds() < 5

    def test_parse_date_string_invalid_returns_now(self, sample_profile: ExtractionProfile) -> None:
        adapter = PageAdapter(extraction_profile=sample_profile)
        result = adapter._parse_date_string("not a date")
        assert (datetime.now(UTC) - result).total_seconds() < 5

    def test_extract_date_returns_now_without_selector(
        self, sample_profile: ExtractionProfile
    ) -> None:
        profile = ExtractionProfile.from_dict(
            {
                **sample_profile.to_dict(),
                "date_selector": None,
            }
        )
        adapter = PageAdapter(extraction_profile=profile)
        soup = BeautifulSoup('<article class="post"></article>', "lxml")

        result = adapter._extract_date(soup.select_one("article.post"))

        assert (datetime.now(UTC) - result).total_seconds() < 5

    def test_extract_date_returns_now_when_selector_missing(
        self, sample_profile: ExtractionProfile
    ) -> None:
        adapter = PageAdapter(extraction_profile=sample_profile)
        soup = BeautifulSoup('<article class="post"></article>', "lxml")

        result = adapter._extract_date(soup.select_one("article.post"))

        assert (datetime.now(UTC) - result).total_seconds() < 5

    def test_extract_date_returns_now_when_attribute_missing(
        self, sample_profile: ExtractionProfile
    ) -> None:
        adapter = PageAdapter(extraction_profile=sample_profile)
        soup = BeautifulSoup(
            '<article class="post"><time></time></article>',
            "lxml",
        )

        result = adapter._extract_date(soup.select_one("article.post"))

        assert (datetime.now(UTC) - result).total_seconds() < 5

    def test_extract_date_uses_text_when_no_date_attribute(
        self, sample_profile: ExtractionProfile
    ) -> None:
        profile = ExtractionProfile.from_dict(
            {
                **sample_profile.to_dict(),
                "date_attribute": None,
            }
        )
        adapter = PageAdapter(extraction_profile=profile)
        soup = BeautifulSoup(
            '<article class="post"><time>January 15, 2024</time></article>',
            "lxml",
        )

        assert adapter._extract_date(soup.select_one("article.post")) == datetime(
            2024, 1, 15, tzinfo=UTC
        )

    def test_extract_author_returns_none_for_missing_or_empty_author(
        self, sample_profile: ExtractionProfile
    ) -> None:
        adapter = PageAdapter(extraction_profile=sample_profile)
        no_author = BeautifulSoup('<article class="post"></article>', "lxml")
        empty_author = BeautifulSoup(
            '<article class="post"><span class="author">  </span></article>',
            "lxml",
        )

        assert adapter._extract_author(no_author.select_one("article.post")) is None
        assert adapter._extract_author(empty_author.select_one("article.post")) is None

    def test_extract_author_returns_none_without_selector(
        self, sample_profile: ExtractionProfile
    ) -> None:
        profile = ExtractionProfile.from_dict(
            {
                **sample_profile.to_dict(),
                "author_selector": None,
            }
        )
        adapter = PageAdapter(extraction_profile=profile)
        soup = BeautifulSoup('<article class="post"></article>', "lxml")

        assert adapter._extract_author(soup.select_one("article.post")) is None


class TestExtractionProfile:
    def test_to_dict(self, sample_profile: ExtractionProfile) -> None:
        data = sample_profile.to_dict()
        assert data["site_name"] == "Test Blog"
        assert data["post_selector"] == "article.post"
        assert data["title_selector"] == "h2.title"
        assert data["url_selector"] == "a.link"
        assert data["url_attribute"] == "href"

    def test_from_dict(self) -> None:
        data = {
            "site_name": "Test Blog",
            "post_selector": "article.post",
            "title_selector": "h2.title",
            "url_selector": "a.link",
            "url_attribute": "href",
            "date_selector": "time",
            "date_attribute": "datetime",
            "author_selector": None,
            "base_url": "https://example.com",
        }
        profile = ExtractionProfile.from_dict(data)
        assert profile.site_name == "Test Blog"
        assert profile.post_selector == "article.post"

    def test_from_dict_minimal(self) -> None:
        data = {
            "site_name": "Minimal Blog",
            "post_selector": "div.post",
            "title_selector": "h1",
            "url_selector": "a",
            "url_attribute": "href",
        }
        profile = ExtractionProfile.from_dict(data)
        assert profile.site_name == "Minimal Blog"
        assert profile.date_selector is None
        assert profile.author_selector is None
