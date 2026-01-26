from datetime import UTC, datetime

import httpx
import pytest
import respx

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
    async def test_fetch_latest_with_provided_feed_url(self) -> None:
        respx.get("https://custom.example.com/rss").mock(
            return_value=httpx.Response(200, text=SAMPLE_RSS_FEED)
        )

        async with httpx.AsyncClient() as client:
            adapter = SubstackAdapter(http_client=client)
            items = await adapter.fetch_latest("ignored", feed_url="https://custom.example.com/rss")

        assert len(items) == 2

    async def test_source_type(self) -> None:
        adapter = SubstackAdapter()
        assert adapter.source_type == "substack"
