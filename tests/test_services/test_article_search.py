from intelstream.database.vector_store import ArticleChunkSearchResult
from intelstream.services.article_search import (
    ArticleChunker,
    ArticleReranker,
    RankedArticleChunk,
    aggregate_article_hits,
)


class TestArticleChunker:
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


class TestArticleReranker:
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
