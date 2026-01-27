from typing import TYPE_CHECKING

import discord
import structlog
from discord import app_commands
from discord.ext import commands

if TYPE_CHECKING:
    from intelstream.bot import IntelStreamBot

logger = structlog.get_logger()


class ConfigManagement(commands.Cog):
    def __init__(self, bot: "IntelStreamBot") -> None:
        self.bot = bot

    config_group = app_commands.Group(
        name="config",
        description="Configure bot settings",
        default_permissions=discord.Permissions(manage_guild=True),
    )

    @config_group.command(name="channel", description="Set the channel for content posts")
    @app_commands.describe(channel="The channel where content summaries will be posted")
    async def config_channel(
        self,
        interaction: discord.Interaction,
        channel: discord.TextChannel,
    ) -> None:
        await interaction.response.defer(ephemeral=True)

        if interaction.guild is None:
            await interaction.followup.send(
                "This command must be used in a server.", ephemeral=True
            )
            return

        bot_member = interaction.guild.get_member(self.bot.user.id) if self.bot.user else None
        if bot_member:
            permissions = channel.permissions_for(bot_member)
            if not permissions.send_messages:
                await interaction.followup.send(
                    f"I don't have permission to send messages in {channel.mention}. "
                    "Please grant me the 'Send Messages' permission.",
                    ephemeral=True,
                )
                return
            if not permissions.embed_links:
                await interaction.followup.send(
                    f"I don't have permission to embed links in {channel.mention}. "
                    "Please grant me the 'Embed Links' permission.",
                    ephemeral=True,
                )
                return

        config = await self.bot.repository.get_or_create_discord_config(
            guild_id=str(interaction.guild.id),
            channel_id=str(channel.id),
        )

        logger.info(
            "Output channel configured",
            guild_id=interaction.guild.id,
            channel_id=channel.id,
            config_id=config.id,
            user_id=interaction.user.id,
        )

        embed = discord.Embed(
            title="Channel Configured",
            description=f"Content summaries will now be posted to {channel.mention}",
            color=discord.Color.green(),
        )

        await interaction.followup.send(embed=embed, ephemeral=True)

    @config_group.command(name="show", description="Show current bot configuration")
    async def config_show(self, interaction: discord.Interaction) -> None:
        await interaction.response.defer(ephemeral=True)

        if interaction.guild is None:
            await interaction.followup.send(
                "This command must be used in a server.", ephemeral=True
            )
            return

        config = await self.bot.repository.get_discord_config(str(interaction.guild.id))

        embed = discord.Embed(
            title="Bot Configuration",
            color=discord.Color.blue(),
        )

        if config:
            channel = self.bot.get_channel(int(config.channel_id))
            if channel and hasattr(channel, "mention"):
                channel_value = channel.mention
            else:
                channel_value = f"Unknown ({config.channel_id})"

            embed.add_field(
                name="Output Channel",
                value=channel_value,
                inline=True,
            )
            embed.add_field(
                name="Status",
                value="Active" if config.is_active else "Paused",
                inline=True,
            )
        else:
            embed.add_field(
                name="Output Channel",
                value="Not configured. Use `/config channel` to set one.",
                inline=False,
            )

        sources = await self.bot.repository.get_all_sources(active_only=False)
        active_count = sum(1 for s in sources if s.is_active)

        embed.add_field(
            name="Sources",
            value=f"{active_count} active / {len(sources)} total",
            inline=True,
        )

        embed.add_field(
            name="Poll Interval",
            value=f"{self.bot.settings.content_poll_interval_minutes} minutes",
            inline=True,
        )

        await interaction.followup.send(embed=embed, ephemeral=True)


async def setup(bot: "IntelStreamBot") -> None:
    await bot.add_cog(ConfigManagement(bot))
