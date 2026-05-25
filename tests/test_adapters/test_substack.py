from datetime import UTC, datetime
from unittest.mock import patch

import feedparser
import httpx
import pytest
import respx

from intelstream.adapters.base import ContentData
from intelstream.adapters.substack import SubstackAdapter

SAMPLE_RSS_FEED = """<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom" xmlns:media="http://search.yahoo.com/mrss/">
  <channel>
    <title>Test Substack</title>
    <link>https://test.substack.com</link>
    <description>A test Substack</description>
    <item>
      <title>Test Article</title>
      <link>https://test.substack.com/p/test-article</link>
      <guid>https://test.substack.com/p/test-article</guid>
      <pubDate>Mon, 15 Jan 2024 12:00:00 GMT</pubDate>
      <author>Test Author</author>
      <description>This is the article summary.</description>
      <content:encoded xmlns:content="http://purl.org/rss/1.0/modules/content/">
        <![CDATA[<p>This is the full article content.</p>]]>
      </content:encoded>
      <media:thumbnail url="https://example.com/image.jpg"/>
    </item>
    <item>
      <title>Second Article</title>
      <link>https://test.substack.com/p/second-article</link>
      <guid>https://test.substack.com/p/second-article</guid>
      <pubDate>Sun, 14 Jan 2024 10:00:00 GMT</pubDate>
      <description>Second article summary.</description>
    </item>
  </channel>
</rss>
"""


class AttrEntry(dict):
    def __getattr__(self, name: str):
        return self.get(name)


class TestSubstackAdapter:
    async def test_get_feed_url_from_identifier(self) -> None:
        adapter = SubstackAdapter()
        url = await adapter.get_feed_url("testblog")
        assert url == "https://testblog.substack.com/feed"

    async def test_get_feed_url_from_full_url(self) -> None:
        adapter = SubstackAdapter()
        url = await adapter.get_feed_url("https://testblog.substack.com")
        assert url == "https://testblog.substack.com/feed"

    async def test_get_feed_url_already_has_feed(self) -> None:
        adapter = SubstackAdapter()
        url = await adapter.get_feed_url("https://testblog.substack.com/feed")
        assert url == "https://testblog.substack.com/feed"

    async def test_get_feed_url_trims_and_lowercases_identifier(self) -> None:
        adapter = SubstackAdapter()

        url = await adapter.get_feed_url("  MixedCase  ")

        assert url == "https://mixedcase.substack.com/feed"

    @respx.mock
    async def test_fetch_latest_success(self) -> None:
        respx.get("https://test.substack.com/feed").mock(
            return_value=httpx.Response(200, text=SAMPLE_RSS_FEED)
        )

        async with httpx.AsyncClient() as client:
            adapter = SubstackAdapter(http_client=client)
            items = await adapter.fetch_latest("test")

        assert len(items) == 2

        first_item = items[0]
        assert first_item.title == "Test Article"
        assert first_item.original_url == "https://test.substack.com/p/test-article"
        assert first_item.author == "Test Author"
        assert first_item.external_id == "https://test.substack.com/p/test-article"
        assert first_item.thumbnail_url == "https://example.com/image.jpg"
        assert first_item.published_at == datetime(2024, 1, 15, 12, 0, 0, tzinfo=UTC)

    @respx.mock
    async def test_fetch_latest_empty_feed(self) -> None:
        empty_feed = """<?xml version="1.0" encoding="UTF-8"?>
        <rss version="2.0">
          <channel>
            <title>Empty Feed</title>
          </channel>
        </rss>
        """
        respx.get("https://empty.substack.com/feed").mock(
            return_value=httpx.Response(200, text=empty_feed)
        )

        async with httpx.AsyncClient() as client:
            adapter = SubstackAdapter(http_client=client)
            items = await adapter.fetch_latest("empty")

        assert len(items) == 0

    @respx.mock
    async def test_fetch_latest_http_error(self) -> None:
        respx.get("https://notfound.substack.com/feed").mock(return_value=httpx.Response(404))

        async with httpx.AsyncClient() as client:
            adapter = SubstackAdapter(http_client=client)

            with pytest.raises(httpx.HTTPStatusError):
                await adapter.fetch_latest("notfound")

    @respx.mock
    async def test_fetch_latest_request_error(self) -> None:
        request = httpx.Request("GET", "https://offline.substack.com/feed")
        respx.get("https://offline.substack.com/feed").mock(
            side_effect=httpx.ReadError("socket closed", request=request)
        )

        async with httpx.AsyncClient() as client:
            adapter = SubstackAdapter(http_client=client)

            with pytest.raises(httpx.ReadError, match="socket closed"):
                await adapter.fetch_latest("offline")

    @respx.mock
    async def test_fetch_latest_invalid_feed_returns_empty(self) -> None:
        respx.get("https://broken.substack.com/feed").mock(
            return_value=httpx.Response(200, text="<rss><broken>")
        )

        async with httpx.AsyncClient() as client:
            adapter = SubstackAdapter(http_client=client)
            items = await adapter.fetch_latest("broken")

        assert items == []

    @respx.mock
    async def test_fetch_latest_with_provided_feed_url(self) -> None:
        respx.get("https://custom.example.com/rss").mock(
            return_value=httpx.Response(200, text=SAMPLE_RSS_FEED)
        )

        async with httpx.AsyncClient() as client:
            adapter = SubstackAdapter(http_client=client)
            items = await adapter.fetch_latest("ignored", feed_url="https://custom.example.com/rss")

        assert len(items) == 2

    @respx.mock
    async def test_fetch_latest_without_http_client(self) -> None:
        respx.get("https://test.substack.com/feed").mock(
            return_value=httpx.Response(200, text=SAMPLE_RSS_FEED)
        )

        items = await SubstackAdapter().fetch_latest("test")

        assert len(items) == 2

    @respx.mock
    async def test_fetch_latest_continues_after_entry_parse_error(self) -> None:
        respx.get("https://test.substack.com/feed").mock(
            return_value=httpx.Response(200, text=SAMPLE_RSS_FEED)
        )
        recovered = ContentData(
            external_id="recovered",
            title="Recovered",
            original_url="https://test.substack.com/p/recovered",
            author="Author",
            published_at=datetime(2024, 1, 1, tzinfo=UTC),
            raw_content="Recovered content",
            thumbnail_url=None,
        )

        async with httpx.AsyncClient() as client:
            adapter = SubstackAdapter(http_client=client)
            with patch.object(
                adapter,
                "_parse_entry",
                side_effect=[RuntimeError("bad entry"), recovered],
            ):
                items = await adapter.fetch_latest("test")

        assert items == [recovered]

    async def test_source_type(self) -> None:
        adapter = SubstackAdapter()
        assert adapter.source_type == "substack"

    def test_parse_entry_falls_back_to_feed_title_for_author(self) -> None:
        feed = feedparser.parse(
            """<?xml version="1.0" encoding="UTF-8"?>
            <rss version="2.0">
              <channel>
                <title>Publisher Name</title>
                <item>
                  <title>No Byline</title>
                  <link>https://publisher.substack.com/p/no-byline</link>
                </item>
              </channel>
            </rss>
            """
        )

        item = SubstackAdapter()._parse_entry(feed.entries[0], feed)

        assert item.author == "Publisher Name"

    def test_parse_entry_uses_unknown_author_when_feed_has_no_title(self) -> None:
        entry = feedparser.FeedParserDict({"title": "No Author", "link": "https://example.com"})
        feed = feedparser.FeedParserDict({"feed": {}})

        item = SubstackAdapter()._parse_entry(entry, feed)

        assert item.author == "Unknown Author"

    def test_extract_content_uses_supported_content_value(self) -> None:
        entry = feedparser.FeedParserDict(
            {
                "content": [
                    {"type": "application/json", "value": "{}"},
                    {"type": "text/plain", "value": "Plain text content"},
                ]
            }
        )

        assert SubstackAdapter()._extract_content(entry) == "Plain text content"

    def test_extract_content_returns_none_for_empty_supported_content_value(self) -> None:
        entry = feedparser.FeedParserDict(
            {"content": [{"type": "text/html", "value": ""}], "summary": "ignored"}
        )

        assert SubstackAdapter()._extract_content(entry) is None

    def test_extract_content_falls_back_to_summary_after_unsupported_content(self) -> None:
        entry = feedparser.FeedParserDict(
            {"content": [{"type": "application/json", "value": "{}"}], "summary": "Summary text"}
        )

        assert SubstackAdapter()._extract_content(entry) == "Summary text"

    def test_extract_content_falls_back_to_description(self) -> None:
        entry = feedparser.FeedParserDict({"description": "Short description"})

        assert SubstackAdapter()._extract_content(entry) == "Short description"

    def test_extract_content_returns_none_without_candidates(self) -> None:
        assert SubstackAdapter()._extract_content(feedparser.FeedParserDict({})) is None

    def test_extract_thumbnail_uses_media_content_image_url(self) -> None:
        entry = feedparser.FeedParserDict(
            {"media_content": [{"medium": "image", "url": "https://example.com/media.jpg"}]}
        )

        assert SubstackAdapter()._extract_thumbnail(entry) == "https://example.com/media.jpg"

    def test_extract_thumbnail_uses_media_content_image_type(self) -> None:
        entry = feedparser.FeedParserDict(
            {"media_content": [{"type": "image/png", "url": "https://example.com/media.png"}]}
        )

        assert SubstackAdapter()._extract_thumbnail(entry) == "https://example.com/media.png"

    def test_extract_thumbnail_returns_none_when_image_media_has_no_url(self) -> None:
        entry = feedparser.FeedParserDict({"media_content": [{"medium": "image"}]})

        assert SubstackAdapter()._extract_thumbnail(entry) is None

    def test_extract_thumbnail_uses_media_thumbnail_url(self) -> None:
        entry = feedparser.FeedParserDict(
            {"media_thumbnail": [{"url": "https://example.com/thumb.jpg"}]}
        )

        assert SubstackAdapter()._extract_thumbnail(entry) == "https://example.com/thumb.jpg"

    def test_extract_thumbnail_skips_empty_media_thumbnail_url(self) -> None:
        entry = feedparser.FeedParserDict({"media_thumbnail": [{}]})

        assert SubstackAdapter()._extract_thumbnail(entry) is None

    def test_extract_thumbnail_uses_image_enclosure_href(self) -> None:
        feed = feedparser.parse(
            """<?xml version="1.0" encoding="UTF-8"?>
            <rss version="2.0">
              <channel>
                <item>
                  <title>With Image</title>
                  <enclosure url="https://example.com/hero.jpg" type="image/jpeg" />
                </item>
              </channel>
            </rss>
            """
        )

        assert (
            SubstackAdapter()._extract_thumbnail(feed.entries[0]) == "https://example.com/hero.jpg"
        )

    def test_extract_thumbnail_uses_image_enclosure_href_fallback(self) -> None:
        entry = AttrEntry(
            {
                "enclosures": [
                    {"type": "application/pdf", "url": "https://example.com/paper.pdf"},
                    {"type": "image/jpeg", "href": "https://example.com/hero.jpg"},
                ]
            }
        )

        assert SubstackAdapter()._extract_thumbnail(entry) == "https://example.com/hero.jpg"

    def test_extract_thumbnail_returns_none_when_image_enclosure_has_no_url(self) -> None:
        entry = AttrEntry({"enclosures": [{"type": "image/jpeg"}]})

        assert SubstackAdapter()._extract_thumbnail(entry) is None
