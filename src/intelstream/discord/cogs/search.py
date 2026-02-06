from __future__ import annotations

from typing import TYPE_CHECKING

import discord
import structlog
from discord import app_commands
from discord.ext import commands

from intelstream.database.models import SourceType
from intelstream.services.content_poster import SOURCE_TYPE_LABELS

if TYPE_CHECKING:
    from intelstream.bot import IntelStreamBot

logger = structlog.get_logger()


class SearchCog(commands.Cog):
    def __init__(self, bot: IntelStreamBot) -> None:
        self.bot = bot

    async def cog_load(self) -> None:
        if not self.bot.settings.voyage_api_key:
            logger.info("Voyage API key not configured, search disabled")
            return

    @app_commands.command(name="search", description="Search across all content")
    @app_commands.describe(
        query="What to search for (3-200 characters)",
        days="Limit to last N days (optional)",
        source_type="Filter by source type (optional)",
    )
    @app_commands.choices(
        source_type=[
            app_commands.Choice(name=label, value=st.value)
            for st, label in SOURCE_TYPE_LABELS.items()
        ]
    )
    @app_commands.checks.cooldown(5, 60.0)
    async def search(
        self,
        interaction: discord.Interaction,
        query: str,
        days: int | None = None,
        source_type: str | None = None,
    ) -> None:
        if not self.bot.search_service:
            await interaction.response.send_message(
                "Semantic search is not configured.", ephemeral=True
            )
            return

        if len(query) < 3 or len(query) > 200:
            await interaction.response.send_message(
                "Query must be between 3 and 200 characters.", ephemeral=True
            )
            return

        await interaction.response.defer(ephemeral=True)

        guild_id = str(interaction.guild_id) if interaction.guild_id else None

        try:
            results = await self.bot.search_service.search(
                query=query,
                guild_id=guild_id,
                source_type=source_type,
                days=days,
                limit=self.bot.settings.search_max_results,
                threshold=self.bot.settings.search_similarity_threshold,
            )
        except Exception:
            logger.exception("Search failed", query=query)
            await interaction.followup.send(
                "An error occurred while searching. Please try again.", ephemeral=True
            )
            return

        if not results:
            await interaction.followup.send("No relevant results found.", ephemeral=True)
            return

        embed = discord.Embed(
            title=f'Search: "{query}"',
            color=0x3498DB,
            description=f"{len(results)} results found",
        )
        for i, result in enumerate(results, 1):
            source_label = SOURCE_TYPE_LABELS.get(SourceType(result.source_type), "Unknown")
            date_str = result.published_at.strftime("%b %d")
            embed.add_field(
                name=f"{i}. {result.title[:250]}",
                value=f"[Link]({result.original_url}) | {source_label} | {date_str} | Score: {result.score:.2f}",
                inline=False,
            )
        await interaction.followup.send(embed=embed, ephemeral=True)

    @search.error
    async def search_error(
        self, interaction: discord.Interaction, error: app_commands.AppCommandError
    ) -> None:
        if isinstance(error, app_commands.CommandOnCooldown):
            await interaction.response.send_message(
                f"Search is on cooldown. Try again in {error.retry_after:.0f}s.",
                ephemeral=True,
            )
        else:
            raise error
