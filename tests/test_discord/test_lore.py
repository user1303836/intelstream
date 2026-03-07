import asyncio
from datetime import UTC, datetime
from unittest.mock import AsyncMock, MagicMock

import discord
import pytest

from intelstream.database.vector_store import ChunkSearchResult
from intelstream.discord.cogs.lore import Lore, _parse_timeframe, _split_message


@pytest.fixture
def mock_bot():
    bot = MagicMock()
    bot.settings = MagicMock()
    bot.settings.lore_chunk_gap_minutes = 10
    bot.settings.lore_chunk_max_messages = 20
    bot.settings.lore_search_results = 15
    bot.settings.llm_provider = "anthropic"
    bot.settings.llm_api_key = "test-key"
    bot.settings.summary_model_interactive = "claude-test"
    bot.repository = AsyncMock()
    bot.repository.count_message_chunk_metas = AsyncMock(return_value=0)
    bot.repository.get_message_chunk_metas_batch = AsyncMock(return_value=[])
    bot.get_guild = MagicMock(return_value=None)
    bot.guilds = []
    bot.cogs = {}
    return bot


@pytest.fixture
def mock_embedding_service():
    svc = AsyncMock()
    svc.embed_text = AsyncMock(return_value=[0.1, 0.2, 0.3])
    return svc


@pytest.fixture
def mock_vector_store():
    store = AsyncMock()
    store.message_chunk_doc_count = AsyncMock(return_value=0)
    store.search_message_chunks = AsyncMock(return_value=[])
    return store


@pytest.fixture
def lore_cog(mock_bot, mock_embedding_service, mock_vector_store):
    cog = Lore(mock_bot, mock_embedding_service, mock_vector_store)
    cog._ingestion_service = MagicMock()
    cog._ingestion_service.is_running = False
    cog._ingestion_service.rebuild_vector_index = AsyncMock(return_value=0)
    cog._llm_client = AsyncMock()
    cog._llm_client.complete = AsyncMock(return_value="Here is the lore about that topic.")
    cog._chunker = MagicMock()
    return cog


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
    interaction.guild = MagicMock(spec=discord.Guild)
    interaction.guild.text_channels = []
    interaction.guild.me = MagicMock()
    return interaction


class TestParseTimeframe:
    def test_last_days(self):
        start, end = _parse_timeframe("last 7 days")
        assert start is not None
        assert end is not None
        assert (end - start).days == 7

    def test_last_weeks(self):
        start, end = _parse_timeframe("last 2 weeks")
        assert start is not None
        assert end is not None
        assert (end - start).days == 14

    def test_last_months(self):
        start, end = _parse_timeframe("last 6 months")
        assert start is not None
        assert end is not None
        assert (end - start).days == 180

    def test_year(self):
        start, end = _parse_timeframe("2024")
        assert start is not None
        assert end is not None
        assert start.year == 2024
        assert end.year == 2024

    def test_invalid(self):
        start, end = _parse_timeframe("sometime")
        assert start is None
        assert end is None

    def test_case_insensitive(self):
        start, end = _parse_timeframe("Last 3 Days")
        assert start is not None
        assert end is not None


class TestSplitMessage:
    def test_short_message(self):
        parts = _split_message("short text")
        assert parts == ["short text"]

    def test_exact_limit(self):
        text = "a" * 2000
        parts = _split_message(text)
        assert parts == [text]

    def test_long_message_splits_at_newline(self):
        line = "a" * 100
        text = "\n".join([line] * 25)
        parts = _split_message(text, max_len=500)
        assert len(parts) > 1
        for part in parts:
            assert len(part) <= 500

    def test_no_newline_splits_at_max(self):
        text = "a" * 3000
        parts = _split_message(text, max_len=2000)
        assert len(parts) == 2
        assert len(parts[0]) == 2000
        assert len(parts[1]) == 1000


class TestLoreQuery:
    async def test_command_temporarily_disabled(self, lore_cog, mock_interaction):
        await lore_cog.lore.callback(lore_cog, mock_interaction, "test query")
        mock_interaction.response.send_message.assert_called_once()
        msg = mock_interaction.response.send_message.call_args[0][0].lower()
        assert "temporarily disabled" in msg


class TestLoreCogLoadWithoutApiKey:
    async def test_cog_load_without_api_key(
        self, mock_bot, mock_embedding_service, mock_vector_store
    ):
        type(mock_bot.settings).llm_api_key = property(
            lambda _: (_ for _ in ()).throw(ValueError("No API key"))
        )
        cog = Lore(mock_bot, mock_embedding_service, mock_vector_store)
        cog._flush_buffers = MagicMock()
        cog._flush_buffers.start = MagicMock()

        await cog.cog_load()

        assert cog._llm_client is None
        assert cog._ingestion_service is not None
        assert cog._chunker is not None
        if cog._index_rebuild_task is not None:
            await cog._index_rebuild_task


class TestIndexHealth:
    async def test_message_index_healthy(self, lore_cog, mock_bot, mock_vector_store):
        mock_bot.repository.get_message_chunk_metas_batch.return_value = [
            MagicMock(id="chunk-1", text="sample chunk text")
        ]
        mock_vector_store.message_chunk_doc_count.return_value = 1
        mock_vector_store.search_message_chunks.return_value = [
            ChunkSearchResult(chunk_id="chunk-1", score=1.0)
        ]

        result = await lore_cog._message_index_is_healthy(expected_count=1)

        assert result is True

    async def test_message_index_unhealthy_on_count_mismatch(
        self, lore_cog, mock_vector_store
    ):
        mock_vector_store.message_chunk_doc_count.return_value = 0

        result = await lore_cog._message_index_is_healthy(expected_count=2)

        assert result is False
        mock_vector_store.search_message_chunks.assert_not_called()

    async def test_ensure_message_chunk_index_rebuilds_unhealthy_index(
        self, lore_cog, mock_bot, mock_vector_store
    ):
        lore_cog._ingestion_service = MagicMock()
        lore_cog._ingestion_service.rebuild_vector_index = AsyncMock(return_value=3)
        mock_bot.repository.count_message_chunk_metas.return_value = 3
        mock_vector_store.message_chunk_doc_count.return_value = 0

        await lore_cog._ensure_message_chunk_index()

        lore_cog._ingestion_service.rebuild_vector_index.assert_awaited_once()

    async def test_command_mentions_rebuild_in_progress(self, lore_cog, mock_interaction):
        lore_cog._index_rebuild_task = asyncio.create_task(asyncio.sleep(0.1))

        try:
            await lore_cog.lore.callback(lore_cog, mock_interaction, "test query")
        finally:
            lore_cog._index_rebuild_task.cancel()
            with pytest.raises(asyncio.CancelledError):
                await lore_cog._index_rebuild_task

        mock_interaction.response.send_message.assert_called_once()
        msg = mock_interaction.response.send_message.call_args[0][0].lower()
        assert "rebuilt" in msg or "rebuild" in msg


class TestAutoStartIngestion:
    async def test_starts_for_guild_with_no_progress(self, lore_cog, mock_bot):
        guild = MagicMock(spec=discord.Guild)
        guild.id = 111
        guild.name = "Test Server"
        mock_bot.repository.get_ingestion_progress_for_guild.return_value = []

        await lore_cog.start_ingestion_for_guild(guild)
        lore_cog._ingestion_service.start_backfill.assert_called_once_with(guild)

    async def test_skips_completed_guild(self, lore_cog, mock_bot):
        guild = MagicMock(spec=discord.Guild)
        guild.id = 111
        guild.name = "Test Server"
        progress = MagicMock()
        progress.status = "completed"
        mock_bot.repository.get_ingestion_progress_for_guild.return_value = [progress]

        await lore_cog.start_ingestion_for_guild(guild)
        lore_cog._ingestion_service.start_backfill.assert_not_called()

    async def test_resumes_paused_guild(self, lore_cog, mock_bot):
        guild = MagicMock(spec=discord.Guild)
        guild.id = 111
        guild.name = "Test Server"
        progress = MagicMock()
        progress.status = "paused"
        mock_bot.repository.get_ingestion_progress_for_guild.return_value = [progress]

        await lore_cog.start_ingestion_for_guild(guild)
        lore_cog._ingestion_service.start_backfill.assert_called_once_with(guild)

    async def test_skips_if_already_running(self, lore_cog):
        guild = MagicMock(spec=discord.Guild)
        guild.id = 111
        lore_cog._ingestion_service.is_running = True

        await lore_cog.start_ingestion_for_guild(guild)
        lore_cog._ingestion_service.start_backfill.assert_not_called()

    async def test_auto_start_uses_first_guild(self, lore_cog, mock_bot):
        guild = MagicMock(spec=discord.Guild)
        guild.id = 111
        guild.name = "Test Server"
        mock_bot.guilds = [guild]
        mock_bot.repository.get_ingestion_progress_for_guild.return_value = []

        await lore_cog.auto_start_ingestion()
        lore_cog._ingestion_service.start_backfill.assert_called_once_with(guild)

    async def test_auto_start_no_guilds(self, lore_cog, mock_bot):
        mock_bot.guilds = []
        await lore_cog.auto_start_ingestion()
        lore_cog._ingestion_service.start_backfill.assert_not_called()


class TestOnMessage:
    async def test_ignores_bot_messages(self, lore_cog):
        msg = MagicMock(spec=discord.Message)
        msg.guild = MagicMock()
        msg.author = MagicMock()
        msg.author.bot = True
        await lore_cog.on_message(msg)
        assert len(lore_cog._message_buffers) == 0

    async def test_ignores_dm(self, lore_cog):
        msg = MagicMock(spec=discord.Message)
        msg.guild = None
        await lore_cog.on_message(msg)
        assert len(lore_cog._message_buffers) == 0

    async def test_ignores_empty_content(self, lore_cog):
        msg = MagicMock(spec=discord.Message)
        msg.guild = MagicMock()
        msg.author = MagicMock()
        msg.author.bot = False
        msg.type = discord.MessageType.default
        msg.content = ""
        await lore_cog.on_message(msg)
        assert len(lore_cog._message_buffers) == 0

    async def test_buffers_valid_message(self, lore_cog):
        msg = MagicMock(spec=discord.Message)
        msg.guild = MagicMock()
        msg.guild.id = 111
        msg.channel = MagicMock()
        msg.channel.id = 222
        msg.author = MagicMock()
        msg.author.bot = False
        msg.author.display_name = "testuser"
        msg.type = discord.MessageType.default
        msg.content = "Hello world"
        msg.id = 12345
        msg.created_at = datetime(2024, 6, 1, 12, 0, tzinfo=UTC)

        await lore_cog.on_message(msg)
        assert "111:222" in lore_cog._message_buffers
        assert len(lore_cog._message_buffers["111:222"]) == 1
