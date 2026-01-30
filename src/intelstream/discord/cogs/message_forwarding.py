import asyncio
from typing import TYPE_CHECKING, Any

import discord
import structlog
from discord import app_commands
from discord.ext import commands

from intelstream.services.message_forwarder import MessageForwarder

if TYPE_CHECKING:
    from intelstream.bot import IntelStreamBot

logger = structlog.get_logger()


class MessageForwarding(commands.Cog):
    forward_group = app_commands.Group(
        name="forward",
        description="Manage message forwarding rules",
    )

    def __init__(self, bot: "IntelStreamBot") -> None:
        self.bot = bot
        self.forwarder = MessageForwarder(bot)
        self._rules_cache: dict[str, list[Any]] = {}
        self._cache_lock = asyncio.Lock()

    @commands.Cog.listener()
    async def on_ready(self) -> None:
        await self._refresh_cache()

    async def _refresh_cache(self) -> None:
        async with self._cache_lock:
            new_cache: dict[str, list[Any]] = {}
            total_rules = 0
            for guild in self.bot.guilds:
                rules = await self.bot.repository.get_forwarding_rules_for_guild(str(guild.id))
                for rule in rules:
                    if rule.is_active:
                        if rule.source_channel_id not in new_cache:
                            new_cache[rule.source_channel_id] = []
                        new_cache[rule.source_channel_id].append(rule)
                        total_rules += 1

            self._rules_cache = new_cache

            logger.info(
                "Forwarding rules cache refreshed",
                total_active_rules=total_rules,
                source_channels=list(self._rules_cache.keys()),
            )

    @commands.Cog.listener()
    async def on_message(self, message: discord.Message) -> None:
        if message.author == self.bot.user:
            return

        if message.guild is None:
            return

        channel_id = str(message.channel.id)
        rules = self._rules_cache.get(channel_id, [])

        if not rules:
            return

        for rule in rules:
            destination_id = int(rule.destination_channel_id)

            forwarded = await self.forwarder.forward_message(
                message=message,
                destination_id=destination_id,
                destination_type=rule.destination_type,
            )

            if forwarded:
                await self.bot.repository.increment_forwarding_count(rule.id)
                logger.debug(
                    "Forward succeeded, count incremented",
                    rule_id=rule.id,
                    forwarded_message_id=forwarded.id,
                )
            else:
                logger.warning(
                    "Forward failed",
                    source_channel_id=channel_id,
                    destination_id=destination_id,
                    destination_type=rule.destination_type,
                    rule_id=rule.id,
                )

    @forward_group.command(name="add", description="Add a forwarding rule")
    @app_commands.describe(
        source="Source channel or thread to forward FROM",
        destination="Destination channel or thread to forward TO",
    )
    @app_commands.default_permissions(administrator=True)
    async def forward_add(
        self,
        interaction: discord.Interaction,
        source: discord.TextChannel | discord.Thread,
        destination: discord.TextChannel | discord.Thread,
    ) -> None:
        await interaction.response.defer(ephemeral=True)

        if interaction.guild is None:
            await interaction.followup.send(
                "This command can only be used in a server.", ephemeral=True
            )
            return

        source_type = "thread" if isinstance(source, discord.Thread) else "channel"
        destination_type = "thread" if isinstance(destination, discord.Thread) else "channel"

        existing = await self.bot.repository.get_forwarding_rules_for_source(str(source.id))
        for rule in existing:
            if rule.destination_channel_id == str(destination.id):
                await interaction.followup.send(
                    f"A forwarding rule from {source.mention} to {destination.mention} already exists.",
                    ephemeral=True,
                )
                return

        if not destination.permissions_for(interaction.guild.me).send_messages:
            await interaction.followup.send(
                f"I don't have permission to send messages in {destination.mention}.",
                ephemeral=True,
            )
            return

        member = interaction.user
        if (
            isinstance(member, discord.Member)
            and not destination.permissions_for(member).send_messages
        ):
            await interaction.followup.send(
                f"You don't have permission to send messages in {destination.mention}.",
                ephemeral=True,
            )
            return

        await self.bot.repository.add_forwarding_rule(
            guild_id=str(interaction.guild_id),
            source_channel_id=str(source.id),
            source_type=source_type,
            destination_channel_id=str(destination.id),
            destination_type=destination_type,
        )

        await self._refresh_cache()

        logger.info(
            "Forwarding rule added",
            source_id=source.id,
            destination_id=destination.id,
            user_id=interaction.user.id,
        )

        await interaction.followup.send(
            f"Forwarding configured: {source.mention} -> {destination.mention}",
            ephemeral=True,
        )

    @forward_group.command(name="list", description="List all forwarding rules")
    @app_commands.default_permissions(administrator=True)
    async def forward_list(self, interaction: discord.Interaction) -> None:
        await interaction.response.defer(ephemeral=True)

        if interaction.guild is None:
            await interaction.followup.send(
                "This command can only be used in a server.", ephemeral=True
            )
            return

        rules = await self.bot.repository.get_forwarding_rules_for_guild(str(interaction.guild_id))

        if not rules:
            await interaction.followup.send("No forwarding rules configured.", ephemeral=True)
            return

        lines = ["**Forwarding Rules:**", ""]
        for i, rule in enumerate(rules, 1):
            source = self.bot.get_channel(int(rule.source_channel_id))
            dest = self.bot.get_channel(int(rule.destination_channel_id))

            if dest is None:
                for guild in self.bot.guilds:
                    dest = guild.get_thread(int(rule.destination_channel_id))
                    if dest:
                        break

            source_name = (
                source.mention
                if source and hasattr(source, "mention")
                else f"Unknown ({rule.source_channel_id})"
            )
            dest_name = (
                dest.mention
                if dest and hasattr(dest, "mention")
                else f"Unknown ({rule.destination_channel_id})"
            )
            status = "active" if rule.is_active else "paused"

            lines.append(
                f"{i}. {source_name} -> {dest_name} ({status}, {rule.messages_forwarded} forwarded)"
            )

        await interaction.followup.send("\n".join(lines), ephemeral=True)

    @forward_group.command(name="remove", description="Remove a forwarding rule")
    @app_commands.describe(
        source="Source channel to stop forwarding from",
        destination="Destination channel/thread to stop forwarding to",
    )
    @app_commands.default_permissions(administrator=True)
    async def forward_remove(
        self,
        interaction: discord.Interaction,
        source: discord.TextChannel | discord.Thread,
        destination: discord.TextChannel | discord.Thread,
    ) -> None:
        await interaction.response.defer(ephemeral=True)

        if interaction.guild is None:
            await interaction.followup.send(
                "This command can only be used in a server.", ephemeral=True
            )
            return

        deleted = await self.bot.repository.delete_forwarding_rule(
            guild_id=str(interaction.guild_id),
            source_channel_id=str(source.id),
            destination_channel_id=str(destination.id),
        )

        if deleted:
            await self._refresh_cache()
            logger.info(
                "Forwarding rule removed",
                source_id=source.id,
                destination_id=destination.id,
                user_id=interaction.user.id,
            )
            await interaction.followup.send(
                f"Forwarding rule {source.mention} -> {destination.mention} removed.",
                ephemeral=True,
            )
        else:
            await interaction.followup.send(
                f"No forwarding rule found from {source.mention} to {destination.mention}.",
                ephemeral=True,
            )

    @forward_group.command(name="pause", description="Pause a forwarding rule")
    @app_commands.describe(
        source="Source channel to pause forwarding from",
        destination="Destination channel/thread to pause forwarding to",
    )
    @app_commands.default_permissions(administrator=True)
    async def forward_pause(
        self,
        interaction: discord.Interaction,
        source: discord.TextChannel | discord.Thread,
        destination: discord.TextChannel | discord.Thread,
    ) -> None:
        await interaction.response.defer(ephemeral=True)

        if interaction.guild is None:
            await interaction.followup.send(
                "This command can only be used in a server.", ephemeral=True
            )
            return

        updated = await self.bot.repository.set_forwarding_rule_active(
            guild_id=str(interaction.guild_id),
            source_channel_id=str(source.id),
            destination_channel_id=str(destination.id),
            is_active=False,
        )

        if updated:
            await self._refresh_cache()
            logger.info(
                "Forwarding rule paused",
                source_id=source.id,
                destination_id=destination.id,
                user_id=interaction.user.id,
            )
            await interaction.followup.send(
                f"Forwarding {source.mention} -> {destination.mention} paused.",
                ephemeral=True,
            )
        else:
            await interaction.followup.send(
                f"No forwarding rule found from {source.mention} to {destination.mention}.",
                ephemeral=True,
            )

    @forward_group.command(name="resume", description="Resume a paused forwarding rule")
    @app_commands.describe(
        source="Source channel to resume forwarding from",
        destination="Destination channel/thread to resume forwarding to",
    )
    @app_commands.default_permissions(administrator=True)
    async def forward_resume(
        self,
        interaction: discord.Interaction,
        source: discord.TextChannel | discord.Thread,
        destination: discord.TextChannel | discord.Thread,
    ) -> None:
        await interaction.response.defer(ephemeral=True)

        if interaction.guild is None:
            await interaction.followup.send(
                "This command can only be used in a server.", ephemeral=True
            )
            return

        updated = await self.bot.repository.set_forwarding_rule_active(
            guild_id=str(interaction.guild_id),
            source_channel_id=str(source.id),
            destination_channel_id=str(destination.id),
            is_active=True,
        )

        if updated:
            await self._refresh_cache()
            logger.info(
                "Forwarding rule resumed",
                source_id=source.id,
                destination_id=destination.id,
                user_id=interaction.user.id,
            )
            await interaction.followup.send(
                f"Forwarding {source.mention} -> {destination.mention} resumed.",
                ephemeral=True,
            )
        else:
            await interaction.followup.send(
                f"No forwarding rule found from {source.mention} to {destination.mention}.",
                ephemeral=True,
            )


async def setup(bot: "IntelStreamBot") -> None:
    await bot.add_cog(MessageForwarding(bot))
