import json
import re
from typing import TYPE_CHECKING
from urllib.parse import urlparse

import anthropic
import discord
import structlog
from discord import app_commands
from discord.ext import commands

from intelstream.adapters.smart_blog import SmartBlogAdapter
from intelstream.database.exceptions import (
    DatabaseConnectionError,
    DuplicateSourceError,
    SourceNotFoundError,
)
from intelstream.database.models import PauseReason, SourceType
from intelstream.services.page_analyzer import PageAnalysisError, PageAnalyzer
from intelstream.utils.url_validation import is_safe_url

if TYPE_CHECKING:
    from intelstream.bot import IntelStreamBot

logger = structlog.get_logger()


_TWITTER_USERNAME_RE = re.compile(r"^[A-Za-z0-9_]{1,15}$")


def _is_valid_twitter_username(username: str) -> bool:
    return _TWITTER_USERNAME_RE.match(username) is not None


class InvalidSourceURLError(ValueError):
    pass


def parse_source_identifier(source_type: SourceType, url: str) -> tuple[str, str | None]:
    parsed = urlparse(url)

    if source_type == SourceType.SUBSTACK:
        host = parsed.netloc.lower()
        if host.endswith(".substack.com"):
            identifier = host.replace(".substack.com", "")
            if not identifier or identifier == "www":
                raise InvalidSourceURLError(
                    f"Invalid Substack URL: {url}. Expected format: https://name.substack.com"
                )
            feed_url = f"https://{host}/feed"
            return identifier, feed_url
        if not host:
            raise InvalidSourceURLError(f"Invalid Substack URL: {url}. No host found.")
        identifier = host
        feed_url = f"https://{host}/feed"
        return identifier, feed_url

    elif source_type == SourceType.YOUTUBE:
        if "youtube.com" in parsed.netloc:
            path = parsed.path
            if path.startswith("/@"):
                identifier = path[2:]
            elif path.startswith("/channel/"):
                identifier = path.split("/channel/")[1].split("/")[0]
            elif path.startswith("/c/"):
                identifier = path.split("/c/")[1].split("/")[0]
            else:
                identifier = path.strip("/")
            if not identifier:
                raise InvalidSourceURLError(
                    f"Invalid YouTube URL: {url}. Could not extract channel identifier."
                )
            return identifier, None
        raise InvalidSourceURLError(f"Invalid YouTube URL: {url}. Expected youtube.com domain.")

    elif source_type == SourceType.RSS:
        if not parsed.netloc:
            raise InvalidSourceURLError(f"Invalid RSS URL: {url}. No host found.")
        identifier = parsed.netloc + parsed.path
        return identifier, url

    elif source_type == SourceType.PAGE:
        if not parsed.netloc:
            raise InvalidSourceURLError(f"Invalid page URL: {url}. No host found.")
        identifier = parsed.netloc + parsed.path.rstrip("/")
        return identifier, url

    elif source_type == SourceType.ARXIV:
        identifier = url.strip()
        if not identifier:
            raise InvalidSourceURLError("Arxiv category cannot be empty.")
        feed_url = f"https://arxiv.org/rss/{identifier}"
        return identifier, feed_url

    elif source_type == SourceType.BLOG:
        if not parsed.netloc:
            raise InvalidSourceURLError(f"Invalid blog URL: {url}. No host found.")
        identifier = parsed.netloc + parsed.path.rstrip("/")
        return identifier, None

    elif source_type == SourceType.TWITTER:
        host = parsed.netloc.lower()
        if host in ("twitter.com", "www.twitter.com", "x.com", "www.x.com"):
            path = parsed.path.strip("/")
            username = path.split("/")[0] if path else ""
            if not username or not _is_valid_twitter_username(username):
                raise InvalidSourceURLError(
                    f"Invalid Twitter URL: {url}. Could not extract a valid username."
                )
            return username.lower(), None
        raise InvalidSourceURLError(
            f"Invalid Twitter URL: {url}. Expected twitter.com or x.com domain."
        )

    return url, None


class SourceManagement(commands.Cog):
    def __init__(self, bot: "IntelStreamBot") -> None:
        self.bot = bot
        self._anthropic_client: anthropic.AsyncAnthropic | None = None

    def _get_anthropic_client(self) -> anthropic.AsyncAnthropic:
        if self._anthropic_client is None:
            self._anthropic_client = anthropic.AsyncAnthropic(
                api_key=self.bot.settings.anthropic_api_key
            )
        return self._anthropic_client

    source_group = app_commands.Group(name="source", description="Manage content sources")

    @source_group.command(name="add", description="Add a new content source")
    @app_commands.describe(
        source_type="Type of source to add",
        name="Display name for this source",
        url="URL of the source (Substack, YouTube, RSS, Twitter/X account, or blog page)",
        summarize="Whether to summarize content before posting (default: True)",
    )
    @app_commands.choices(
        source_type=[
            app_commands.Choice(name="Substack", value="substack"),
            app_commands.Choice(name="YouTube", value="youtube"),
            app_commands.Choice(name="RSS", value="rss"),
            app_commands.Choice(name="Page", value="page"),
            app_commands.Choice(name="Arxiv", value="arxiv"),
            app_commands.Choice(name="Blog", value="blog"),
            app_commands.Choice(name="Twitter", value="twitter"),
        ]
    )
    @app_commands.default_permissions(manage_guild=True)
    async def source_add(
        self,
        interaction: discord.Interaction,
        source_type: app_commands.Choice[str],
        name: str,
        url: str,
        summarize: bool = True,
    ) -> None:
        await interaction.response.defer(ephemeral=True)

        logger.info(
            "source_add command invoked",
            user_id=interaction.user.id,
            guild_id=str(interaction.guild_id) if interaction.guild_id else None,
            source_type=source_type.value,
            name=name,
            url=url,
        )

        try:
            stype = SourceType(source_type.value)
        except ValueError:
            await interaction.followup.send(
                f"Invalid source type: {source_type.value}", ephemeral=True
            )
            return

        if stype == SourceType.YOUTUBE and not self.bot.settings.youtube_api_key:
            await interaction.followup.send(
                "YouTube sources are not available. No YouTube API key configured.",
                ephemeral=True,
            )
            return

        if stype == SourceType.PAGE and not self.bot.settings.anthropic_api_key:
            await interaction.followup.send(
                "Page sources are not available. No Anthropic API key configured.",
                ephemeral=True,
            )
            return

        if stype == SourceType.BLOG and not self.bot.settings.anthropic_api_key:
            await interaction.followup.send(
                "Blog sources are not available. No Anthropic API key configured.",
                ephemeral=True,
            )
            return

        if stype == SourceType.TWITTER and not self.bot.settings.twitter_bearer_token:
            await interaction.followup.send(
                "Twitter sources are not available. No Twitter Bearer Token configured.",
                ephemeral=True,
            )
            return

        safe, error_msg = is_safe_url(url)
        if not safe:
            await interaction.followup.send(f"URL not allowed: {error_msg}", ephemeral=True)
            return

        discovery_strategy: str | None = None
        discovered_feed_url: str | None = None
        discovered_url_pattern: str | None = None

        if stype == SourceType.BLOG:
            adapter = SmartBlogAdapter(
                anthropic_client=self._get_anthropic_client(),
                repository=self.bot.repository,
            )
            result = await adapter.analyze_site(url)
            if not result.success:
                await interaction.followup.send(
                    f"Failed to analyze blog: {result.error}",
                    ephemeral=True,
                )
                return
            discovery_strategy = result.strategy
            discovered_feed_url = result.feed_url
            discovered_url_pattern = result.url_pattern
            logger.info(
                "Blog analysis complete",
                url=url,
                strategy=result.strategy,
                post_count=result.post_count,
            )

        extraction_profile_json: str | None = None
        if stype == SourceType.PAGE:
            try:
                analyzer = PageAnalyzer(api_key=self.bot.settings.anthropic_api_key)
                profile = await analyzer.analyze(url)
                extraction_profile_json = json.dumps(profile.to_dict())
            except PageAnalysisError as e:
                await interaction.followup.send(
                    f"Failed to analyze page structure: {e}",
                    ephemeral=True,
                )
                return

        try:
            identifier, feed_url = parse_source_identifier(stype, url)
        except InvalidSourceURLError as e:
            await interaction.followup.send(str(e), ephemeral=True)
            return

        existing = await self.bot.repository.get_source_by_identifier(identifier)
        if existing:
            await interaction.followup.send(
                f"A source with identifier `{identifier}` already exists: **{existing.name}**",
                ephemeral=True,
            )
            return

        existing_name = await self.bot.repository.get_source_by_name(name)
        if existing_name:
            await interaction.followup.send(
                f"A source with name **{name}** already exists.",
                ephemeral=True,
            )
            return

        final_feed_url = discovered_feed_url if discovered_feed_url else feed_url

        try:
            source = await self.bot.repository.add_source(
                source_type=stype,
                name=name,
                identifier=identifier,
                feed_url=final_feed_url,
                poll_interval_minutes=self.bot.settings.default_poll_interval_minutes,
                extraction_profile=extraction_profile_json,
                discovery_strategy=discovery_strategy,
                url_pattern=discovered_url_pattern,
                guild_id=str(interaction.guild_id) if interaction.guild_id else None,
                channel_id=str(interaction.channel_id),
                skip_summary=not summarize,
            )
        except DuplicateSourceError:
            await interaction.followup.send(
                f"A source with identifier `{identifier}` or name **{name}** already exists.",
                ephemeral=True,
            )
            return

        logger.info(
            "Source added",
            source_id=source.id,
            name=name,
            type=stype.value,
            identifier=identifier,
            user_id=interaction.user.id,
        )

        embed = discord.Embed(
            title="Source Added",
            color=discord.Color.green(),
        )
        embed.add_field(name="Name", value=name, inline=True)
        embed.add_field(name="Type", value=source_type.name, inline=True)
        embed.add_field(name="Identifier", value=identifier, inline=False)
        if final_feed_url:
            embed.add_field(name="Feed URL", value=final_feed_url, inline=False)
        if not summarize:
            embed.add_field(name="Summarize", value="Off", inline=True)
        if discovery_strategy:
            embed.add_field(name="Discovery Strategy", value=discovery_strategy, inline=True)

        await interaction.followup.send(embed=embed, ephemeral=True)

    @source_group.command(name="list", description="List sources for this channel")
    async def source_list(self, interaction: discord.Interaction) -> None:
        await interaction.response.defer()

        logger.debug(
            "source_list command invoked",
            user_id=interaction.user.id,
            guild_id=str(interaction.guild_id) if interaction.guild_id else None,
            channel_id=str(interaction.channel_id),
        )

        channel_id = str(interaction.channel_id)
        sources = await self.bot.repository.get_all_sources(
            active_only=False, channel_id=channel_id
        )

        if not sources:
            await interaction.followup.send("No sources configured for this channel.")
            return

        embed = discord.Embed(
            title="Sources for This Channel",
            color=discord.Color.blue(),
        )

        for source in sources:
            if source.is_active:
                status = "Active"
            elif source.pause_reason == PauseReason.USER_PAUSED.value:
                status = "Paused by user"
            elif source.pause_reason == PauseReason.CONSECUTIVE_FAILURES.value:
                status = f"Disabled: {source.consecutive_failures} consecutive failures"
            else:
                status = "Paused"
            last_poll = (
                source.last_polled_at.strftime("%Y-%m-%d %H:%M UTC")
                if source.last_polled_at
                else "Never"
            )
            embed.add_field(
                name=f"{'[ON]' if source.is_active else '[OFF]'} {source.name}",
                value=f"**Type:** {source.type.value}\n**Status:** {status}\n**Last Poll:** {last_poll}",
                inline=True,
            )

        await interaction.followup.send(embed=embed)

    @source_group.command(name="remove", description="Remove a content source")
    @app_commands.default_permissions(manage_guild=True)
    @app_commands.describe(name="Name of the source to remove")
    async def source_remove(
        self,
        interaction: discord.Interaction,
        name: str,
    ) -> None:
        await interaction.response.defer(ephemeral=True)

        source = await self.bot.repository.get_source_by_name(name)
        if not source:
            await interaction.followup.send(
                f"No source found with name **{name}**.", ephemeral=True
            )
            return

        content_count = await self.bot.repository.get_content_count_for_source(source.id)

        try:
            await self.bot.repository.delete_source(source.identifier)
            logger.info(
                "Source removed",
                name=name,
                identifier=source.identifier,
                user_id=interaction.user.id,
                content_items_deleted=content_count,
            )
            if content_count > 0:
                msg = (
                    f"Source **{name}** and {content_count} content item"
                    f"{'s' if content_count != 1 else ''} "
                    f"have been removed. Use `/source toggle` next time to disable without deleting."
                )
            else:
                msg = f"Source **{name}** has been removed."
            await interaction.followup.send(msg, ephemeral=True)
        except SourceNotFoundError:
            await interaction.followup.send(
                f"Source **{name}** was already removed.", ephemeral=True
            )
        except DatabaseConnectionError:
            await interaction.followup.send(
                f"Failed to remove source **{name}** due to a database error.", ephemeral=True
            )

    @source_group.command(name="info", description="Show detailed info about a source")
    @app_commands.describe(name="Name of the source to inspect")
    async def source_info(
        self,
        interaction: discord.Interaction,
        name: str,
    ) -> None:
        await interaction.response.defer(ephemeral=True)

        source = await self.bot.repository.get_source_by_name(name)
        if not source:
            await interaction.followup.send(
                f"No source found with name **{name}**.", ephemeral=True
            )
            return

        embed = discord.Embed(title=f"Source: {source.name}", color=discord.Color.blue())
        embed.add_field(name="Type", value=source.type.value, inline=True)
        embed.add_field(name="Identifier", value=source.identifier, inline=True)

        if source.is_active:
            status = "Active"
        elif source.pause_reason == PauseReason.USER_PAUSED.value:
            status = "Paused by user"
        elif source.pause_reason == PauseReason.CONSECUTIVE_FAILURES.value:
            status = f"Disabled ({source.consecutive_failures} failures)"
        else:
            status = "Paused"
        embed.add_field(name="Status", value=status, inline=True)

        if source.feed_url:
            embed.add_field(name="Feed URL", value=source.feed_url, inline=False)
        if source.discovery_strategy:
            embed.add_field(name="Discovery Strategy", value=source.discovery_strategy, inline=True)
        if source.url_pattern:
            embed.add_field(name="URL Pattern", value=source.url_pattern, inline=True)

        embed.add_field(name="Failures", value=str(source.consecutive_failures), inline=True)
        embed.add_field(name="Summarize", value="Off" if source.skip_summary else "On", inline=True)

        last_poll = (
            source.last_polled_at.strftime("%Y-%m-%d %H:%M UTC")
            if source.last_polled_at
            else "Never"
        )
        embed.add_field(name="Last Poll", value=last_poll, inline=True)

        await interaction.followup.send(embed=embed, ephemeral=True)

    @source_group.command(name="toggle", description="Enable or disable a content source")
    @app_commands.default_permissions(manage_guild=True)
    @app_commands.describe(name="Name of the source to toggle")
    async def source_toggle(
        self,
        interaction: discord.Interaction,
        name: str,
    ) -> None:
        await interaction.response.defer(ephemeral=True)

        source = await self.bot.repository.get_source_by_name(name)
        if not source:
            await interaction.followup.send(
                f"No source found with name **{name}**.", ephemeral=True
            )
            return

        new_state = not source.is_active
        pause_reason = PauseReason.NONE if new_state else PauseReason.USER_PAUSED

        try:
            await self.bot.repository.set_source_active(
                source.identifier, new_state, pause_reason=pause_reason
            )
            status = "enabled" if new_state else "disabled"
            logger.info(
                "Source toggled",
                name=name,
                identifier=source.identifier,
                is_active=new_state,
                user_id=interaction.user.id,
            )
            await interaction.followup.send(f"Source **{name}** has been {status}.", ephemeral=True)
        except SourceNotFoundError:
            await interaction.followup.send(f"Source **{name}** no longer exists.", ephemeral=True)
        except DatabaseConnectionError:
            await interaction.followup.send(
                f"Failed to toggle source **{name}** due to a database error.", ephemeral=True
            )


async def setup(bot: "IntelStreamBot") -> None:
    await bot.add_cog(SourceManagement(bot))
