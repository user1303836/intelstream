from __future__ import annotations

from dataclasses import dataclass, field
from datetime import UTC, datetime

import discord
import structlog
from discord.ext import commands

from intelstream.noosphere.constants import ComputationMode, PathologyType

logger = structlog.get_logger(__name__)


@dataclass
class ModeTransition:
    old_mode: ComputationMode
    new_mode: ComputationMode
    reason: str
    timestamp: datetime = field(default_factory=lambda: datetime.now(UTC))


class ModeManager:
    """Manages the 10-mode taxonomy for a guild.

    Phase 3: manual mode switching via admin commands.
    Phase 4: automatic transitions driven by pathology detection.
    """

    def __init__(self, guild_id: str, default_mode: ComputationMode = ComputationMode.INTEGRATIVE):
        self.guild_id = guild_id
        self._current_mode = default_mode
        self._history: list[ModeTransition] = []
        self._active_pathologies: dict[PathologyType, float] = {}

    @property
    def current_mode(self) -> ComputationMode:
        return self._current_mode

    @property
    def active_pathologies(self) -> dict[PathologyType, float]:
        return dict(self._active_pathologies)

    @property
    def history(self) -> list[ModeTransition]:
        return list(self._history)

    def set_mode(self, new_mode: ComputationMode, reason: str = "manual") -> ModeTransition:
        old_mode = self._current_mode
        transition = ModeTransition(
            old_mode=old_mode,
            new_mode=new_mode,
            reason=reason,
        )
        self._current_mode = new_mode
        self._history.append(transition)
        logger.info(
            "Mode transition",
            guild_id=self.guild_id,
            old_mode=old_mode.value,
            new_mode=new_mode.value,
            reason=reason,
        )
        return transition

    def report_pathology(self, pathology: PathologyType, severity: float) -> None:
        self._active_pathologies[pathology] = max(0.0, min(1.0, severity))
        logger.warning(
            "Pathology reported",
            guild_id=self.guild_id,
            pathology=pathology.value,
            severity=severity,
            current_mode=self._current_mode.value,
        )

    def clear_pathology(self, pathology: PathologyType) -> None:
        self._active_pathologies.pop(pathology, None)

    def get_mode_description(self) -> str:
        descriptions: dict[ComputationMode, str] = {
            ComputationMode.SUBTRACTIVE: "Pruning low-value paths (Physarum optimization)",
            ComputationMode.BROADCAST: "VOC saturation broadcasting",
            ComputationMode.RESONANT: "Frequency synchronization across participants",
            ComputationMode.STIGMERGIC: "Environmental trace-based coordination",
            ComputationMode.PARASITIC: "Behavioral redirection (Cordyceps-style)",
            ComputationMode.PARLIAMENTARY: "Distributed authority and consensus",
            ComputationMode.INTEGRATIVE: "Gap junction coupling between participants",
            ComputationMode.CRYPTOBIOTIC: "Suspended computation (dormancy)",
            ComputationMode.PROJECTIVE: "Higher-dimensional shadow projection",
            ComputationMode.TOPOLOGICAL: "Shape-invariant information processing",
        }
        return descriptions.get(self._current_mode, "Unknown mode")


class ModeManagerCog(commands.Cog):
    """Discord cog for manual mode management commands."""

    def __init__(self, bot: commands.Bot) -> None:
        self.bot = bot
        self._managers: dict[str, ModeManager] = {}

    def get_manager(self, guild_id: str) -> ModeManager:
        if guild_id not in self._managers:
            self._managers[guild_id] = ModeManager(guild_id)
        return self._managers[guild_id]

    @discord.app_commands.command(name="mode", description="Show current computation mode")
    async def mode_status(self, interaction: discord.Interaction) -> None:
        if not interaction.guild:
            await interaction.response.send_message("This command must be used in a server.")
            return

        manager = self.get_manager(str(interaction.guild.id))
        mode = manager.current_mode
        description = manager.get_mode_description()

        pathologies = manager.active_pathologies
        pathology_text = ""
        if pathologies:
            lines = [f"  {p.value}: severity {s:.2f}" for p, s in pathologies.items()]
            pathology_text = "\nActive pathologies:\n" + "\n".join(lines)

        await interaction.response.send_message(
            f"**Current Mode:** {mode.value}\n**Description:** {description}{pathology_text}"
        )

    @discord.app_commands.command(name="mode-set", description="Set computation mode (admin)")
    @discord.app_commands.describe(mode="The computation mode to switch to")
    @discord.app_commands.checks.has_permissions(administrator=True)
    async def mode_set(self, interaction: discord.Interaction, mode: str) -> None:
        if not interaction.guild:
            await interaction.response.send_message("This command must be used in a server.")
            return

        try:
            new_mode = ComputationMode(mode)
        except ValueError:
            valid = ", ".join(m.value for m in ComputationMode)
            await interaction.response.send_message(
                f"Invalid mode. Valid modes: {valid}", ephemeral=True
            )
            return

        manager = self.get_manager(str(interaction.guild.id))
        transition = manager.set_mode(new_mode, reason=f"manual by {interaction.user}")

        self.bot.dispatch(
            "mode_transition",
            guild_id=str(interaction.guild.id),
            old_mode=transition.old_mode.value,
            new_mode=transition.new_mode.value,
            reason=transition.reason,
        )

        await interaction.response.send_message(
            f"Mode changed: {transition.old_mode.value} -> {transition.new_mode.value}"
        )

    @discord.app_commands.command(name="mode-history", description="Show mode transition history")
    async def mode_history(self, interaction: discord.Interaction) -> None:
        if not interaction.guild:
            await interaction.response.send_message("This command must be used in a server.")
            return

        manager = self.get_manager(str(interaction.guild.id))
        history = manager.history

        if not history:
            await interaction.response.send_message("No mode transitions recorded.")
            return

        lines = []
        for t in history[-10:]:
            lines.append(
                f"{t.timestamp.strftime('%Y-%m-%d %H:%M')} "
                f"{t.old_mode.value} -> {t.new_mode.value} ({t.reason})"
            )

        await interaction.response.send_message(
            "**Recent Mode Transitions:**\n```\n" + "\n".join(lines) + "\n```"
        )
