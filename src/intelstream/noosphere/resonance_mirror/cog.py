from __future__ import annotations

from typing import TYPE_CHECKING

import discord
import structlog
from discord import app_commands
from discord.ext import commands

from intelstream.noosphere.resonance_mirror.analyzer import (
    build_mirror_lines,
    ei_color,
)

if TYPE_CHECKING:
    from intelstream.bot import IntelStreamBot
    from intelstream.noosphere.shared.data_models import CommunityStateVector

logger = structlog.get_logger(__name__)


class ResonanceMirrorCog(commands.Cog):
    def __init__(self, bot: IntelStreamBot) -> None:
        self.bot = bot
        self._latest: dict[str, CommunityStateVector] = {}
        self._previous: dict[str, CommunityStateVector] = {}

    @commands.Cog.listener("on_state_vector_updated")
    async def _on_state_vector(self, csv: CommunityStateVector) -> None:
        old = self._latest.get(csv.guild_id)
        self._latest[csv.guild_id] = csv
        if old is not None:
            self._previous[csv.guild_id] = old

    @app_commands.command(name="mirror", description="View community resonance snapshot")
    async def mirror(self, interaction: discord.Interaction) -> None:
        if interaction.guild is None:
            await interaction.response.send_message(
                "This command can only be used in a server.", ephemeral=True
            )
            return

        guild_id = str(interaction.guild.id)
        csv = self._latest.get(guild_id)
        if csv is None:
            await interaction.response.send_message(
                "No community data available yet. The mirror needs time to observe.",
                ephemeral=True,
            )
            return

        previous = self._previous.get(guild_id)
        lines = build_mirror_lines(csv, previous)

        embed = discord.Embed(
            title="Resonance Mirror",
            description="```\n" + "\n".join(lines) + "\n```",
            color=ei_color(csv.egregore_index),
        )
        embed.set_footer(text=f"Snapshot at {csv.timestamp:%Y-%m-%d %H:%M UTC}")

        await interaction.response.send_message(embed=embed)
        logger.debug(
            "resonance mirror displayed",
            guild_id=guild_id,
            egregore_index=csv.egregore_index,
        )
