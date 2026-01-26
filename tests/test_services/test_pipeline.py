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

    async def test_summarize_pending_skips_items_without_content(
        self,
        pipeline: ContentPipeline,
        mock_repository: AsyncMock,
        mock_summarizer: AsyncMock,
    ):
        await pipeline.initialize()

        item_without_content = MagicMock(spec=ContentItem)
        item_without_content.id = "item-456"
        item_without_content.raw_content = None

        mock_repository.get_unsummarized_content_items.return_value = [item_without_content]

        result = await pipeline.summarize_pending()

        assert result == 0
        mock_summarizer.summarize.assert_not_called()

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
        mock_summarizer.summarize.return_value = "Summary"

        result = await pipeline.summarize_pending()

        assert result == 1
        call_args = mock_summarizer.summarize.call_args
        assert call_args.kwargs["source_type"] == "unknown"

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

        result = await pipeline.run_cycle()

        assert isinstance(result, tuple)
        assert len(result) == 2
        assert result == (0, 0)

        await pipeline.close()
