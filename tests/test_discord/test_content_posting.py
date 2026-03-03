from unittest.mock import AsyncMock, MagicMock, patch

import discord
import pytest

from intelstream.discord.cogs.content_posting import ContentPosting

PATCH_CREATE_LLM = "intelstream.discord.cogs.content_posting.create_llm_client"
PATCH_SUMMARIZER = "intelstream.discord.cogs.content_posting.SummarizationService"
PATCH_PIPELINE = "intelstream.discord.cogs.content_posting.ContentPipeline"
PATCH_POSTER = "intelstream.discord.cogs.content_posting.ContentPoster"


@pytest.fixture
def mock_bot():
    bot = MagicMock()
    bot.repository = MagicMock()
    bot.settings = MagicMock()
    bot.settings.llm_provider = "anthropic"
    bot.settings.llm_api_key = "test-api-key"
    bot.settings.content_poll_interval_minutes = 5
    bot.settings.summary_model = "claude-sonnet-4-20250514"
    bot.settings.summary_max_tokens = 2048
    bot.settings.summary_max_input_length = 100000
    bot.settings.discord_max_message_length = 2000
    bot.guilds = []
    bot.wait_until_ready = AsyncMock()
    bot.notify_owner = AsyncMock()
    return bot


@pytest.fixture
def _patch_cog_deps():
    """Patch all external dependencies used by ContentPosting.cog_load()."""
    with (
        patch(PATCH_CREATE_LLM) as mock_create_llm,
        patch(PATCH_SUMMARIZER) as mock_summarizer_cls,
        patch(PATCH_PIPELINE) as mock_pipeline_cls,
        patch(PATCH_POSTER) as mock_poster_cls,
    ):
        mock_pipeline = MagicMock()
        mock_pipeline.initialize = AsyncMock()
        mock_pipeline.close = AsyncMock()
        mock_pipeline.run_cycle = AsyncMock(return_value=(0, 0))
        mock_pipeline_cls.return_value = mock_pipeline

        mock_poster = MagicMock()
        mock_poster.post_unposted_items = AsyncMock(return_value=0)
        mock_poster_cls.return_value = mock_poster

        mock_llm_client = MagicMock()
        mock_create_llm.return_value = mock_llm_client

        mock_summarizer = MagicMock()
        mock_summarizer.close = AsyncMock()
        mock_summarizer_cls.return_value = mock_summarizer

        yield {
            "create_llm": mock_create_llm,
            "summarizer_cls": mock_summarizer_cls,
            "pipeline_cls": mock_pipeline_cls,
            "pipeline": mock_pipeline,
            "poster_cls": mock_poster_cls,
            "poster": mock_poster,
            "llm_client": mock_llm_client,
            "summarizer": mock_summarizer,
        }


class TestContentPostingCogLoad:
    @patch(PATCH_CREATE_LLM)
    @patch(PATCH_SUMMARIZER)
    @patch(PATCH_PIPELINE)
    @patch(PATCH_POSTER)
    async def test_cog_load_initializes_components(
        self, mock_poster_cls, mock_pipeline_cls, mock_summarizer_cls, mock_create_llm, mock_bot
    ):
        mock_pipeline = MagicMock()
        mock_pipeline.initialize = AsyncMock()
        mock_pipeline_cls.return_value = mock_pipeline

        mock_poster = MagicMock()
        mock_poster_cls.return_value = mock_poster

        mock_llm_client = MagicMock()
        mock_create_llm.return_value = mock_llm_client

        mock_summarizer = MagicMock()
        mock_summarizer_cls.return_value = mock_summarizer

        cog = ContentPosting(mock_bot)

        await cog.cog_load()

        mock_create_llm.assert_called_once_with(
            provider="anthropic",
            api_key="test-api-key",
            model="claude-sonnet-4-20250514",
        )
        mock_summarizer_cls.assert_called_once_with(
            client=mock_llm_client,
            max_tokens=2048,
            max_input_length=100000,
        )
        mock_pipeline_cls.assert_called_once()
        mock_pipeline.initialize.assert_called_once()
        mock_poster_cls.assert_called_once_with(mock_bot, max_message_length=2000)
        assert cog._initialized is True

    @patch(PATCH_CREATE_LLM)
    @patch(PATCH_SUMMARIZER)
    @patch(PATCH_PIPELINE)
    @patch(PATCH_POSTER)
    async def test_cog_load_starts_content_loop(
        self, _mock_poster_cls, mock_pipeline_cls, _mock_summarizer_cls, _mock_create_llm, mock_bot
    ):
        mock_pipeline = MagicMock()
        mock_pipeline.initialize = AsyncMock()
        mock_pipeline_cls.return_value = mock_pipeline

        cog = ContentPosting(mock_bot)

        await cog.cog_load()

        assert cog.content_loop.is_running()


class TestContentPostingCogUnload:
    async def test_cog_unload_closes_pipeline(self, _patch_cog_deps, mock_bot):
        deps = _patch_cog_deps

        cog = ContentPosting(mock_bot)
        await cog.cog_load()

        await cog.cog_unload()

        deps["pipeline"].close.assert_called_once()
        assert cog._initialized is False

    async def test_cog_unload_closes_summarizer(self, _patch_cog_deps, mock_bot):
        deps = _patch_cog_deps

        cog = ContentPosting(mock_bot)
        await cog.cog_load()

        await cog.cog_unload()

        deps["summarizer"].close.assert_called_once()


class TestContentLoop:
    async def test_content_loop_skips_when_not_initialized(self, _patch_cog_deps, mock_bot):
        cog = ContentPosting(mock_bot)
        cog._initialized = False

        await cog.content_loop()

    async def test_content_loop_runs_pipeline_cycle(self, _patch_cog_deps, mock_bot):
        deps = _patch_cog_deps
        deps["pipeline"].run_cycle = AsyncMock(return_value=(5, 3))

        cog = ContentPosting(mock_bot)
        await cog.cog_load()

        await cog.content_loop()

        deps["pipeline"].run_cycle.assert_called_once()

    async def test_content_loop_posts_to_all_guilds(self, _patch_cog_deps, mock_bot):
        deps = _patch_cog_deps
        deps["pipeline"].run_cycle = AsyncMock(return_value=(5, 3))
        deps["poster"].post_unposted_items = AsyncMock(return_value=2)

        guild1 = MagicMock(spec=discord.Guild)
        guild1.id = 111
        guild1.name = "Guild 1"

        guild2 = MagicMock(spec=discord.Guild)
        guild2.id = 222
        guild2.name = "Guild 2"

        mock_bot.guilds = [guild1, guild2]

        cog = ContentPosting(mock_bot)
        await cog.cog_load()

        await cog.content_loop()

        assert deps["poster"].post_unposted_items.call_count == 2
        deps["poster"].post_unposted_items.assert_any_call(111)
        deps["poster"].post_unposted_items.assert_any_call(222)

    async def test_content_loop_notifies_owner_on_error(self, _patch_cog_deps, mock_bot):
        deps = _patch_cog_deps
        deps["pipeline"].run_cycle = AsyncMock(side_effect=Exception("Test error"))

        cog = ContentPosting(mock_bot)
        await cog.cog_load()

        await cog.content_loop()

        mock_bot.notify_owner.assert_called_once()
        call_args = mock_bot.notify_owner.call_args[0][0]
        assert "Test error" in call_args

    async def test_content_loop_continues_on_guild_error(self, _patch_cog_deps, mock_bot):
        deps = _patch_cog_deps
        deps["pipeline"].run_cycle = AsyncMock(return_value=(5, 3))
        deps["poster"].post_unposted_items = AsyncMock(side_effect=[Exception("Guild 1 error"), 2])

        guild1 = MagicMock(spec=discord.Guild)
        guild1.id = 111
        guild1.name = "Guild 1"

        guild2 = MagicMock(spec=discord.Guild)
        guild2.id = 222
        guild2.name = "Guild 2"

        mock_bot.guilds = [guild1, guild2]

        cog = ContentPosting(mock_bot)
        await cog.cog_load()

        await cog.content_loop()

        assert deps["poster"].post_unposted_items.call_count == 2


class TestContentLoopErrorHandler:
    async def test_error_handler_notifies_owner_on_first_error(self, _patch_cog_deps, mock_bot):
        cog = ContentPosting(mock_bot)
        await cog.cog_load()

        test_error = Exception("Loop error")
        await cog.content_loop_error(test_error)

        mock_bot.notify_owner.assert_called_once()
        call_args = mock_bot.notify_owner.call_args[0][0]
        assert "Loop error" in call_args

    async def test_error_handler_does_not_notify_owner_on_subsequent_errors(
        self, _patch_cog_deps, mock_bot
    ):
        cog = ContentPosting(mock_bot)
        await cog.cog_load()
        cog._consecutive_failures = 1

        test_error = Exception("Loop error")
        await cog.content_loop_error(test_error)

        mock_bot.notify_owner.assert_not_called()


class TestContentLoopBackoff:
    async def test_backoff_increments_consecutive_failures(self, _patch_cog_deps, mock_bot):
        deps = _patch_cog_deps
        deps["pipeline"].run_cycle = AsyncMock(side_effect=Exception("Test error"))

        cog = ContentPosting(mock_bot)
        await cog.cog_load()

        assert cog._consecutive_failures == 0
        await cog.content_loop()
        assert cog._consecutive_failures == 1
        await cog.content_loop()
        assert cog._consecutive_failures == 2

    async def test_backoff_resets_on_success(self, _patch_cog_deps, mock_bot):
        deps = _patch_cog_deps
        deps["pipeline"].run_cycle = AsyncMock(return_value=(5, 3))

        cog = ContentPosting(mock_bot)
        await cog.cog_load()
        cog._consecutive_failures = 3

        await cog.content_loop()

        assert cog._consecutive_failures == 0

    async def test_circuit_breaker_notifies_and_retries_hourly(self, _patch_cog_deps, mock_bot):
        deps = _patch_cog_deps
        deps["pipeline"].run_cycle = AsyncMock(side_effect=Exception("Still failing"))

        cog = ContentPosting(mock_bot)
        await cog.cog_load()
        cog._consecutive_failures = ContentPosting.MAX_CONSECUTIVE_FAILURES

        await cog.content_loop()

        assert mock_bot.notify_owner.call_count == 1
        assert "consecutive failures" in mock_bot.notify_owner.call_args[0][0]
        assert cog.content_loop.minutes == 60
        deps["pipeline"].run_cycle.assert_called_once()

    async def test_circuit_breaker_recovers_on_success(self, _patch_cog_deps, mock_bot):
        deps = _patch_cog_deps
        deps["pipeline"].run_cycle = AsyncMock(return_value=(5, 3))

        cog = ContentPosting(mock_bot)
        await cog.cog_load()
        cog._consecutive_failures = ContentPosting.MAX_CONSECUTIVE_FAILURES + 1
        cog.content_loop.change_interval(minutes=60)

        await cog.content_loop()

        assert cog._consecutive_failures == 0
        assert cog.content_loop.minutes == cog._base_interval

    async def test_apply_backoff_keeps_base_on_first_failure(self, _patch_cog_deps, mock_bot):
        cog = ContentPosting(mock_bot)
        await cog.cog_load()
        cog._consecutive_failures = 1

        cog._apply_backoff()

        assert cog.content_loop.minutes == cog._base_interval

    async def test_apply_backoff_doubles_on_second_failure(self, _patch_cog_deps, mock_bot):
        cog = ContentPosting(mock_bot)
        await cog.cog_load()
        cog._consecutive_failures = 2

        cog._apply_backoff()

        assert cog.content_loop.minutes == cog._base_interval * 2

    async def test_apply_backoff_caps_at_max_multiplier(self, _patch_cog_deps, mock_bot):
        cog = ContentPosting(mock_bot)
        await cog.cog_load()
        cog._consecutive_failures = 4

        cog._apply_backoff()

        max_interval = cog._base_interval * ContentPosting.MAX_BACKOFF_MULTIPLIER
        assert cog.content_loop.minutes == max_interval

    async def test_reset_backoff_restores_base_interval(self, _patch_cog_deps, mock_bot):
        cog = ContentPosting(mock_bot)
        await cog.cog_load()
        cog._consecutive_failures = 3
        cog.content_loop.change_interval(minutes=20)

        cog._reset_backoff()

        assert cog._consecutive_failures == 0
        assert cog.content_loop.minutes == cog._base_interval

    async def test_only_notifies_owner_on_first_failure(self, _patch_cog_deps, mock_bot):
        deps = _patch_cog_deps
        deps["pipeline"].run_cycle = AsyncMock(side_effect=Exception("Test error"))

        cog = ContentPosting(mock_bot)
        await cog.cog_load()

        await cog.content_loop()
        await cog.content_loop()
        await cog.content_loop()

        mock_bot.notify_owner.assert_called_once()
