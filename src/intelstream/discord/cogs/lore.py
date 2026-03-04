from __future__ import annotations

import re
from datetime import UTC, datetime, timedelta
from typing import TYPE_CHECKING

import discord
import structlog
from discord import MessageType, app_commands
from discord.ext import commands, tasks

from intelstream.services.llm_client import LLMClient, create_llm_client
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
    "Based on the message excerpts provided, answer the user's question. "
    "Organize the information chronologically. Include specific quotes when relevant. "
    "Mention usernames. If the excerpts don't contain enough information, "
    "say what you found and note that the history may be incomplete."
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
        self._llm_client: LLMClient | None = None
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
        try:
            self._llm_client = create_llm_client(
                provider=self.bot.settings.llm_provider,
                api_key=self.bot.settings.llm_api_key,
                model=self.bot.settings.summary_model_interactive,
            )
        except ValueError:
            logger.warning("No LLM API key configured; /lore queries will be disabled")
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
        if self._llm_client:
            await self._llm_client.close()
        logger.info("Lore cog unloaded")

    @app_commands.command(name="lore", description="Ask about server history and lore")
    @app_commands.describe(
        query="What do you want to know about?",
        channel="Limit search to a specific channel",
        timeframe="Time range, e.g. 'last 6 months', '2024'",
    )
    async def lore(
        self,
        interaction: discord.Interaction,
        query: str,  # noqa: ARG002
        channel: discord.TextChannel | None = None,  # noqa: ARG002
        timeframe: str | None = None,  # noqa: ARG002
    ) -> None:
        await interaction.response.send_message(
            "The /lore command is temporarily disabled while the message index is being built. "
            "Check back soon!",
            ephemeral=True,
        )

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
                logger.info(
                    "Real-time lore flush",
                    channel=channel_name,
                    chunks=stored,
                    messages=len(buf),
                )

    async def _flush_all_buffers(self) -> None:
        keys = list(self._message_buffers.keys())
        for key in keys:
            await self._flush_buffer(key)

    async def start_ingestion_for_guild(self, guild: discord.Guild) -> None:
        if not self._ingestion_service:
            return
        if self._ingestion_service.is_running:
            return

        progress = await self.bot.repository.get_ingestion_progress_for_guild(str(guild.id))
        in_progress_or_paused = [p for p in progress if p.status in ("in_progress", "paused")]
        all_completed = progress and all(p.status == "completed" for p in progress)

        if all_completed:
            logger.info("Lore ingestion already complete", guild=guild.name)
            return

        if in_progress_or_paused:
            logger.info("Resuming lore ingestion", guild=guild.name)
        else:
            logger.info("Starting lore ingestion", guild=guild.name)

        self._ingestion_service.start_backfill(guild)

    async def auto_start_ingestion(self) -> None:
        for guild in self.bot.guilds:
            await self.start_ingestion_for_guild(guild)
            break
