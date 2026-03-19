import asyncio
from unittest.mock import AsyncMock, MagicMock

import discord
import pytest

from intelstream.database.vector_store import ArticleChunkSearchResult
from intelstream.discord.cogs.search import Search, _truncate
from intelstream.services.article_search import RankedArticleChunk


@pytest.fixture
def mock_bot():
    bot = MagicMock()
    bot.settings = MagicMock()
    bot.settings.search_result_limit = 5
    bot.settings.article_search_candidate_limit = 12
    bot.settings.article_search_min_relevance_score = 0.35
    bot.settings.article_search_reranker_enabled = False
    bot.repository = AsyncMock()
    bot.repository.count_summarized_content_items = AsyncMock(return_value=0)
    bot.repository.get_summarized_content_items = AsyncMock(return_value=[])
    bot.repository.count_article_chunk_items = AsyncMock(return_value=0)
    bot.repository.count_article_chunk_metas = AsyncMock(return_value=0)
    bot.repository.delete_all_article_chunk_metas = AsyncMock(return_value=0)
    return bot


@pytest.fixture
def mock_embedding_service():
    svc = AsyncMock()
    svc.embed_text = AsyncMock(return_value=[0.1, 0.2, 0.3])
    svc.embed_batch = AsyncMock(return_value=[[0.1, 0.2, 0.3], [0.4, 0.5, 0.6]])
    return svc


@pytest.fixture
def mock_vector_store():
    store = AsyncMock()
    store.search_article_chunks = AsyncMock(return_value=[])
    store.upsert_article_chunks_batch = AsyncMock()
    store.article_chunk_doc_count = AsyncMock(return_value=0)
    store.recreate_article_chunks_collection = AsyncMock()
    return store


@pytest.fixture
def search_cog(mock_bot, mock_embedding_service, mock_vector_store):
    return Search(mock_bot, mock_embedding_service, mock_vector_store)


@pytest.fixture
def mock_interaction():
    interaction = MagicMock(spec=discord.Interaction)
    interaction.response = MagicMock()
    interaction.response.defer = AsyncMock()
    interaction.response.send_message = AsyncMock()
    interaction.followup = MagicMock()
    interaction.followup.send = AsyncMock()
    interaction.user = MagicMock()
    interaction.user.id = 12345
    interaction.guild_id = 111222333
    return interaction


class TestSearch:
    async def test_search_no_results(self, search_cog, mock_interaction, mock_vector_store):
        mock_vector_store.search_article_chunks.return_value = []
        await search_cog.search.callback(search_cog, mock_interaction, "test query")
        mock_interaction.followup.send.assert_called_once()
        call_kwargs = mock_interaction.followup.send.call_args
        assert "No strong matches found" in call_kwargs.args[0] or call_kwargs.kwargs.get(
            "content", ""
        )

    async def test_search_with_results(
        self, search_cog, mock_interaction, mock_vector_store, mock_bot
    ):
        mock_vector_store.search_article_chunks.return_value = [
            ArticleChunkSearchResult(
                chunk_id="item-1__0000",
                content_item_id="item-1",
                chunk_index=0,
                text="Best chunk about AI systems and model evaluations.",
                search_text="AI Article\n\nBest chunk about AI systems and model evaluations.",
                score=0.95,
            ),
            ArticleChunkSearchResult(
                chunk_id="item-2__0000",
                content_item_id="item-2",
                chunk_index=0,
                text="Best chunk about ML model training and data quality.",
                search_text="ML Article\n\nBest chunk about ML model training and data quality.",
                score=0.80,
            ),
        ]
        search_cog._reranker.rerank = AsyncMock(
            return_value=[
                RankedArticleChunk(
                    chunk_id="item-1__0000",
                    content_item_id="item-1",
                    chunk_index=0,
                    text="Best chunk about AI systems and model evaluations.",
                    vector_score=0.95,
                    relevance_score=0.82,
                ),
                RankedArticleChunk(
                    chunk_id="item-2__0000",
                    content_item_id="item-2",
                    chunk_index=0,
                    text="Best chunk about ML model training and data quality.",
                    vector_score=0.80,
                    relevance_score=0.61,
                ),
            ]
        )

        mock_item_1 = MagicMock()
        mock_item_1.id = "item-1"
        mock_item_1.title = "AI Article"
        mock_item_1.summary = "Summary about AI"
        mock_item_1.original_url = "https://example.com/ai"

        mock_item_2 = MagicMock()
        mock_item_2.id = "item-2"
        mock_item_2.title = "ML Article"
        mock_item_2.summary = "Summary about ML"
        mock_item_2.original_url = "https://example.com/ml"

        mock_bot.repository.get_content_items_by_ids.return_value = [
            mock_item_1,
            mock_item_2,
        ]

        await search_cog.search.callback(search_cog, mock_interaction, "AI research")

        mock_interaction.followup.send.assert_called_once()
        call_kwargs = mock_interaction.followup.send.call_args
        embed = call_kwargs.kwargs.get("embed")
        assert embed is not None
        assert len(embed.fields) == 2
        assert embed.fields[0].name.startswith("1. AI Article")
        assert "Relevance 82%" in embed.fields[0].value
        assert "Best match:" in embed.fields[0].value

    async def test_search_embeds_query(self, search_cog, mock_interaction, mock_embedding_service):
        await search_cog.search.callback(search_cog, mock_interaction, "test query")
        mock_embedding_service.embed_text.assert_called_once_with("test query")

    async def test_search_mentions_rebuild_in_progress(self, search_cog, mock_interaction):
        search_cog._index_rebuild_task = asyncio.create_task(asyncio.sleep(0.1))

        try:
            await search_cog.search.callback(search_cog, mock_interaction, "test query")
        finally:
            search_cog._index_rebuild_task.cancel()
            with pytest.raises(asyncio.CancelledError):
                await search_cog._index_rebuild_task

        mock_interaction.response.send_message.assert_called_once()
        msg = mock_interaction.response.send_message.call_args[0][0].lower()
        assert "rebuilt" in msg or "rebuild" in msg


class TestIndex:
    async def test_index_empty(self, search_cog, mock_interaction, mock_bot):
        mock_bot.repository.get_summarized_content_items.return_value = []
        await search_cog.index.callback(search_cog, mock_interaction)
        mock_interaction.followup.send.assert_called_once()
        assert "0" in mock_interaction.followup.send.call_args.args[0]

    async def test_index_processes_items(
        self, search_cog, mock_interaction, mock_bot, mock_embedding_service, mock_vector_store
    ):
        item1 = MagicMock()
        item1.id = "item-1"
        item1.title = "Title 1"
        item1.summary = "Summary 1"
        item1.raw_content = None

        item2 = MagicMock()
        item2.id = "item-2"
        item2.title = "Title 2"
        item2.summary = "Summary 2"
        item2.raw_content = None

        mock_bot.repository.get_summarized_content_items.side_effect = [
            [item1, item2],
            [],
        ]
        mock_bot.repository.count_summarized_content_items.return_value = 2

        await search_cog.index.callback(search_cog, mock_interaction)

        mock_bot.repository.count_summarized_content_items.assert_called_once()
        mock_vector_store.recreate_article_chunks_collection.assert_called_once()
        mock_embedding_service.embed_batch.assert_called_once_with(
            ["Title 1\n\nSummary 1", "Title 2\n\nSummary 2"]
        )
        mock_bot.repository.add_article_chunk_metas_batch.assert_called_once()
        mock_vector_store.upsert_article_chunks_batch.assert_called_once()
        assert "2" in mock_interaction.followup.send.call_args.args[0]

    async def test_ensure_article_index_rebuilds_unhealthy_index(self, search_cog, mock_bot):
        search_cog._article_index_is_healthy = AsyncMock(return_value=False)
        search_cog._rebuild_article_index = AsyncMock(return_value=(3, 9))
        mock_bot.repository.count_summarized_content_items.return_value = 3

        await search_cog._ensure_article_index()

        search_cog._rebuild_article_index.assert_awaited_once()


class TestTruncate:
    def test_short_text(self):
        assert _truncate("hello", 10) == "hello"

    def test_exact_length(self):
        assert _truncate("hello", 5) == "hello"

    def test_long_text(self):
        assert _truncate("hello world", 8) == "hello..."

    def test_empty_text(self):
        assert _truncate("", 10) == ""
