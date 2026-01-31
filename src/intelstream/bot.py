from datetime import UTC, datetime
from typing import Any

import discord
import structlog
from discord import app_commands
from discord.ext import commands

from intelstream.config import Settings, get_database_directory
from intelstream.database.repository import Repository

logger = structlog.get_logger(__name__)


class RestrictedCommandTree(app_commands.CommandTree):
    def __init__(self, bot: "IntelStreamBot", *args: Any, **kwargs: Any) -> None:
        super().__init__(bot, *args, **kwargs)

    async def interaction_check(self, interaction: discord.Interaction, /) -> bool:
        if not isinstance(self.client, IntelStreamBot):
            return False
        bot = self.client
        allowed_channel_id = bot.settings.discord_channel_id
        if allowed_channel_id is not None and interaction.channel_id != allowed_channel_id:
            await interaction.response.send_message(
                f"Commands can only be used in <#{allowed_channel_id}>",
                ephemeral=True,
            )
            return False
        return True

    async def on_error(
        self, interaction: discord.Interaction, error: app_commands.AppCommandError
    ) -> None:
        original_error: BaseException = error
        if isinstance(error, app_commands.CommandInvokeError):
            original_error = error.original

        command_name = interaction.command.name if interaction.command else "unknown"

        if isinstance(original_error, discord.Forbidden):
            logger.error(
                "Missing permissions for command response",
                command=command_name,
                user_id=interaction.user.id,
                channel_id=interaction.channel_id,
                error=str(original_error),
            )
            return

        if isinstance(original_error, discord.NotFound):
            logger.warning(
                "Interaction expired or invalid",
                command=command_name,
                user_id=interaction.user.id,
                error=str(original_error),
            )
            return

        if isinstance(original_error, discord.HTTPException):
            logger.error(
                "Discord API error during command",
                command=command_name,
                user_id=interaction.user.id,
                status=original_error.status,
                error=str(original_error),
            )
            await self._send_error_response(
                interaction, "A Discord error occurred. Please try again."
            )
            return

        logger.exception(
            "Unhandled error in command",
            command=command_name,
            user_id=interaction.user.id,
            error=str(original_error),
        )
        await self._send_error_response(
            interaction, "An unexpected error occurred. Please try again."
        )

    async def _send_error_response(self, interaction: discord.Interaction, message: str) -> None:
        try:
            if interaction.response.is_done():
                await interaction.followup.send(message, ephemeral=True)
            else:
                await interaction.response.send_message(message, ephemeral=True)
        except discord.HTTPException:
            pass


class IntelStreamBot(commands.Bot):
    def __init__(self, settings: Settings, repository: Repository) -> None:
        intents = discord.Intents.default()
        intents.message_content = True

        super().__init__(
            command_prefix="!",
            intents=intents,
            help_command=None,
            tree_cls=RestrictedCommandTree,
        )

        self.settings = settings
        self.repository = repository
        self.start_time: datetime | None = None
        self._owner: discord.User | None = None

    async def setup_hook(self) -> None:
        db_dir = get_database_directory(self.settings.database_url)
        if db_dir is not None:
            db_dir.mkdir(parents=True, exist_ok=True)

        await self.repository.initialize()

        if self.settings.discord_channel_id is not None:
            migrated = await self.repository.migrate_sources_to_channel(
                guild_id=str(self.settings.discord_guild_id),
                channel_id=str(self.settings.discord_channel_id),
            )
            if migrated > 0:
                logger.info(
                    f"Migrated {migrated} existing sources to channel {self.settings.discord_channel_id}"
                )

        await self.add_cog(CoreCommands(self))

        from intelstream.discord.cogs import (
            ConfigManagement,
            ContentPosting,
            SourceManagement,
            SuckBoobs,
            Summarize,
        )
        from intelstream.discord.cogs.message_forwarding import MessageForwarding

        await self.add_cog(SourceManagement(self))
        await self.add_cog(ConfigManagement(self))
        await self.add_cog(ContentPosting(self))
        await self.add_cog(Summarize(self))
        await self.add_cog(MessageForwarding(self))
        await self.add_cog(SuckBoobs(self))

        guild = discord.Object(id=self.settings.discord_guild_id)
        self.tree.copy_global_to(guild=guild)
        await self.tree.sync(guild=guild)

        logger.info("Bot setup complete, commands synced")

    async def on_ready(self) -> None:
        self.start_time = datetime.now(UTC)
        logger.info(f"Logged in as {self.user} (ID: {self.user.id if self.user else 'Unknown'})")

        try:
            self._owner = await self.fetch_user(self.settings.discord_owner_id)
            logger.info(f"Owner set to {self._owner}")
        except discord.NotFound:
            logger.warning(f"Could not find owner with ID {self.settings.discord_owner_id}")

    async def on_error(self, event_method: str, *_args: Any, **_kwargs: Any) -> None:
        logger.exception(f"Error in {event_method}")
        await self.notify_owner(f"Error in {event_method}. Check logs for details.")

    async def notify_owner(self, message: str) -> None:
        if self._owner is None:
            try:
                self._owner = await self.fetch_user(self.settings.discord_owner_id)
            except discord.NotFound:
                logger.error("Cannot notify owner: user not found")
                return

        if len(message) > 1900:
            message = message[:1900] + "... (truncated)"

        try:
            await self._owner.send(f"**IntelStream Alert**\n{message}")
            logger.info(f"Notified owner: {message[:50]}...")
        except discord.NotFound:
            logger.error("Owner user not found - check DISCORD_OWNER_ID")
            self._owner = None
        except discord.Forbidden:
            logger.error("Cannot DM owner: DMs may be disabled")
        except discord.HTTPException as e:
            logger.error(f"Failed to DM owner: {e}")

    async def close(self) -> None:
        await self.repository.close()
        await super().close()


class CoreCommands(commands.Cog):
    def __init__(self, bot: IntelStreamBot) -> None:
        self.bot = bot

    @app_commands.command(name="status", description="Show bot status and information")
    async def status(self, interaction: discord.Interaction) -> None:
        sources = await self.bot.repository.get_all_sources(active_only=False)
        active_sources = [s for s in sources if s.is_active]

        uptime = "Unknown"
        if self.bot.start_time:
            delta = datetime.now(UTC) - self.bot.start_time
            hours, remainder = divmod(int(delta.total_seconds()), 3600)
            minutes, seconds = divmod(remainder, 60)
            uptime = f"{hours}h {minutes}m {seconds}s"

        embed = discord.Embed(
            title="IntelStream Status",
            color=discord.Color.green(),
            timestamp=datetime.now(UTC),
        )

        embed.add_field(name="Uptime", value=uptime, inline=True)
        embed.add_field(
            name="Sources",
            value=f"{len(active_sources)} active / {len(sources)} total",
            inline=True,
        )
        embed.add_field(
            name="Latency",
            value=f"{round(self.bot.latency * 1000)}ms",
            inline=True,
        )

        if sources:
            source_list = []
            for source in sources[:10]:
                status_icon = "+" if source.is_active else "-"
                last_poll = (
                    source.last_polled_at.strftime("%Y-%m-%d %H:%M")
                    if source.last_polled_at
                    else "Never"
                )
                source_list.append(
                    f"`{status_icon}` **{source.name}** ({source.type.value}) - Last poll: {last_poll}"
                )

            if len(sources) > 10:
                source_list.append(f"... and {len(sources) - 10} more")

            embed.add_field(
                name="Configured Sources",
                value="\n".join(source_list) if source_list else "No sources configured",
                inline=False,
            )

        embed.set_footer(text="IntelStream")

        await interaction.response.send_message(embed=embed)

    @app_commands.command(name="ping", description="Check if the bot is responsive")
    async def ping(self, interaction: discord.Interaction) -> None:
        latency = round(self.bot.latency * 1000)
        await interaction.response.send_message(f"Pong! Latency: {latency}ms")


async def create_bot(settings: Settings) -> IntelStreamBot:
    repository = Repository(settings.database_url)
    bot = IntelStreamBot(settings, repository)
    return bot


async def run_bot(settings: Settings) -> None:
    bot = await create_bot(settings)
    try:
        await bot.start(settings.discord_bot_token)
    finally:
        await bot.close()
