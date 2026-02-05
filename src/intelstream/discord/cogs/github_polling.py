from typing import TYPE_CHECKING

import discord
import httpx
import structlog
from discord.ext import commands, tasks

from intelstream.database.models import GitHubRepo
from intelstream.services.github_poster import GitHubPoster
from intelstream.services.github_service import GitHubAPIError, GitHubEvent, GitHubService

if TYPE_CHECKING:
    from intelstream.bot import IntelStreamBot

logger = structlog.get_logger()


class GitHubPolling(commands.Cog):
    MAX_CONSECUTIVE_FAILURES = 5
    MAX_BACKOFF_MULTIPLIER = 4

    def __init__(self, bot: "IntelStreamBot") -> None:
        self.bot = bot
        self._service: GitHubService | None = None
        self._poster: GitHubPoster | None = None
        self._http_client: httpx.AsyncClient | None = None
        self._initialized = False
        self._consecutive_failures = 0
        self._base_interval: int = 5

    async def cog_load(self) -> None:
        if not self.bot.settings.github_token:
            logger.info("GitHub token not configured, polling disabled")
            return

        self._http_client = httpx.AsyncClient(timeout=30.0)
        self._service = GitHubService(
            token=self.bot.settings.github_token,
            http_client=self._http_client,
        )
        self._poster = GitHubPoster()
        self._initialized = True

        self._base_interval = self.bot.settings.github_poll_interval_minutes
        self.github_loop.change_interval(minutes=self._base_interval)
        self.github_loop.start()

        logger.info(
            "GitHub polling cog loaded",
            poll_interval=self._base_interval,
        )

    async def cog_unload(self) -> None:
        self.github_loop.cancel()

        if self._service:
            await self._service.close()

        if self._http_client:
            await self._http_client.aclose()

        self._initialized = False
        logger.info("GitHub polling cog unloaded")

    # Interval placeholder; actual value set via change_interval() in cog_load
    @tasks.loop(minutes=5)
    async def github_loop(self) -> None:
        if not self._initialized or not self._service or not self._poster:
            return

        if self._consecutive_failures == self.MAX_CONSECUTIVE_FAILURES:
            logger.error(
                "GitHub polling loop circuit breaker triggered, will retry hourly",
                consecutive_failures=self._consecutive_failures,
            )
            await self.bot.notify_owner(
                f"GitHub polling loop hit {self.MAX_CONSECUTIVE_FAILURES} consecutive failures. "
                "Switching to hourly retries until recovered."
            )
            self._consecutive_failures += 1
            self.github_loop.change_interval(minutes=60)

        try:
            repos = await self.bot.repository.get_all_github_repos(active_only=True)

            repos_polled = 0
            repos_failed = 0
            total_events = 0

            for repo in repos:
                try:
                    events_posted = await self._process_repo(repo)
                    repos_polled += 1
                    total_events += events_posted
                except Exception as e:
                    logger.error(
                        "Error processing GitHub repo",
                        owner=repo.owner,
                        repo=repo.repo,
                        error=str(e),
                    )
                    await self._handle_failure(repo, e)
                    repos_failed += 1

            if repos:
                logger.info(
                    "GitHub cycle complete",
                    repos_polled=repos_polled,
                    repos_failed=repos_failed,
                    events_posted=total_events,
                )

            self._reset_backoff()

        except Exception as e:
            self._consecutive_failures += 1
            logger.error(
                "GitHub polling loop error",
                error=str(e),
                consecutive_failures=self._consecutive_failures,
            )

            if self._consecutive_failures == 1:
                await self.bot.notify_owner(f"GitHub polling loop error: {e}")

            self._apply_backoff()

    @github_loop.before_loop
    async def before_github_loop(self) -> None:
        await self.bot.wait_until_ready()
        logger.info("GitHub polling loop ready to start")

    @github_loop.error  # type: ignore[type-var]
    async def github_loop_error(self, error: Exception) -> None:
        self._consecutive_failures += 1
        logger.error(
            "GitHub polling loop encountered an error",
            error=str(error),
            consecutive_failures=self._consecutive_failures,
        )

        if self._consecutive_failures == 1:
            await self.bot.notify_owner(f"GitHub polling loop error: {error}")

        self._apply_backoff()

    def _apply_backoff(self) -> None:
        if self._consecutive_failures > self.MAX_CONSECUTIVE_FAILURES:
            return
        multiplier = min(2 ** (self._consecutive_failures - 1), self.MAX_BACKOFF_MULTIPLIER)
        new_interval = self._base_interval * multiplier
        self.github_loop.change_interval(minutes=new_interval)
        logger.info(
            "Applied backoff to GitHub polling loop",
            new_interval_minutes=new_interval,
            consecutive_failures=self._consecutive_failures,
        )

    def _reset_backoff(self) -> None:
        if self._consecutive_failures > 0:
            self._consecutive_failures = 0
            self.github_loop.change_interval(minutes=self._base_interval)
            logger.info("GitHub polling loop backoff reset")

    async def _process_repo(self, repo: GitHubRepo) -> int:
        if not self._service or not self._poster:
            return 0

        is_first_poll = (
            repo.last_commit_sha is None
            and repo.last_pr_number is None
            and repo.last_issue_number is None
        )

        events: list[GitHubEvent] = []

        if repo.track_commits:
            try:
                commits = await self._service.fetch_new_commits(
                    repo.owner, repo.repo, repo.last_commit_sha
                )
                events.extend(commits)
            except GitHubAPIError as e:
                logger.warning(
                    "Failed to fetch commits",
                    owner=repo.owner,
                    repo=repo.repo,
                    error=e.message,
                )

        if repo.track_prs:
            try:
                prs = await self._service.fetch_new_prs(repo.owner, repo.repo, repo.last_pr_number)
                events.extend(prs)
            except GitHubAPIError as e:
                logger.warning(
                    "Failed to fetch PRs",
                    owner=repo.owner,
                    repo=repo.repo,
                    error=e.message,
                )

        if repo.track_issues:
            try:
                issues = await self._service.fetch_new_issues(
                    repo.owner, repo.repo, repo.last_issue_number
                )
                events.extend(issues)
            except GitHubAPIError as e:
                logger.warning(
                    "Failed to fetch issues",
                    owner=repo.owner,
                    repo=repo.repo,
                    error=e.message,
                )

        if events and not is_first_poll:
            channel = self.bot.get_channel(int(repo.channel_id))
            if channel and isinstance(channel, (discord.TextChannel, discord.Thread)):
                await self._poster.post_events(channel, events)
                logger.info(
                    "Posted GitHub events",
                    owner=repo.owner,
                    repo=repo.repo,
                    event_count=len(events),
                )
            else:
                logger.warning(
                    "Channel not found for GitHub repo",
                    channel_id=repo.channel_id,
                    owner=repo.owner,
                    repo=repo.repo,
                )
        elif is_first_poll:
            logger.info(
                "First poll - initialized state without posting",
                owner=repo.owner,
                repo=repo.repo,
                event_count=len(events),
            )

        new_commit_sha = None
        new_pr_number = None
        new_issue_number = None

        for event in events:
            if event.event_type == "commit" and event.sha and new_commit_sha is None:
                new_commit_sha = event.sha
            elif event.event_type == "pull_request" and event.number:
                if new_pr_number is None or event.number > new_pr_number:
                    new_pr_number = event.number
            elif (
                event.event_type == "issue"
                and event.number
                and (new_issue_number is None or event.number > new_issue_number)
            ):
                new_issue_number = event.number

        await self.bot.repository.update_github_repo_state(
            repo.id,
            last_commit_sha=new_commit_sha,
            last_pr_number=new_pr_number,
            last_issue_number=new_issue_number,
        )

        await self.bot.repository.reset_github_failure(repo.id)

        posted_count = len(events) if events and not is_first_poll else 0
        return posted_count

    async def _handle_failure(self, repo: GitHubRepo, error: Exception) -> None:
        failure_count = await self.bot.repository.increment_github_failure(repo.id)

        if failure_count >= self.MAX_CONSECUTIVE_FAILURES:
            await self.bot.repository.set_github_repo_active(repo.id, False)
            logger.warning(
                "GitHub repo disabled due to consecutive failures",
                owner=repo.owner,
                repo=repo.repo,
                failures=failure_count,
            )
            await self.bot.notify_owner(
                f"GitHub repo `{repo.owner}/{repo.repo}` disabled after "
                f"{failure_count} consecutive failures: {error}"
            )


async def setup(bot: "IntelStreamBot") -> None:
    await bot.add_cog(GitHubPolling(bot))
