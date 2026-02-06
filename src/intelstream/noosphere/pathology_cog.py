from __future__ import annotations

from collections import defaultdict
from typing import TYPE_CHECKING

import discord
import structlog
from discord import app_commands
from discord.ext import commands

from intelstream.noosphere.pathology import (
    GuildBaseline,
    PathologyAlert,
    run_pathology_scan,
)

if TYPE_CHECKING:
    from intelstream.bot import IntelStreamBot
    from intelstream.noosphere.shared.data_models import CommunityStateVector

logger = structlog.get_logger(__name__)


class PathologyMonitorCog(commands.Cog):
    def __init__(self, bot: IntelStreamBot) -> None:
        self.bot = bot
        self._baselines: dict[int, GuildBaseline] = {}
        self._latest_alerts: dict[int, list[PathologyAlert]] = defaultdict(list)

    @commands.Cog.listener("on_state_vector_updated")
    async def _on_state_vector(self, csv: CommunityStateVector) -> None:
        baseline = self._baselines.get(csv.guild_id)
        alerts = run_pathology_scan(csv, baseline)
        self._latest_alerts[csv.guild_id] = alerts
        for alert in alerts:
            self.bot.dispatch(
                "pathology_detected",
                {
                    "guild_id": csv.guild_id,
                    "pathology_type": alert.pathology.value,
                    "severity": alert.severity,
                    "description": alert.description,
                },
            )
            logger.warning(
                "pathology detected",
                guild_id=csv.guild_id,
                pathology=alert.pathology.value,
                severity=alert.severity,
            )

    @app_commands.command(name="pathology", description="View detected community pathologies")
    async def pathology(self, interaction: discord.Interaction) -> None:
        if interaction.guild is None:
            await interaction.response.send_message(
                "This command can only be used in a server.", ephemeral=True
            )
            return

        guild_id = interaction.guild.id
        alerts = self._latest_alerts.get(guild_id, [])

        if not alerts:
            embed = discord.Embed(
                title="Pathology Monitor",
                description="No pathologies detected. Community appears healthy.",
                color=0x2ECC71,
            )
            await interaction.response.send_message(embed=embed)
            return

        embed = discord.Embed(
            title="Pathology Monitor",
            color=0xE74C3C,
        )
        for alert in alerts:
            severity_bar = "\u2588" * round(alert.severity * 5) + "\u2591" * (
                5 - round(alert.severity * 5)
            )
            embed.add_field(
                name=f"{alert.pathology.value.replace('_', ' ').title()}",
                value=f"Severity: {severity_bar} ({alert.severity:.2f})\n{alert.description}",
                inline=False,
            )

        await interaction.response.send_message(embed=embed)
