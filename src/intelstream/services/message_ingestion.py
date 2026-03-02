from __future__ import annotations

import asyncio
import json
import re
from dataclasses import dataclass, field
from datetime import UTC, datetime, timedelta
from typing import TYPE_CHECKING

import structlog

if TYPE_CHECKING:
    import discord

    from intelstream.database.models import MessageChunkMeta
    from intelstream.database.repository import Repository
    from intelstream.database.vector_store import VectorStore
    from intelstream.services.embedding_service import EmbeddingService

logger = structlog.get_logger(__name__)

EMOJI_ONLY_PATTERN = re.compile(
    r"^[\s]*(<a?:\w+:\d+>|[\U0001F600-\U0001FFFF\U00002600-\U000027BF"
    r"\U0000FE00-\U0000FE0F\U0001F900-\U0001F9FF\u200d]+[\s]*)+$"
)
URL_ONLY_PATTERN = re.compile(r"^https?://\S+$")

CHECKPOINT_INTERVAL = 1000
YIELD_INTERVAL = 500
EMBED_BATCH_SIZE = 50
LOG_INTERVAL = 10000


@dataclass
class RawMessage:
    id: int
    content: str
    author_name: str
    author_bot: bool
    created_at: datetime
    is_system: bool


@dataclass
class Chunk:
    messages: list[RawMessage] = field(default_factory=list)
    channel_id: str = ""
    channel_name: str = ""
    guild_id: str = ""

    @property
    def start_message_id(self) -> str:
        return str(self.messages[0].id)

    @property
    def end_message_id(self) -> str:
        return str(self.messages[-1].id)

    @property
    def start_timestamp(self) -> datetime:
        return self.messages[0].created_at

    @property
    def end_timestamp(self) -> datetime:
        return self.messages[-1].created_at

    @property
    def authors(self) -> list[str]:
        seen: dict[str, None] = {}
        for m in self.messages:
            seen.setdefault(m.author_name, None)
        return list(seen.keys())

    @property
    def text(self) -> str:
        lines = []
        for m in self.messages:
            ts = m.created_at.strftime("%Y-%m-%d %H:%M")
            lines.append(f"[{ts}] {m.author_name}: {m.content}")
        return "\n".join(lines)

    @property
    def meaningful_count(self) -> int:
        return sum(1 for m in self.messages if not _is_trivial(m.content))


def _is_trivial(content: str) -> bool:
    stripped = content.strip()
    if not stripped:
        return True
    if EMOJI_ONLY_PATTERN.match(stripped):
        return True
    return bool(URL_ONLY_PATTERN.match(stripped))


def _should_skip_message(msg: RawMessage) -> bool:
    if msg.author_bot:
        return True
    if msg.is_system:
        return True
    content = msg.content.strip()
    if not content:
        return True
    return content.startswith("/") or content.startswith("!")


def _should_discard_chunk(chunk: Chunk) -> bool:
    if chunk.meaningful_count < 3:
        return True
    return len(chunk.text) < 50


def discord_message_to_raw(msg: discord.Message) -> RawMessage:
    from discord import MessageType

    return RawMessage(
        id=msg.id,
        content=msg.content or "",
        author_name=msg.author.display_name,
        author_bot=msg.author.bot,
        created_at=msg.created_at.replace(tzinfo=UTC)
        if msg.created_at.tzinfo is None
        else msg.created_at,
        is_system=msg.type not in (MessageType.default, MessageType.reply),
    )


class MessageChunker:
    def __init__(
        self,
        gap_minutes: int = 10,
        max_messages: int = 20,
    ) -> None:
        self._gap = timedelta(minutes=gap_minutes)
        self._max_messages = max_messages

    def chunk_messages(
        self,
        messages: list[RawMessage],
        guild_id: str,
        channel_id: str,
        channel_name: str,
    ) -> list[Chunk]:
        filtered = [m for m in messages if not _should_skip_message(m)]
        if not filtered:
            return []

        chunks: list[Chunk] = []
        current = Chunk(guild_id=guild_id, channel_id=channel_id, channel_name=channel_name)

        for msg in filtered:
            if current.messages:
                time_gap = msg.created_at - current.messages[-1].created_at
                if time_gap > self._gap or len(current.messages) >= self._max_messages:
                    if not _should_discard_chunk(current):
                        chunks.append(current)
                    current = Chunk(
                        guild_id=guild_id, channel_id=channel_id, channel_name=channel_name
                    )
            current.messages.append(msg)

        if current.messages and not _should_discard_chunk(current):
            chunks.append(current)

        return chunks


class MessageIngestionService:
    def __init__(
        self,
        repository: Repository,
        embedding_service: EmbeddingService,
        vector_store: VectorStore,
        gap_minutes: int = 10,
        max_messages: int = 20,
    ) -> None:
        self._repository = repository
        self._embedding_service = embedding_service
        self._vector_store = vector_store
        self._chunker = MessageChunker(gap_minutes=gap_minutes, max_messages=max_messages)
        self._backfill_task: asyncio.Task[None] | None = None
        self._paused = False

    @property
    def is_running(self) -> bool:
        return self._backfill_task is not None and not self._backfill_task.done()

    @property
    def is_paused(self) -> bool:
        return self._paused

    def pause(self) -> None:
        self._paused = True

    def resume(self) -> None:
        self._paused = False

    async def store_chunks(self, chunks: list[Chunk]) -> int:
        if not chunks:
            return 0

        from intelstream.database.models import MessageChunkMeta

        texts = [c.text for c in chunks]
        embeddings = await self._embedding_service.embed_batch(texts)

        metas: list[MessageChunkMeta] = []
        vector_items: list[tuple[str, list[float]]] = []

        for chunk, embedding in zip(chunks, embeddings, strict=True):
            meta = MessageChunkMeta(
                guild_id=chunk.guild_id,
                channel_id=chunk.channel_id,
                channel_name=chunk.channel_name,
                start_message_id=chunk.start_message_id,
                end_message_id=chunk.end_message_id,
                start_timestamp=chunk.start_timestamp,
                end_timestamp=chunk.end_timestamp,
                authors=json.dumps(chunk.authors),
                message_count=len(chunk.messages),
                text=chunk.text,
            )
            metas.append(meta)
            vector_items.append((meta.id, embedding))

        await self._repository.add_message_chunk_metas_batch(metas)
        await self._vector_store.upsert_message_chunks_batch(vector_items)

        return len(metas)

    async def ingest_channel(
        self,
        channel: discord.TextChannel,
        guild_id: str,
    ) -> None:
        channel_id = str(channel.id)
        channel_name = channel.name

        progress = await self._repository.get_or_create_ingestion_progress(guild_id, channel_id)

        if progress.status == "completed":
            logger.info("Channel already fully ingested", channel=channel_name)
            return

        after_snowflake = None
        if progress.last_message_id:
            import discord as discord_mod

            after_snowflake = discord_mod.Object(id=int(progress.last_message_id))

        await self._repository.update_ingestion_progress(guild_id, channel_id, status="in_progress")

        logger.info(
            "Starting channel ingestion",
            channel=channel_name,
            resume_from=progress.last_message_id,
        )

        buffer: list[RawMessage] = []
        total_fetched = progress.total_fetched or 0
        messages_since_checkpoint = 0

        try:
            async for msg in channel.history(
                limit=None,
                after=after_snowflake,
                oldest_first=True,
            ):
                if self._paused:
                    await self._repository.update_ingestion_progress(
                        guild_id,
                        channel_id,
                        status="paused",
                        last_message_id=str(msg.id),
                        total_fetched=total_fetched,
                    )
                    logger.info("Ingestion paused", channel=channel_name, fetched=total_fetched)
                    return

                raw = discord_message_to_raw(msg)
                buffer.append(raw)
                total_fetched += 1
                messages_since_checkpoint += 1

                if messages_since_checkpoint >= CHECKPOINT_INTERVAL:
                    chunks = self._chunker.chunk_messages(
                        buffer, guild_id, channel_id, channel_name
                    )
                    if chunks:
                        leftover_start = 0
                        for chunk in chunks:
                            leftover_start = max(
                                leftover_start,
                                next(
                                    (
                                        i
                                        for i, m in enumerate(buffer)
                                        if m.id == chunk.messages[-1].id
                                    ),
                                    0,
                                )
                                + 1,
                            )
                        await self.store_chunks(chunks)
                        buffer = buffer[leftover_start:]

                    await self._repository.update_ingestion_progress(
                        guild_id,
                        channel_id,
                        last_message_id=str(msg.id),
                        total_fetched=total_fetched,
                    )
                    messages_since_checkpoint = 0

                    if total_fetched % LOG_INTERVAL == 0:
                        logger.info(
                            "Ingestion progress",
                            channel=channel_name,
                            fetched=total_fetched,
                        )

                if total_fetched % YIELD_INTERVAL == 0:
                    await asyncio.sleep(0.1)

            if buffer:
                chunks = self._chunker.chunk_messages(buffer, guild_id, channel_id, channel_name)
                if chunks:
                    await self.store_chunks(chunks)

            await self._repository.update_ingestion_progress(
                guild_id,
                channel_id,
                status="completed",
                total_fetched=total_fetched,
                last_message_id=str(buffer[-1].id) if buffer else progress.last_message_id,
            )
            logger.info(
                "Channel ingestion complete",
                channel=channel_name,
                total_fetched=total_fetched,
            )

        except Exception:
            logger.exception("Ingestion failed", channel=channel_name)
            if buffer:
                last_id = str(buffer[-1].id)
            elif progress.last_message_id:
                last_id = progress.last_message_id
            else:
                last_id = None
            await self._repository.update_ingestion_progress(
                guild_id,
                channel_id,
                status="paused",
                total_fetched=total_fetched,
                last_message_id=last_id,
            )

    async def run_backfill(
        self,
        guild: discord.Guild,
    ) -> None:
        guild_id = str(guild.id)
        channels = [
            ch for ch in guild.text_channels if ch.permissions_for(guild.me).read_message_history
        ]
        channels.sort(key=lambda c: c.last_message_id or "", reverse=True)

        logger.info(
            "Starting backfill",
            guild=guild.name,
            channels=len(channels),
        )

        for channel in channels:
            if self._paused:
                logger.info("Backfill paused by user")
                return
            await self.ingest_channel(channel, guild_id)

        logger.info("Backfill complete", guild=guild.name)

    def start_backfill(self, guild: discord.Guild) -> None:
        if self.is_running:
            return
        self._paused = False
        self._backfill_task = asyncio.create_task(self.run_backfill(guild))

    def stop_backfill(self) -> None:
        self._paused = True
