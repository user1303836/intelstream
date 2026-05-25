import asyncio
from unittest.mock import AsyncMock, MagicMock

import discord
import pytest
from discord import app_commands

from intelstream.database.vector_store import ArticleChunkSearchResult
from intelstream.discord.cogs import search as search_module
from intelstream.discord.cogs.search import (
    ArticleIndexStatus,
    Search,
    _bool_setting,
    _clean_preview,
    _float_setting,
    _int_setting,
    _str_setting,
    _supporting_excerpt_label,
    _truncate,
)
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

    async def test_search_restarts_recovery_after_error(self, search_cog, mock_interaction):
        search_cog._index_rebuild_error = "RuntimeError: boom"
        search_cog._start_index_rebuild = MagicMock()

        await search_cog.search.callback(search_cog, mock_interaction, "test query")

        search_cog._start_index_rebuild.assert_called_once_with()
        mock_interaction.response.send_message.assert_called_once()
        msg = mock_interaction.response.send_message.call_args[0][0].lower()
        assert "recovers" in msg or "recover" in msg

    async def test_search_embed_omits_empty_url_snippet_and_duplicate_summary(
        self, search_cog, mock_interaction, mock_bot
    ):
        mock_result = ArticleChunkSearchResult(
            chunk_id="item-1__0000",
            content_item_id="item-1",
            chunk_index=0,
            text="Same preview",
            search_text="Title\n\nSame preview",
            score=0.7,
        )
        search_cog._vector_store.search_article_chunks.return_value = [mock_result]
        search_cog._reranker.rerank = AsyncMock(
            return_value=[
                RankedArticleChunk(
                    chunk_id="item-1__0000",
                    content_item_id="item-1",
                    chunk_index=0,
                    text="Same preview",
                    vector_score=0.7,
                    relevance_score=0.7,
                )
            ]
        )

        item = MagicMock()
        item.id = "item-1"
        item.title = "Article without URL"
        item.summary = "Same preview"
        item.original_url = ""
        mock_bot.repository.get_content_items_by_ids.return_value = [item]

        await search_cog.search.callback(search_cog, mock_interaction, "query")

        embed = mock_interaction.followup.send.call_args.kwargs["embed"]
        assert "Open article" not in embed.fields[0].value
        assert "Summary:" not in embed.fields[0].value

    async def test_search_embed_omits_blank_best_match(
        self, search_cog, mock_interaction, mock_bot
    ):
        mock_result = ArticleChunkSearchResult(
            chunk_id="item-1__0000",
            content_item_id="item-1",
            chunk_index=0,
            text="   ",
            search_text="Title",
            score=0.7,
        )
        search_cog._vector_store.search_article_chunks.return_value = [mock_result]
        search_cog._reranker.rerank = AsyncMock(
            return_value=[
                RankedArticleChunk(
                    chunk_id="item-1__0000",
                    content_item_id="item-1",
                    chunk_index=0,
                    text="   ",
                    vector_score=0.7,
                    relevance_score=0.7,
                )
            ]
        )

        item = MagicMock()
        item.id = "item-1"
        item.title = "Article with summary"
        item.summary = "Useful summary"
        item.original_url = "https://example.com/article"
        mock_bot.repository.get_content_items_by_ids.return_value = [item]

        await search_cog.search.callback(search_cog, mock_interaction, "query")

        embed = mock_interaction.followup.send.call_args.kwargs["embed"]
        assert "Best match:" not in embed.fields[0].value
        assert "Summary: Useful summary" in embed.fields[0].value


class TestSearchLifecycle:
    async def test_cog_load_starts_background_rebuild(self, search_cog):
        search_cog._start_index_rebuild = MagicMock()

        await search_cog.cog_load()

        search_cog._start_index_rebuild.assert_called_once_with()

    async def test_cog_unload_cancels_background_rebuild(self, search_cog):
        search_cog._index_rebuild_task = asyncio.create_task(asyncio.sleep(10))

        await search_cog.cog_unload()

        assert search_cog._index_rebuild_task.cancelled()

    async def test_cog_unload_without_background_rebuild(self, search_cog):
        search_cog._index_rebuild_task = None

        await search_cog.cog_unload()

        assert search_cog._index_rebuild_task is None

    async def test_start_index_rebuild_is_noop_when_task_running(self, search_cog):
        task = asyncio.create_task(asyncio.sleep(10))
        search_cog._index_rebuild_task = task

        try:
            search_cog._start_index_rebuild()
            assert search_cog._index_rebuild_task is task
        finally:
            task.cancel()
            with pytest.raises(asyncio.CancelledError):
                await task

    async def test_start_index_rebuild_creates_named_task(self, search_cog):
        search_cog._ensure_article_index = AsyncMock()

        search_cog._start_index_rebuild()
        task = search_cog._index_rebuild_task
        assert task is not None
        assert task.get_name() == "article-index-rebuild"

        await task
        search_cog._ensure_article_index.assert_awaited_once_with()


class TestIndex:
    async def test_index_empty(self, search_cog, mock_interaction, mock_bot):
        mock_bot.repository.get_summarized_content_items.return_value = []
        await search_cog.index.callback(search_cog, mock_interaction)
        mock_interaction.followup.send.assert_called_once()
        assert "0" in mock_interaction.followup.send.call_args.args[0]

    async def test_index_reports_rebuild_already_running(self, search_cog, mock_interaction):
        search_cog._index_rebuild_task = asyncio.create_task(asyncio.sleep(10))

        try:
            await search_cog.index.callback(search_cog, mock_interaction)
        finally:
            search_cog._index_rebuild_task.cancel()
            with pytest.raises(asyncio.CancelledError):
                await search_cog._index_rebuild_task

        msg = mock_interaction.followup.send.call_args.args[0]
        assert "already" in msg

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

    async def test_ensure_article_index_skips_when_no_summarized_content(self, search_cog):
        search_cog._get_article_index_status = AsyncMock()
        search_cog._index_rebuild_error = "RuntimeError: stale"

        await search_cog._ensure_article_index()

        assert search_cog._index_rebuild_error is None
        search_cog._get_article_index_status.assert_not_awaited()

    async def test_ensure_article_index_retries_after_failure(
        self, search_cog, mock_bot, monkeypatch
    ):
        search_cog._article_index_is_healthy = AsyncMock(return_value=False)
        search_cog._rebuild_article_index = AsyncMock(side_effect=[RuntimeError("locked"), (3, 9)])
        mock_bot.repository.count_summarized_content_items.return_value = 3
        sleep_mock = AsyncMock()
        monkeypatch.setattr("intelstream.discord.cogs.search.asyncio.sleep", sleep_mock)

        await search_cog._ensure_article_index()

        assert search_cog._rebuild_article_index.await_count == 2
        sleep_mock.assert_awaited_once()
        assert search_cog._index_rebuild_error is None

    async def test_ensure_article_index_logs_status(
        self, search_cog, mock_bot, mock_vector_store, monkeypatch
    ):
        mock_bot.repository.count_summarized_content_items.return_value = 3
        mock_bot.repository.count_article_chunk_items.return_value = 2
        mock_bot.repository.count_article_chunk_metas.return_value = 9
        mock_vector_store.article_chunk_doc_count.return_value = 8
        search_cog._article_index_is_healthy = AsyncMock(return_value=True)
        fake_logger = MagicMock()
        monkeypatch.setattr(search_module, "logger", fake_logger)

        await search_cog._ensure_article_index()

        fake_logger.info.assert_any_call(
            "Article search index status",
            expected_articles=3,
            indexed_articles=2,
            stored_chunks=9,
            vector_chunks=8,
        )

    async def test_ensure_article_index_gives_up_after_max_failures(
        self, search_cog, mock_bot, monkeypatch
    ):
        search_cog._get_article_index_status = AsyncMock(side_effect=RuntimeError("locked"))
        mock_bot.repository.count_summarized_content_items.return_value = 3
        sleep_mock = AsyncMock()
        monkeypatch.setattr("intelstream.discord.cogs.search.asyncio.sleep", sleep_mock)

        await search_cog._ensure_article_index()

        assert search_cog._get_article_index_status.await_count == 3
        assert search_cog._index_rebuild_error == "RuntimeError: locked"

    async def test_ensure_article_index_propagates_cancelled_error(self, search_cog, mock_bot):
        search_cog._get_article_index_status = AsyncMock(side_effect=asyncio.CancelledError)
        mock_bot.repository.count_summarized_content_items.return_value = 3

        with pytest.raises(asyncio.CancelledError):
            await search_cog._ensure_article_index()

    async def test_ensure_article_index_allows_zero_recovery_attempts(
        self, search_cog, mock_bot, monkeypatch
    ):
        monkeypatch.setattr(search_module, "INDEX_RECOVERY_MAX_ATTEMPTS", 0)

        await search_cog._ensure_article_index()

        mock_bot.repository.count_summarized_content_items.assert_not_called()

    async def test_article_index_unhealthy_when_article_counts_mismatch(self, search_cog):
        status = ArticleIndexStatus(
            expected_articles=2,
            indexed_articles=1,
            stored_chunks=3,
            vector_chunks=3,
        )

        assert await search_cog._article_index_is_healthy(status) is False

    async def test_article_index_unhealthy_when_chunk_counts_mismatch(self, search_cog):
        status = ArticleIndexStatus(
            expected_articles=2,
            indexed_articles=2,
            stored_chunks=3,
            vector_chunks=2,
        )

        assert await search_cog._article_index_is_healthy(status) is False

    async def test_article_index_healthy_when_no_sample_available(self, search_cog, mock_bot):
        status = ArticleIndexStatus(
            expected_articles=2,
            indexed_articles=2,
            stored_chunks=3,
            vector_chunks=3,
        )
        mock_bot.repository.get_summarized_content_items.return_value = []

        assert await search_cog._article_index_is_healthy(status) is True

    async def test_article_index_unhealthy_when_sample_has_no_chunks(self, search_cog, mock_bot):
        status = ArticleIndexStatus(
            expected_articles=1,
            indexed_articles=1,
            stored_chunks=0,
            vector_chunks=0,
        )
        sample = MagicMock()
        sample.id = "item-empty"
        sample.title = ""
        sample.raw_content = ""
        sample.summary = ""
        mock_bot.repository.get_summarized_content_items.return_value = [sample]

        assert await search_cog._article_index_is_healthy(status) is False

    async def test_article_index_probe_matches_sample(
        self, search_cog, mock_bot, mock_vector_store
    ):
        status = ArticleIndexStatus(
            expected_articles=1,
            indexed_articles=1,
            stored_chunks=1,
            vector_chunks=1,
        )
        sample = MagicMock()
        sample.id = "item-1"
        sample.title = "Probe"
        sample.raw_content = "Probe body"
        sample.summary = None
        mock_bot.repository.get_summarized_content_items.return_value = [sample]
        mock_vector_store.search_article_chunks.return_value = [
            ArticleChunkSearchResult(
                chunk_id="item-1__0000",
                content_item_id="item-1",
                chunk_index=0,
                text="Probe body",
                search_text="Probe\n\nProbe body",
                score=0.9,
            )
        ]

        assert await search_cog._article_index_is_healthy(status) is True

    async def test_article_index_probe_misses_sample(self, search_cog, mock_bot, mock_vector_store):
        status = ArticleIndexStatus(
            expected_articles=1,
            indexed_articles=1,
            stored_chunks=1,
            vector_chunks=1,
        )
        sample = MagicMock()
        sample.id = "item-1"
        sample.title = "Probe"
        sample.raw_content = "Probe body"
        sample.summary = None
        mock_bot.repository.get_summarized_content_items.return_value = [sample]
        mock_vector_store.search_article_chunks.return_value = [
            ArticleChunkSearchResult(
                chunk_id="other__0000",
                content_item_id="other",
                chunk_index=0,
                text="Other body",
                search_text="Other\n\nOther body",
                score=0.9,
            )
        ]

        assert await search_cog._article_index_is_healthy(status) is False

    async def test_rebuild_article_index_skips_items_without_chunks(
        self, search_cog, mock_bot, mock_embedding_service, mock_vector_store
    ):
        item = MagicMock()
        item.id = "empty-item"
        item.title = ""
        item.raw_content = ""
        item.summary = ""
        mock_bot.repository.count_summarized_content_items.return_value = 1
        mock_bot.repository.get_summarized_content_items.side_effect = [[item], []]

        assert await search_cog._rebuild_article_index(batch_size=1) == (0, 0)
        mock_embedding_service.embed_batch.assert_not_called()
        mock_bot.repository.add_article_chunk_metas_batch.assert_not_called()
        mock_vector_store.upsert_article_chunks_batch.assert_not_called()

    async def test_search_articles_uses_result_limit_as_candidate_floor(
        self, search_cog, mock_bot, mock_vector_store
    ):
        mock_bot.settings.article_search_candidate_limit = 1
        mock_bot.settings.search_result_limit = 3
        mock_bot.settings.article_search_min_relevance_score = 0.1
        mock_vector_store.search_article_chunks.return_value = [
            ArticleChunkSearchResult(
                chunk_id="item-1__0000",
                content_item_id="item-1",
                chunk_index=0,
                text="Chunk",
                search_text="Title\n\nChunk",
                score=0.9,
            )
        ]
        search_cog._reranker.rerank = AsyncMock(
            return_value=[
                RankedArticleChunk(
                    chunk_id="item-1__0000",
                    content_item_id="item-1",
                    chunk_index=0,
                    text="Chunk",
                    vector_score=0.9,
                    relevance_score=0.9,
                )
            ]
        )
        mock_bot.repository.get_content_items_by_ids.return_value = []

        assert await search_cog._search_articles("query") == []
        mock_vector_store.search_article_chunks.assert_called_once_with(
            [0.1, 0.2, 0.3],
            topk=3,
        )

    async def test_search_articles_returns_empty_when_scores_below_threshold(
        self, search_cog, mock_bot, mock_vector_store
    ):
        mock_vector_store.search_article_chunks.return_value = [
            ArticleChunkSearchResult(
                chunk_id="item-1__0000",
                content_item_id="item-1",
                chunk_index=0,
                text="Chunk",
                search_text="Title\n\nChunk",
                score=0.9,
            )
        ]
        search_cog._reranker.rerank = AsyncMock(
            return_value=[
                RankedArticleChunk(
                    chunk_id="item-1__0000",
                    content_item_id="item-1",
                    chunk_index=0,
                    text="Chunk",
                    vector_score=0.9,
                    relevance_score=0.1,
                )
            ]
        )
        mock_bot.repository.get_content_items_by_ids = AsyncMock()

        assert await search_cog._search_articles("query") == []
        mock_bot.repository.get_content_items_by_ids.assert_not_awaited()


class TestSearchErrors:
    async def test_search_cooldown_error_sends_retry_message(self, search_cog, mock_interaction):
        error = app_commands.CommandOnCooldown(
            app_commands.Cooldown(rate=5, per=60.0), retry_after=12.8
        )

        await search_cog.search_error(mock_interaction, error)

        msg = mock_interaction.response.send_message.call_args.args[0]
        assert "12s" in msg

    async def test_search_non_cooldown_error_is_reraised(self, search_cog, mock_interaction):
        error = app_commands.MissingPermissions(["administrator"])

        with pytest.raises(app_commands.MissingPermissions):
            await search_cog.search_error(mock_interaction, error)

    async def test_index_missing_permissions_error_sends_message(
        self, search_cog, mock_interaction
    ):
        error = app_commands.MissingPermissions(["administrator"])

        await search_cog.index_error(mock_interaction, error)

        msg = mock_interaction.response.send_message.call_args.args[0]
        assert "Administrator permissions required" in msg

    async def test_index_non_permission_error_is_reraised(self, search_cog, mock_interaction):
        error = app_commands.AppCommandError("boom")

        with pytest.raises(app_commands.AppCommandError):
            await search_cog.index_error(mock_interaction, error)


class TestTruncate:
    def test_short_text(self):
        assert _truncate("hello", 10) == "hello"

    def test_exact_length(self):
        assert _truncate("hello", 5) == "hello"

    def test_long_text(self):
        assert _truncate("hello world", 8) == "hello..."

    def test_empty_text(self):
        assert _truncate("", 10) == ""


class TestHelpers:
    def test_clean_preview_collapses_whitespace(self):
        assert _clean_preview("  hello\n\nworld\tagain ") == "hello world again"

    def test_supporting_excerpt_label_pluralizes(self):
        assert _supporting_excerpt_label(1) == "1 matching excerpt"
        assert _supporting_excerpt_label(2) == "2 matching excerpts"

    def test_setting_helpers_use_defaults_for_wrong_types(self):
        settings = MagicMock()
        settings.size = True
        settings.score = False
        settings.enabled = "yes"
        settings.model = 123

        assert _int_setting(settings, "size", 10) == 10
        assert _float_setting(settings, "score", 0.5) == 0.5
        assert _bool_setting(settings, "enabled", False) is False
        assert _str_setting(settings, "model", "default") == "default"

    def test_setting_helpers_accept_expected_types(self):
        settings = MagicMock()
        settings.size = 8
        settings.score = 1
        settings.enabled = False
        settings.model = "reranker"

        assert _int_setting(settings, "size", 10) == 8
        assert _float_setting(settings, "score", 0.5) == 1.0
        assert _bool_setting(settings, "enabled", True) is False
        assert _str_setting(settings, "model", "default") == "reranker"
