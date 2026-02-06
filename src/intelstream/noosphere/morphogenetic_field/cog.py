from __future__ import annotations

import discord
import structlog
from discord import app_commands
from discord.ext import commands

from intelstream.noosphere.config import NoosphereSettings
from intelstream.noosphere.morphogenetic_field.pulse import MorphogeneticPulseGenerator
from intelstream.noosphere.morphogenetic_field.serendipity import SerendipityInjector

logger = structlog.get_logger(__name__)


class MorphogeneticPulseCog(commands.Cog, name="MorphogeneticPulse"):
    """Cog for morphogenetic pulse and serendipity injection.

    Manages Socratic prompts on phi-timed schedule and
    cross-topic bridge discovery.
    """

    def __init__(self, bot: commands.Bot, settings: NoosphereSettings | None = None) -> None:
        self.bot = bot
        ns = settings or NoosphereSettings()
        self.pulse_generator = MorphogeneticPulseGenerator(
            base_interval_minutes=ns.pulse_base_interval_minutes,
        )
        self.serendipity = SerendipityInjector(
            noise_sigma=ns.serendipity_noise_sigma,
            similarity_min=ns.serendipity_similarity_min,
            similarity_max=ns.serendipity_similarity_max,
        )
        self._pulse_enabled = ns.pulse_enabled
        self._serendipity_enabled = ns.serendipity_enabled

    @app_commands.command(name="pulse", description="Trigger a morphogenetic pulse")
    @app_commands.checks.has_permissions(administrator=True)
    async def manual_pulse(self, interaction: discord.Interaction) -> None:
        if not interaction.guild or not interaction.channel_id:
            await interaction.response.send_message(
                "This command must be used in a server channel.", ephemeral=True
            )
            return

        if not self._pulse_enabled:
            await interaction.response.send_message(
                "Morphogenetic pulse is currently disabled.", ephemeral=True
            )
            return

        pulse = self.pulse_generator.generate_pulse(
            channel_id=str(interaction.channel_id),
        )

        self.bot.dispatch(
            "pulse_fired",
            guild_id=str(interaction.guild.id),
            channel_id=str(interaction.channel_id),
            content=pulse.content,
        )

        await interaction.response.send_message(pulse.content)

    @app_commands.command(name="pulse-status", description="Show pulse generator status")
    async def pulse_status(self, interaction: discord.Interaction) -> None:
        next_interval = self.pulse_generator.next_interval_minutes()
        step = self.pulse_generator.step

        status = "enabled" if self._pulse_enabled else "disabled"
        seren_status = "enabled" if self._serendipity_enabled else "disabled"

        await interaction.response.send_message(
            f"**Morphogenetic Pulse:** {status}\n"
            f"**Serendipity Injector:** {seren_status}\n"
            f"**Current step:** {step}\n"
            f"**Next interval:** {next_interval:.1f} minutes"
        )

    @app_commands.command(
        name="serendipity",
        description="Find serendipitous connections in current topics",
    )
    async def find_serendipity(self, interaction: discord.Interaction) -> None:
        if not self._serendipity_enabled:
            await interaction.response.send_message(
                "Serendipity injection is currently disabled.", ephemeral=True
            )
            return

        await interaction.response.send_message(
            "Serendipity injection requires active topic data from the analytics pipeline. "
            "Use `/pulse` to trigger a manual catalytic prompt instead."
        )
