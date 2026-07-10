import re
from typing import TYPE_CHECKING

import discord
import structlog
from discord import app_commands
from discord.ext import commands

from intelstream.config import reveal_secret
from intelstream.services.github_service import GitHubAPIError, GitHubService

if TYPE_CHECKING:
    from intelstream.bot import IntelStreamBot

logger = structlog.get_logger()

GITHUB_URL_PATTERN = re.compile(
    r"^(?:https?://)?(?:www\.)?github\.com/([^/]+)/([^/]+?)(?:\.git)?/?$"
)
OWNER_REPO_PATTERN = re.compile(r"^([^/]+)/([^/]+)$")
MAX_EMBED_FIELDS = 25
MAX_EMBED_FIELD_NAME_LENGTH = 256
MAX_EMBED_TOTAL_TEXT_LENGTH = 6000
MAX_EMBED_FOOTER_RESERVE = 100


def _truncate_embed_field_name(value: str) -> str:
    if len(value) <= MAX_EMBED_FIELD_NAME_LENGTH:
        return value
    return value[: MAX_EMBED_FIELD_NAME_LENGTH - 3] + "..."


def parse_github_url(url: str) -> tuple[str, str] | None:
    url = url.strip()

    match = GITHUB_URL_PATTERN.match(url)
    if match:
        return match.group(1).lower(), match.group(2).lower()

    match = OWNER_REPO_PATTERN.match(url)
    if match:
        return match.group(1).lower(), match.group(2).lower()

    return None


class ConfirmGitHubRemoveView(discord.ui.View):
    def __init__(self) -> None:
        super().__init__(timeout=30)
        self.confirmed: bool | None = None

    @discord.ui.button(label="Confirm", style=discord.ButtonStyle.danger)
    async def confirm(
        self,
        interaction: discord.Interaction,
        _button: discord.ui.Button["ConfirmGitHubRemoveView"],
    ) -> None:
        self.confirmed = True
        self.stop()
        await interaction.response.defer()

    @discord.ui.button(label="Cancel", style=discord.ButtonStyle.secondary)
    async def cancel(
        self,
        interaction: discord.Interaction,
        _button: discord.ui.Button["ConfirmGitHubRemoveView"],
    ) -> None:
        self.confirmed = False
        self.stop()
        await interaction.response.defer()


class GitHubCommands(commands.Cog):
    def __init__(self, bot: "IntelStreamBot") -> None:
        self.bot = bot
        self._github_service: GitHubService | None = None

    def _get_github_service(self) -> GitHubService | None:
        token = reveal_secret(self.bot.settings.github_token)
        if token is None:
            return None
        if self._github_service is None:
            self._github_service = GitHubService(token=token)
        return self._github_service

    async def cog_unload(self) -> None:
        if self._github_service:
            await self._github_service.close()

    async def _github_repo_autocomplete(
        self,
        interaction: discord.Interaction,
        current: str,
    ) -> list[app_commands.Choice[str]]:
        guild_id = str(interaction.guild_id) if interaction.guild_id else None
        if not guild_id:
            return []
        repos = await self.bot.repository.get_github_repos_for_guild(guild_id)
        return [
            app_commands.Choice(
                name=f"{'[ON]' if r.is_active else '[OFF]'} {r.owner}/{r.repo}",
                value=f"{r.owner}/{r.repo}",
            )
            for r in repos
            if current.lower() in f"{r.owner}/{r.repo}".lower()
        ][:25]

    github_group = app_commands.Group(name="github", description="Monitor GitHub repositories")

    @github_group.command(name="add", description="Monitor a GitHub repository in this channel")
    @app_commands.describe(
        repo_url="GitHub repository URL or owner/repo format",
        channel="Channel or thread for updates (defaults to current)",
        track_commits="Track new commits (default: True)",
        track_prs="Track pull requests (default: True)",
        track_issues="Track issues (default: True)",
    )
    @app_commands.default_permissions(manage_guild=True)
    @app_commands.checks.has_permissions(manage_guild=True)
    async def github_add(
        self,
        interaction: discord.Interaction,
        repo_url: str,
        channel: discord.TextChannel | discord.Thread | None = None,
        track_commits: bool = True,
        track_prs: bool = True,
        track_issues: bool = True,
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
            track_commits=track_commits,
            track_prs=track_prs,
            track_issues=track_issues,
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
        tracking = []
        if track_commits:
            tracking.append("Commits")
        if track_prs:
            tracking.append("PRs")
        if track_issues:
            tracking.append("Issues")
        embed.add_field(name="Tracking", value=", ".join(tracking) or "None", inline=False)

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

        displayed_repos = []
        embed_text_length = len(embed.title or "")
        for repo in repos[:MAX_EMBED_FIELDS]:
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

            field_name = _truncate_embed_field_name(
                f"{'[ON]' if repo.is_active else '[OFF]'} {repo.owner}/{repo.repo}"
            )
            field_value = (
                f"**Status:** {status}\n**Tracking:** {', '.join(tracking)}\n"
                f"**Last Poll:** {last_poll}"
            )
            if (
                embed_text_length + len(field_name) + len(field_value)
                > MAX_EMBED_TOTAL_TEXT_LENGTH - MAX_EMBED_FOOTER_RESERVE
            ):
                break
            embed.add_field(name=field_name, value=field_value, inline=True)
            displayed_repos.append(repo)
            embed_text_length += len(field_name) + len(field_value)

        embed.set_footer(text=f"Showing {len(displayed_repos)} of {len(repos)} repositories")

        await interaction.followup.send(embed=embed)

    @github_group.command(name="remove", description="Stop monitoring a GitHub repository")
    @app_commands.default_permissions(manage_guild=True)
    @app_commands.checks.has_permissions(manage_guild=True)
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

        github_repo = await self.bot.repository.get_github_repo(guild_id, owner, repo_name)
        if not github_repo:
            await interaction.followup.send(
                f"Repository `{owner}/{repo_name}` is not being monitored in this server.",
                ephemeral=True,
            )
            return

        tracking = []
        if github_repo.track_commits:
            tracking.append("Commits")
        if github_repo.track_prs:
            tracking.append("PRs")
        if github_repo.track_issues:
            tracking.append("Issues")

        embed = discord.Embed(
            title="Confirm Repository Removal",
            description=f"Are you sure you want to stop monitoring **{owner}/{repo_name}**?",
            color=discord.Color.red(),
        )
        embed.add_field(name="Channel", value=f"<#{github_repo.channel_id}>", inline=True)
        embed.add_field(
            name="Status", value="Active" if github_repo.is_active else "Paused", inline=True
        )
        embed.add_field(name="Tracking", value=", ".join(tracking) or "None", inline=True)

        view = ConfirmGitHubRemoveView()
        await interaction.followup.send(embed=embed, view=view, ephemeral=True)
        timed_out = await view.wait()

        if timed_out or not view.confirmed:
            await interaction.edit_original_response(
                content="Repository removal cancelled.", embed=None, view=None
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
            await interaction.edit_original_response(
                content=f"Stopped monitoring `{owner}/{repo_name}`.", embed=None, view=None
            )
        else:
            await interaction.edit_original_response(
                content=f"Repository `{owner}/{repo_name}` was already removed.",
                embed=None,
                view=None,
            )

    @github_remove.autocomplete("repo")
    async def github_remove_autocomplete(
        self, interaction: discord.Interaction, current: str
    ) -> list[app_commands.Choice[str]]:
        return await self._github_repo_autocomplete(interaction, current)

    @github_group.command(
        name="toggle",
        description="Pause or resume GitHub repository monitoring",
    )
    @app_commands.default_permissions(manage_guild=True)
    @app_commands.checks.has_permissions(manage_guild=True)
    @app_commands.describe(repo="Repository name (owner/repo format)")
    async def github_toggle(
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

        github_repo = await self.bot.repository.get_github_repo(guild_id, owner, repo_name)
        if not github_repo:
            await interaction.followup.send(
                f"Repository `{owner}/{repo_name}` is not being monitored in this server.",
                ephemeral=True,
            )
            return

        new_state = not github_repo.is_active
        await self.bot.repository.set_github_repo_active(github_repo.id, new_state)

        status = "enabled" if new_state else "disabled"
        logger.info(
            "GitHub repo toggled",
            owner=owner,
            repo=repo_name,
            is_active=new_state,
            user_id=interaction.user.id,
        )
        await interaction.followup.send(
            f"Monitoring for `{owner}/{repo_name}` has been {status}.", ephemeral=True
        )

    @github_toggle.autocomplete("repo")
    async def github_toggle_autocomplete(
        self, interaction: discord.Interaction, current: str
    ) -> list[app_commands.Choice[str]]:
        return await self._github_repo_autocomplete(interaction, current)

    @github_add.error
    async def github_add_error(
        self, interaction: discord.Interaction, error: app_commands.AppCommandError
    ) -> None:
        if isinstance(error, app_commands.MissingPermissions):
            await interaction.response.send_message(
                "You need Manage Server permission to add GitHub repositories.",
                ephemeral=True,
            )
        else:
            raise error

    @github_remove.error
    async def github_remove_error(
        self, interaction: discord.Interaction, error: app_commands.AppCommandError
    ) -> None:
        if isinstance(error, app_commands.MissingPermissions):
            await interaction.response.send_message(
                "You need Manage Server permission to remove GitHub repositories.",
                ephemeral=True,
            )
        else:
            raise error

    @github_toggle.error
    async def github_toggle_error(
        self, interaction: discord.Interaction, error: app_commands.AppCommandError
    ) -> None:
        if isinstance(error, app_commands.MissingPermissions):
            await interaction.response.send_message(
                "You need Manage Server permission to toggle GitHub repositories.",
                ephemeral=True,
            )
        else:
            raise error


async def setup(bot: "IntelStreamBot") -> None:
    await bot.add_cog(GitHubCommands(bot))
