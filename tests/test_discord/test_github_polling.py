from unittest.mock import AsyncMock, MagicMock

import pytest

from intelstream.discord.cogs.github_polling import GitHubPolling


@pytest.fixture
def mock_bot():
    bot = MagicMock()
    bot.repository = MagicMock()
    bot.repository.get_all_github_repos = AsyncMock(return_value=[])
    bot.settings = MagicMock()
    bot.settings.github_token = "test-github-token"
    bot.settings.github_poll_interval_minutes = 5
    bot.wait_until_ready = AsyncMock()
    bot.notify_owner = AsyncMock()
    return bot


def _make_cog(mock_bot: MagicMock) -> GitHubPolling:
    cog = GitHubPolling(mock_bot)
    cog._initialized = True
    cog._service = MagicMock()
    cog._poster = MagicMock()
    cog._base_interval = mock_bot.settings.github_poll_interval_minutes
    return cog


class TestGitHubPollingInit:
    def test_init_sets_consecutive_failures_to_zero(self, mock_bot):
        cog = GitHubPolling(mock_bot)
        assert cog._consecutive_failures == 0

    def test_class_has_max_backoff_multiplier(self):
        assert GitHubPolling.MAX_BACKOFF_MULTIPLIER == 4


class TestGitHubLoopBackoff:
    async def test_backoff_increments_consecutive_failures(self, mock_bot):
        mock_bot.repository.get_all_github_repos = AsyncMock(side_effect=Exception("DB error"))
        cog = _make_cog(mock_bot)

        assert cog._consecutive_failures == 0
        await cog.github_loop()
        assert cog._consecutive_failures == 1
        await cog.github_loop()
        assert cog._consecutive_failures == 2

    async def test_backoff_resets_on_success(self, mock_bot):
        cog = _make_cog(mock_bot)
        cog._consecutive_failures = 3

        await cog.github_loop()

        assert cog._consecutive_failures == 0

    async def test_circuit_breaker_notifies_and_retries_hourly(self, mock_bot):
        mock_bot.repository.get_all_github_repos = AsyncMock(side_effect=Exception("DB error"))
        cog = _make_cog(mock_bot)
        cog._consecutive_failures = GitHubPolling.MAX_CONSECUTIVE_FAILURES

        await cog.github_loop()

        assert mock_bot.notify_owner.call_count == 1
        assert "consecutive failures" in mock_bot.notify_owner.call_args[0][0]
        assert cog.github_loop.minutes == 60

    async def test_circuit_breaker_recovers_on_success(self, mock_bot):
        cog = _make_cog(mock_bot)
        cog._consecutive_failures = GitHubPolling.MAX_CONSECUTIVE_FAILURES + 1
        cog.github_loop.change_interval(minutes=60)

        await cog.github_loop()

        assert cog._consecutive_failures == 0
        assert cog.github_loop.minutes == cog._base_interval

    async def test_apply_backoff_keeps_base_on_first_failure(self, mock_bot):
        cog = _make_cog(mock_bot)
        cog._consecutive_failures = 1

        cog._apply_backoff()

        assert cog.github_loop.minutes == cog._base_interval

    async def test_apply_backoff_doubles_on_second_failure(self, mock_bot):
        cog = _make_cog(mock_bot)
        cog._consecutive_failures = 2

        cog._apply_backoff()

        assert cog.github_loop.minutes == cog._base_interval * 2

    async def test_apply_backoff_caps_at_max_multiplier(self, mock_bot):
        cog = _make_cog(mock_bot)
        cog._consecutive_failures = 4

        cog._apply_backoff()

        max_interval = cog._base_interval * GitHubPolling.MAX_BACKOFF_MULTIPLIER
        assert cog.github_loop.minutes == max_interval

    async def test_apply_backoff_skips_when_past_circuit_breaker(self, mock_bot):
        cog = _make_cog(mock_bot)
        cog._consecutive_failures = GitHubPolling.MAX_CONSECUTIVE_FAILURES + 1
        cog.github_loop.change_interval(minutes=60)

        cog._apply_backoff()

        assert cog.github_loop.minutes == 60

    async def test_reset_backoff_restores_base_interval(self, mock_bot):
        cog = _make_cog(mock_bot)
        cog._consecutive_failures = 3
        cog.github_loop.change_interval(minutes=20)

        cog._reset_backoff()

        assert cog._consecutive_failures == 0
        assert cog.github_loop.minutes == cog._base_interval

    async def test_reset_backoff_noop_when_no_failures(self, mock_bot):
        cog = _make_cog(mock_bot)
        cog._consecutive_failures = 0
        cog.github_loop.change_interval(minutes=5)

        cog._reset_backoff()

        assert cog._consecutive_failures == 0

    async def test_only_notifies_owner_on_first_failure(self, mock_bot):
        mock_bot.repository.get_all_github_repos = AsyncMock(side_effect=Exception("DB error"))
        cog = _make_cog(mock_bot)

        await cog.github_loop()
        await cog.github_loop()
        await cog.github_loop()

        mock_bot.notify_owner.assert_called_once()


class TestGitHubLoopErrorHandler:
    async def test_error_handler_notifies_owner_on_first_error(self, mock_bot):
        cog = _make_cog(mock_bot)

        await cog.github_loop_error(Exception("Loop error"))

        mock_bot.notify_owner.assert_called_once()
        call_args = mock_bot.notify_owner.call_args[0][0]
        assert "Loop error" in call_args

    async def test_error_handler_does_not_notify_on_subsequent_errors(self, mock_bot):
        cog = _make_cog(mock_bot)
        cog._consecutive_failures = 1

        await cog.github_loop_error(Exception("Loop error"))

        mock_bot.notify_owner.assert_not_called()

    async def test_error_handler_increments_failures(self, mock_bot):
        cog = _make_cog(mock_bot)
        assert cog._consecutive_failures == 0

        await cog.github_loop_error(Exception("Loop error"))

        assert cog._consecutive_failures == 1

    async def test_error_handler_applies_backoff(self, mock_bot):
        cog = _make_cog(mock_bot)

        await cog.github_loop_error(Exception("Loop error"))
        await cog.github_loop_error(Exception("Loop error"))

        assert cog.github_loop.minutes == cog._base_interval * 2
