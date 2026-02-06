from __future__ import annotations

from collections import defaultdict
from typing import TYPE_CHECKING

import discord
import structlog
from discord import app_commands
from discord.ext import commands

from intelstream.noosphere.cordyceps_audit.audit import run_audit
from intelstream.noosphere.cordyceps_audit.vocabulary_tracker import VocabularyTracker

if TYPE_CHECKING:
    from intelstream.bot import IntelStreamBot
    from intelstream.noosphere.shared.data_models import ProcessedMessage

logger = structlog.get_logger(__name__)


class CordycepsAuditCog(commands.Cog):
    def __init__(self, bot: IntelStreamBot) -> None:
        self.bot = bot
        self._trackers: dict[str, VocabularyTracker] = defaultdict(VocabularyTracker)
        self._message_counts: dict[str, dict[str, int]] = defaultdict(lambda: defaultdict(int))

    @commands.Cog.listener("on_message_processed")
    async def _on_message(self, msg: ProcessedMessage) -> None:
        tracker = self._trackers[msg.guild_id]
        counts = self._message_counts[msg.guild_id]
        counts[msg.user_id] += 1

        if msg.is_bot:
            tracker.record_bot_message(msg.content)
        else:
            tracker.record_community_message(msg.content)

    @app_commands.command(name="cordyceps", description="Run a Cordyceps influence audit")
    async def cordyceps(self, interaction: discord.Interaction) -> None:
        if interaction.guild is None:
            await interaction.response.send_message(
                "This command can only be used in a server.", ephemeral=True
            )
            return

        guild_id = str(interaction.guild.id)
        tracker = self._trackers.get(guild_id)
        counts = self._message_counts.get(guild_id)

        if tracker is None or counts is None or not counts:
            await interaction.response.send_message(
                "Insufficient data for a Cordyceps audit.", ephemeral=True
            )
            return

        report = run_audit(
            message_counts=dict(counts),
            bot_terms=tracker.bot_terms,
            community_terms=tracker.community_terms,
        )

        color = 0xE74C3C if report.flagged else 0x2ECC71
        status = "FLAGGED" if report.flagged else "Healthy"

        embed = discord.Embed(
            title="Cordyceps Audit",
            color=color,
        )
        embed.add_field(name="Status", value=status, inline=True)
        embed.add_field(
            name="Parasitism Score",
            value=f"{report.parasitism_score:.3f}",
            inline=True,
        )
        embed.add_field(
            name="Herfindahl Index",
            value=f"{report.herfindahl_index:.3f}",
            inline=True,
        )
        embed.add_field(
            name="Vocabulary Overlap",
            value=f"{report.vocabulary_jaccard:.3f}",
            inline=True,
        )

        await interaction.response.send_message(embed=embed)
        logger.info(
            "cordyceps audit completed",
            guild_id=guild_id,
            parasitism_score=report.parasitism_score,
            flagged=report.flagged,
        )
