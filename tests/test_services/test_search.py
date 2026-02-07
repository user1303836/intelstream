import json
from datetime import UTC, datetime
from unittest.mock import AsyncMock, MagicMock, PropertyMock

import numpy as np
import pytest

from intelstream.database.models import ContentEmbedding, ContentItem, Source, SourceType
from intelstream.database.repository import Repository
from intelstream.services.search import (
    SearchService,
    build_embedding_text,
    compute_text_hash,
    cosine_similarity,
)


@pytest.fixture
def mock_repository():
    return AsyncMock(spec=Repository)


@pytest.fixture
def mock_provider():
    provider = MagicMock()
    provider.embed = AsyncMock(return_value=[[0.1, 0.2, 0.3]])
    type(provider).dimension = PropertyMock(return_value=3)
    type(provider).model_name = PropertyMock(return_value="test-model")
    return provider


@pytest.fixture
def search_service(mock_repository, mock_provider):
    return SearchService(mock_repository, mock_provider)


@pytest.fixture
def sample_source():
    source = MagicMock(spec=Source)
    source.id = "source-1"
    source.name = "Test Source"
    source.type = SourceType.SUBSTACK
    source.guild_id = "guild-1"
    return source


@pytest.fixture
def sample_item():
    item = MagicMock(spec=ContentItem)
    item.id = "item-1"
    item.source_id = "source-1"
    item.title = "Test Article"
    item.summary = "A great article about testing"
    item.original_url = "https://example.com/article"
    item.author = "Test Author"
    item.published_at = datetime(2024, 1, 15, 12, 0, 0, tzinfo=UTC)
    return item


@pytest.fixture
def sample_embedding():
    emb = MagicMock(spec=ContentEmbedding)
    emb.content_item_id = "item-1"
    emb.embedding_json = json.dumps([0.1, 0.2, 0.3])
    emb.model_name = "test-model"
    emb.text_hash = "abc123"
    return emb


class TestSearchServiceInitialization:
    def test_initializes_with_repository_and_provider(self, search_service):
        assert search_service._repository is not None
        assert search_service._provider is not None

    def test_cache_not_loaded_on_init(self, search_service):
        assert search_service._cache_loaded is False
        assert len(search_service._embeddings_cache) == 0


class TestBuildEmbeddingText:
    def test_combines_title_summary_and_metadata(self, sample_item, sample_source):
        text = build_embedding_text(sample_item, sample_source)
        assert "Test Article" in text
        assert "A great article about testing" in text
        assert "Test Source" in text
        assert "substack" in text
        assert "Test Author" in text

    def test_handles_no_summary(self, sample_item, sample_source):
        sample_item.summary = None
        text = build_embedding_text(sample_item, sample_source)
        assert "Test Article" in text
        assert "Test Source" in text

    def test_handles_no_author(self, sample_item, sample_source):
        sample_item.author = ""
        text = build_embedding_text(sample_item, sample_source)
        assert "Test Article" in text


class TestComputeTextHash:
    def test_returns_sha256_hex(self):
        h = compute_text_hash("test")
        assert len(h) == 64

    def test_same_input_same_hash(self):
        assert compute_text_hash("hello") == compute_text_hash("hello")

    def test_different_input_different_hash(self):
        assert compute_text_hash("hello") != compute_text_hash("world")


class TestCosineSimilarity:
    def test_identical_vectors_return_1(self):
        v = np.array([1.0, 0.0, 0.0], dtype=np.float32)
        candidates = np.array([[1.0, 0.0, 0.0]], dtype=np.float32)
        scores = cosine_similarity(v, candidates)
        assert abs(scores[0] - 1.0) < 1e-6

    def test_orthogonal_vectors_return_0(self):
        v = np.array([1.0, 0.0, 0.0], dtype=np.float32)
        candidates = np.array([[0.0, 1.0, 0.0]], dtype=np.float32)
        scores = cosine_similarity(v, candidates)
        assert abs(scores[0]) < 1e-6

    def test_opposite_vectors_return_negative(self):
        v = np.array([1.0, 0.0, 0.0], dtype=np.float32)
        candidates = np.array([[-1.0, 0.0, 0.0]], dtype=np.float32)
        scores = cosine_similarity(v, candidates)
        assert scores[0] < -0.99

    def test_zero_query_vector_returns_zeros(self):
        v = np.array([0.0, 0.0, 0.0], dtype=np.float32)
        candidates = np.array([[1.0, 0.0, 0.0], [0.0, 1.0, 0.0]], dtype=np.float32)
        scores = cosine_similarity(v, candidates)
        assert scores.shape == (2,)
        np.testing.assert_array_equal(scores, np.zeros(2, dtype=np.float32))

    def test_zero_candidate_vector_returns_zero_score(self):
        v = np.array([1.0, 0.0, 0.0], dtype=np.float32)
        candidates = np.array([[0.0, 0.0, 0.0], [1.0, 0.0, 0.0]], dtype=np.float32)
        scores = cosine_similarity(v, candidates)
        assert abs(scores[0]) < 1e-6
        assert abs(scores[1] - 1.0) < 1e-6


class TestEmbeddingGeneration:
    async def test_embed_pending_processes_items_without_embeddings(
        self, search_service, mock_repository, mock_provider, sample_item, sample_source
    ):
        mock_repository.get_latest_embedding.return_value = None
        mock_repository.get_items_without_embeddings.return_value = [sample_item]
        mock_repository.get_source_by_id.return_value = sample_source
        mock_provider.embed.return_value = [[0.1, 0.2, 0.3]]

        count = await search_service.embed_pending()

        assert count == 1
        mock_repository.add_content_embedding.assert_called_once()

    async def test_embed_pending_handles_empty_list(self, search_service, mock_repository):
        mock_repository.get_latest_embedding.return_value = None
        mock_repository.get_items_without_embeddings.return_value = []

        count = await search_service.embed_pending()

        assert count == 0

    async def test_embed_pending_updates_cache(
        self, search_service, mock_repository, mock_provider, sample_item, sample_source
    ):
        mock_repository.get_latest_embedding.return_value = None
        mock_repository.get_items_without_embeddings.return_value = [sample_item]
        mock_repository.get_source_by_id.return_value = sample_source
        mock_provider.embed.return_value = [[0.5, 0.6, 0.7]]

        await search_service.embed_pending()

        assert sample_item.id in search_service._embeddings_cache
        np.testing.assert_array_almost_equal(
            search_service._embeddings_cache[sample_item.id],
            np.array([0.5, 0.6, 0.7], dtype=np.float32),
        )

    async def test_embed_pending_continues_on_single_item_failure(
        self, search_service, mock_repository, mock_provider, sample_source
    ):
        item1 = MagicMock(spec=ContentItem)
        item1.id = "item-1"
        item1.source_id = "source-1"
        item1.title = "Item 1"
        item1.summary = "Summary 1"
        item1.author = "Author"

        item2 = MagicMock(spec=ContentItem)
        item2.id = "item-2"
        item2.source_id = "source-1"
        item2.title = "Item 2"
        item2.summary = "Summary 2"
        item2.author = "Author"

        mock_repository.get_latest_embedding.return_value = None
        mock_repository.get_items_without_embeddings.return_value = [item1, item2]
        mock_repository.get_source_by_id.return_value = sample_source
        mock_provider.embed.side_effect = [Exception("API error"), [[0.1, 0.2, 0.3]]]

        count = await search_service.embed_pending()

        assert count == 1

    async def test_embed_pending_skips_item_without_source(
        self, search_service, mock_repository, mock_provider, sample_item
    ):
        mock_repository.get_latest_embedding.return_value = None
        mock_repository.get_items_without_embeddings.return_value = [sample_item]
        mock_repository.get_source_by_id.return_value = None

        count = await search_service.embed_pending()

        assert count == 0
        mock_provider.embed.assert_not_called()


class TestSearch:
    async def test_search_returns_ranked_results(
        self,
        search_service,
        mock_repository,
        mock_provider,
        sample_embedding,
        sample_item,
        sample_source,
    ):
        mock_repository.get_latest_embedding.return_value = MagicMock(model_name="test-model")
        mock_repository.get_all_embeddings.return_value = [sample_embedding]
        mock_repository.get_embeddings_with_items.return_value = [
            (sample_embedding, sample_item, sample_source)
        ]
        mock_provider.embed.return_value = [[0.1, 0.2, 0.3]]

        results = await search_service.search("test query")

        assert len(results) == 1
        assert results[0].title == "Test Article"
        assert results[0].score > 0

    async def test_search_returns_empty_for_no_embeddings(
        self, search_service, mock_repository, mock_provider
    ):
        mock_repository.get_latest_embedding.return_value = None
        mock_repository.get_all_embeddings.return_value = []
        mock_repository.get_embeddings_with_items.return_value = []
        mock_provider.embed.return_value = [[0.1, 0.2, 0.3]]

        results = await search_service.search("test query")

        assert len(results) == 0

    async def test_search_filters_below_threshold(
        self,
        search_service,
        mock_repository,
        mock_provider,
        sample_item,
        sample_source,
    ):
        emb = MagicMock(spec=ContentEmbedding)
        emb.content_item_id = "item-1"
        emb.embedding_json = json.dumps([1.0, 0.0, 0.0])

        mock_repository.get_latest_embedding.return_value = MagicMock(model_name="test-model")
        mock_repository.get_all_embeddings.return_value = [emb]
        mock_repository.get_embeddings_with_items.return_value = [(emb, sample_item, sample_source)]
        mock_provider.embed.return_value = [[0.0, 0.0, 1.0]]

        results = await search_service.search("test query", threshold=0.9)

        assert len(results) == 0

    async def test_search_respects_limit(
        self,
        search_service,
        mock_repository,
        mock_provider,
        sample_source,
    ):
        candidates = []
        all_embeddings = []
        for i in range(5):
            item = MagicMock(spec=ContentItem)
            item.id = f"item-{i}"
            item.source_id = "source-1"
            item.title = f"Article {i}"
            item.summary = f"Summary {i}"
            item.original_url = f"https://example.com/{i}"
            item.author = "Author"
            item.published_at = datetime(2024, 1, 15, 12, 0, 0, tzinfo=UTC)

            emb = MagicMock(spec=ContentEmbedding)
            emb.content_item_id = f"item-{i}"
            emb.embedding_json = json.dumps([0.1 * (i + 1), 0.2, 0.3])
            emb.model_name = "test-model"

            candidates.append((emb, item, sample_source))
            all_embeddings.append(emb)

        mock_repository.get_latest_embedding.return_value = MagicMock(model_name="test-model")
        mock_repository.get_all_embeddings.return_value = all_embeddings
        mock_repository.get_embeddings_with_items.return_value = candidates
        mock_provider.embed.return_value = [[0.1, 0.2, 0.3]]

        results = await search_service.search("test", limit=2, threshold=0.0)

        assert len(results) == 2

    async def test_search_lazy_loads_cache(self, search_service, mock_repository, mock_provider):
        mock_repository.get_latest_embedding.return_value = None
        mock_repository.get_all_embeddings.return_value = []
        mock_repository.get_embeddings_with_items.return_value = []
        mock_provider.embed.return_value = [[0.1, 0.2, 0.3]]

        assert search_service._cache_loaded is False

        await search_service.search("test")

        assert search_service._cache_loaded is True
        mock_repository.get_all_embeddings.assert_called_once()

    async def test_search_passes_filters_to_repository(
        self, search_service, mock_repository, mock_provider
    ):
        mock_repository.get_latest_embedding.return_value = None
        mock_repository.get_all_embeddings.return_value = []
        mock_repository.get_embeddings_with_items.return_value = []
        mock_provider.embed.return_value = [[0.1, 0.2, 0.3]]

        await search_service.search("test", guild_id="guild-1", source_type="arxiv", days=30)

        call_kwargs = mock_repository.get_embeddings_with_items.call_args.kwargs
        assert call_kwargs["guild_id"] == "guild-1"
        assert call_kwargs["source_type"] == "arxiv"
        assert call_kwargs["since"] is not None


class TestModelConsistency:
    async def test_model_change_clears_all_embeddings(
        self, search_service, mock_repository, mock_provider
    ):
        latest = MagicMock(spec=ContentEmbedding)
        latest.model_name = "old-model"
        mock_repository.get_latest_embedding.return_value = latest
        mock_repository.get_all_embeddings.return_value = []
        mock_repository.get_embeddings_with_items.return_value = []
        mock_provider.embed.return_value = [[0.1, 0.2, 0.3]]

        await search_service.search("test")

        mock_repository.clear_all_embeddings.assert_called_once()

    async def test_same_model_does_not_clear(self, search_service, mock_repository, mock_provider):
        latest = MagicMock(spec=ContentEmbedding)
        latest.model_name = "test-model"
        mock_repository.get_latest_embedding.return_value = latest
        mock_repository.get_all_embeddings.return_value = []
        mock_repository.get_embeddings_with_items.return_value = []
        mock_provider.embed.return_value = [[0.1, 0.2, 0.3]]

        await search_service.search("test")

        mock_repository.clear_all_embeddings.assert_not_called()
