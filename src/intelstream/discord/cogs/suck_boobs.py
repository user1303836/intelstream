import random
from typing import TYPE_CHECKING

import discord
import structlog
from discord import app_commands
from discord.ext import commands

if TYPE_CHECKING:
    from intelstream.bot import IntelStreamBot

logger = structlog.get_logger()


class SuckBoobs(commands.Cog):
    suck_boobs_group = app_commands.Group(
        name="suck_boobs",
        description="The suck_boobs command",
    )

    def __init__(self, bot: "IntelStreamBot") -> None:
        self.bot = bot

    def _get_random_member(
        self, members: list[discord.Member] | list[discord.ThreadMember], exclude_id: int
    ) -> discord.Member | discord.ThreadMember | None:
        eligible = [m for m in members if not getattr(m, "bot", False) and m.id != exclude_id]
        if not eligible:
            return None
        return random.choice(eligible)

    @suck_boobs_group.command(name="do", description="Suck someone's boobs")
    async def suck_boobs_do(self, interaction: discord.Interaction) -> None:
        if interaction.guild is None or not isinstance(
            interaction.channel, (discord.TextChannel, discord.Thread)
        ):
            await interaction.response.send_message(
                "This command can only be used in a server channel.", ephemeral=True
            )
            return

        members = interaction.channel.members
        target = self._get_random_member(members, interaction.user.id)

        if target is None:
            await interaction.response.send_message(
                "No eligible users found in this channel.", ephemeral=True
            )
            return

        await self.bot.repository.record_suck_boobs_usage(
            guild_id=str(interaction.guild_id),
            user_id=str(interaction.user.id),
            pinged_user_id=str(target.id),
        )

        await interaction.response.send_message(
            f"🍼 {interaction.user.display_name} sucks <@{target.id}>'s boobs 🥛😳"
        )

    @suck_boobs_group.command(name="score", description="Show the suck_boobs leaderboard")
    async def suck_boobs_score(self, interaction: discord.Interaction) -> None:
        if interaction.guild is None:
            await interaction.response.send_message(
                "This command can only be used in a server.", ephemeral=True
            )
            return

        await interaction.response.defer()

        top_users, top_pinged = await self.bot.repository.get_suck_boobs_leaderboard(
            guild_id=str(interaction.guild_id)
        )

        embed = discord.Embed(title="🍼 Suck Boobs Leaderboard 🍼", color=discord.Color.purple())

        rank_emojis = ["🥇", "🥈", "🥉", "4️⃣", "5️⃣"]

        if top_users:
            user_lines = []
            for i, stat in enumerate(top_users):
                try:
                    member = await interaction.guild.fetch_member(int(stat.user_id))
                    name = member.display_name
                except discord.DiscordException as e:
                    logger.warning("Failed to fetch member", user_id=stat.user_id, error=str(e))
                    name = f"Unknown ({stat.user_id})"
                rank = rank_emojis[i] if i < len(rank_emojis) else f"{i + 1}."
                user_lines.append(f"{rank} {name}: {stat.times_used}")
            embed.add_field(name="🫡 Top Boob Suckers", value="\n".join(user_lines), inline=True)
        else:
            embed.add_field(name="🫡 Top Boob Suckers", value="No data yet 💀", inline=True)

        if top_pinged:
            pinged_lines = []
            for i, stat in enumerate(top_pinged):
                try:
                    member = await interaction.guild.fetch_member(int(stat.user_id))
                    name = member.display_name
                except discord.DiscordException as e:
                    logger.warning("Failed to fetch member", user_id=stat.user_id, error=str(e))
                    name = f"Unknown ({stat.user_id})"
                rank = rank_emojis[i] if i < len(rank_emojis) else f"{i + 1}."
                pinged_lines.append(f"{rank} {name}: {stat.times_pinged}")
            embed.add_field(name="🥛 Most Sucked", value="\n".join(pinged_lines), inline=True)
        else:
            embed.add_field(name="🥛 Most Sucked", value="No data yet 💀", inline=True)

        await interaction.followup.send(embed=embed)


async def setup(bot: "IntelStreamBot") -> None:
    await bot.add_cog(SuckBoobs(bot))
