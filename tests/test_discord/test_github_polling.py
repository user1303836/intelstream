from datetime import UTC, datetime
from unittest.mock import AsyncMock, MagicMock, patch

import discord
import pytest

from intelstream.discord.cogs.github_polling import GitHubPolling
from intelstream.services.github_service import GitHubAPIError, GitHubEvent


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


def _make_repo(
    *,
    first_poll: bool = False,
    track_commits: bool = True,
    track_prs: bool = True,
    track_issues: bool = True,
) -> MagicMock:
    repo = MagicMock()
    repo.id = 42
    repo.owner = "org"
    repo.repo = "repo"
    repo.channel_id = "987"
    repo.track_commits = track_commits
    repo.track_prs = track_prs
    repo.track_issues = track_issues
    repo.last_commit_sha = None if first_poll else "old-sha"
    repo.last_pr_number = None if first_poll else 1
    repo.last_issue_number = None if first_poll else 2
    return repo


def _make_event(
    event_type: str,
    *,
    sha: str | None = None,
    number: int | None = None,
) -> GitHubEvent:
    return GitHubEvent(
        event_type=event_type,
        repo_full_name="org/repo",
        number=number,
        sha=sha,
        title="Title",
        description=None,
        author="octocat",
        author_avatar_url="https://example.com/avatar.png",
        url="https://github.com/org/repo",
        created_at=datetime(2026, 5, 25, tzinfo=UTC),
        state="open",
    )


def _make_text_channel() -> MagicMock:
    channel = MagicMock(spec=discord.TextChannel)
    channel.id = 987
    return channel


class TestGitHubPollingInit:
    def test_init_sets_consecutive_failures_to_zero(self, mock_bot):
        cog = GitHubPolling(mock_bot)
        assert cog._consecutive_failures == 0

    def test_class_has_max_backoff_multiplier(self):
        assert GitHubPolling.MAX_BACKOFF_MULTIPLIER == 4

    async def test_cog_load_noops_without_token(self, mock_bot):
        mock_bot.settings.github_token = None
        cog = GitHubPolling(mock_bot)

        await cog.cog_load()

        assert cog._initialized is False
        assert cog._service is None
        assert cog._poster is None

    async def test_cog_load_initializes_service_poster_and_loop(self, mock_bot):
        cog = GitHubPolling(mock_bot)

        with (
            patch("intelstream.discord.cogs.github_polling.httpx.AsyncClient") as client_cls,
            patch("intelstream.discord.cogs.github_polling.GitHubService") as service_cls,
            patch("intelstream.discord.cogs.github_polling.GitHubPoster") as poster_cls,
            patch.object(cog.github_loop, "start") as start,
        ):
            await cog.cog_load()

        client_cls.assert_called_once_with(timeout=30.0)
        service_cls.assert_called_once_with(
            token="test-github-token",
            http_client=client_cls.return_value,
        )
        poster_cls.assert_called_once_with()
        start.assert_called_once_with()
        assert cog._initialized is True
        assert cog._base_interval == 5

    async def test_cog_unload_cancels_loop_and_closes_resources(self, mock_bot):
        cog = GitHubPolling(mock_bot)
        service = MagicMock()
        service.close = AsyncMock()
        http_client = MagicMock()
        http_client.aclose = AsyncMock()
        cog._service = service
        cog._http_client = http_client
        cog._initialized = True

        with patch.object(cog.github_loop, "cancel") as cancel:
            await cog.cog_unload()

        cancel.assert_called_once_with()
        service.close.assert_awaited_once()
        http_client.aclose.assert_awaited_once()
        assert cog._initialized is False


class TestGitHubLoopBackoff:
    async def test_loop_returns_when_not_initialized(self, mock_bot):
        cog = GitHubPolling(mock_bot)

        await cog.github_loop()

        mock_bot.repository.get_all_github_repos.assert_not_awaited()

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

    async def test_loop_processes_successes_and_failures(self, mock_bot):
        repo_ok = _make_repo()
        repo_failed = _make_repo()
        repo_failed.id = 43
        repo_failed.repo = "broken"
        mock_bot.repository.get_all_github_repos = AsyncMock(return_value=[repo_ok, repo_failed])
        cog = _make_cog(mock_bot)
        cog._process_repo = AsyncMock(side_effect=[2, RuntimeError("boom")])
        cog._handle_failure = AsyncMock()

        await cog.github_loop()

        assert cog._process_repo.await_count == 2
        cog._handle_failure.assert_awaited_once()
        assert cog._handle_failure.await_args.args[0] is repo_failed
        assert isinstance(cog._handle_failure.await_args.args[1], RuntimeError)
        assert cog._consecutive_failures == 0


class TestGitHubLoopErrorHandler:
    async def test_before_loop_waits_for_bot_ready(self, mock_bot):
        cog = _make_cog(mock_bot)

        await cog.before_github_loop()

        mock_bot.wait_until_ready.assert_awaited_once()

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


class TestProcessRepo:
    async def test_returns_zero_when_service_or_poster_missing(self, mock_bot):
        cog = _make_cog(mock_bot)
        cog._service = None

        posted = await cog._process_repo(_make_repo())

        assert posted == 0

    async def test_first_poll_updates_state_without_posting_events(self, mock_bot):
        cog = _make_cog(mock_bot)
        repo = _make_repo(first_poll=True)
        commit = _make_event("commit", sha="new-sha")
        pr = _make_event("pull_request", number=7)
        issue = _make_event("issue", number=9)
        cog._service.fetch_new_commits = AsyncMock(return_value=[commit])
        cog._service.fetch_new_prs = AsyncMock(return_value=[pr])
        cog._service.fetch_new_issues = AsyncMock(return_value=[issue])
        cog._poster.post_events = AsyncMock()
        mock_bot.repository.update_github_repo_state = AsyncMock()
        mock_bot.repository.reset_github_failure = AsyncMock()

        posted = await cog._process_repo(repo)

        assert posted == 0
        cog._poster.post_events.assert_not_awaited()
        mock_bot.repository.update_github_repo_state.assert_awaited_once_with(
            42,
            last_commit_sha="new-sha",
            last_pr_number=7,
            last_issue_number=9,
        )
        mock_bot.repository.reset_github_failure.assert_awaited_once_with(42)

    async def test_subsequent_poll_posts_events_to_target_channel(self, mock_bot):
        cog = _make_cog(mock_bot)
        repo = _make_repo()
        commit = _make_event("commit", sha="new-sha")
        pr_low = _make_event("pull_request", number=3)
        pr_high = _make_event("pull_request", number=8)
        issue = _make_event("issue", number=6)
        cog._service.fetch_new_commits = AsyncMock(return_value=[commit])
        cog._service.fetch_new_prs = AsyncMock(return_value=[pr_low, pr_high])
        cog._service.fetch_new_issues = AsyncMock(return_value=[issue])
        cog._poster.post_events = AsyncMock()
        channel = _make_text_channel()
        mock_bot.get_channel = MagicMock(return_value=channel)
        mock_bot.repository.update_github_repo_state = AsyncMock()
        mock_bot.repository.reset_github_failure = AsyncMock()

        posted = await cog._process_repo(repo)

        assert posted == 4
        cog._poster.post_events.assert_awaited_once()
        assert cog._poster.post_events.await_args.args[0] is channel
        mock_bot.repository.update_github_repo_state.assert_awaited_once_with(
            42,
            last_commit_sha="new-sha",
            last_pr_number=8,
            last_issue_number=6,
        )

    async def test_process_repo_tolerates_partial_github_api_errors(self, mock_bot):
        cog = _make_cog(mock_bot)
        repo = _make_repo()
        pr = _make_event("pull_request", number=5)
        cog._service.fetch_new_commits = AsyncMock(side_effect=GitHubAPIError(500, "commit error"))
        cog._service.fetch_new_prs = AsyncMock(return_value=[pr])
        cog._service.fetch_new_issues = AsyncMock(side_effect=GitHubAPIError(500, "issue error"))
        cog._poster.post_events = AsyncMock()
        mock_bot.get_channel = MagicMock(return_value=_make_text_channel())
        mock_bot.repository.update_github_repo_state = AsyncMock()
        mock_bot.repository.reset_github_failure = AsyncMock()

        posted = await cog._process_repo(repo)

        assert posted == 1
        mock_bot.repository.update_github_repo_state.assert_awaited_once_with(
            42,
            last_commit_sha=None,
            last_pr_number=5,
            last_issue_number=None,
        )
        mock_bot.repository.reset_github_failure.assert_awaited_once_with(42)

    async def test_process_repo_tolerates_pr_github_api_error(self, mock_bot):
        cog = _make_cog(mock_bot)
        repo = _make_repo()
        commit = _make_event("commit", sha="new-sha")
        issue = _make_event("issue", number=11)
        cog._service.fetch_new_commits = AsyncMock(return_value=[commit])
        cog._service.fetch_new_prs = AsyncMock(side_effect=GitHubAPIError(500, "pr error"))
        cog._service.fetch_new_issues = AsyncMock(return_value=[issue])
        cog._poster.post_events = AsyncMock()
        mock_bot.get_channel = MagicMock(return_value=_make_text_channel())
        mock_bot.repository.update_github_repo_state = AsyncMock()
        mock_bot.repository.reset_github_failure = AsyncMock()

        posted = await cog._process_repo(repo)

        assert posted == 2
        mock_bot.repository.update_github_repo_state.assert_awaited_once_with(
            42,
            last_commit_sha="new-sha",
            last_pr_number=None,
            last_issue_number=11,
        )

    async def test_process_repo_posts_to_thread_channel(self, mock_bot):
        cog = _make_cog(mock_bot)
        repo = _make_repo()
        commit = _make_event("commit", sha="new-sha")
        cog._service.fetch_new_commits = AsyncMock(return_value=[commit])
        cog._service.fetch_new_prs = AsyncMock(return_value=[])
        cog._service.fetch_new_issues = AsyncMock(return_value=[])
        cog._poster.post_events = AsyncMock()
        thread = MagicMock(spec=discord.Thread)
        mock_bot.get_channel = MagicMock(return_value=thread)
        mock_bot.repository.update_github_repo_state = AsyncMock()
        mock_bot.repository.reset_github_failure = AsyncMock()

        posted = await cog._process_repo(repo)

        assert posted == 1
        cog._poster.post_events.assert_awaited_once_with(thread, [commit])

    async def test_process_repo_updates_none_for_events_without_identifiers(self, mock_bot):
        cog = _make_cog(mock_bot)
        repo = _make_repo()
        commit_without_sha = _make_event("commit")
        pr_without_number = _make_event("pull_request")
        issue_without_number = _make_event("issue")
        cog._service.fetch_new_commits = AsyncMock(return_value=[commit_without_sha])
        cog._service.fetch_new_prs = AsyncMock(return_value=[pr_without_number])
        cog._service.fetch_new_issues = AsyncMock(return_value=[issue_without_number])
        cog._poster.post_events = AsyncMock()
        mock_bot.get_channel = MagicMock(return_value=_make_text_channel())
        mock_bot.repository.update_github_repo_state = AsyncMock()
        mock_bot.repository.reset_github_failure = AsyncMock()

        posted = await cog._process_repo(repo)

        assert posted == 3
        mock_bot.repository.update_github_repo_state.assert_awaited_once_with(
            42,
            last_commit_sha=None,
            last_pr_number=None,
            last_issue_number=None,
        )

    async def test_process_repo_skips_post_when_channel_missing(self, mock_bot):
        cog = _make_cog(mock_bot)
        repo = _make_repo()
        commit = _make_event("commit", sha="new-sha")
        cog._service.fetch_new_commits = AsyncMock(return_value=[commit])
        cog._service.fetch_new_prs = AsyncMock(return_value=[])
        cog._service.fetch_new_issues = AsyncMock(return_value=[])
        cog._poster.post_events = AsyncMock()
        mock_bot.get_channel = MagicMock(return_value=None)
        mock_bot.repository.update_github_repo_state = AsyncMock()
        mock_bot.repository.reset_github_failure = AsyncMock()

        posted = await cog._process_repo(repo)

        assert posted == 1
        cog._poster.post_events.assert_not_awaited()
        mock_bot.repository.reset_github_failure.assert_awaited_once_with(42)

    async def test_process_repo_respects_tracking_flags(self, mock_bot):
        cog = _make_cog(mock_bot)
        repo = _make_repo(track_commits=False, track_prs=True, track_issues=False)
        cog._service.fetch_new_commits = AsyncMock(return_value=[])
        cog._service.fetch_new_prs = AsyncMock(return_value=[])
        cog._service.fetch_new_issues = AsyncMock(return_value=[])
        mock_bot.repository.update_github_repo_state = AsyncMock()
        mock_bot.repository.reset_github_failure = AsyncMock()

        posted = await cog._process_repo(repo)

        assert posted == 0
        cog._service.fetch_new_commits.assert_not_called()
        cog._service.fetch_new_prs.assert_awaited_once_with("org", "repo", 1)
        cog._service.fetch_new_issues.assert_not_called()


class TestHandleFailure:
    async def test_handle_failure_only_increments_below_disable_threshold(self, mock_bot):
        cog = _make_cog(mock_bot)
        repo = _make_repo()
        mock_bot.repository.increment_github_failure = AsyncMock(return_value=4)
        mock_bot.repository.set_github_repo_active = AsyncMock()

        await cog._handle_failure(repo, RuntimeError("boom"))

        mock_bot.repository.increment_github_failure.assert_awaited_once_with(42)
        mock_bot.repository.set_github_repo_active.assert_not_awaited()
        mock_bot.notify_owner.assert_not_awaited()

    async def test_handle_failure_disables_repo_at_threshold(self, mock_bot):
        cog = _make_cog(mock_bot)
        repo = _make_repo()
        mock_bot.repository.increment_github_failure = AsyncMock(return_value=5)
        mock_bot.repository.set_github_repo_active = AsyncMock()

        await cog._handle_failure(repo, RuntimeError("boom"))

        mock_bot.repository.set_github_repo_active.assert_awaited_once_with(42, False)
        mock_bot.notify_owner.assert_awaited_once()
        assert "disabled after 5 consecutive failures" in mock_bot.notify_owner.await_args.args[0]


async def test_setup_adds_github_polling_cog(mock_bot):
    from intelstream.discord.cogs.github_polling import setup

    mock_bot.add_cog = AsyncMock()

    await setup(mock_bot)

    mock_bot.add_cog.assert_awaited_once()
    assert isinstance(mock_bot.add_cog.await_args.args[0], GitHubPolling)
