import re
from typing import TYPE_CHECKING

import discord
import structlog
from discord import app_commands
from discord.ext import commands

from intelstream.services.github_service import GitHubAPIError, GitHubService

if TYPE_CHECKING:
    from intelstream.bot import IntelStreamBot

logger = structlog.get_logger()

GITHUB_URL_PATTERN = re.compile(
    r"^(?:https?://)?(?:www\.)?github\.com/([^/]+)/([^/]+?)(?:\.git)?/?$"
)
OWNER_REPO_PATTERN = re.compile(r"^([^/]+)/([^/]+)$")


def parse_github_url(url: str) -> tuple[str, str] | None:
    url = url.strip()

    match = GITHUB_URL_PATTERN.match(url)
    if match:
        return match.group(1).lower(), match.group(2).lower()

    match = OWNER_REPO_PATTERN.match(url)
    if match:
        return match.group(1).lower(), match.group(2).lower()

    return None


class GitHubCommands(commands.Cog):
    def __init__(self, bot: "IntelStreamBot") -> None:
        self.bot = bot
        self._github_service: GitHubService | None = None

    def _get_github_service(self) -> GitHubService | None:
        if not self.bot.settings.github_token:
            return None
        if self._github_service is None:
            self._github_service = GitHubService(token=self.bot.settings.github_token)
        return self._github_service

    async def cog_unload(self) -> None:
        if self._github_service:
            await self._github_service.close()

    github_group = app_commands.Group(name="github", description="Monitor GitHub repositories")

    @github_group.command(name="add", description="Monitor a GitHub repository in this channel")
    @app_commands.describe(
        repo_url="GitHub repository URL or owner/repo format",
        channel="Channel or thread for updates (defaults to current)",
    )
    async def github_add(
        self,
        interaction: discord.Interaction,
        repo_url: str,
        channel: discord.TextChannel | discord.Thread | None = None,
    ) -> None:
        await interaction.response.defer(ephemeral=True)

        service = self._get_github_service()
        if not service:
            await interaction.followup.send(
                "GitHub monitoring is not available. No GitHub token configured.",
                ephemeral=True,
            )
            return

        parsed = parse_github_url(repo_url)
        if not parsed:
            await interaction.followup.send(
                "Invalid GitHub URL. Use format: `https://github.com/owner/repo` or `owner/repo`",
                ephemeral=True,
            )
            return

        owner, repo = parsed
        target_channel = channel or interaction.channel
        if target_channel is None:
            await interaction.followup.send("Could not determine target channel.", ephemeral=True)
            return

        guild_id = str(interaction.guild_id) if interaction.guild_id else None
        if not guild_id:
            await interaction.followup.send(
                "This command can only be used in a server.", ephemeral=True
            )
            return

        existing = await self.bot.repository.get_github_repo(guild_id, owner, repo)
        if existing:
            await interaction.followup.send(
                f"Repository `{owner}/{repo}` is already being monitored in <#{existing.channel_id}>.",
                ephemeral=True,
            )
            return

        try:
            is_valid = await service.validate_repo(owner, repo)
            if not is_valid:
                await interaction.followup.send(
                    f"Repository `{owner}/{repo}` not found or is not accessible.",
                    ephemeral=True,
                )
                return
        except GitHubAPIError as e:
            await interaction.followup.send(
                f"Failed to validate repository: {e.message}",
                ephemeral=True,
            )
            return

        github_repo = await self.bot.repository.add_github_repo(
            guild_id=guild_id,
            channel_id=str(target_channel.id),
            owner=owner,
            repo=repo,
        )

        logger.info(
            "GitHub repo added",
            repo_id=github_repo.id,
            owner=owner,
            repo=repo,
            channel_id=target_channel.id,
            user_id=interaction.user.id,
        )

        embed = discord.Embed(
            title="GitHub Repository Added",
            color=discord.Color.green(),
        )
        embed.add_field(
            name="Repository",
            value=f"[{owner}/{repo}](https://github.com/{owner}/{repo})",
            inline=True,
        )
        embed.add_field(name="Channel", value=f"<#{target_channel.id}>", inline=True)
        embed.add_field(name="Tracking", value="Commits, PRs, Issues", inline=False)

        await interaction.followup.send(embed=embed, ephemeral=True)

    @github_group.command(name="list", description="List monitored GitHub repositories")
    @app_commands.describe(channel="Filter by channel (defaults to current)")
    async def github_list(
        self,
        interaction: discord.Interaction,
        channel: discord.TextChannel | discord.Thread | None = None,
    ) -> None:
        await interaction.response.defer()

        logger.debug(
            "github_list command invoked",
            user_id=interaction.user.id,
            guild_id=str(interaction.guild_id) if interaction.guild_id else None,
            channel_id=str(channel.id) if channel else None,
        )

        target_channel = channel or interaction.channel
        if target_channel is None:
            await interaction.followup.send("Could not determine target channel.")
            return

        repos = await self.bot.repository.get_github_repos_for_channel(str(target_channel.id))

        if not repos:
            await interaction.followup.send(
                f"No GitHub repositories are being monitored in <#{target_channel.id}>."
            )
            return

        channel_name = getattr(target_channel, "name", str(target_channel.id))
        embed = discord.Embed(
            title=f"GitHub Repositories in #{channel_name}",
            color=discord.Color.blue(),
        )

        for repo in repos:
            status = "Active" if repo.is_active else "Paused"
            if repo.consecutive_failures > 0:
                status = f"Failing ({repo.consecutive_failures} errors)"

            tracking = []
            if repo.track_commits:
                tracking.append("Commits")
            if repo.track_prs:
                tracking.append("PRs")
            if repo.track_issues:
                tracking.append("Issues")

            last_poll = (
                repo.last_polled_at.strftime("%Y-%m-%d %H:%M UTC")
                if repo.last_polled_at
                else "Never"
            )

            embed.add_field(
                name=f"{'[ON]' if repo.is_active else '[OFF]'} {repo.owner}/{repo.repo}",
                value=f"**Status:** {status}\n**Tracking:** {', '.join(tracking)}\n**Last Poll:** {last_poll}",
                inline=True,
            )

        await interaction.followup.send(embed=embed)

    @github_group.command(name="remove", description="Stop monitoring a GitHub repository")
    @app_commands.default_permissions(manage_guild=True)
    @app_commands.describe(repo="Repository name (owner/repo format)")
    async def github_remove(
        self,
        interaction: discord.Interaction,
        repo: str,
    ) -> None:
        await interaction.response.defer(ephemeral=True)

        parsed = parse_github_url(repo)
        if not parsed:
            await interaction.followup.send(
                "Invalid repository format. Use `owner/repo` format.",
                ephemeral=True,
            )
            return

        owner, repo_name = parsed

        guild_id = str(interaction.guild_id) if interaction.guild_id else None
        if not guild_id:
            await interaction.followup.send(
                "This command can only be used in a server.", ephemeral=True
            )
            return

        deleted = await self.bot.repository.delete_github_repo(guild_id, owner, repo_name)

        if deleted:
            logger.info(
                "GitHub repo removed",
                owner=owner,
                repo=repo_name,
                user_id=interaction.user.id,
            )
            await interaction.followup.send(
                f"Stopped monitoring `{owner}/{repo_name}`.", ephemeral=True
            )
        else:
            await interaction.followup.send(
                f"Repository `{owner}/{repo_name}` is not being monitored in this server.",
                ephemeral=True,
            )


async def setup(bot: "IntelStreamBot") -> None:
    await bot.add_cog(GitHubCommands(bot))
