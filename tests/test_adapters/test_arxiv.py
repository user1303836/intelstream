from typing import Any

import httpx
import pytest
import respx

from intelstream.adapters.arxiv import ArxivAdapter

SAMPLE_ARXIV_FEED = """<?xml version='1.0' encoding='UTF-8'?>
<rss xmlns:arxiv="http://arxiv.org/schemas/atom"
     xmlns:dc="http://purl.org/dc/elements/1.1/"
     xmlns:atom="http://www.w3.org/2005/Atom"
     xmlns:content="http://purl.org/rss/1.0/modules/content/"
     version="2.0">
  <channel>
    <title>cs.AI updates on arXiv.org</title>
    <link>http://rss.arxiv.org/rss/cs.AI</link>
    <item>
      <title>Scaling Laws for Neural Machine Translation</title>
      <link>https://arxiv.org/abs/2401.12345</link>
      <description>arXiv:2401.12345v1 Announce Type: new
Abstract: This paper establishes precise scaling laws for neural machine translation, showing that performance improves predictably with compute, data, and model size.</description>
      <guid isPermaLink="false">oai:arXiv.org:2401.12345v1</guid>
      <category>cs.AI</category>
      <category>cs.CL</category>
      <pubDate>Tue, 16 Jan 2024 00:00:00 -0500</pubDate>
      <arxiv:announce_type>new</arxiv:announce_type>
      <dc:creator>Jane Smith, John Doe, Alice Johnson</dc:creator>
    </item>
    <item>
      <title>arXiv:2401.12346v2 Constitutional AI Improvements</title>
      <link>https://arxiv.org/abs/2401.12346</link>
      <description>arXiv:2401.12346v2 Announce Type: replace
Abstract: We present improvements to constitutional AI methods that reduce harmful outputs while maintaining helpfulness.</description>
      <guid isPermaLink="false">oai:arXiv.org:2401.12346v2</guid>
      <category>cs.AI</category>
      <pubDate>Wed, 17 Jan 2024 00:00:00 -0500</pubDate>
      <arxiv:announce_type>replace</arxiv:announce_type>
      <dc:creator>Bob Williams</dc:creator>
    </item>
  </channel>
</rss>
"""

SAMPLE_ARXIV_FEED_WITH_ATOM_AUTHORS = """<?xml version='1.0' encoding='UTF-8'?>
<rss xmlns:arxiv="http://arxiv.org/schemas/atom"
     xmlns:dc="http://purl.org/dc/elements/1.1/"
     xmlns:atom="http://www.w3.org/2005/Atom"
     version="2.0">
  <channel>
    <title>cs.LG updates on arXiv.org</title>
    <item>
      <title>Multi-Author Paper</title>
      <link>https://arxiv.org/abs/2401.99999</link>
      <description>Abstract: A paper with multiple authors using atom format.</description>
      <guid isPermaLink="false">oai:arXiv.org:2401.99999v1</guid>
      <pubDate>Thu, 18 Jan 2024 00:00:00 -0500</pubDate>
      <author>
        <name>Author One</name>
      </author>
      <author>
        <name>Author Two</name>
      </author>
    </item>
  </channel>
</rss>
"""


class TestArxivAdapter:
    async def test_source_type(self) -> None:
        adapter = ArxivAdapter()
        assert adapter.source_type == "arxiv"

    async def test_get_feed_url(self) -> None:
        adapter = ArxivAdapter()
        url = await adapter.get_feed_url("cs.AI")
        assert url == "https://arxiv.org/rss/cs.AI"

    async def test_get_feed_url_stat_ml(self) -> None:
        adapter = ArxivAdapter()
        url = await adapter.get_feed_url("stat.ML")
        assert url == "https://arxiv.org/rss/stat.ML"

    @respx.mock
    async def test_fetch_latest_parses_entries(self) -> None:
        respx.get("https://arxiv.org/rss/cs.AI").mock(
            return_value=httpx.Response(200, text=SAMPLE_ARXIV_FEED)
        )

        async with httpx.AsyncClient() as client:
            adapter = ArxivAdapter(http_client=client)
            items = await adapter.fetch_latest("cs.AI")

        assert len(items) == 2

    @respx.mock
    async def test_fetch_latest_extracts_arxiv_id(self) -> None:
        respx.get("https://arxiv.org/rss/cs.AI").mock(
            return_value=httpx.Response(200, text=SAMPLE_ARXIV_FEED)
        )

        async with httpx.AsyncClient() as client:
            adapter = ArxivAdapter(http_client=client)
            items = await adapter.fetch_latest("cs.AI")

        assert items[0].external_id == "arxiv:2401.12345"
        assert items[1].external_id == "arxiv:2401.12346"

    @respx.mock
    async def test_fetch_latest_cleans_title(self) -> None:
        respx.get("https://arxiv.org/rss/cs.AI").mock(
            return_value=httpx.Response(200, text=SAMPLE_ARXIV_FEED)
        )

        async with httpx.AsyncClient() as client:
            adapter = ArxivAdapter(http_client=client)
            items = await adapter.fetch_latest("cs.AI")

        assert items[0].title == "Scaling Laws for Neural Machine Translation"
        assert items[1].title == "Constitutional AI Improvements"

    @respx.mock
    async def test_fetch_latest_extracts_authors(self) -> None:
        respx.get("https://arxiv.org/rss/cs.AI").mock(
            return_value=httpx.Response(200, text=SAMPLE_ARXIV_FEED)
        )

        async with httpx.AsyncClient() as client:
            adapter = ArxivAdapter(http_client=client)
            items = await adapter.fetch_latest("cs.AI")

        assert items[0].author == "Jane Smith, John Doe, Alice Johnson"
        assert items[1].author == "Bob Williams"

    @respx.mock
    async def test_fetch_latest_extracts_abstract(self) -> None:
        respx.get("https://arxiv.org/rss/cs.AI").mock(
            return_value=httpx.Response(200, text=SAMPLE_ARXIV_FEED)
        )

        async with httpx.AsyncClient() as client:
            adapter = ArxivAdapter(http_client=client)
            items = await adapter.fetch_latest("cs.AI")

        assert items[0].raw_content is not None
        assert "scaling laws" in items[0].raw_content.lower()
        assert "arXiv:" not in items[0].raw_content

    @respx.mock
    async def test_fetch_latest_extracts_url(self) -> None:
        respx.get("https://arxiv.org/rss/cs.AI").mock(
            return_value=httpx.Response(200, text=SAMPLE_ARXIV_FEED)
        )

        async with httpx.AsyncClient() as client:
            adapter = ArxivAdapter(http_client=client)
            items = await adapter.fetch_latest("cs.AI")

        assert items[0].original_url == "https://arxiv.org/abs/2401.12345"
        assert items[1].original_url == "https://arxiv.org/abs/2401.12346"

    @respx.mock
    async def test_fetch_latest_parses_date(self) -> None:
        respx.get("https://arxiv.org/rss/cs.AI").mock(
            return_value=httpx.Response(200, text=SAMPLE_ARXIV_FEED)
        )

        async with httpx.AsyncClient() as client:
            adapter = ArxivAdapter(http_client=client)
            items = await adapter.fetch_latest("cs.AI")

        assert items[0].published_at.year == 2024
        assert items[0].published_at.month == 1
        assert items[0].published_at.day == 16

    @respx.mock
    async def test_fetch_latest_with_feed_url_override(self) -> None:
        respx.get("https://custom.arxiv.org/feed").mock(
            return_value=httpx.Response(200, text=SAMPLE_ARXIV_FEED)
        )

        async with httpx.AsyncClient() as client:
            adapter = ArxivAdapter(http_client=client)
            items = await adapter.fetch_latest("cs.AI", feed_url="https://custom.arxiv.org/feed")

        assert len(items) == 2

    @respx.mock
    async def test_fetch_latest_http_error(self) -> None:
        respx.get("https://arxiv.org/rss/cs.AI").mock(return_value=httpx.Response(500))

        async with httpx.AsyncClient() as client:
            adapter = ArxivAdapter(http_client=client)

            with pytest.raises(httpx.HTTPStatusError):
                await adapter.fetch_latest("cs.AI")

    @respx.mock
    async def test_fetch_latest_invalid_feed(self) -> None:
        respx.get("https://arxiv.org/rss/cs.AI").mock(
            return_value=httpx.Response(200, text="<not valid xml>")
        )

        async with httpx.AsyncClient() as client:
            adapter = ArxivAdapter(http_client=client)
            items = await adapter.fetch_latest("cs.AI")

        assert len(items) == 0

    @respx.mock
    async def test_fetch_latest_without_http_client(self) -> None:
        respx.get("https://arxiv.org/rss/cs.AI").mock(
            return_value=httpx.Response(200, text=SAMPLE_ARXIV_FEED)
        )

        adapter = ArxivAdapter()
        items = await adapter.fetch_latest("cs.AI")

        assert len(items) == 2


class MockEntry(dict[str, Any]):
    def __getattr__(self, name: str) -> Any:
        return self.get(name)


class TestArxivIdExtraction:
    def test_extract_from_link(self) -> None:
        adapter = ArxivAdapter()
        entry = MockEntry({"link": "https://arxiv.org/abs/2401.12345", "id": ""})
        arxiv_id = adapter._extract_arxiv_id(entry)
        assert arxiv_id == "arxiv:2401.12345"

    def test_extract_from_guid(self) -> None:
        adapter = ArxivAdapter()
        entry = MockEntry({"link": "https://example.com", "id": "oai:arXiv.org:2401.12345v1"})
        arxiv_id = adapter._extract_arxiv_id(entry)
        assert arxiv_id == "arxiv:2401.12345"

    def test_extract_strips_version_from_guid(self) -> None:
        adapter = ArxivAdapter()
        entry = MockEntry({"link": "https://example.com", "id": "oai:arXiv.org:2401.12345v3"})
        arxiv_id = adapter._extract_arxiv_id(entry)
        assert arxiv_id == "arxiv:2401.12345"


class TestTitleCleaning:
    def test_clean_title_removes_arxiv_prefix(self) -> None:
        adapter = ArxivAdapter()
        assert adapter._clean_title("arXiv:2401.12345v1 Some Paper Title") == "Some Paper Title"

    def test_clean_title_without_prefix(self) -> None:
        adapter = ArxivAdapter()
        assert adapter._clean_title("Some Paper Title") == "Some Paper Title"

    def test_clean_title_normalizes_whitespace(self) -> None:
        adapter = ArxivAdapter()
        assert adapter._clean_title("Title  with   spaces") == "Title with spaces"


class TestAbstractExtraction:
    def test_extract_abstract_from_description(self) -> None:
        adapter = ArxivAdapter()
        entry = MockEntry(
            {"summary": "arXiv:2401.12345v1 Announce Type: new\nAbstract: This is the abstract."}
        )
        abstract = adapter._extract_abstract(entry)
        assert abstract == "This is the abstract."

    def test_extract_abstract_without_prefix(self) -> None:
        adapter = ArxivAdapter()
        entry = MockEntry({"summary": "Abstract: Direct abstract content."})
        abstract = adapter._extract_abstract(entry)
        assert abstract == "Direct abstract content."

    def test_extract_abstract_no_abstract_marker(self) -> None:
        adapter = ArxivAdapter()
        entry = MockEntry({"summary": "Just some text without abstract marker."})
        abstract = adapter._extract_abstract(entry)
        assert abstract == "Just some text without abstract marker."

    def test_extract_abstract_empty(self) -> None:
        adapter = ArxivAdapter()
        entry = MockEntry({"summary": None, "description": None})
        abstract = adapter._extract_abstract(entry)
        assert abstract is None
