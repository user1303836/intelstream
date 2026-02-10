from __future__ import annotations

from collections import defaultdict
from typing import TYPE_CHECKING

import discord
import structlog
from discord import app_commands
from discord.ext import commands

from intelstream.noosphere.attractor_dashboard.metrics import (
    find_change_points,
    format_dashboard,
)

if TYPE_CHECKING:
    from intelstream.bot import IntelStreamBot
    from intelstream.noosphere.shared.data_models import CommunityStateVector

logger = structlog.get_logger(__name__)

MAX_HISTORY = 168


class AttractorDashboardCog(commands.Cog):
    def __init__(self, bot: IntelStreamBot) -> None:
        self.bot = bot
        self._history: dict[str, list[CommunityStateVector]] = defaultdict(list)

    @commands.Cog.listener("on_state_vector_updated")
    async def _on_state_vector(self, csv: CommunityStateVector) -> None:
        history = self._history[csv.guild_id]
        history.append(csv)
        if len(history) > MAX_HISTORY:
            self._history[csv.guild_id] = history[-MAX_HISTORY:]

    @app_commands.command(name="dashboard", description="View community attractor dashboard")
    async def dashboard(self, interaction: discord.Interaction) -> None:
        if interaction.guild is None:
            await interaction.response.send_message(
                "This command can only be used in a server.", ephemeral=True
            )
            return

        guild_id = str(interaction.guild.id)
        history = self._history.get(guild_id, [])
        if not history:
            await interaction.response.send_message(
                "No community data available yet.", ephemeral=True
            )
            return

        latest = history[-1]
        change_points = find_change_points(history) if len(history) >= 10 else None
        lines = format_dashboard(latest, change_points)

        embed = discord.Embed(
            title="Attractor Dashboard",
            description="```\n" + "\n".join(lines) + "\n```",
            color=0x9B59B6,
        )

        if change_points:
            cp_summary = ", ".join(f"{cp.metric} ({cp.direction})" for cp in change_points[:5])
            embed.add_field(name="Change Points Detected", value=cp_summary, inline=False)

        embed.set_footer(text=f"History: {len(history)} snapshots")

        await interaction.response.send_message(embed=embed)
        logger.debug(
            "attractor dashboard displayed",
            guild_id=guild_id,
            history_size=len(history),
        )
