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
    bot.settings.lore_auto_resume = True
    bot.settings.anthropic_api_key = "test-key"
    bot.settings.summary_model_interactive = "claude-test"
    bot.repository = AsyncMock()
    bot.get_guild = MagicMock(return_value=None)
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
    store.search_message_chunks = AsyncMock(return_value=[])
    return store


@pytest.fixture
def lore_cog(mock_bot, mock_embedding_service, mock_vector_store):
    cog = Lore(mock_bot, mock_embedding_service, mock_vector_store)
    cog._ingestion_service = MagicMock()
    cog._ingestion_service.is_running = False
    cog._anthropic = AsyncMock()
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
    async def test_query_no_guild(self, lore_cog, mock_interaction):
        mock_interaction.guild_id = None
        await lore_cog.lore_query.callback(lore_cog, mock_interaction, "test")
        mock_interaction.followup.send.assert_called_once()
        assert "server" in mock_interaction.followup.send.call_args[0][0].lower()

    async def test_query_no_results(self, lore_cog, mock_interaction, mock_vector_store):
        mock_vector_store.search_message_chunks.return_value = []
        await lore_cog.lore_query.callback(lore_cog, mock_interaction, "test query")
        mock_interaction.followup.send.assert_called_once()
        assert "no lore" in mock_interaction.followup.send.call_args[0][0].lower()

    async def test_query_with_results(
        self, lore_cog, mock_interaction, mock_vector_store, mock_bot
    ):
        mock_vector_store.search_message_chunks.return_value = [
            ChunkSearchResult(chunk_id="chunk-1", score=0.9),
        ]

        meta = MagicMock()
        meta.id = "chunk-1"
        meta.guild_id = str(mock_interaction.guild_id)
        meta.channel_id = "999"
        meta.channel_name = "general"
        meta.start_timestamp = datetime(2024, 6, 1, tzinfo=UTC)
        meta.end_timestamp = datetime(2024, 6, 1, 1, 0, tzinfo=UTC)
        meta.text = "Some conversation text here"
        mock_bot.repository.get_message_chunk_metas_by_ids.return_value = [meta]

        response_block = MagicMock()
        response_block.text = "Here is the lore about that topic."
        claude_response = MagicMock()
        claude_response.content = [response_block]
        lore_cog._anthropic.messages.create = AsyncMock(return_value=claude_response)

        await lore_cog.lore_query.callback(lore_cog, mock_interaction, "test query")
        mock_interaction.followup.send.assert_called()
        sent_text = mock_interaction.followup.send.call_args[0][0]
        assert "lore" in sent_text.lower()

    async def test_query_filters_other_guild(
        self, lore_cog, mock_interaction, mock_vector_store, mock_bot
    ):
        mock_vector_store.search_message_chunks.return_value = [
            ChunkSearchResult(chunk_id="chunk-1", score=0.9),
        ]

        meta = MagicMock()
        meta.id = "chunk-1"
        meta.guild_id = "999999"
        meta.channel_id = "999"
        mock_bot.repository.get_message_chunk_metas_by_ids.return_value = [meta]

        await lore_cog.lore_query.callback(lore_cog, mock_interaction, "test query")
        mock_interaction.followup.send.assert_called()
        assert "no relevant" in mock_interaction.followup.send.call_args[0][0].lower()




class TestLoreCogLoadWithoutAnthropicKey:
    async def test_cog_load_without_api_key(
        self, mock_bot, mock_embedding_service, mock_vector_store
    ):
        mock_bot.settings.anthropic_api_key = None
        cog = Lore(mock_bot, mock_embedding_service, mock_vector_store)
        cog._flush_buffers = MagicMock()
        cog._flush_buffers.start = MagicMock()

        await cog.cog_load()

        assert cog._anthropic is None
        assert cog._ingestion_service is not None
        assert cog._chunker is not None

    async def test_cog_load_with_empty_api_key(
        self, mock_bot, mock_embedding_service, mock_vector_store
    ):
        mock_bot.settings.anthropic_api_key = "  "
        cog = Lore(mock_bot, mock_embedding_service, mock_vector_store)
        cog._flush_buffers = MagicMock()
        cog._flush_buffers.start = MagicMock()

        await cog.cog_load()

        assert cog._anthropic is None

    async def test_query_returns_error_when_no_anthropic(
        self, mock_interaction, mock_vector_store, mock_bot, mock_embedding_service
    ):
        mock_bot.settings.anthropic_api_key = None
        cog = Lore(mock_bot, mock_embedding_service, mock_vector_store)
        cog._anthropic = None
        cog._ingestion_service = MagicMock()
        cog._chunker = MagicMock()

        mock_vector_store.search_message_chunks.return_value = [
            ChunkSearchResult(chunk_id="chunk-1", score=0.9),
        ]
        meta = MagicMock()
        meta.id = "chunk-1"
        meta.guild_id = str(mock_interaction.guild_id)
        meta.channel_id = "999"
        meta.channel_name = "general"
        meta.start_timestamp = datetime(2024, 6, 1, tzinfo=UTC)
        meta.end_timestamp = datetime(2024, 6, 1, 1, 0, tzinfo=UTC)
        meta.text = "Some text"
        mock_bot.repository.get_message_chunk_metas_by_ids.return_value = [meta]

        await cog.lore_query.callback(cog, mock_interaction, "test query")

        mock_interaction.followup.send.assert_called()
        sent_text = mock_interaction.followup.send.call_args[0][0]
        assert "unavailable" in sent_text.lower()


class TestLoreSetup:
    async def test_setup_no_guild(self, lore_cog, mock_interaction):
        mock_interaction.guild = None
        await lore_cog.lore_setup.callback(lore_cog, mock_interaction)
        mock_interaction.followup.send.assert_called_once()
        assert (
            "server"
            in mock_interaction.followup.send.call_args.kwargs.get(
                "content", mock_interaction.followup.send.call_args[0][0]
            ).lower()
        )

    async def test_setup_already_running(self, lore_cog, mock_interaction):
        lore_cog._ingestion_service.is_running = True
        await lore_cog.lore_setup.callback(lore_cog, mock_interaction)
        mock_interaction.followup.send.assert_called_once()
        assert "already running" in mock_interaction.followup.send.call_args[0][0].lower()

    async def test_setup_starts_backfill(self, lore_cog, mock_interaction):
        lore_cog._ingestion_service.is_running = False
        await lore_cog.lore_setup.callback(lore_cog, mock_interaction)
        lore_cog._ingestion_service.start_backfill.assert_called_once()


class TestLoreStatus:
    async def test_status_no_guild(self, lore_cog, mock_interaction):
        mock_interaction.guild_id = None
        await lore_cog.lore_status.callback(lore_cog, mock_interaction)
        mock_interaction.response.send_message.assert_called_once()

    async def test_status_no_ingestion(self, lore_cog, mock_interaction, mock_bot):
        mock_bot.repository.get_ingestion_progress_for_guild.return_value = []
        await lore_cog.lore_status.callback(lore_cog, mock_interaction)
        mock_interaction.response.send_message.assert_called_once()
        assert "no ingestion" in mock_interaction.response.send_message.call_args[0][0].lower()

    async def test_status_shows_progress(self, lore_cog, mock_interaction, mock_bot):
        progress = MagicMock()
        progress.channel_id = "123"
        progress.total_fetched = 5000
        progress.status = "in_progress"
        mock_bot.repository.get_ingestion_progress_for_guild.return_value = [progress]

        await lore_cog.lore_status.callback(lore_cog, mock_interaction)
        mock_interaction.response.send_message.assert_called_once()
        text = mock_interaction.response.send_message.call_args[0][0]
        assert "5,000" in text


class TestLorePauseResume:
    async def test_pause_not_running(self, lore_cog, mock_interaction):
        lore_cog._ingestion_service.is_running = False
        await lore_cog.lore_pause.callback(lore_cog, mock_interaction)
        mock_interaction.response.send_message.assert_called_once()
        assert "no ingestion" in mock_interaction.response.send_message.call_args[0][0].lower()

    async def test_pause_running(self, lore_cog, mock_interaction):
        lore_cog._ingestion_service.is_running = True
        await lore_cog.lore_pause.callback(lore_cog, mock_interaction)
        lore_cog._ingestion_service.pause.assert_called_once()

    async def test_resume_restarts_when_not_running(self, lore_cog, mock_interaction):
        lore_cog._ingestion_service.is_running = False
        await lore_cog.lore_resume.callback(lore_cog, mock_interaction)
        lore_cog._ingestion_service.start_backfill.assert_called_once()

    async def test_resume_unpauses_when_running(self, lore_cog, mock_interaction):
        lore_cog._ingestion_service.is_running = True
        await lore_cog.lore_resume.callback(lore_cog, mock_interaction)
        lore_cog._ingestion_service.resume.assert_called_once()


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
