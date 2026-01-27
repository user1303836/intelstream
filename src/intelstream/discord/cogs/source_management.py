import json
from typing import TYPE_CHECKING
from urllib.parse import urlparse

import discord
import structlog
from discord import app_commands
from discord.ext import commands

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

    return url, None


class SourceManagement(commands.Cog):
    def __init__(self, bot: "IntelStreamBot") -> None:
        self.bot = bot

    source_group = app_commands.Group(
        name="source",
        description="Manage content sources",
        default_permissions=discord.Permissions(manage_guild=True),
    )

    @source_group.command(name="add", description="Add a new content source")
    @app_commands.describe(
        source_type="Type of source to add",
        name="Display name for this source",
        url="URL of the source (Substack URL, YouTube channel, or RSS feed)",
    )
    @app_commands.choices(
        source_type=[
            app_commands.Choice(name="Substack", value="substack"),
            app_commands.Choice(name="YouTube", value="youtube"),
            app_commands.Choice(name="RSS", value="rss"),
            app_commands.Choice(name="Page", value="page"),
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

        source = await self.bot.repository.add_source(
            source_type=stype,
            name=name,
            identifier=identifier,
            feed_url=feed_url,
            poll_interval_minutes=self.bot.settings.default_poll_interval_minutes,
            extraction_profile=extraction_profile_json,
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
        if feed_url:
            embed.add_field(name="Feed URL", value=feed_url, inline=False)

        await interaction.followup.send(embed=embed, ephemeral=True)

    @source_group.command(name="list", description="List all configured sources")
    async def source_list(self, interaction: discord.Interaction) -> None:
        await interaction.response.defer(ephemeral=True)

        sources = await self.bot.repository.get_all_sources(active_only=False)

        if not sources:
            await interaction.followup.send("No sources configured.", ephemeral=True)
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
            embed.add_field(
                name=f"{'[ON]' if source.is_active else '[OFF]'} {source.name}",
                value=f"**Type:** {source.type.value}\n**Status:** {status}\n**Last Poll:** {last_poll}",
                inline=True,
            )

        await interaction.followup.send(embed=embed, ephemeral=True)

    @source_group.command(name="remove", description="Remove a content source")
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
