from __future__ import annotations

from typing import TYPE_CHECKING

import discord
import structlog
from discord import app_commands
from discord.ext import commands

from intelstream.noosphere.morphogenetic_field.field import MorphogeneticField

if TYPE_CHECKING:
    from intelstream.bot import IntelStreamBot
    from intelstream.noosphere.shared.data_models import ProcessedMessage

logger = structlog.get_logger(__name__)


class MorphogeneticFieldCog(commands.Cog):
    def __init__(self, bot: IntelStreamBot) -> None:
        self.bot = bot
        self._fields: dict[str, MorphogeneticField] = {}
        self._reply_cache: dict[int, str] = {}

    def _get_field(self, guild_id: str) -> MorphogeneticField:
        if guild_id not in self._fields:
            self._fields[guild_id] = MorphogeneticField(guild_id=guild_id)
        return self._fields[guild_id]

    @commands.Cog.listener("on_message_processed")
    async def _on_message(self, msg: ProcessedMessage) -> None:
        if msg.embedding is None:
            return
        mf = self._get_field(msg.guild_id)
        mf.update_user(msg.user_id, msg.embedding, msg.timestamp)

    @commands.Cog.listener()
    async def on_message(self, message: discord.Message) -> None:
        if message.author.bot or message.guild is None:
            return
        if message.reference and message.reference.message_id:
            replied_to_author = self._reply_cache.get(message.reference.message_id)
            if replied_to_author is not None:
                mf = self._get_field(str(message.guild.id))
                mf.record_interaction(str(message.author.id), replied_to_author)
        self._reply_cache[message.id] = str(message.author.id)
        if len(self._reply_cache) > 10000:
            oldest_keys = list(self._reply_cache.keys())[: len(self._reply_cache) - 5000]
            for k in oldest_keys:
                del self._reply_cache[k]

    @app_commands.command(name="morph", description="View morphogenetic field status")
    async def morph(self, interaction: discord.Interaction) -> None:
        if interaction.guild is None:
            await interaction.response.send_message(
                "This command can only be used in a server.", ephemeral=True
            )
            return

        guild_id = str(interaction.guild.id)
        mf = self._fields.get(guild_id)
        if mf is None or not mf.users:
            await interaction.response.send_message(
                "No morphogenetic field data available yet.", ephemeral=True
            )
            return

        active_users = sum(1 for u in mf.users.values() if u.message_count > 0)
        edges = mf.interaction_graph.number_of_edges()
        modularity = mf.graph_modularity()

        top = mf.top_couplings(5)
        coupling_lines: list[str] = []
        for c in top:
            coupling_lines.append(f"<@{c.user_a}> <-> <@{c.user_b}>: {c.score:.3f}")

        embed = discord.Embed(
            title="Morphogenetic Field",
            color=0x1ABC9C,
        )
        embed.add_field(name="Active Users", value=str(active_users), inline=True)
        embed.add_field(name="Interactions", value=str(edges), inline=True)
        embed.add_field(name="Modularity", value=f"{modularity:.3f}", inline=True)

        if coupling_lines:
            embed.add_field(
                name="Top Couplings",
                value="\n".join(coupling_lines),
                inline=False,
            )

        await interaction.response.send_message(embed=embed)
        logger.debug(
            "morphogenetic field displayed",
            guild_id=guild_id,
            active_users=active_users,
        )
