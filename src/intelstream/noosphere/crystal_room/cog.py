from __future__ import annotations

import discord
import structlog
from discord import app_commands
from discord.ext import commands

from intelstream.noosphere.config import NoosphereSettings
from intelstream.noosphere.constants import CrystalRoomMode, CrystalRoomState
from intelstream.noosphere.crystal_room.access_control import (
    create_private_channel,
    grant_access,
    set_open_permissions,
    set_sealed_permissions,
)
from intelstream.noosphere.crystal_room.manager import CrystalRoomManager

logger = structlog.get_logger(__name__)


class CrystalRoomCog(commands.Cog, name="CrystalRoom"):
    """Discord cog for Crystal Room management."""

    def __init__(self, bot: commands.Bot, settings: NoosphereSettings | None = None) -> None:
        self.bot = bot
        ns = settings or NoosphereSettings()
        self.manager = CrystalRoomManager(
            seal_quorum=ns.crystal_room_seal_quorum,
            max_rooms_per_guild=ns.crystal_room_max_per_guild,
        )

    crystal = app_commands.Group(name="crystal", description="Crystal Room commands")

    @crystal.command(name="create", description="Create a new Crystal Room")
    @app_commands.describe(
        name="Room name",
        mode="Room mode: number_station, whale, or ghost",
    )
    async def crystal_create(
        self,
        interaction: discord.Interaction,
        name: str,
        mode: str = "number_station",
    ) -> None:
        if not interaction.guild or not isinstance(interaction.user, discord.Member):
            await interaction.response.send_message(
                "This command must be used in a server.", ephemeral=True
            )
            return

        try:
            room_mode = CrystalRoomMode(mode)
        except ValueError:
            valid = ", ".join(m.value for m in CrystalRoomMode)
            await interaction.response.send_message(
                f"Invalid mode. Valid modes: {valid}", ephemeral=True
            )
            return

        await interaction.response.defer(ephemeral=True)

        try:
            channel = await create_private_channel(
                guild=interaction.guild,
                name=name,
                creator=interaction.user,
            )

            self.manager.create_room(
                guild_id=interaction.guild.id,
                channel_id=channel.id,
                mode=room_mode,
                creator_id=interaction.user.id,
            )

            await interaction.followup.send(
                f"Crystal Room created: {channel.mention} (mode: {room_mode.value})",
                ephemeral=True,
            )

        except ValueError as e:
            await interaction.followup.send(str(e), ephemeral=True)
        except discord.Forbidden:
            await interaction.followup.send(
                "Missing permissions to create channels.", ephemeral=True
            )

    @crystal.command(name="join", description="Join an existing Crystal Room")
    async def crystal_join(self, interaction: discord.Interaction) -> None:
        if (
            not interaction.guild
            or not isinstance(interaction.user, discord.Member)
            or not interaction.channel_id
        ):
            await interaction.response.send_message(
                "This command must be used in a server.", ephemeral=True
            )
            return

        channel_id = interaction.channel_id
        room = self.manager.get_room(channel_id)

        if room is None:
            await interaction.response.send_message(
                "This channel is not a Crystal Room.", ephemeral=True
            )
            return

        try:
            self.manager.add_member(channel_id, interaction.user.id)
        except ValueError as e:
            await interaction.response.send_message(str(e), ephemeral=True)
            return

        channel = interaction.guild.get_channel(channel_id)
        if isinstance(channel, discord.TextChannel):
            await grant_access(channel, interaction.user)

        await interaction.response.send_message(
            f"{interaction.user.display_name} joined the Crystal Room."
        )

    @crystal.command(name="seal", description="Vote to seal the Crystal Room")
    async def crystal_seal(self, interaction: discord.Interaction) -> None:
        if not interaction.guild or not interaction.channel_id:
            await interaction.response.send_message(
                "This command must be used in a server.", ephemeral=True
            )
            return

        channel_id = interaction.channel_id

        try:
            sealed, current, needed = self.manager.vote_seal(channel_id, interaction.user.id)
        except ValueError as e:
            await interaction.response.send_message(str(e), ephemeral=True)
            return

        if sealed:
            channel = interaction.guild.get_channel(channel_id)
            if isinstance(channel, discord.TextChannel):
                await set_sealed_permissions(channel)

            self.bot.dispatch(
                "crystal_state_change",
                guild_id=interaction.guild.id,
                channel_id=channel_id,
                new_state=CrystalRoomState.SEALED.value,
            )

            await interaction.response.send_message(
                "The Crystal Room is now **SEALED**. Bot behavior has shifted."
            )
        else:
            await interaction.response.send_message(
                f"Seal vote recorded. {current}/{needed} votes needed."
            )

    @crystal.command(name="unseal", description="Unseal the Crystal Room")
    async def crystal_unseal(self, interaction: discord.Interaction) -> None:
        if not interaction.guild or not interaction.channel_id:
            await interaction.response.send_message(
                "This command must be used in a server.", ephemeral=True
            )
            return

        channel_id = interaction.channel_id

        try:
            self.manager.unseal(channel_id, interaction.user.id)
        except ValueError as e:
            await interaction.response.send_message(str(e), ephemeral=True)
            return

        channel = interaction.guild.get_channel(channel_id)
        if isinstance(channel, discord.TextChannel):
            await set_open_permissions(channel)

        self.bot.dispatch(
            "crystal_state_change",
            guild_id=interaction.guild.id,
            channel_id=channel_id,
            new_state=CrystalRoomState.OPEN.value,
        )

        await interaction.response.send_message("The Crystal Room is now **OPEN**.")

    @crystal.command(name="status", description="Show Crystal Room status")
    async def crystal_status(self, interaction: discord.Interaction) -> None:
        if not interaction.channel_id:
            await interaction.response.send_message(
                "This command must be used in a channel.", ephemeral=True
            )
            return

        room = self.manager.get_room(interaction.channel_id)

        if room is None:
            await interaction.response.send_message(
                "This channel is not a Crystal Room.", ephemeral=True
            )
            return

        lines = [
            f"**Mode:** {room.mode.value}",
            f"**State:** {room.state.value}",
            f"**Members:** {len(room.member_ids)}",
            f"**Created:** {room.created_at.strftime('%Y-%m-%d %H:%M UTC')}",
        ]
        if room.sealed_at:
            lines.append(f"**Sealed at:** {room.sealed_at.strftime('%Y-%m-%d %H:%M UTC')}")

        await interaction.response.send_message("\n".join(lines))
