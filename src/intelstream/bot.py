import asyncio
from datetime import UTC, datetime
from typing import TYPE_CHECKING, Any

import discord
import structlog
from discord import app_commands
from discord.ext import commands

from intelstream.config import Settings, get_database_directory
from intelstream.database.repository import Repository

if TYPE_CHECKING:
    from intelstream.database.models import Source

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
        intents.members = True

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
        logger.info("Shutting down bot...")

        async def unload_all_cogs() -> None:
            for cog_name in list(self.cogs.keys()):
                try:
                    await asyncio.wait_for(self.remove_cog(cog_name), timeout=10.0)
                    logger.debug("Unloaded cog", cog=cog_name)
                except TimeoutError:
                    logger.error("Cog unload timed out", cog=cog_name)
                except Exception as e:
                    logger.error("Error unloading cog", cog=cog_name, error=str(e))

        try:
            await asyncio.wait_for(unload_all_cogs(), timeout=30.0)
        except TimeoutError:
            logger.error("Total cog unload exceeded 30s timeout")

        try:
            await asyncio.wait_for(self.repository.close(), timeout=5.0)
        except TimeoutError:
            logger.error("Repository close timed out")
        except Exception as e:
            logger.error("Error closing repository", error=str(e))
        finally:
            await super().close()


class CoreCommands(commands.Cog):
    def __init__(self, bot: IntelStreamBot) -> None:
        self.bot = bot

    def _format_uptime(self) -> str:
        if not self.bot.start_time:
            return "Unknown"
        delta = datetime.now(UTC) - self.bot.start_time
        hours, remainder = divmod(int(delta.total_seconds()), 3600)
        minutes, seconds = divmod(remainder, 60)
        return f"{hours}h {minutes}m {seconds}s"

    def _format_relative_time(self, dt: datetime) -> str:
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=UTC)
        delta = datetime.now(UTC) - dt
        total_seconds = int(delta.total_seconds())

        if total_seconds < 60:
            return "just now"
        elif total_seconds < 3600:
            mins = total_seconds // 60
            return f"{mins}m ago"
        elif total_seconds < 86400:
            hours = total_seconds // 3600
            return f"{hours}h ago"
        else:
            days = total_seconds // 86400
            return f"{days}d ago"

    def _get_source_status_icon(self, source: "Source") -> str:
        from intelstream.database.models import PauseReason

        if source.is_active:
            if source.consecutive_failures and source.consecutive_failures > 0:
                return "!"  # Warning - has failures but still active
            return "+"  # Active and healthy
        else:
            if source.pause_reason == PauseReason.CONSECUTIVE_FAILURES.value:
                return "X"  # Disabled due to failures
            return "-"  # Paused by user

    @app_commands.command(name="status", description="Show bot status and information")
    async def status(self, interaction: discord.Interaction) -> None:
        guild_id = str(interaction.guild_id) if interaction.guild_id else None

        sources = await self.bot.repository.get_all_sources(active_only=False)
        active_sources = [s for s in sources if s.is_active]
        failing_sources = [
            s for s in sources if s.consecutive_failures and s.consecutive_failures > 0
        ]

        content_stats = await self.bot.repository.get_content_stats(guild_id)
        last_posted = await self.bot.repository.get_last_posted_content(guild_id)

        forwarding_rules = []
        if guild_id:
            forwarding_rules = await self.bot.repository.get_forwarding_rules_for_guild(guild_id)
        active_rules = [r for r in forwarding_rules if r.is_active]

        default_config = None
        if guild_id:
            default_config = await self.bot.repository.get_discord_config(guild_id)

        embed = discord.Embed(
            title="IntelStream Status",
            color=discord.Color.green() if not failing_sources else discord.Color.orange(),
            timestamp=datetime.now(UTC),
        )

        status_lines = [
            f"**Uptime:** {self._format_uptime()}",
            f"**Latency:** {round(self.bot.latency * 1000)}ms",
            f"**Poll Interval:** {self.bot.settings.content_poll_interval_minutes}m",
        ]
        embed.add_field(name="System", value="\n".join(status_lines), inline=True)

        content_lines = [
            f"**Fetched:** {content_stats['total_fetched']}",
            f"**Posted:** {content_stats['total_posted']}",
        ]
        if last_posted and last_posted.created_at:
            content_lines.append(
                f"**Last Post:** {self._format_relative_time(last_posted.created_at)}"
            )
        else:
            content_lines.append("**Last Post:** Never")
        embed.add_field(name="Content", value="\n".join(content_lines), inline=True)

        source_summary = f"**Active:** {len(active_sources)} / {len(sources)}"
        if failing_sources:
            source_summary += f"\n**With Errors:** {len(failing_sources)}"
        embed.add_field(name="Sources", value=source_summary, inline=True)

        if sources:
            source_list = []
            for source in sources[:8]:
                icon = self._get_source_status_icon(source)
                channel_mention = f"<#{source.channel_id}>" if source.channel_id else "No channel"

                failure_note = ""
                if source.consecutive_failures and source.consecutive_failures > 0:
                    failure_note = f" ({source.consecutive_failures} failures)"

                source_list.append(
                    f"`{icon}` **{source.name}** ({source.type.value}) -> {channel_mention}{failure_note}"
                )

            if len(sources) > 8:
                source_list.append(f"*... and {len(sources) - 8} more*")

            embed.add_field(
                name="Configured Sources",
                value="\n".join(source_list),
                inline=False,
            )

        if forwarding_rules:
            rule_list = []
            for rule in forwarding_rules[:5]:
                status = "+" if rule.is_active else "-"
                forwarded_count = f" ({rule.messages_forwarded or 0} msgs)"
                rule_list.append(
                    f"`{status}` <#{rule.source_channel_id}> -> <#{rule.destination_channel_id}>{forwarded_count}"
                )

            if len(forwarding_rules) > 5:
                rule_list.append(f"*... and {len(forwarding_rules) - 5} more*")

            embed.add_field(
                name=f"Forwarding Rules ({len(active_rules)} active)",
                value="\n".join(rule_list),
                inline=False,
            )

        if default_config and default_config.channel_id:
            embed.add_field(
                name="Default Output",
                value=f"<#{default_config.channel_id}>",
                inline=True,
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
