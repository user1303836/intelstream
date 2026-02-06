from __future__ import annotations

import math

import discord
import structlog
from discord import app_commands
from discord.ext import commands

from intelstream.noosphere.config import NoosphereSettings
from intelstream.noosphere.constants import FIBONACCI_SEQ
from intelstream.noosphere.ghost_channel.oracle import GhostOracle

logger = structlog.get_logger(__name__)


class GhostChannelCog(commands.Cog, name="GhostChannel"):
    """Ephemeral Discord threads with optional LLM oracle.

    Posts are Fibonacci-spaced for quasiperiodic timing.
    Threads auto-archive after a configurable period.
    """

    def __init__(self, bot: commands.Bot, settings: NoosphereSettings | None = None) -> None:
        self.bot = bot
        ns = settings or NoosphereSettings()
        self.oracle = GhostOracle(
            temperature=ns.ghost_oracle_temperature,
            top_p=ns.ghost_oracle_top_p,
        )
        self._auto_archive_minutes = ns.ghost_thread_auto_archive_minutes
        self._base_interval_hours = ns.ghost_base_interval_hours
        self._fib_index = 0
        self._enabled = ns.ghost_channel_enabled

    def _next_fib_interval_minutes(self) -> float:
        """Get next Fibonacci-spaced interval in minutes."""
        fib = FIBONACCI_SEQ[self._fib_index % len(FIBONACCI_SEQ)]
        self._fib_index += 1
        if self._fib_index >= len(FIBONACCI_SEQ):
            self._fib_index = 0
        return fib

    def _next_posting_delay_seconds(self) -> float:
        """Compute the next posting delay using base interval + Fibonacci offset."""
        base_seconds = self._base_interval_hours * 3600
        fib_offset_minutes = self._next_fib_interval_minutes()
        fib_offset_seconds = fib_offset_minutes * 60
        jitter = math.sin(self._fib_index * 0.618) * 60
        return max(60.0, base_seconds + fib_offset_seconds + jitter)

    @app_commands.command(name="ghost", description="Ask the Ghost Oracle a question")
    @app_commands.describe(question="Your question for the oracle")
    async def ghost_ask(
        self,
        interaction: discord.Interaction,
        question: str,
    ) -> None:
        if not interaction.guild or not interaction.channel:
            await interaction.response.send_message(
                "This command must be used in a server channel.", ephemeral=True
            )
            return

        if not self._enabled:
            await interaction.response.send_message(
                "Ghost Channel is currently disabled.", ephemeral=True
            )
            return

        await interaction.response.defer()

        anthropic_client = getattr(self.bot, "_anthropic_client", None)

        result = await self.oracle.generate_response(
            question=question,
            fragments=None,
            anthropic_client=anthropic_client,
        )

        archive_duration = 60
        if self._auto_archive_minutes in (60, 1440, 4320, 10080):
            archive_duration = self._auto_archive_minutes

        if isinstance(interaction.channel, discord.TextChannel):
            thread = await interaction.channel.create_thread(
                name=f"Ghost: {question[:50]}",
                auto_archive_duration=archive_duration,  # type: ignore[arg-type]
                reason="Ghost Channel oracle response",
            )

            await thread.send(
                f"**Question:** {question}\n\n"
                f"**The oracle speaks:**\n> {result.response}\n\n"
                f"*This thread will auto-archive in "
                f"{archive_duration} minutes.*"
            )

            await interaction.followup.send(
                f"The oracle has spoken in {thread.mention}", ephemeral=True
            )
        else:
            await interaction.followup.send(f"**The oracle speaks:**\n> {result.response}")

    @app_commands.command(name="ghost-status", description="Show Ghost Channel configuration")
    async def ghost_status(self, interaction: discord.Interaction) -> None:
        status = "enabled" if self._enabled else "disabled"
        await interaction.response.send_message(
            f"**Ghost Channel:** {status}\n"
            f"**Oracle temperature:** {self.oracle.temperature}\n"
            f"**Auto-archive:** {self._auto_archive_minutes} minutes\n"
            f"**Base interval:** {self._base_interval_hours} hours"
        )
