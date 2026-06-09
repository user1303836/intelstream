from datetime import UTC, datetime

import feedparser
import httpx
import pytest
import respx

from intelstream.adapters.base import ContentData
from intelstream.adapters.rss import RSSAdapter

SAMPLE_ATOM_FEED = """<?xml version="1.0" encoding="utf-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <title>Test Blog</title>
  <link href="https://testblog.com/"/>
  <updated>2024-01-15T12:00:00Z</updated>
  <entry>
    <title>Atom Article</title>
    <link href="https://testblog.com/atom-article"/>
    <id>https://testblog.com/atom-article</id>
    <updated>2024-01-15T12:00:00Z</updated>
    <author>
      <name>Atom Author</name>
    </author>
    <summary>This is an Atom feed entry.</summary>
  </entry>
</feed>
"""

SAMPLE_RSS_FEED = """<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>Test RSS Blog</title>
    <link>https://rssblog.com</link>
    <item>
      <title>RSS Article</title>
      <link>https://rssblog.com/rss-article</link>
      <guid>rss-article-123</guid>
      <pubDate>Tue, 16 Jan 2024 08:00:00 GMT</pubDate>
      <description>RSS article description.</description>
    </item>
  </channel>
</rss>
"""

SAMPLE_RSS_MULTIPLE_AUTHORS = """<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:dc="http://purl.org/dc/elements/1.1/">
  <channel>
    <title>Multi-Author Blog</title>
    <item>
      <title>Collaborative Article</title>
      <link>https://blog.com/collab</link>
      <guid>collab-123</guid>
      <pubDate>Wed, 17 Jan 2024 14:00:00 GMT</pubDate>
      <dc:creator>Author One</dc:creator>
      <dc:creator>Author Two</dc:creator>
    </item>
  </channel>
</rss>
"""


class AttributeEntry(dict):
    def __getattr__(self, name: str) -> object:
        return self[name]


class TruthyEmptyList(list[object]):
    def __bool__(self) -> bool:
        return True


class TestRSSAdapter:
    async def test_get_feed_url_returns_identifier(self) -> None:
        adapter = RSSAdapter()
        url = await adapter.get_feed_url("https://example.com/feed.xml")
        assert url == "https://example.com/feed.xml"

    @respx.mock
    async def test_fetch_atom_feed(self) -> None:
        respx.get("https://testblog.com/feed.xml").mock(
            return_value=httpx.Response(200, text=SAMPLE_ATOM_FEED)
        )

        async with httpx.AsyncClient() as client:
            adapter = RSSAdapter(http_client=client)
            items = await adapter.fetch_latest("https://testblog.com/feed.xml")

        assert len(items) == 1
        item = items[0]
        assert item.title == "Atom Article"
        assert item.author == "Atom Author"
        assert item.original_url == "https://testblog.com/atom-article"
        assert item.published_at == datetime(2024, 1, 15, 12, 0, 0, tzinfo=UTC)

    @respx.mock
    async def test_fetch_rss_feed(self) -> None:
        respx.get("https://rssblog.com/feed").mock(
            return_value=httpx.Response(200, text=SAMPLE_RSS_FEED)
        )

        async with httpx.AsyncClient() as client:
            adapter = RSSAdapter(http_client=client)
            items = await adapter.fetch_latest("https://rssblog.com/feed")

        assert len(items) == 1
        item = items[0]
        assert item.title == "RSS Article"
        assert item.external_id == "rss-article-123"
        assert item.author == "Test RSS Blog"
        assert item.published_at == datetime(2024, 1, 16, 8, 0, 0, tzinfo=UTC)

    @respx.mock
    async def test_fetch_latest_http_error(self) -> None:
        respx.get("https://notfound.com/feed").mock(return_value=httpx.Response(500))

        async with httpx.AsyncClient() as client:
            adapter = RSSAdapter(http_client=client)

            with pytest.raises(httpx.HTTPStatusError):
                await adapter.fetch_latest("https://notfound.com/feed")

    @respx.mock
    async def test_fetch_latest_request_error(self) -> None:
        request = httpx.Request("GET", "https://offline.com/feed")
        respx.get("https://offline.com/feed").mock(
            side_effect=httpx.ConnectError("network unreachable", request=request)
        )

        async with httpx.AsyncClient() as client:
            adapter = RSSAdapter(http_client=client)

            with pytest.raises(httpx.ConnectError, match="network unreachable"):
                await adapter.fetch_latest("https://offline.com/feed")

    @respx.mock
    async def test_fetch_invalid_feed(self) -> None:
        respx.get("https://invalid.com/feed").mock(
            return_value=httpx.Response(200, text="<not valid xml>")
        )

        async with httpx.AsyncClient() as client:
            adapter = RSSAdapter(http_client=client)
            items = await adapter.fetch_latest("https://invalid.com/feed")

        assert len(items) == 0

    @respx.mock
    async def test_uses_feed_url_parameter(self) -> None:
        respx.get("https://override.com/feed").mock(
            return_value=httpx.Response(200, text=SAMPLE_RSS_FEED)
        )

        async with httpx.AsyncClient() as client:
            adapter = RSSAdapter(http_client=client)
            items = await adapter.fetch_latest(
                "ignored-identifier", feed_url="https://override.com/feed"
            )

        assert len(items) == 1

    @respx.mock
    async def test_fetch_latest_without_injected_client(self) -> None:
        respx.get("https://rssblog.com/internal-client-feed").mock(
            return_value=httpx.Response(200, text=SAMPLE_RSS_FEED)
        )

        adapter = RSSAdapter()
        items = await adapter.fetch_latest("https://rssblog.com/internal-client-feed")

        assert len(items) == 1
        assert items[0].title == "RSS Article"

    @respx.mock
    async def test_fetch_latest_continues_after_entry_parse_error(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        two_item_feed = """<?xml version="1.0" encoding="UTF-8"?>
        <rss version="2.0">
          <channel>
            <title>Recovering Feed</title>
            <item><title>Bad</title><link>https://example.com/bad</link></item>
            <item><title>Good</title><link>https://example.com/good</link></item>
          </channel>
        </rss>
        """
        respx.get("https://example.com/feed").mock(
            return_value=httpx.Response(200, text=two_item_feed)
        )
        recovered = ContentData(
            external_id="good",
            title="Good",
            original_url="https://example.com/good",
            author="Author",
            published_at=datetime(2024, 1, 1, tzinfo=UTC),
        )
        adapter = RSSAdapter()
        calls = 0

        def fake_parse_entry(
            _entry: feedparser.FeedParserDict,
            _feed: feedparser.FeedParserDict,
        ) -> ContentData:
            nonlocal calls
            calls += 1
            if calls == 1:
                raise ValueError("bad entry")
            return recovered

        monkeypatch.setattr(adapter, "_parse_entry", fake_parse_entry)

        items = await adapter.fetch_latest("https://example.com/feed")

        assert items == [recovered]

    async def test_source_type(self) -> None:
        adapter = RSSAdapter()
        assert adapter.source_type == "rss"

    @respx.mock
    async def test_fallback_to_feed_title_for_author(self) -> None:
        feed_without_author = """<?xml version="1.0" encoding="UTF-8"?>
        <rss version="2.0">
          <channel>
            <title>Feed Title as Author</title>
            <item>
              <title>No Author Article</title>
              <link>https://blog.com/no-author</link>
              <guid>no-author</guid>
            </item>
          </channel>
        </rss>
        """
        respx.get("https://blog.com/feed").mock(
            return_value=httpx.Response(200, text=feed_without_author)
        )

        async with httpx.AsyncClient() as client:
            adapter = RSSAdapter(http_client=client)
            items = await adapter.fetch_latest("https://blog.com/feed")

        assert len(items) == 1
        assert items[0].author == "Feed Title as Author"

    def test_extract_author_joins_multiple_entry_authors(self) -> None:
        entry = feedparser.FeedParserDict(
            {
                "authors": [
                    feedparser.FeedParserDict({"name": "Author One"}),
                    feedparser.FeedParserDict({"name": "Author Two"}),
                ]
            }
        )
        feed = feedparser.FeedParserDict({"feed": feedparser.FeedParserDict()})

        assert RSSAdapter()._extract_author(entry, feed) == "Author One, Author Two"

    def test_extract_author_prefers_author_detail_name(self) -> None:
        entry = feedparser.FeedParserDict(
            {"author_detail": feedparser.FeedParserDict({"name": "Detail Author"})}
        )
        feed = feedparser.FeedParserDict({"feed": feedparser.FeedParserDict()})

        assert RSSAdapter()._extract_author(entry, feed) == "Detail Author"

    def test_extract_author_ignores_authors_without_names(self) -> None:
        entry = feedparser.FeedParserDict(
            {"authors": [feedparser.FeedParserDict({}), feedparser.FeedParserDict({"name": ""})]}
        )
        feed = feedparser.FeedParserDict({"feed": feedparser.FeedParserDict()})

        assert RSSAdapter()._extract_author(entry, feed) == "Unknown Author"

    def test_parse_entry_falls_back_to_unknown_author(self) -> None:
        adapter = RSSAdapter()
        feed = feedparser.parse(
            """<?xml version="1.0" encoding="UTF-8"?>
            <rss version="2.0">
              <channel>
                <item>
                  <title>Untitled Publisher</title>
                  <link>https://example.com/post</link>
                </item>
              </channel>
            </rss>
            """
        )

        item = adapter._parse_entry(feed.entries[0], feed)

        assert item.author == "Unknown Author"

    def test_extract_content_uses_first_non_empty_value_for_unknown_type(self) -> None:
        entry = feedparser.FeedParserDict(
            {"content": [{"type": "application/xhtml+xml", "value": "<section>Body</section>"}]}
        )

        assert RSSAdapter()._extract_content(entry) == "<section>Body</section>"

    def test_extract_content_falls_through_empty_content_list(self) -> None:
        entry = feedparser.FeedParserDict(
            {
                "content": TruthyEmptyList(),
                "summary_detail": feedparser.FeedParserDict({"value": "Summary detail"}),
            }
        )

        assert RSSAdapter()._extract_content(entry) == "Summary detail"

    def test_extract_content_skips_empty_unknown_content_value(self) -> None:
        entry = feedparser.FeedParserDict(
            {
                "content": [
                    {"type": "application/xhtml+xml", "value": ""},
                    {"type": "text/plain", "value": "Plain body"},
                ]
            }
        )

        assert RSSAdapter()._extract_content(entry) == "Plain body"

    def test_extract_content_returns_none_for_empty_preferred_content(self) -> None:
        entry = feedparser.FeedParserDict({"content": [{"type": "text/html", "value": ""}]})

        assert RSSAdapter()._extract_content(entry) is None

    def test_extract_content_uses_summary_detail(self) -> None:
        entry = feedparser.FeedParserDict(
            {"summary_detail": feedparser.FeedParserDict({"value": "Summary detail"})}
        )

        assert RSSAdapter()._extract_content(entry) == "Summary detail"

    def test_extract_content_uses_summary_then_description(self) -> None:
        adapter = RSSAdapter()
        assert (
            adapter._extract_content(feedparser.FeedParserDict({"summary": "Summary"})) == "Summary"
        )
        assert (
            adapter._extract_content(feedparser.FeedParserDict({"description": "Description"}))
            == "Description"
        )

    def test_extract_content_returns_none_when_missing(self) -> None:
        assert RSSAdapter()._extract_content(feedparser.FeedParserDict()) is None

    def test_extract_thumbnail_uses_media_content_image(self) -> None:
        entry = feedparser.FeedParserDict(
            {"media_content": [{"medium": "image", "url": "https://example.com/media.jpg"}]}
        )

        assert RSSAdapter()._extract_thumbnail(entry) == "https://example.com/media.jpg"

    def test_extract_thumbnail_uses_media_content_image_type(self) -> None:
        entry = feedparser.FeedParserDict(
            {"media_content": [{"type": "image/jpeg", "url": "https://example.com/type.jpg"}]}
        )

        assert RSSAdapter()._extract_thumbnail(entry) == "https://example.com/type.jpg"

    def test_extract_thumbnail_skips_non_image_media_content(self) -> None:
        entry = feedparser.FeedParserDict(
            {
                "media_content": [{"medium": "video", "url": "https://example.com/video.mp4"}],
                "media_thumbnail": [{"url": "https://example.com/thumb.jpg"}],
            }
        )

        assert RSSAdapter()._extract_thumbnail(entry) == "https://example.com/thumb.jpg"

    def test_extract_thumbnail_returns_none_for_image_media_without_url(self) -> None:
        entry = feedparser.FeedParserDict({"media_content": [{"medium": "image"}]})

        assert RSSAdapter()._extract_thumbnail(entry) is None

    def test_extract_thumbnail_uses_media_thumbnail(self) -> None:
        entry = feedparser.FeedParserDict(
            {"media_thumbnail": [{"url": "https://example.com/thumb.jpg"}]}
        )

        assert RSSAdapter()._extract_thumbnail(entry) == "https://example.com/thumb.jpg"

    def test_extract_thumbnail_skips_empty_media_thumbnail_url(self) -> None:
        entry = AttributeEntry(
            {
                "media_thumbnail": [{"url": ""}],
                "enclosures": [{"type": "image/png", "url": "https://example.com/enclosed.png"}],
            }
        )

        assert RSSAdapter()._extract_thumbnail(entry) == "https://example.com/enclosed.png"

    def test_extract_thumbnail_falls_through_empty_media_thumbnail_list(self) -> None:
        entry = AttributeEntry(
            {
                "media_thumbnail": TruthyEmptyList(),
                "enclosures": [{"type": "image/png", "url": "https://example.com/enclosed.png"}],
            }
        )

        assert RSSAdapter()._extract_thumbnail(entry) == "https://example.com/enclosed.png"

    def test_extract_thumbnail_uses_image_enclosure_href_and_url(self) -> None:
        adapter = RSSAdapter()
        href_entry = AttributeEntry(
            {"enclosures": [{"type": "image/png", "href": "https://example.com/href.png"}]}
        )
        url_entry = AttributeEntry(
            {"enclosures": [{"type": "image/png", "url": "https://example.com/url.png"}]}
        )

        assert adapter._extract_thumbnail(href_entry) == "https://example.com/href.png"
        assert adapter._extract_thumbnail(url_entry) == "https://example.com/url.png"

    def test_extract_thumbnail_skips_non_image_enclosure(self) -> None:
        entry = AttributeEntry(
            {
                "enclosures": [{"type": "text/html", "href": "https://example.com/page"}],
                "links": [{"type": "image/png", "href": "https://example.com/card.png"}],
            }
        )

        assert RSSAdapter()._extract_thumbnail(entry) == "https://example.com/card.png"

    def test_extract_thumbnail_falls_through_empty_enclosures_list(self) -> None:
        entry = AttributeEntry(
            {
                "enclosures": TruthyEmptyList(),
                "links": [{"type": "image/png", "href": "https://example.com/card.png"}],
            }
        )

        assert RSSAdapter()._extract_thumbnail(entry) == "https://example.com/card.png"

    def test_extract_thumbnail_uses_link_image_fallback(self) -> None:
        entry = feedparser.FeedParserDict(
            {
                "links": [
                    {"type": "text/html", "href": "ignored"},
                    {"type": "image/png", "href": "https://example.com/card.png"},
                ]
            }
        )

        assert RSSAdapter()._extract_thumbnail(entry) == "https://example.com/card.png"

    def test_extract_thumbnail_returns_none_when_links_are_not_images(self) -> None:
        entry = AttributeEntry(
            {"links": [{"type": "text/html", "href": "https://example.com/page"}]}
        )

        assert RSSAdapter()._extract_thumbnail(entry) is None

    def test_extract_thumbnail_returns_none_when_no_thumbnail_fields(self) -> None:
        assert RSSAdapter()._extract_thumbnail(AttributeEntry()) is None
