from unittest.mock import AsyncMock, MagicMock, patch

import discord
import pytest

from intelstream.discord.cogs.content_posting import ContentPosting


@pytest.fixture
def mock_bot():
    bot = MagicMock()
    bot.repository = MagicMock()
    bot.settings = MagicMock()
    bot.settings.anthropic_api_key = "test-api-key"
    bot.settings.content_poll_interval_minutes = 5
    bot.settings.summary_model = "claude-sonnet-4-20250514"
    bot.settings.summary_max_tokens = 2048
    bot.settings.summary_max_input_length = 100000
    bot.settings.discord_max_message_length = 2000
    bot.guilds = []
    bot.wait_until_ready = AsyncMock()
    bot.notify_owner = AsyncMock()
    return bot


class TestContentPostingCogLoad:
    @patch("intelstream.discord.cogs.content_posting.SummarizationService")
    @patch("intelstream.discord.cogs.content_posting.ContentPipeline")
    @patch("intelstream.discord.cogs.content_posting.ContentPoster")
    async def test_cog_load_initializes_components(
        self, mock_poster_cls, mock_pipeline_cls, mock_summarizer_cls, mock_bot
    ):
        mock_pipeline = MagicMock()
        mock_pipeline.initialize = AsyncMock()
        mock_pipeline_cls.return_value = mock_pipeline

        mock_poster = MagicMock()
        mock_poster_cls.return_value = mock_poster

        mock_summarizer = MagicMock()
        mock_summarizer_cls.return_value = mock_summarizer

        cog = ContentPosting(mock_bot)

        await cog.cog_load()

        mock_summarizer_cls.assert_called_once_with(
            api_key="test-api-key",
            model="claude-sonnet-4-20250514",
            max_tokens=2048,
            max_input_length=100000,
        )
        mock_pipeline_cls.assert_called_once()
        mock_pipeline.initialize.assert_called_once()
        mock_poster_cls.assert_called_once_with(mock_bot, max_message_length=2000)
        assert cog._initialized is True

    @patch("intelstream.discord.cogs.content_posting.SummarizationService")
    @patch("intelstream.discord.cogs.content_posting.ContentPipeline")
    @patch("intelstream.discord.cogs.content_posting.ContentPoster")
    async def test_cog_load_starts_content_loop(
        self, _mock_poster_cls, mock_pipeline_cls, _mock_summarizer_cls, mock_bot
    ):
        mock_pipeline = MagicMock()
        mock_pipeline.initialize = AsyncMock()
        mock_pipeline_cls.return_value = mock_pipeline

        cog = ContentPosting(mock_bot)

        await cog.cog_load()

        assert cog.content_loop.is_running() or True


class TestContentPostingCogUnload:
    @patch("intelstream.discord.cogs.content_posting.SummarizationService")
    @patch("intelstream.discord.cogs.content_posting.ContentPipeline")
    @patch("intelstream.discord.cogs.content_posting.ContentPoster")
    async def test_cog_unload_closes_pipeline(
        self, _mock_poster_cls, mock_pipeline_cls, _mock_summarizer_cls, mock_bot
    ):
        mock_pipeline = MagicMock()
        mock_pipeline.initialize = AsyncMock()
        mock_pipeline.close = AsyncMock()
        mock_pipeline_cls.return_value = mock_pipeline

        cog = ContentPosting(mock_bot)
        await cog.cog_load()

        await cog.cog_unload()

        mock_pipeline.close.assert_called_once()
        assert cog._initialized is False


class TestContentLoop:
    @patch("intelstream.discord.cogs.content_posting.SummarizationService")
    @patch("intelstream.discord.cogs.content_posting.ContentPipeline")
    @patch("intelstream.discord.cogs.content_posting.ContentPoster")
    async def test_content_loop_skips_when_not_initialized(
        self, _mock_poster_cls, _mock_pipeline_cls, _mock_summarizer_cls, mock_bot
    ):
        cog = ContentPosting(mock_bot)
        cog._initialized = False

        await cog.content_loop()

    @patch("intelstream.discord.cogs.content_posting.SummarizationService")
    @patch("intelstream.discord.cogs.content_posting.ContentPipeline")
    @patch("intelstream.discord.cogs.content_posting.ContentPoster")
    async def test_content_loop_runs_pipeline_cycle(
        self, mock_poster_cls, mock_pipeline_cls, _mock_summarizer_cls, mock_bot
    ):
        mock_pipeline = MagicMock()
        mock_pipeline.initialize = AsyncMock()
        mock_pipeline.run_cycle = AsyncMock(return_value=(5, 3))
        mock_pipeline_cls.return_value = mock_pipeline

        mock_poster = MagicMock()
        mock_poster.post_unposted_items = AsyncMock(return_value=0)
        mock_poster_cls.return_value = mock_poster

        cog = ContentPosting(mock_bot)
        await cog.cog_load()

        await cog.content_loop()

        mock_pipeline.run_cycle.assert_called_once()

    @patch("intelstream.discord.cogs.content_posting.SummarizationService")
    @patch("intelstream.discord.cogs.content_posting.ContentPipeline")
    @patch("intelstream.discord.cogs.content_posting.ContentPoster")
    async def test_content_loop_posts_to_all_guilds(
        self, mock_poster_cls, mock_pipeline_cls, _mock_summarizer_cls, mock_bot
    ):
        mock_pipeline = MagicMock()
        mock_pipeline.initialize = AsyncMock()
        mock_pipeline.run_cycle = AsyncMock(return_value=(5, 3))
        mock_pipeline_cls.return_value = mock_pipeline

        mock_poster = MagicMock()
        mock_poster.post_unposted_items = AsyncMock(return_value=2)
        mock_poster_cls.return_value = mock_poster

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

        assert mock_poster.post_unposted_items.call_count == 2
        mock_poster.post_unposted_items.assert_any_call(111)
        mock_poster.post_unposted_items.assert_any_call(222)

    @patch("intelstream.discord.cogs.content_posting.SummarizationService")
    @patch("intelstream.discord.cogs.content_posting.ContentPipeline")
    @patch("intelstream.discord.cogs.content_posting.ContentPoster")
    async def test_content_loop_notifies_owner_on_error(
        self, _mock_poster_cls, mock_pipeline_cls, _mock_summarizer_cls, mock_bot
    ):
        mock_pipeline = MagicMock()
        mock_pipeline.initialize = AsyncMock()
        mock_pipeline.run_cycle = AsyncMock(side_effect=Exception("Test error"))
        mock_pipeline_cls.return_value = mock_pipeline

        cog = ContentPosting(mock_bot)
        await cog.cog_load()

        await cog.content_loop()

        mock_bot.notify_owner.assert_called_once()
        call_args = mock_bot.notify_owner.call_args[0][0]
        assert "Test error" in call_args

    @patch("intelstream.discord.cogs.content_posting.SummarizationService")
    @patch("intelstream.discord.cogs.content_posting.ContentPipeline")
    @patch("intelstream.discord.cogs.content_posting.ContentPoster")
    async def test_content_loop_continues_on_guild_error(
        self, mock_poster_cls, mock_pipeline_cls, _mock_summarizer_cls, mock_bot
    ):
        mock_pipeline = MagicMock()
        mock_pipeline.initialize = AsyncMock()
        mock_pipeline.run_cycle = AsyncMock(return_value=(5, 3))
        mock_pipeline_cls.return_value = mock_pipeline

        mock_poster = MagicMock()
        mock_poster.post_unposted_items = AsyncMock(side_effect=[Exception("Guild 1 error"), 2])
        mock_poster_cls.return_value = mock_poster

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

        assert mock_poster.post_unposted_items.call_count == 2


class TestContentLoopErrorHandler:
    @patch("intelstream.discord.cogs.content_posting.SummarizationService")
    @patch("intelstream.discord.cogs.content_posting.ContentPipeline")
    @patch("intelstream.discord.cogs.content_posting.ContentPoster")
    async def test_error_handler_notifies_owner_on_first_error(
        self, _mock_poster_cls, mock_pipeline_cls, _mock_summarizer_cls, mock_bot
    ):
        mock_pipeline = MagicMock()
        mock_pipeline.initialize = AsyncMock()
        mock_pipeline_cls.return_value = mock_pipeline

        cog = ContentPosting(mock_bot)
        await cog.cog_load()

        test_error = Exception("Loop error")
        await cog.content_loop_error(test_error)

        mock_bot.notify_owner.assert_called_once()
        call_args = mock_bot.notify_owner.call_args[0][0]
        assert "Loop error" in call_args

    @patch("intelstream.discord.cogs.content_posting.SummarizationService")
    @patch("intelstream.discord.cogs.content_posting.ContentPipeline")
    @patch("intelstream.discord.cogs.content_posting.ContentPoster")
    async def test_error_handler_does_not_notify_owner_on_subsequent_errors(
        self, _mock_poster_cls, mock_pipeline_cls, _mock_summarizer_cls, mock_bot
    ):
        mock_pipeline = MagicMock()
        mock_pipeline.initialize = AsyncMock()
        mock_pipeline_cls.return_value = mock_pipeline

        cog = ContentPosting(mock_bot)
        await cog.cog_load()
        cog._consecutive_failures = 1

        test_error = Exception("Loop error")
        await cog.content_loop_error(test_error)

        mock_bot.notify_owner.assert_not_called()


class TestContentLoopBackoff:
    @patch("intelstream.discord.cogs.content_posting.SummarizationService")
    @patch("intelstream.discord.cogs.content_posting.ContentPipeline")
    @patch("intelstream.discord.cogs.content_posting.ContentPoster")
    async def test_backoff_increments_consecutive_failures(
        self, _mock_poster_cls, mock_pipeline_cls, _mock_summarizer_cls, mock_bot
    ):
        mock_pipeline = MagicMock()
        mock_pipeline.initialize = AsyncMock()
        mock_pipeline.run_cycle = AsyncMock(side_effect=Exception("Test error"))
        mock_pipeline_cls.return_value = mock_pipeline

        cog = ContentPosting(mock_bot)
        await cog.cog_load()

        assert cog._consecutive_failures == 0
        await cog.content_loop()
        assert cog._consecutive_failures == 1
        await cog.content_loop()
        assert cog._consecutive_failures == 2

    @patch("intelstream.discord.cogs.content_posting.SummarizationService")
    @patch("intelstream.discord.cogs.content_posting.ContentPipeline")
    @patch("intelstream.discord.cogs.content_posting.ContentPoster")
    async def test_backoff_resets_on_success(
        self, mock_poster_cls, mock_pipeline_cls, _mock_summarizer_cls, mock_bot
    ):
        mock_pipeline = MagicMock()
        mock_pipeline.initialize = AsyncMock()
        mock_pipeline.run_cycle = AsyncMock(return_value=(5, 3))
        mock_pipeline_cls.return_value = mock_pipeline

        mock_poster = MagicMock()
        mock_poster.post_unposted_items = AsyncMock(return_value=0)
        mock_poster_cls.return_value = mock_poster

        cog = ContentPosting(mock_bot)
        await cog.cog_load()
        cog._consecutive_failures = 3

        await cog.content_loop()

        assert cog._consecutive_failures == 0

    @patch("intelstream.discord.cogs.content_posting.SummarizationService")
    @patch("intelstream.discord.cogs.content_posting.ContentPipeline")
    @patch("intelstream.discord.cogs.content_posting.ContentPoster")
    async def test_circuit_breaker_notifies_and_retries_hourly(
        self, _mock_poster_cls, mock_pipeline_cls, _mock_summarizer_cls, mock_bot
    ):
        mock_pipeline = MagicMock()
        mock_pipeline.initialize = AsyncMock()
        mock_pipeline.run_cycle = AsyncMock(side_effect=Exception("Still failing"))
        mock_pipeline_cls.return_value = mock_pipeline

        cog = ContentPosting(mock_bot)
        await cog.cog_load()
        cog._consecutive_failures = ContentPosting.MAX_CONSECUTIVE_FAILURES

        await cog.content_loop()

        assert mock_bot.notify_owner.call_count == 1
        assert "consecutive failures" in mock_bot.notify_owner.call_args[0][0]
        assert cog.content_loop.minutes == 60
        mock_pipeline.run_cycle.assert_called_once()

    @patch("intelstream.discord.cogs.content_posting.SummarizationService")
    @patch("intelstream.discord.cogs.content_posting.ContentPipeline")
    @patch("intelstream.discord.cogs.content_posting.ContentPoster")
    async def test_circuit_breaker_recovers_on_success(
        self, mock_poster_cls, mock_pipeline_cls, _mock_summarizer_cls, mock_bot
    ):
        mock_pipeline = MagicMock()
        mock_pipeline.initialize = AsyncMock()
        mock_pipeline.run_cycle = AsyncMock(return_value=(5, 3))
        mock_pipeline_cls.return_value = mock_pipeline

        mock_poster = MagicMock()
        mock_poster.post_unposted_items = AsyncMock(return_value=0)
        mock_poster_cls.return_value = mock_poster

        cog = ContentPosting(mock_bot)
        await cog.cog_load()
        cog._consecutive_failures = ContentPosting.MAX_CONSECUTIVE_FAILURES + 1
        cog.content_loop.change_interval(minutes=60)

        await cog.content_loop()

        assert cog._consecutive_failures == 0
        assert cog.content_loop.minutes == cog._base_interval

    @patch("intelstream.discord.cogs.content_posting.SummarizationService")
    @patch("intelstream.discord.cogs.content_posting.ContentPipeline")
    @patch("intelstream.discord.cogs.content_posting.ContentPoster")
    async def test_apply_backoff_keeps_base_on_first_failure(
        self, _mock_poster_cls, mock_pipeline_cls, _mock_summarizer_cls, mock_bot
    ):
        mock_pipeline = MagicMock()
        mock_pipeline.initialize = AsyncMock()
        mock_pipeline_cls.return_value = mock_pipeline

        cog = ContentPosting(mock_bot)
        await cog.cog_load()
        cog._consecutive_failures = 1

        cog._apply_backoff()

        assert cog.content_loop.minutes == cog._base_interval

    @patch("intelstream.discord.cogs.content_posting.SummarizationService")
    @patch("intelstream.discord.cogs.content_posting.ContentPipeline")
    @patch("intelstream.discord.cogs.content_posting.ContentPoster")
    async def test_apply_backoff_doubles_on_second_failure(
        self, _mock_poster_cls, mock_pipeline_cls, _mock_summarizer_cls, mock_bot
    ):
        mock_pipeline = MagicMock()
        mock_pipeline.initialize = AsyncMock()
        mock_pipeline_cls.return_value = mock_pipeline

        cog = ContentPosting(mock_bot)
        await cog.cog_load()
        cog._consecutive_failures = 2

        cog._apply_backoff()

        assert cog.content_loop.minutes == cog._base_interval * 2

    @patch("intelstream.discord.cogs.content_posting.SummarizationService")
    @patch("intelstream.discord.cogs.content_posting.ContentPipeline")
    @patch("intelstream.discord.cogs.content_posting.ContentPoster")
    async def test_apply_backoff_caps_at_max_multiplier(
        self, _mock_poster_cls, mock_pipeline_cls, _mock_summarizer_cls, mock_bot
    ):
        mock_pipeline = MagicMock()
        mock_pipeline.initialize = AsyncMock()
        mock_pipeline_cls.return_value = mock_pipeline

        cog = ContentPosting(mock_bot)
        await cog.cog_load()
        cog._consecutive_failures = 4

        cog._apply_backoff()

        max_interval = cog._base_interval * ContentPosting.MAX_BACKOFF_MULTIPLIER
        assert cog.content_loop.minutes == max_interval

    @patch("intelstream.discord.cogs.content_posting.SummarizationService")
    @patch("intelstream.discord.cogs.content_posting.ContentPipeline")
    @patch("intelstream.discord.cogs.content_posting.ContentPoster")
    async def test_reset_backoff_restores_base_interval(
        self, _mock_poster_cls, mock_pipeline_cls, _mock_summarizer_cls, mock_bot
    ):
        mock_pipeline = MagicMock()
        mock_pipeline.initialize = AsyncMock()
        mock_pipeline_cls.return_value = mock_pipeline

        cog = ContentPosting(mock_bot)
        await cog.cog_load()
        cog._consecutive_failures = 3
        cog.content_loop.change_interval(minutes=20)

        cog._reset_backoff()

        assert cog._consecutive_failures == 0
        assert cog.content_loop.minutes == cog._base_interval

    @patch("intelstream.discord.cogs.content_posting.SummarizationService")
    @patch("intelstream.discord.cogs.content_posting.ContentPipeline")
    @patch("intelstream.discord.cogs.content_posting.ContentPoster")
    async def test_only_notifies_owner_on_first_failure(
        self, _mock_poster_cls, mock_pipeline_cls, _mock_summarizer_cls, mock_bot
    ):
        mock_pipeline = MagicMock()
        mock_pipeline.initialize = AsyncMock()
        mock_pipeline.run_cycle = AsyncMock(side_effect=Exception("Test error"))
        mock_pipeline_cls.return_value = mock_pipeline

        cog = ContentPosting(mock_bot)
        await cog.cog_load()

        await cog.content_loop()
        await cog.content_loop()
        await cog.content_loop()

        mock_bot.notify_owner.assert_called_once()
