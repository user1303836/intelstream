from unittest.mock import AsyncMock, MagicMock

import discord
import pytest

from intelstream.database.vector_store import SearchResult
from intelstream.discord.cogs.search import Search, _truncate


@pytest.fixture
def mock_bot():
    bot = MagicMock()
    bot.settings = MagicMock()
    bot.settings.search_result_limit = 5
    bot.repository = AsyncMock()
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
    store.search_articles = AsyncMock(return_value=[])
    store.upsert_articles_batch = AsyncMock()
    return store


@pytest.fixture
def search_cog(mock_bot, mock_embedding_service, mock_vector_store):
    return Search(mock_bot, mock_embedding_service, mock_vector_store)


@pytest.fixture
def mock_interaction():
    interaction = MagicMock(spec=discord.Interaction)
    interaction.response = MagicMock()
    interaction.response.defer = AsyncMock()
    interaction.followup = MagicMock()
    interaction.followup.send = AsyncMock()
    interaction.user = MagicMock()
    interaction.user.id = 12345
    interaction.guild_id = 111222333
    return interaction


class TestSearch:
    async def test_search_no_results(self, search_cog, mock_interaction, mock_vector_store):
        mock_vector_store.search_articles.return_value = []
        await search_cog.search.callback(search_cog, mock_interaction, "test query")
        mock_interaction.followup.send.assert_called_once()
        call_kwargs = mock_interaction.followup.send.call_args
        assert "No results found" in call_kwargs.args[0] or call_kwargs.kwargs.get("content", "")

    async def test_search_with_results(
        self, search_cog, mock_interaction, mock_vector_store, mock_bot
    ):
        mock_vector_store.search_articles.return_value = [
            SearchResult(content_item_id="item-1", score=0.95),
            SearchResult(content_item_id="item-2", score=0.80),
        ]

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

    async def test_search_embeds_query(self, search_cog, mock_interaction, mock_embedding_service):
        await search_cog.search.callback(search_cog, mock_interaction, "test query")
        mock_embedding_service.embed_text.assert_called_once_with("test query")


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

        item2 = MagicMock()
        item2.id = "item-2"
        item2.title = "Title 2"
        item2.summary = "Summary 2"

        mock_bot.repository.get_summarized_content_items.side_effect = [
            [item1, item2],
            [],
        ]

        await search_cog.index.callback(search_cog, mock_interaction)

        mock_embedding_service.embed_batch.assert_called_once_with(
            ["Title 1 Summary 1", "Title 2 Summary 2"]
        )
        mock_vector_store.upsert_articles_batch.assert_called_once()
        assert "2" in mock_interaction.followup.send.call_args.args[0]


class TestTruncate:
    def test_short_text(self):
        assert _truncate("hello", 10) == "hello"

    def test_exact_length(self):
        assert _truncate("hello", 5) == "hello"

    def test_long_text(self):
        assert _truncate("hello world", 8) == "hello..."

    def test_empty_text(self):
        assert _truncate("", 10) == ""
