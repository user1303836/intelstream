from datetime import UTC, datetime
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from intelstream.adapters.base import ContentData
from intelstream.config import Settings
from intelstream.database.models import ContentItem, Source, SourceType
from intelstream.database.repository import Repository
from intelstream.services.pipeline import ContentPipeline
from intelstream.services.summarizer import SummarizationError, SummarizationService


@pytest.fixture
def mock_settings():
    settings = MagicMock(spec=Settings)
    settings.youtube_api_key = "test-youtube-key"
    settings.anthropic_api_key = "test-anthropic-key"
    settings.fetch_delay_seconds = 0.0
    return settings


@pytest.fixture
def mock_repository():
    return AsyncMock(spec=Repository)


@pytest.fixture
def mock_summarizer():
    return AsyncMock(spec=SummarizationService)


@pytest.fixture
def pipeline(mock_settings, mock_repository, mock_summarizer):
    return ContentPipeline(
        settings=mock_settings,
        repository=mock_repository,
        summarizer=mock_summarizer,
    )


@pytest.fixture
def sample_source():
    source = MagicMock(spec=Source)
    source.id = "source-123"
    source.name = "Test Source"
    source.type = SourceType.SUBSTACK
    source.identifier = "test-substack"
    source.feed_url = "https://test.substack.com/feed"
    return source


@pytest.fixture
def sample_content_data():
    return ContentData(
        external_id="article-123",
        title="Test Article",
        original_url="https://test.substack.com/p/test-article",
        author="Test Author",
        published_at=datetime(2024, 1, 15, 12, 0, 0, tzinfo=UTC),
        raw_content="This is the article content.",
        thumbnail_url="https://example.com/thumb.jpg",
    )


@pytest.fixture
def sample_content_item(sample_source):
    item = MagicMock(spec=ContentItem)
    item.id = "item-123"
    item.source_id = sample_source.id
    item.title = "Test Article"
    item.author = "Test Author"
    item.raw_content = "This is the article content."
    return item


class TestContentPipelineInitialization:
    async def test_initialize_creates_http_client(self, pipeline: ContentPipeline):
        await pipeline.initialize()

        assert pipeline._http_client is not None
        assert pipeline._adapters is not None

        await pipeline.close()

    async def test_initialize_creates_adapters(self, pipeline: ContentPipeline):
        await pipeline.initialize()

        assert SourceType.SUBSTACK in pipeline._adapters
        assert SourceType.RSS in pipeline._adapters
        assert SourceType.YOUTUBE in pipeline._adapters

        await pipeline.close()

    async def test_initialize_without_youtube_key(self, mock_repository, mock_summarizer):
        settings = MagicMock(spec=Settings)
        settings.youtube_api_key = None
        settings.anthropic_api_key = "test-anthropic-key"
        settings.fetch_delay_seconds = 0.0

        pipeline = ContentPipeline(
            settings=settings, repository=mock_repository, summarizer=mock_summarizer
        )

        await pipeline.initialize()

        assert SourceType.SUBSTACK in pipeline._adapters
        assert SourceType.RSS in pipeline._adapters
        assert SourceType.YOUTUBE not in pipeline._adapters

        await pipeline.close()

    async def test_close_disposes_http_client(self, pipeline: ContentPipeline):
        await pipeline.initialize()
        http_client = pipeline._http_client

        await pipeline.close()

        assert http_client.is_closed


class TestFetchAllSources:
    async def test_fetch_all_sources_success(
        self,
        pipeline: ContentPipeline,
        mock_repository: AsyncMock,
        sample_source,
        sample_content_data,
    ):
        await pipeline.initialize()

        mock_repository.get_all_sources.return_value = [sample_source]
        mock_repository.content_item_exists.return_value = False

        with patch.object(
            pipeline._adapters[SourceType.SUBSTACK],
            "fetch_latest",
            new_callable=AsyncMock,
            return_value=[sample_content_data],
        ):
            result = await pipeline.fetch_all_sources()

        assert result == 1
        mock_repository.add_content_item.assert_called_once()
        mock_repository.update_source_last_polled.assert_called_once_with(sample_source.id)

        await pipeline.close()

    async def test_fetch_all_sources_skips_existing(
        self,
        pipeline: ContentPipeline,
        mock_repository: AsyncMock,
        sample_source,
        sample_content_data,
    ):
        await pipeline.initialize()

        mock_repository.get_all_sources.return_value = [sample_source]
        mock_repository.content_item_exists.return_value = True

        with patch.object(
            pipeline._adapters[SourceType.SUBSTACK],
            "fetch_latest",
            new_callable=AsyncMock,
            return_value=[sample_content_data],
        ):
            result = await pipeline.fetch_all_sources()

        assert result == 0
        mock_repository.add_content_item.assert_not_called()

        await pipeline.close()

    async def test_fetch_all_sources_handles_adapter_errors(
        self, pipeline: ContentPipeline, mock_repository: AsyncMock, sample_source
    ):
        await pipeline.initialize()

        mock_repository.get_all_sources.return_value = [sample_source]

        with patch.object(
            pipeline._adapters[SourceType.SUBSTACK],
            "fetch_latest",
            new_callable=AsyncMock,
            side_effect=Exception("Network error"),
        ):
            result = await pipeline.fetch_all_sources()

        assert result == 0

        await pipeline.close()

    async def test_fetch_all_sources_no_adapter_for_type(
        self, pipeline: ContentPipeline, mock_repository: AsyncMock
    ):
        await pipeline.initialize()

        source = MagicMock(spec=Source)
        source.type = MagicMock()
        source.type.value = "unknown"

        mock_repository.get_all_sources.return_value = [source]

        result = await pipeline.fetch_all_sources()

        assert result == 0

        await pipeline.close()

    async def test_first_poll_limits_to_one_item(
        self,
        pipeline: ContentPipeline,
        mock_repository: AsyncMock,
        sample_source,
    ):
        """On first poll (last_polled_at is None), only store the most recent item."""
        await pipeline.initialize()

        sample_source.last_polled_at = None

        items = [
            ContentData(
                external_id=f"article-{i}",
                title=f"Article {i}",
                original_url=f"https://test.com/article-{i}",
                author="Author",
                published_at=datetime(2024, 1, i + 1, 12, 0, 0, tzinfo=UTC),
                raw_content=f"Content {i}",
                thumbnail_url=None,
            )
            for i in range(5)
        ]

        mock_repository.get_all_sources.return_value = [sample_source]
        mock_repository.content_item_exists.return_value = False

        with patch.object(
            pipeline._adapters[SourceType.SUBSTACK],
            "fetch_latest",
            new_callable=AsyncMock,
            return_value=items,
        ):
            result = await pipeline.fetch_all_sources()

        assert result == 1
        assert mock_repository.add_content_item.call_count == 1

        await pipeline.close()

    async def test_subsequent_poll_stores_all_new_items(
        self,
        pipeline: ContentPipeline,
        mock_repository: AsyncMock,
        sample_source,
    ):
        """On subsequent polls (last_polled_at is set), store all new items."""
        await pipeline.initialize()

        sample_source.last_polled_at = datetime(2024, 1, 1, 0, 0, 0, tzinfo=UTC)

        items = [
            ContentData(
                external_id=f"article-{i}",
                title=f"Article {i}",
                original_url=f"https://test.com/article-{i}",
                author="Author",
                published_at=datetime(2024, 1, i + 1, 12, 0, 0, tzinfo=UTC),
                raw_content=f"Content {i}",
                thumbnail_url=None,
            )
            for i in range(5)
        ]

        mock_repository.get_all_sources.return_value = [sample_source]
        mock_repository.content_item_exists.return_value = False

        with patch.object(
            pipeline._adapters[SourceType.SUBSTACK],
            "fetch_latest",
            new_callable=AsyncMock,
            return_value=items,
        ):
            result = await pipeline.fetch_all_sources()

        assert result == 5
        assert mock_repository.add_content_item.call_count == 5

        await pipeline.close()

    async def test_fetch_all_sources_applies_rate_limiting(
        self,
        mock_repository: AsyncMock,
        mock_summarizer: AsyncMock,
    ):
        """Verify that fetch_delay_seconds is applied between source fetches."""
        settings = MagicMock(spec=Settings)
        settings.youtube_api_key = "test-key"
        settings.anthropic_api_key = "test-key"
        settings.fetch_delay_seconds = 0.1

        pipeline = ContentPipeline(
            settings=settings, repository=mock_repository, summarizer=mock_summarizer
        )
        await pipeline.initialize()

        source1 = MagicMock(spec=Source)
        source1.id = "source-1"
        source1.name = "Source 1"
        source1.type = SourceType.SUBSTACK
        source1.identifier = "source1"
        source1.feed_url = "https://source1.substack.com/feed"
        source1.last_polled_at = None

        source2 = MagicMock(spec=Source)
        source2.id = "source-2"
        source2.name = "Source 2"
        source2.type = SourceType.SUBSTACK
        source2.identifier = "source2"
        source2.feed_url = "https://source2.substack.com/feed"
        source2.last_polled_at = None

        mock_repository.get_all_sources.return_value = [source1, source2]
        mock_repository.content_item_exists.return_value = True

        with (
            patch.object(
                pipeline._adapters[SourceType.SUBSTACK],
                "fetch_latest",
                new_callable=AsyncMock,
                return_value=[],
            ),
            patch(
                "intelstream.services.pipeline.asyncio.sleep", new_callable=AsyncMock
            ) as mock_sleep,
        ):
            await pipeline.fetch_all_sources()
            mock_sleep.assert_called_once_with(0.1)

        await pipeline.close()


class TestSummarizePending:
    async def test_summarize_pending_success(
        self,
        pipeline: ContentPipeline,
        mock_repository: AsyncMock,
        mock_summarizer: AsyncMock,
        sample_content_item,
        sample_source,
    ):
        await pipeline.initialize()

        mock_repository.get_unsummarized_content_items.return_value = [sample_content_item]
        mock_repository.get_source_by_id.return_value = sample_source
        mock_repository.has_source_posted_content.return_value = True
        mock_summarizer.summarize.return_value = "This is the summary."

        result = await pipeline.summarize_pending(max_items=5)

        assert result == 1
        mock_summarizer.summarize.assert_called_once_with(
            content=sample_content_item.raw_content,
            title=sample_content_item.title,
            source_type="substack",
            author=sample_content_item.author,
        )
        mock_repository.update_content_item_summary.assert_called_once_with(
            sample_content_item.id, "This is the summary."
        )

        await pipeline.close()

    async def test_summarize_pending_no_summarizer(self, mock_settings, mock_repository: AsyncMock):
        pipeline = ContentPipeline(
            settings=mock_settings, repository=mock_repository, summarizer=None
        )

        result = await pipeline.summarize_pending()

        assert result == 0
        mock_repository.get_unsummarized_content_items.assert_not_called()

    async def test_summarize_pending_marks_items_without_content_ready_for_posting(
        self,
        pipeline: ContentPipeline,
        mock_repository: AsyncMock,
        mock_summarizer: AsyncMock,
    ):
        await pipeline.initialize()

        item_without_content = MagicMock(spec=ContentItem)
        item_without_content.id = "item-456"
        item_without_content.source_id = "source-456"
        item_without_content.raw_content = None

        mock_repository.get_unsummarized_content_items.return_value = [item_without_content]
        mock_repository.has_source_posted_content.return_value = True

        result = await pipeline.summarize_pending()

        assert result == 1
        mock_summarizer.summarize.assert_not_called()
        mock_repository.update_content_item_summary.assert_called_once_with("item-456", "")

        await pipeline.close()

    async def test_summarize_pending_handles_summarization_error(
        self,
        pipeline: ContentPipeline,
        mock_repository: AsyncMock,
        mock_summarizer: AsyncMock,
        sample_content_item,
        sample_source,
    ):
        await pipeline.initialize()

        mock_repository.get_unsummarized_content_items.return_value = [sample_content_item]
        mock_repository.get_source_by_id.return_value = sample_source
        mock_repository.has_source_posted_content.return_value = True
        mock_summarizer.summarize.side_effect = SummarizationError("API error")

        result = await pipeline.summarize_pending()

        assert result == 0
        mock_repository.update_content_item_summary.assert_not_called()

        await pipeline.close()

    async def test_summarize_pending_handles_unexpected_error(
        self,
        pipeline: ContentPipeline,
        mock_repository: AsyncMock,
        mock_summarizer: AsyncMock,
        sample_content_item,
        sample_source,
    ):
        await pipeline.initialize()

        mock_repository.get_unsummarized_content_items.return_value = [sample_content_item]
        mock_repository.get_source_by_id.return_value = sample_source
        mock_repository.has_source_posted_content.return_value = True
        mock_summarizer.summarize.side_effect = RuntimeError("Unexpected")

        result = await pipeline.summarize_pending()

        assert result == 0

        await pipeline.close()

    async def test_summarize_pending_unknown_source_type(
        self,
        pipeline: ContentPipeline,
        mock_repository: AsyncMock,
        mock_summarizer: AsyncMock,
        sample_content_item,
    ):
        await pipeline.initialize()

        mock_repository.get_unsummarized_content_items.return_value = [sample_content_item]
        mock_repository.get_source_by_id.return_value = None
        mock_repository.has_source_posted_content.return_value = True
        mock_summarizer.summarize.return_value = "Summary"

        result = await pipeline.summarize_pending()

        assert result == 1
        call_args = mock_summarizer.summarize.call_args
        assert call_args.kwargs["source_type"] == "unknown"

        await pipeline.close()

    async def test_summarize_pending_backfills_first_posting_items(
        self,
        pipeline: ContentPipeline,
        mock_repository: AsyncMock,
        mock_summarizer: AsyncMock,
        sample_source,
    ):
        await pipeline.initialize()

        old_item = MagicMock(spec=ContentItem)
        old_item.id = "old-item"
        old_item.source_id = sample_source.id
        old_item.raw_content = "Old content"
        old_item.title = "Old Article"
        old_item.author = "Author"
        old_item.published_at = datetime(2024, 1, 1, tzinfo=UTC)

        new_item = MagicMock(spec=ContentItem)
        new_item.id = "new-item"
        new_item.source_id = sample_source.id
        new_item.raw_content = "New content"
        new_item.title = "New Article"
        new_item.author = "Author"
        new_item.published_at = datetime(2024, 1, 15, tzinfo=UTC)

        mock_repository.get_unsummarized_content_items.side_effect = [
            [old_item, new_item],
            [new_item],
        ]
        mock_repository.has_source_posted_content.return_value = False
        mock_repository.get_most_recent_item_for_source.return_value = new_item
        mock_repository.mark_items_as_backfilled.return_value = 1
        mock_repository.get_source_by_id.return_value = sample_source
        mock_summarizer.summarize.return_value = "Summary"

        result = await pipeline.summarize_pending()

        mock_repository.mark_items_as_backfilled.assert_called_once_with(
            source_id=sample_source.id,
            exclude_item_id=new_item.id,
        )

        assert result == 1

        await pipeline.close()


class TestRunCycle:
    async def test_run_cycle_returns_tuple(
        self,
        pipeline: ContentPipeline,
        mock_repository: AsyncMock,
    ):
        await pipeline.initialize()

        mock_repository.get_all_sources.return_value = []
        mock_repository.get_unsummarized_content_items.return_value = []
        mock_repository.has_source_posted_content.return_value = True

        result = await pipeline.run_cycle()

        assert isinstance(result, tuple)
        assert len(result) == 2
        assert result == (0, 0)

        await pipeline.close()
