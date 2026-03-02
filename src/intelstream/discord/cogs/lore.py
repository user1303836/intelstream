from __future__ import annotations

import re
from datetime import UTC, datetime, timedelta
from typing import TYPE_CHECKING

import anthropic
import discord
import structlog
from discord import MessageType, app_commands
from discord.ext import commands, tasks

from intelstream.services.message_ingestion import (
    MessageChunker,
    MessageIngestionService,
    RawMessage,
    discord_message_to_raw,
)

if TYPE_CHECKING:
    from intelstream.bot import IntelStreamBot
    from intelstream.database.vector_store import VectorStore
    from intelstream.services.embedding_service import EmbeddingService

logger = structlog.get_logger(__name__)

LORE_SYSTEM_PROMPT = (
    "You are a Discord server historian. Based on the message excerpts provided, "
    "tell the story of what was asked about. Organize the information chronologically. "
    "Include specific quotes when they are interesting or funny. Mention usernames. "
    "If the excerpts don't contain enough information to tell a complete story, "
    "say what you found and note that the history may be incomplete. "
    "Be conversational and engaging -- this is server lore, not a formal report."
)

BUFFER_FLUSH_MINUTES = 5
MAX_DISCORD_MESSAGE_LENGTH = 2000


def _parse_timeframe(timeframe: str) -> tuple[datetime | None, datetime | None]:
    now = datetime.now(UTC)
    lower = timeframe.lower().strip()

    match = re.match(r"last\s+(\d+)\s+(day|week|month|year)s?", lower)
    if match:
        amount = int(match.group(1))
        unit = match.group(2)
        deltas = {
            "day": timedelta(days=amount),
            "week": timedelta(weeks=amount),
            "month": timedelta(days=amount * 30),
            "year": timedelta(days=amount * 365),
        }
        return now - deltas[unit], now

    if re.match(r"^\d{4}$", lower):
        year = int(lower)
        return datetime(year, 1, 1, tzinfo=UTC), datetime(year, 12, 31, 23, 59, 59, tzinfo=UTC)

    return None, None


class Lore(commands.Cog):
    def __init__(
        self,
        bot: IntelStreamBot,
        embedding_service: EmbeddingService,
        vector_store: VectorStore,
    ) -> None:
        self.bot = bot
        self._embedding_service = embedding_service
        self._vector_store = vector_store
        self._ingestion_service: MessageIngestionService | None = None
        self._anthropic: anthropic.AsyncAnthropic | None = None
        self._message_buffers: dict[str, list[RawMessage]] = {}
        self._chunker: MessageChunker | None = None

    async def cog_load(self) -> None:
        self._ingestion_service = MessageIngestionService(
            repository=self.bot.repository,
            embedding_service=self._embedding_service,
            vector_store=self._vector_store,
            gap_minutes=self.bot.settings.lore_chunk_gap_minutes,
            max_messages=self.bot.settings.lore_chunk_max_messages,
        )
        self._anthropic = anthropic.AsyncAnthropic(
            api_key=self.bot.settings.anthropic_api_key,
        )
        self._chunker = MessageChunker(
            gap_minutes=self.bot.settings.lore_chunk_gap_minutes,
            max_messages=self.bot.settings.lore_chunk_max_messages,
        )
        self._flush_buffers.start()
        logger.info("Lore cog loaded")

    async def cog_unload(self) -> None:
        self._flush_buffers.cancel()
        if self._ingestion_service and self._ingestion_service.is_running:
            self._ingestion_service.stop_backfill()
        await self._flush_all_buffers()
        logger.info("Lore cog unloaded")

    lore_group = app_commands.Group(name="lore", description="Server lore and history commands")

    @lore_group.command(name="query", description="Query server lore with natural language")
    @app_commands.describe(
        query="What do you want to know about?",
        channel="Limit search to a specific channel",
        timeframe="Time range, e.g. 'last 6 months', '2024'",
    )
    @app_commands.checks.cooldown(rate=1, per=120.0)
    async def lore_query(
        self,
        interaction: discord.Interaction,
        query: str,
        channel: discord.TextChannel | None = None,
        timeframe: str | None = None,
    ) -> None:
        await interaction.response.defer()

        guild_id = str(interaction.guild_id) if interaction.guild_id else None
        if not guild_id:
            await interaction.followup.send(
                "This command can only be used in a server.", ephemeral=True
            )
            return

        logger.info(
            "lore query invoked",
            user_id=interaction.user.id,
            query=query,
            channel=channel.name if channel else None,
            timeframe=timeframe,
        )

        query_embedding = await self._embedding_service.embed_text(query)
        topk = self.bot.settings.lore_search_results * 2
        results = await self._vector_store.search_message_chunks(query_embedding, topk=topk)

        if not results:
            await interaction.followup.send(
                "No lore found. The message index may be empty. Run `/lore setup` first.",
                ephemeral=True,
            )
            return

        chunk_ids = [r.chunk_id for r in results]
        metas = await self.bot.repository.get_message_chunk_metas_by_ids(chunk_ids)
        metas_by_id = {m.id: m for m in metas}

        filtered = []
        for result in results:
            meta = metas_by_id.get(result.chunk_id)
            if meta is None:
                continue
            if meta.guild_id != guild_id:
                continue
            if channel and meta.channel_id != str(channel.id):
                continue
            if timeframe:
                start_dt, end_dt = _parse_timeframe(timeframe)
                if start_dt and meta.end_timestamp < start_dt:
                    continue
                if end_dt and meta.start_timestamp > end_dt:
                    continue
            filtered.append(meta)

        max_results = self.bot.settings.lore_search_results
        filtered = filtered[:max_results]

        if not filtered:
            await interaction.followup.send(
                "No relevant lore found for that query.", ephemeral=True
            )
            return

        filtered.sort(key=lambda m: m.start_timestamp)

        context_parts = []
        for meta in filtered:
            ch_name = meta.channel_name or "unknown"
            ts = meta.start_timestamp.strftime("%Y-%m-%d")
            context_parts.append(f"--- #{ch_name} ({ts}) ---\n{meta.text}")
        context_text = "\n\n".join(context_parts)

        prompt = (
            f"Based on the following message excerpts from this server's history, "
            f'tell the story of: "{query}"\n\n'
            f"--- Message History ---\n{context_text}"
        )

        assert self._anthropic is not None
        try:
            message = await self._anthropic.messages.create(
                model=self.bot.settings.summary_model_interactive,
                max_tokens=2048,
                system=LORE_SYSTEM_PROMPT,
                messages=[{"role": "user", "content": prompt}],
            )
            response_text = "\n\n".join(
                block.text for block in message.content if hasattr(block, "text")
            ).strip()
        except Exception as e:
            logger.error("Failed to generate lore response", error=str(e))
            await interaction.followup.send(
                "Failed to generate lore response. Please try again later.", ephemeral=True
            )
            return

        if len(response_text) <= MAX_DISCORD_MESSAGE_LENGTH:
            await interaction.followup.send(response_text)
        else:
            parts = _split_message(response_text)
            for part in parts:
                await interaction.followup.send(part)

    @lore_group.command(
        name="setup", description="Start ingesting server message history (admin only)"
    )
    @app_commands.checks.has_permissions(administrator=True)
    async def lore_setup(self, interaction: discord.Interaction) -> None:
        await interaction.response.defer(ephemeral=True)

        if not interaction.guild:
            await interaction.followup.send(
                "This command can only be used in a server.", ephemeral=True
            )
            return

        assert self._ingestion_service is not None

        if self._ingestion_service.is_running:
            await interaction.followup.send("Ingestion is already running.", ephemeral=True)
            return

        channels = [
            ch
            for ch in interaction.guild.text_channels
            if ch.permissions_for(interaction.guild.me).read_message_history
        ]

        self._ingestion_service.start_backfill(interaction.guild)

        await interaction.followup.send(
            f"Started message ingestion for {len(channels)} channels. "
            f"Use `/lore status` to check progress.",
            ephemeral=True,
        )

    @lore_group.command(name="status", description="Show message ingestion progress")
    async def lore_status(self, interaction: discord.Interaction) -> None:
        guild_id = str(interaction.guild_id) if interaction.guild_id else None
        if not guild_id:
            await interaction.response.send_message("Server only.", ephemeral=True)
            return

        progress_list = await self.bot.repository.get_ingestion_progress_for_guild(guild_id)
        if not progress_list:
            await interaction.response.send_message(
                "No ingestion started. Run `/lore setup` to begin.", ephemeral=True
            )
            return

        lines = []
        total_fetched = 0
        completed = 0
        for p in progress_list:
            status_icon = {
                "pending": "-",
                "in_progress": ">",
                "completed": "+",
                "paused": "||",
            }.get(p.status, "?")
            lines.append(
                f"`{status_icon}` <#{p.channel_id}> -- {p.total_fetched:,} messages ({p.status})"
            )
            total_fetched += p.total_fetched or 0
            if p.status == "completed":
                completed += 1

        header = f"**Lore Ingestion** ({completed}/{len(progress_list)} channels done, {total_fetched:,} total messages)\n"
        text = header + "\n".join(lines[:20])
        if len(progress_list) > 20:
            text += f"\n*... and {len(progress_list) - 20} more channels*"

        if len(text) > MAX_DISCORD_MESSAGE_LENGTH:
            text = text[: MAX_DISCORD_MESSAGE_LENGTH - 3] + "..."

        await interaction.response.send_message(text, ephemeral=True)

    @lore_group.command(name="pause", description="Pause message ingestion (admin only)")
    @app_commands.checks.has_permissions(administrator=True)
    async def lore_pause(self, interaction: discord.Interaction) -> None:
        assert self._ingestion_service is not None
        if not self._ingestion_service.is_running:
            await interaction.response.send_message("No ingestion is running.", ephemeral=True)
            return
        self._ingestion_service.pause()
        await interaction.response.send_message("Ingestion paused.", ephemeral=True)

    @lore_group.command(name="resume", description="Resume paused message ingestion (admin only)")
    @app_commands.checks.has_permissions(administrator=True)
    async def lore_resume(self, interaction: discord.Interaction) -> None:
        if not interaction.guild:
            await interaction.response.send_message("Server only.", ephemeral=True)
            return
        assert self._ingestion_service is not None
        if self._ingestion_service.is_running:
            self._ingestion_service.resume()
            await interaction.response.send_message("Ingestion resumed.", ephemeral=True)
        else:
            self._ingestion_service.start_backfill(interaction.guild)
            await interaction.response.send_message("Restarted ingestion.", ephemeral=True)

    @commands.Cog.listener("on_message")
    async def on_message(self, message: discord.Message) -> None:
        if not message.guild:
            return
        if message.author.bot:
            return
        if message.type not in (MessageType.default, MessageType.reply):
            return
        if not message.content:
            return

        channel_key = f"{message.guild.id}:{message.channel.id}"
        raw = discord_message_to_raw(message)

        if channel_key not in self._message_buffers:
            self._message_buffers[channel_key] = []

        buf = self._message_buffers[channel_key]

        if buf:
            gap = raw.created_at - buf[-1].created_at
            gap_threshold = timedelta(minutes=self.bot.settings.lore_chunk_gap_minutes)
            if gap > gap_threshold:
                await self._flush_buffer(channel_key)

        self._message_buffers.setdefault(channel_key, []).append(raw)
        buf = self._message_buffers[channel_key]

        if len(buf) >= self.bot.settings.lore_chunk_max_messages:
            await self._flush_buffer(channel_key)

    @tasks.loop(minutes=BUFFER_FLUSH_MINUTES)
    async def _flush_buffers(self) -> None:
        keys = list(self._message_buffers.keys())
        for key in keys:
            buf = self._message_buffers.get(key)
            if buf:
                await self._flush_buffer(key)

    async def _flush_buffer(self, channel_key: str) -> None:
        buf = self._message_buffers.pop(channel_key, [])
        if not buf:
            return

        parts = channel_key.split(":", 1)
        if len(parts) != 2:
            return
        guild_id, channel_id = parts

        channel_name = ""
        guild = self.bot.get_guild(int(guild_id))
        if guild:
            ch = guild.get_channel(int(channel_id))
            if ch and isinstance(ch, discord.TextChannel):
                channel_name = ch.name

        assert self._chunker is not None
        chunks = self._chunker.chunk_messages(buf, guild_id, channel_id, channel_name)
        if chunks and self._ingestion_service:
            stored = await self._ingestion_service.store_chunks(chunks)
            if stored > 0:
                logger.debug(
                    "Flushed real-time message buffer",
                    channel=channel_name,
                    chunks=stored,
                    messages=len(buf),
                )

    async def _flush_all_buffers(self) -> None:
        keys = list(self._message_buffers.keys())
        for key in keys:
            await self._flush_buffer(key)

    async def auto_resume_ingestion(self) -> None:
        if not self.bot.settings.lore_auto_resume:
            return

        in_progress = await self.bot.repository.get_in_progress_ingestions()
        if not in_progress:
            return

        guild_ids = {p.guild_id for p in in_progress}
        for gid in guild_ids:
            guild = self.bot.get_guild(int(gid))
            if guild and self._ingestion_service:
                logger.info("Auto-resuming ingestion", guild=guild.name)
                self._ingestion_service.start_backfill(guild)
                break

    @lore_query.error
    async def lore_query_error(
        self, interaction: discord.Interaction, error: app_commands.AppCommandError
    ) -> None:
        if isinstance(error, app_commands.CommandOnCooldown):
            minutes, seconds = divmod(int(error.retry_after), 60)
            time_str = f"{minutes}m {seconds}s" if minutes > 0 else f"{seconds}s"
            await interaction.response.send_message(
                f"Lore queries are on cooldown. Try again in {time_str}.", ephemeral=True
            )
        else:
            raise error

    @lore_setup.error
    async def lore_setup_error(
        self, interaction: discord.Interaction, error: app_commands.AppCommandError
    ) -> None:
        if isinstance(error, app_commands.MissingPermissions):
            await interaction.response.send_message(
                "Administrator permissions required.", ephemeral=True
            )
        else:
            raise error

    @lore_pause.error
    async def lore_pause_error(
        self, interaction: discord.Interaction, error: app_commands.AppCommandError
    ) -> None:
        if isinstance(error, app_commands.MissingPermissions):
            await interaction.response.send_message(
                "Administrator permissions required.", ephemeral=True
            )
        else:
            raise error

    @lore_resume.error
    async def lore_resume_error(
        self, interaction: discord.Interaction, error: app_commands.AppCommandError
    ) -> None:
        if isinstance(error, app_commands.MissingPermissions):
            await interaction.response.send_message(
                "Administrator permissions required.", ephemeral=True
            )
        else:
            raise error


def _split_message(text: str, max_len: int = MAX_DISCORD_MESSAGE_LENGTH) -> list[str]:
    if len(text) <= max_len:
        return [text]

    parts: list[str] = []
    while text:
        if len(text) <= max_len:
            parts.append(text)
            break
        split_at = text.rfind("\n", 0, max_len)
        if split_at == -1:
            split_at = max_len
        parts.append(text[:split_at])
        text = text[split_at:].lstrip("\n")
    return parts
