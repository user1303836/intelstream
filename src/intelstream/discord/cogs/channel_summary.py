from typing import TYPE_CHECKING

import discord
import structlog
from discord import MessageType, app_commands
from discord.ext import commands

from intelstream.services.llm_client import create_llm_client
from intelstream.services.summarizer import SummarizationService

if TYPE_CHECKING:
    from intelstream.bot import IntelStreamBot

logger = structlog.get_logger()

MAX_MESSAGE_COUNT = 500
DEFAULT_MESSAGE_COUNT = 200


class ChannelSummary(commands.Cog):
    def __init__(self, bot: "IntelStreamBot") -> None:
        self.bot = bot
        self._summarizer: SummarizationService | None = None

    async def cog_load(self) -> None:
        llm_client = create_llm_client(
            provider=self.bot.settings.llm_provider,
            api_key=self.bot.settings.llm_api_key,
            model=self.bot.settings.summary_model_interactive,
        )
        self._summarizer = SummarizationService(
            client=llm_client,
            max_tokens=self.bot.settings.summary_max_tokens,
            max_input_length=self.bot.settings.summary_max_input_length,
        )
        logger.info("ChannelSummary cog loaded")

    @app_commands.command(
        name="summary",
        description="Summarize recent messages in a channel",
    )
    @app_commands.describe(
        count="Number of messages to summarize (default: 200, max: 500)",
        channel="Channel to summarize (defaults to current channel)",
    )
    @app_commands.checks.cooldown(rate=1, per=60.0, key=lambda i: i.channel_id)
    async def summary(
        self,
        interaction: discord.Interaction,
        count: app_commands.Range[int, 10, MAX_MESSAGE_COUNT] = DEFAULT_MESSAGE_COUNT,
        channel: discord.TextChannel | None = None,
    ) -> None:
        await interaction.response.defer()

        target_channel = channel or interaction.channel
        if not isinstance(target_channel, discord.TextChannel):
            await interaction.followup.send(
                "This command can only be used in text channels.", ephemeral=True
            )
            return

        logger.info(
            "summary command invoked",
            user_id=interaction.user.id,
            channel_id=target_channel.id,
            count=count,
        )

        messages: list[discord.Message] = []
        async for msg in target_channel.history(limit=count, oldest_first=False):
            if msg.author.bot:
                continue
            if msg.type != MessageType.default and msg.type != MessageType.reply:
                continue
            if not msg.content and not msg.attachments and not msg.embeds:
                continue
            messages.append(msg)

        if len(messages) < 5:
            await interaction.followup.send(
                "Not enough messages to summarize (need at least 5 non-bot messages).",
                ephemeral=True,
            )
            return

        messages.reverse()
        formatted = self._format_messages(messages)

        try:
            assert self._summarizer is not None
            result = await self._summarizer.summarize_chat(
                messages_text=formatted,
                message_count=len(messages),
            )
        except Exception as e:
            logger.error("Failed to generate channel summary", error=str(e))
            await interaction.followup.send(
                "Failed to generate summary. Please try again later.", ephemeral=True
            )
            return

        channel_mention = (
            f" for {target_channel.mention}" if target_channel != interaction.channel else ""
        )
        header = f"**Channel Summary{channel_mention}** ({len(messages)} messages)\n\n"
        full_text = header + result

        if len(full_text) > 2000:
            full_text = full_text[:1997] + "..."

        await interaction.followup.send(full_text)

    def _format_messages(self, messages: list[discord.Message]) -> str:
        lines: list[str] = []
        for msg in messages:
            ts = msg.created_at.strftime("%Y-%m-%d %H:%M")
            content = msg.content or ""

            extras: list[str] = []
            if msg.attachments:
                extras.append(
                    f"[{len(msg.attachments)} attachment(s): "
                    + ", ".join(a.filename for a in msg.attachments)
                    + "]"
                )
            if msg.embeds:
                extras.append(f"[{len(msg.embeds)} embed(s)]")

            full_content = content
            if extras:
                full_content = (content + " " + " ".join(extras)).strip()

            lines.append(f"[{ts}] {msg.author.display_name}: {full_content}")

        return "\n".join(lines)

    @summary.error
    async def summary_error(
        self, interaction: discord.Interaction, error: app_commands.AppCommandError
    ) -> None:
        if isinstance(error, app_commands.CommandOnCooldown):
            seconds = int(error.retry_after)
            await interaction.response.send_message(
                f"This command is on cooldown. Try again in {seconds}s.",
                ephemeral=True,
            )
        else:
            raise error


async def setup(bot: "IntelStreamBot") -> None:
    await bot.add_cog(ChannelSummary(bot))
