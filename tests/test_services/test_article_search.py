import sys
from types import SimpleNamespace
from unittest.mock import MagicMock

from intelstream.database.vector_store import ArticleChunkSearchResult
from intelstream.services import article_search as article_search_module
from intelstream.services.article_search import (
    ArticleChunker,
    ArticleReranker,
    RankedArticleChunk,
    aggregate_article_hits,
    build_article_chunk_id,
)


class TestArticleChunker:
    def test_build_chunks_returns_empty_without_text(self):
        chunker = ArticleChunker()

        assert chunker.build_chunks(title="Title", raw_content=None, summary=None) == []
        assert chunker.build_chunks(title="Title", raw_content="", summary="   ") == []

    def test_build_chunks_prefers_raw_content_and_includes_title(self):
        chunker = ArticleChunker(chunk_size_chars=80, overlap_chars=10)

        chunks = chunker.build_chunks(
            title="Test Title",
            raw_content="Sentence one. Sentence two. Sentence three. Sentence four.",
            summary="Short summary",
        )

        assert chunks
        assert chunks[0].text.startswith("Sentence one.")
        assert chunks[0].search_text.startswith("Test Title\n\nSentence one.")

    def test_build_chunks_falls_back_to_summary_for_non_string_raw_content(self):
        chunker = ArticleChunker(chunk_size_chars=80, overlap_chars=0)

        chunks = chunker.build_chunks(
            title="Fallback Title",
            raw_content=None,
            summary="Summary fallback content.",
        )

        assert [chunk.text for chunk in chunks] == ["Summary fallback content."]

    def test_build_chunks_omits_blank_title_from_search_text(self):
        chunker = ArticleChunker(chunk_size_chars=80, overlap_chars=0)

        [chunk] = chunker.build_chunks(
            title="   ",
            raw_content="Searchable article content.",
            summary=None,
        )

        assert chunk.search_text == "Searchable article content."

    def test_build_chunks_splits_long_sentence_by_words(self):
        chunker = ArticleChunker(chunk_size_chars=20, overlap_chars=0)

        chunks = chunker.build_chunks(
            title="",
            raw_content="alpha beta gamma delta epsilon zeta",
            summary=None,
        )

        assert [chunk.text for chunk in chunks] == [
            "alpha beta gamma",
            "delta epsilon zeta",
        ]

    def test_build_chunks_adds_overlap_from_previous_chunk(self):
        chunker = ArticleChunker(chunk_size_chars=35, overlap_chars=10)

        chunks = chunker.build_chunks(
            title="",
            raw_content="First sentence. Second sentence. Third sentence.",
            summary=None,
        )

        assert [chunk.text for chunk in chunks] == [
            "First sentence. Second sentence.",
            "Second sentence. Third sentence.",
        ]

    def test_chunk_text_returns_empty_after_normalization(self):
        chunker = ArticleChunker()

        assert chunker._chunk_text(" \t \n ") == []

    def test_chunk_text_falls_back_when_sentence_splitter_returns_no_units(self, monkeypatch):
        chunker = ArticleChunker(chunk_size_chars=5, overlap_chars=0)
        splitter = SimpleNamespace(split=lambda _text: ["", ""])

        monkeypatch.setattr(article_search_module, "_SENTENCE_SPLIT_RE", splitter)

        assert chunker._chunk_text("abcdef") == ["abcde"]

    def test_chunk_text_returns_empty_when_long_unit_produces_no_segments(self, monkeypatch):
        chunker = ArticleChunker(chunk_size_chars=5, overlap_chars=0)

        monkeypatch.setattr(chunker, "_split_long_unit", lambda _unit: [])

        assert chunker._chunk_text("abcdef") == []

    def test_build_overlap_returns_empty_for_no_units_or_disabled_overlap(self):
        assert ArticleChunker(overlap_chars=10)._build_overlap([]) == []
        assert ArticleChunker(overlap_chars=0)._build_overlap(["first"]) == []

    def test_build_overlap_can_include_all_units_when_budget_large(self):
        chunker = ArticleChunker(overlap_chars=10_000)

        assert chunker._build_overlap(["first", "second"]) == ["first", "second"]

    def test_split_long_unit_returns_empty_for_whitespace(self):
        chunker = ArticleChunker(chunk_size_chars=10, overlap_chars=0)

        assert chunker._split_long_unit("   ") == []

    def test_split_long_unit_handles_truthy_empty_word_container(self):
        chunker = ArticleChunker(chunk_size_chars=10, overlap_chars=0)

        class TruthyEmptyWords(list[str]):
            def __bool__(self) -> bool:
                return True

        class OddUnit(str):
            def split(self, *_args: object, **_kwargs: object) -> list[str]:
                return TruthyEmptyWords()

        assert chunker._split_long_unit(OddUnit("ignored")) == []


class TestArticleReranker:
    async def test_rerank_returns_empty_for_no_candidates(self):
        reranker = ArticleReranker(enabled=True, model_name="unused")

        assert await reranker.rerank("query", []) == []

    async def test_disabled_reranker_uses_vector_scores(self):
        reranker = ArticleReranker(enabled=False, model_name="unused")
        candidates = [
            ArticleChunkSearchResult(
                chunk_id="item-1__0000",
                content_item_id="item-1",
                chunk_index=0,
                text="chunk text",
                search_text="search text",
                score=0.73,
            )
        ]

        ranked = await reranker.rerank("query", candidates)

        assert ranked[0].relevance_score == 0.73
        assert ranked[0].vector_score == 0.73

    async def test_rerank_uses_loaded_model_scores_and_sorts(self):
        reranker = ArticleReranker(enabled=True, model_name="unused")
        model = MagicMock()
        model.predict.return_value = [-2.0, 2.0]
        reranker._model = model
        candidates = [
            ArticleChunkSearchResult(
                chunk_id="item-1__0000",
                content_item_id="item-1",
                chunk_index=0,
                text="weak text",
                search_text="weak search",
                score=0.99,
            ),
            ArticleChunkSearchResult(
                chunk_id="item-2__0000",
                content_item_id="item-2",
                chunk_index=0,
                text="strong text",
                search_text="strong search",
                score=0.1,
            ),
        ]

        ranked = await reranker.rerank("query", candidates)

        assert [chunk.content_item_id for chunk in ranked] == ["item-2", "item-1"]
        assert ranked[0].relevance_score > ranked[1].relevance_score
        model.predict.assert_called_once_with(
            [("query", "weak search"), ("query", "strong search")]
        )

    async def test_load_failed_reranker_falls_back_to_vector_scores(self):
        reranker = ArticleReranker(enabled=True, model_name="unused")
        reranker._load_failed = True
        candidates = [
            ArticleChunkSearchResult(
                chunk_id="item-1__0000",
                content_item_id="item-1",
                chunk_index=0,
                text="chunk text",
                search_text="search text",
                score=1.5,
            )
        ]

        ranked = await reranker.rerank("query", candidates)

        assert ranked[0].relevance_score == 1.0

    async def test_get_model_loads_cross_encoder_once(self, monkeypatch):
        created_models = []

        class FakeCrossEncoder:
            def __init__(self, model_name: str) -> None:
                self.model_name = model_name
                created_models.append(self)

        monkeypatch.setitem(
            sys.modules,
            "sentence_transformers",
            SimpleNamespace(CrossEncoder=FakeCrossEncoder),
        )
        reranker = ArticleReranker(enabled=True, model_name="rerank-model")

        first = await reranker._get_model()
        second = await reranker._get_model()

        assert isinstance(first, FakeCrossEncoder)
        assert first is second
        assert first.model_name == "rerank-model"
        assert created_models == [first]

    async def test_get_model_returns_model_set_while_waiting_for_lock(self):
        reranker = ArticleReranker(enabled=True, model_name="unused")
        model = object()

        class LockThatSetsModel:
            async def __aenter__(self):
                reranker._model = model

            async def __aexit__(self, *_args: object) -> None:
                return None

        reranker._lock = LockThatSetsModel()  # type: ignore[assignment]

        assert await reranker._get_model() is model

    async def test_get_model_returns_none_when_load_failed_while_waiting_for_lock(self):
        reranker = ArticleReranker(enabled=True, model_name="unused")

        class LockThatMarksLoadFailed:
            async def __aenter__(self):
                reranker._load_failed = True

            async def __aexit__(self, *_args: object) -> None:
                return None

        reranker._lock = LockThatMarksLoadFailed()  # type: ignore[assignment]

        assert await reranker._get_model() is None


class TestBuildArticleChunkId:
    def test_pads_chunk_index(self):
        assert build_article_chunk_id("content-id", 7) == "content-id__0007"


class TestAggregateArticleHits:
    def test_groups_chunks_and_applies_threshold(self):
        ranked_chunks = [
            RankedArticleChunk(
                chunk_id="item-1__0000",
                content_item_id="item-1",
                chunk_index=0,
                text="best chunk",
                vector_score=0.9,
                relevance_score=0.9,
            ),
            RankedArticleChunk(
                chunk_id="item-1__0001",
                content_item_id="item-1",
                chunk_index=1,
                text="supporting chunk",
                vector_score=0.8,
                relevance_score=0.8,
            ),
        ]

        hits = aggregate_article_hits(
            ranked_chunks,
            limit=5,
            min_relevance_score=0.5,
        )

        assert len(hits) == 1
        assert hits[0].content_item_id == "item-1"
        assert hits[0].supporting_chunks == 2
        assert hits[0].score > 0.9

    def test_filters_sorts_limits_and_caps_scores(self):
        ranked_chunks = [
            RankedArticleChunk(
                chunk_id="low__0000",
                content_item_id="low",
                chunk_index=0,
                text="low chunk",
                vector_score=0.99,
                relevance_score=0.49,
            ),
            RankedArticleChunk(
                chunk_id="first__0000",
                content_item_id="first",
                chunk_index=0,
                text="first chunk",
                vector_score=0.4,
                relevance_score=0.99,
            ),
            RankedArticleChunk(
                chunk_id="first__0001",
                content_item_id="first",
                chunk_index=1,
                text="supporting chunk",
                vector_score=0.3,
                relevance_score=0.9,
            ),
            RankedArticleChunk(
                chunk_id="second__0000",
                content_item_id="second",
                chunk_index=0,
                text="second chunk",
                vector_score=0.95,
                relevance_score=0.8,
            ),
        ]

        hits = aggregate_article_hits(
            ranked_chunks,
            limit=1,
            min_relevance_score=0.5,
        )

        assert [hit.content_item_id for hit in hits] == ["first"]
        assert hits[0].score == 1.0
        assert hits[0].best_chunk_text == "first chunk"
