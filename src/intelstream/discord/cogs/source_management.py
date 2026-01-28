import json
from typing import TYPE_CHECKING
from urllib.parse import urlparse

import anthropic
import discord
import structlog
from discord import app_commands
from discord.ext import commands

from intelstream.adapters.smart_blog import SmartBlogAdapter
from intelstream.database.models import SourceType
from intelstream.services.page_analyzer import PageAnalysisError, PageAnalyzer

if TYPE_CHECKING:
    from intelstream.bot import IntelStreamBot

logger = structlog.get_logger()


def parse_source_identifier(source_type: SourceType, url: str) -> tuple[str, str | None]:
    parsed = urlparse(url)

    if source_type == SourceType.SUBSTACK:
        host = parsed.netloc.lower()
        if host.endswith(".substack.com"):
            identifier = host.replace(".substack.com", "")
            feed_url = f"https://{host}/feed"
            return identifier, feed_url
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
            return identifier, None

    elif source_type == SourceType.RSS:
        identifier = parsed.netloc + parsed.path
        return identifier, url

    elif source_type == SourceType.PAGE:
        identifier = parsed.netloc + parsed.path.rstrip("/")
        return identifier, url

    elif source_type == SourceType.ARXIV:
        identifier = url.strip()
        feed_url = f"https://arxiv.org/rss/{identifier}"
        return identifier, feed_url

    elif source_type == SourceType.BLOG:
        identifier = parsed.netloc + parsed.path.rstrip("/")
        return identifier, None

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
        url="URL of the source (Substack URL, YouTube channel, RSS feed, or blog page)",
    )
    @app_commands.choices(
        source_type=[
            app_commands.Choice(name="Substack", value="substack"),
            app_commands.Choice(name="YouTube", value="youtube"),
            app_commands.Choice(name="RSS", value="rss"),
            app_commands.Choice(name="Page", value="page"),
            app_commands.Choice(name="Arxiv", value="arxiv"),
            app_commands.Choice(name="Blog", value="blog"),
        ]
    )
    async def source_add(
        self,
        interaction: discord.Interaction,
        source_type: app_commands.Choice[str],
        name: str,
        url: str,
    ) -> None:
        await interaction.response.defer(ephemeral=True)

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

        identifier, feed_url = parse_source_identifier(stype, url)

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
        )

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
        if discovery_strategy:
            embed.add_field(name="Discovery Strategy", value=discovery_strategy, inline=True)

        await interaction.followup.send(embed=embed, ephemeral=True)

    @source_group.command(name="list", description="List all configured sources")
    async def source_list(self, interaction: discord.Interaction) -> None:
        await interaction.response.defer()

        sources = await self.bot.repository.get_all_sources(active_only=False)

        if not sources:
            await interaction.followup.send("No sources configured.")
            return

        embed = discord.Embed(
            title="Configured Sources",
            color=discord.Color.blue(),
        )

        for source in sources:
            status = "Active" if source.is_active else "Paused"
            last_poll = (
                source.last_polled_at.strftime("%Y-%m-%d %H:%M UTC")
                if source.last_polled_at
                else "Never"
            )
            channel_info = f"<#{source.channel_id}>" if source.channel_id else "Not set"
            embed.add_field(
                name=f"{'[ON]' if source.is_active else '[OFF]'} {source.name}",
                value=f"**Type:** {source.type.value}\n**Channel:** {channel_info}\n**Status:** {status}\n**Last Poll:** {last_poll}",
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

        deleted = await self.bot.repository.delete_source(source.identifier)

        if deleted:
            logger.info(
                "Source removed",
                name=name,
                identifier=source.identifier,
                user_id=interaction.user.id,
            )
            await interaction.followup.send(f"Source **{name}** has been removed.", ephemeral=True)
        else:
            await interaction.followup.send(f"Failed to remove source **{name}**.", ephemeral=True)

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
        updated = await self.bot.repository.set_source_active(source.identifier, new_state)

        if updated:
            status = "enabled" if new_state else "disabled"
            logger.info(
                "Source toggled",
                name=name,
                identifier=source.identifier,
                is_active=new_state,
                user_id=interaction.user.id,
            )
            await interaction.followup.send(f"Source **{name}** has been {status}.", ephemeral=True)
        else:
            await interaction.followup.send(f"Failed to toggle source **{name}**.", ephemeral=True)


async def setup(bot: "IntelStreamBot") -> None:
    await bot.add_cog(SourceManagement(bot))
