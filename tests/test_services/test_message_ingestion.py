import asyncio
from datetime import UTC, datetime, timedelta
from unittest.mock import AsyncMock, MagicMock, patch

import discord
import pytest

from intelstream.services.message_ingestion import (
    Chunk,
    MessageChunker,
    MessageIngestionService,
    RawMessage,
    _is_trivial,
    _should_discard_chunk,
    _should_skip_message,
    clean_message_chunk_text,
    discord_message_to_raw,
)


def _make_raw(
    id: int = 1,
    content: str = "hello",
    author_name: str = "user",
    author_bot: bool = False,
    created_at: datetime | None = None,
    is_system: bool = False,
) -> RawMessage:
    return RawMessage(
        id=id,
        content=content,
        author_name=author_name,
        author_bot=author_bot,
        created_at=created_at or datetime(2024, 6, 1, 12, 0, tzinfo=UTC),
        is_system=is_system,
    )


class FakeHistoryChannel:
    def __init__(self, messages: list[MagicMock], *, channel_id: int = 222) -> None:
        self.id = channel_id
        self.name = "general"
        self.messages = messages
        self.history_kwargs: dict[str, object] | None = None

    def history(self, **kwargs):
        self.history_kwargs = kwargs

        async def _iter_messages():
            for msg in self.messages:
                yield msg

        return _iter_messages()


def _make_discord_message(message_id: int = 1) -> MagicMock:
    msg = MagicMock(spec=discord.Message)
    msg.id = message_id
    return msg


def _make_progress(
    *,
    status: str = "pending",
    last_message_id: str | None = None,
    total_fetched: int | None = 0,
) -> MagicMock:
    progress = MagicMock()
    progress.status = status
    progress.last_message_id = last_message_id
    progress.total_fetched = total_fetched
    return progress


class TestIsTrivial:
    def test_empty_string(self):
        assert _is_trivial("") is True

    def test_whitespace_only(self):
        assert _is_trivial("   ") is True

    def test_url_only(self):
        assert _is_trivial("https://example.com/page") is True

    def test_emoji_only(self):
        assert _is_trivial("\U0001f600") is True

    @pytest.mark.parametrize("emoji", ["<:party:123456789>", "<a:dance:987654321>"])
    def test_discord_custom_emoji_only(self, emoji):
        assert _is_trivial(emoji) is True

    def test_normal_text(self):
        assert _is_trivial("This is a normal message") is False

    def test_text_with_url(self):
        assert _is_trivial("Check this out https://example.com") is False


class TestShouldSkipMessage:
    def test_bot_message(self):
        msg = _make_raw(author_bot=True)
        assert _should_skip_message(msg) is True

    def test_system_message(self):
        msg = _make_raw(is_system=True)
        assert _should_skip_message(msg) is True

    def test_empty_content(self):
        msg = _make_raw(content="")
        assert _should_skip_message(msg) is True

    def test_slash_command(self):
        msg = _make_raw(content="/lore query test")
        assert _should_skip_message(msg) is True

    def test_bang_command(self):
        msg = _make_raw(content="!help")
        assert _should_skip_message(msg) is True

    def test_normal_message(self):
        msg = _make_raw(content="This is a real message")
        assert _should_skip_message(msg) is False


class TestShouldDiscardChunk:
    def test_too_few_meaningful_messages(self):
        chunk = Chunk(
            messages=[
                _make_raw(content="ok"),
                _make_raw(content="https://example.com"),
            ],
            guild_id="1",
            channel_id="2",
            channel_name="test",
        )
        assert _should_discard_chunk(chunk) is True

    def test_enough_meaningful_messages(self):
        base = datetime(2024, 6, 1, 12, 0, tzinfo=UTC)
        chunk = Chunk(
            messages=[
                _make_raw(id=1, content="This is a meaningful message", created_at=base),
                _make_raw(
                    id=2,
                    content="Another meaningful message here",
                    created_at=base + timedelta(minutes=1),
                ),
                _make_raw(
                    id=3,
                    content="And a third meaningful one",
                    created_at=base + timedelta(minutes=2),
                ),
            ],
            guild_id="1",
            channel_id="2",
            channel_name="test",
        )
        assert _should_discard_chunk(chunk) is False

    def test_short_text(self):
        chunk = Chunk(
            messages=[_make_raw(content="hi")],
            guild_id="1",
            channel_id="2",
            channel_name="test",
        )
        assert _should_discard_chunk(chunk) is True


class TestChunk:
    def test_properties(self):
        base = datetime(2024, 6, 1, 12, 0, tzinfo=UTC)
        chunk = Chunk(
            messages=[
                _make_raw(id=10, content="first", author_name="alice", created_at=base),
                _make_raw(
                    id=20,
                    content="second",
                    author_name="bob",
                    created_at=base + timedelta(minutes=1),
                ),
                _make_raw(
                    id=30,
                    content="third",
                    author_name="alice",
                    created_at=base + timedelta(minutes=2),
                ),
            ],
            guild_id="1",
            channel_id="2",
            channel_name="test",
        )
        assert chunk.start_message_id == "10"
        assert chunk.end_message_id == "30"
        assert chunk.start_timestamp == base
        assert chunk.end_timestamp == base + timedelta(minutes=2)
        assert chunk.authors == ["alice", "bob"]
        assert "alice: first" in chunk.text
        assert "bob: second" in chunk.text

    def test_embedding_text_strips_content_and_skips_blank_lines(self):
        chunk = Chunk(
            messages=[
                _make_raw(content="  first message  ", author_name="alice"),
                _make_raw(content="   ", author_name="ignored"),
                _make_raw(content="\nsecond message\n", author_name="bob"),
            ],
            guild_id="1",
            channel_id="2",
            channel_name="test",
        )

        assert chunk.embedding_text == "alice: first message\nbob: second message"

    def test_meaningful_count(self):
        chunk = Chunk(
            messages=[
                _make_raw(content="Real message here"),
                _make_raw(content=""),
                _make_raw(content="Another real one"),
                _make_raw(content="https://example.com"),
            ],
            guild_id="1",
            channel_id="2",
            channel_name="test",
        )
        assert chunk.meaningful_count == 2


class TestDiscordMessageToRaw:
    def test_converts_naive_created_at_to_utc(self):
        msg = MagicMock(spec=discord.Message)
        msg.id = 123
        msg.content = "hello"
        msg.author.display_name = "Alice"
        msg.author.bot = False
        msg.created_at = datetime(2026, 5, 25, 12, 0)
        msg.type = discord.MessageType.default

        raw = discord_message_to_raw(msg)

        assert raw.id == 123
        assert raw.created_at.tzinfo == UTC
        assert raw.author_name == "Alice"
        assert raw.is_system is False

    def test_marks_non_default_message_types_as_system(self):
        msg = MagicMock(spec=discord.Message)
        msg.id = 123
        msg.content = None
        msg.author.display_name = "Alice"
        msg.author.bot = False
        msg.created_at = datetime(2026, 5, 25, 12, 0, tzinfo=UTC)
        msg.type = discord.MessageType.pins_add

        raw = discord_message_to_raw(msg)

        assert raw.content == ""
        assert raw.is_system is True


class TestCleanMessageChunkText:
    def test_removes_timestamp_prefixes_and_blank_lines(self):
        text = "\n[2026-05-25 12:00] Alice: hello\n   \nBob: no timestamp\n"

        assert clean_message_chunk_text(text) == "Alice: hello\nBob: no timestamp"


class TestMessageChunker:
    def _make_messages(self, count: int, gap_minutes: int = 1) -> list[RawMessage]:
        base = datetime(2024, 6, 1, 12, 0, tzinfo=UTC)
        return [
            _make_raw(
                id=i + 1,
                content=f"Message number {i + 1} with enough content to be meaningful",
                author_name=f"user{i % 3}",
                created_at=base + timedelta(minutes=i * gap_minutes),
            )
            for i in range(count)
        ]

    def test_empty_input(self):
        chunker = MessageChunker(gap_minutes=10, max_messages=20)
        result = chunker.chunk_messages([], "1", "2", "test")
        assert result == []

    def test_all_bot_messages(self):
        chunker = MessageChunker(gap_minutes=10, max_messages=20)
        messages = [_make_raw(id=i, author_bot=True) for i in range(5)]
        result = chunker.chunk_messages(messages, "1", "2", "test")
        assert result == []

    def test_single_chunk(self):
        chunker = MessageChunker(gap_minutes=10, max_messages=20)
        messages = self._make_messages(5, gap_minutes=1)
        result = chunker.chunk_messages(messages, "1", "2", "test")
        assert len(result) == 1
        assert len(result[0].messages) == 5
        assert result[0].guild_id == "1"
        assert result[0].channel_id == "2"

    def test_time_gap_split(self):
        chunker = MessageChunker(gap_minutes=10, max_messages=100)
        base = datetime(2024, 6, 1, 12, 0, tzinfo=UTC)
        messages = [
            *[
                _make_raw(
                    id=i + 1,
                    content=f"First conversation message {i + 1}",
                    created_at=base + timedelta(minutes=i),
                )
                for i in range(5)
            ],
            *[
                _make_raw(
                    id=i + 6,
                    content=f"Second conversation message {i + 1}",
                    created_at=base + timedelta(minutes=30 + i),
                )
                for i in range(5)
            ],
        ]
        result = chunker.chunk_messages(messages, "1", "2", "test")
        assert len(result) == 2
        assert len(result[0].messages) == 5
        assert len(result[1].messages) == 5

    def test_time_gap_at_threshold_stays_in_same_chunk(self):
        chunker = MessageChunker(gap_minutes=10, max_messages=100)
        base = datetime(2024, 6, 1, 12, 0, tzinfo=UTC)
        messages = [
            _make_raw(
                id=1,
                content="First meaningful message with enough words",
                created_at=base,
            ),
            _make_raw(
                id=2,
                content="Second meaningful message with enough words",
                created_at=base + timedelta(minutes=10),
            ),
            _make_raw(
                id=3,
                content="Third meaningful message with enough words",
                created_at=base + timedelta(minutes=20),
            ),
        ]

        result = chunker.chunk_messages(messages, "1", "2", "test")

        assert len(result) == 1
        assert result[0].start_message_id == "1"
        assert result[0].end_message_id == "3"

    def test_max_messages_split(self):
        chunker = MessageChunker(gap_minutes=60, max_messages=5)
        messages = self._make_messages(12, gap_minutes=1)
        result = chunker.chunk_messages(messages, "1", "2", "test")
        assert len(result) >= 2
        for chunk in result:
            assert len(chunk.messages) <= 5

    def test_discards_trivial_chunks(self):
        chunker = MessageChunker(gap_minutes=10, max_messages=20)
        messages = [
            _make_raw(id=1, content="ok"),
            _make_raw(id=2, content="yeah"),
        ]
        result = chunker.chunk_messages(messages, "1", "2", "test")
        assert result == []

    def test_discards_current_chunk_before_gap_and_keeps_next_valid_chunk(self):
        chunker = MessageChunker(gap_minutes=10, max_messages=20)
        base = datetime(2024, 6, 1, 12, 0, tzinfo=UTC)
        messages = [
            _make_raw(id=1, content="short setup", created_at=base),
            _make_raw(id=2, content="another short setup", created_at=base + timedelta(minutes=1)),
            _make_raw(
                id=3,
                content="Fresh thread with enough detail to keep as a chunk",
                created_at=base + timedelta(minutes=30),
            ),
            _make_raw(
                id=4,
                content="Second useful message that belongs to the later thread",
                created_at=base + timedelta(minutes=31),
            ),
            _make_raw(
                id=5,
                content="Third useful message that makes the later chunk meaningful",
                created_at=base + timedelta(minutes=32),
            ),
        ]

        result = chunker.chunk_messages(messages, "1", "2", "test")

        assert len(result) == 1
        assert [msg.id for msg in result[0].messages] == [3, 4, 5]


class TestMessageIngestionService:
    @pytest.fixture
    def mock_deps(self):
        repository = AsyncMock()
        embedding_service = AsyncMock()
        embedding_service.embed_batch = AsyncMock(return_value=[[0.1, 0.2, 0.3]])
        vector_store = AsyncMock()
        return repository, embedding_service, vector_store

    @pytest.fixture
    def service(self, mock_deps):
        repository, embedding_service, vector_store = mock_deps
        return MessageIngestionService(
            repository=repository,
            embedding_service=embedding_service,
            vector_store=vector_store,
            gap_minutes=10,
            max_messages=20,
        )

    async def test_store_chunks_empty(self, service):
        result = await service.store_chunks([])
        assert result == 0

    async def test_store_chunks_single(self, service, mock_deps):
        repository, embedding_service, vector_store = mock_deps
        base = datetime(2024, 6, 1, 12, 0, tzinfo=UTC)
        chunk = Chunk(
            messages=[
                _make_raw(id=1, content="Hello world from a test", created_at=base),
                _make_raw(
                    id=2,
                    content="Another test message here",
                    created_at=base + timedelta(minutes=1),
                ),
                _make_raw(
                    id=3,
                    content="Third test message content",
                    created_at=base + timedelta(minutes=2),
                ),
            ],
            guild_id="111",
            channel_id="222",
            channel_name="general",
        )

        result = await service.store_chunks([chunk])

        assert result == 1
        embedding_service.embed_batch.assert_called_once()
        repository.add_message_chunk_metas_batch.assert_called_once()
        vector_store.upsert_message_chunks_batch.assert_called_once()
        assert vector_store.upsert_message_chunks_batch.call_args.args[0] == "111"

        metas = repository.add_message_chunk_metas_batch.call_args[0][0]
        assert len(metas) == 1
        assert metas[0].guild_id == "111"
        assert metas[0].channel_id == "222"
        assert metas[0].message_count == 3

    async def test_rebuild_vector_index(self, service, mock_deps):
        repository, embedding_service, vector_store = mock_deps
        repository.count_message_chunk_metas = AsyncMock(return_value=3)

        meta1 = MagicMock(id="chunk-1", text="first chunk text")
        meta2 = MagicMock(id="chunk-2", text="second chunk text")
        meta3 = MagicMock(id="chunk-3", text="third chunk text")
        repository.get_message_chunk_metas_batch = AsyncMock(
            side_effect=[
                [meta1, meta2],
                [meta3],
                [],
            ]
        )
        embedding_service.embed_batch = AsyncMock(
            side_effect=[
                [[0.1, 0.2, 0.3], [0.4, 0.5, 0.6]],
                [[0.7, 0.8, 0.9]],
            ]
        )

        result = await service.rebuild_vector_index("guild-1", batch_size=2)

        assert result == 3
        vector_store.recreate_message_chunks_collection.assert_called_once_with("guild-1")
        assert vector_store.upsert_message_chunks_batch.await_count == 2
        repository.count_message_chunk_metas.assert_called_once_with(guild_id="guild-1")
        repository.get_message_chunk_metas_batch.assert_any_call(
            offset=0,
            limit=2,
            guild_id="guild-1",
        )
        repository.get_message_chunk_metas_batch.assert_any_call(
            offset=2,
            limit=2,
            guild_id="guild-1",
        )

    async def test_rebuild_vector_index_empty(self, service, mock_deps):
        repository, embedding_service, vector_store = mock_deps
        repository.count_message_chunk_metas = AsyncMock(return_value=0)
        repository.get_message_chunk_metas_batch = AsyncMock(return_value=[])

        result = await service.rebuild_vector_index("guild-1")

        assert result == 0
        vector_store.recreate_message_chunks_collection.assert_called_once_with("guild-1")
        embedding_service.embed_batch.assert_not_called()
        vector_store.upsert_message_chunks_batch.assert_not_called()

    def test_is_running_no_task(self, service):
        assert service.is_running is False

    def test_pause_resume(self, service):
        assert service.is_paused is False
        service.pause()
        assert service.is_paused is True
        service.resume()
        assert service.is_paused is False

    async def test_ingest_channel_skips_completed_progress(self, service, mock_deps):
        repository, _, _ = mock_deps
        repository.get_or_create_ingestion_progress = AsyncMock(
            return_value=_make_progress(status="completed", total_fetched=5)
        )
        channel = FakeHistoryChannel([])

        await service.ingest_channel(channel, "guild-1")

        repository.update_ingestion_progress.assert_not_called()
        assert channel.history_kwargs is None

    async def test_ingest_channel_completes_and_stores_final_buffer(self, service, mock_deps):
        repository, _, _ = mock_deps
        repository.get_or_create_ingestion_progress = AsyncMock(return_value=_make_progress())
        repository.update_ingestion_progress = AsyncMock()
        messages = [_make_discord_message(i) for i in [1, 2, 3]]
        raw_messages = [
            _make_raw(
                id=i,
                content=f"Message {i} has enough content to keep this chunk",
                created_at=datetime(2026, 5, 25, 12, i, tzinfo=UTC),
            )
            for i in [1, 2, 3]
        ]
        channel = FakeHistoryChannel(messages)
        service.store_chunks = AsyncMock(return_value=1)

        with patch(
            "intelstream.services.message_ingestion.discord_message_to_raw",
            side_effect=raw_messages,
        ):
            await service.ingest_channel(channel, "guild-1", channel_index=1, total_channels=2)

        service.store_chunks.assert_awaited_once()
        stored_chunks = service.store_chunks.await_args.args[0]
        assert len(stored_chunks) == 1
        assert stored_chunks[0].start_message_id == "1"
        assert stored_chunks[0].end_message_id == "3"
        repository.update_ingestion_progress.assert_any_await(
            "guild-1",
            "222",
            status="completed",
            total_fetched=3,
            last_message_id="3",
        )

    async def test_ingest_channel_resumes_after_last_message_id(self, service, mock_deps):
        repository, _, _ = mock_deps
        repository.get_or_create_ingestion_progress = AsyncMock(
            return_value=_make_progress(last_message_id="99", total_fetched=4)
        )
        repository.update_ingestion_progress = AsyncMock()
        channel = FakeHistoryChannel([])

        await service.ingest_channel(channel, "guild-1")

        assert channel.history_kwargs is not None
        after = channel.history_kwargs["after"]
        assert isinstance(after, discord.Object)
        assert after.id == 99
        repository.update_ingestion_progress.assert_any_await(
            "guild-1",
            "222",
            status="completed",
            total_fetched=4,
            last_message_id="99",
        )

    async def test_ingest_channel_pauses_before_processing_next_message(self, service, mock_deps):
        repository, _, _ = mock_deps
        repository.get_or_create_ingestion_progress = AsyncMock(return_value=_make_progress())
        repository.update_ingestion_progress = AsyncMock()
        channel = FakeHistoryChannel([_make_discord_message(10)])
        service.pause()
        service.store_chunks = AsyncMock()

        await service.ingest_channel(channel, "guild-1")

        service.store_chunks.assert_not_called()
        repository.update_ingestion_progress.assert_any_await(
            "guild-1",
            "222",
            status="paused",
            last_message_id=None,
            total_fetched=0,
        )

    async def test_ingest_channel_checkpoints_and_keeps_leftover_buffer(self, service, mock_deps):
        repository, _, _ = mock_deps
        repository.get_or_create_ingestion_progress = AsyncMock(return_value=_make_progress())
        repository.update_ingestion_progress = AsyncMock()
        messages = [_make_discord_message(i) for i in [1, 2, 3]]
        raw_messages = [
            _make_raw(
                id=i,
                content=f"Checkpoint message {i} has enough useful text",
                created_at=datetime(2026, 5, 25, 12, i, tzinfo=UTC),
            )
            for i in [1, 2, 3]
        ]
        channel = FakeHistoryChannel(messages)
        service.store_chunks = AsyncMock(return_value=1)
        checkpoint_chunks = [
            Chunk(
                messages=raw_messages[:2],
                guild_id="guild-1",
                channel_id="222",
                channel_name="general",
            )
        ]
        final_chunks = [
            Chunk(
                messages=raw_messages[2:],
                guild_id="guild-1",
                channel_id="222",
                channel_name="general",
            )
        ]
        service._chunker.chunk_messages = MagicMock(side_effect=[checkpoint_chunks, final_chunks])

        with (
            patch("intelstream.services.message_ingestion.CHECKPOINT_INTERVAL", 2),
            patch("intelstream.services.message_ingestion.YIELD_INTERVAL", 1000),
            patch(
                "intelstream.services.message_ingestion.discord_message_to_raw",
                side_effect=raw_messages,
            ),
        ):
            await service.ingest_channel(channel, "guild-1")

        assert service.store_chunks.await_count == 2
        repository.update_ingestion_progress.assert_any_await(
            "guild-1",
            "222",
            last_message_id="2",
            total_fetched=2,
        )
        first_final_chunk = service.store_chunks.await_args_list[-1].args[0][0]
        assert first_final_chunk.start_message_id == "3"

    async def test_ingest_channel_checkpoints_without_chunks_and_logs_progress(
        self, service, mock_deps
    ):
        repository, _, _ = mock_deps
        repository.get_or_create_ingestion_progress = AsyncMock(return_value=_make_progress())
        repository.update_ingestion_progress = AsyncMock()
        messages = [_make_discord_message(i) for i in [1, 2]]
        raw_messages = [
            _make_raw(
                id=i,
                content=f"Checkpoint message {i} remains buffered",
                created_at=datetime(2026, 5, 25, 12, i, tzinfo=UTC),
            )
            for i in [1, 2]
        ]
        channel = FakeHistoryChannel(messages)
        service.store_chunks = AsyncMock(return_value=0)
        service._chunker.chunk_messages = MagicMock(return_value=[])

        with (
            patch("intelstream.services.message_ingestion.CHECKPOINT_INTERVAL", 1),
            patch("intelstream.services.message_ingestion.LOG_INTERVAL", 1),
            patch("intelstream.services.message_ingestion.YIELD_INTERVAL", 1000),
            patch("intelstream.services.message_ingestion.logger.info") as log_info,
            patch(
                "intelstream.services.message_ingestion.discord_message_to_raw",
                side_effect=raw_messages,
            ),
        ):
            await service.ingest_channel(channel, "guild-1")

        service.store_chunks.assert_not_awaited()
        assert service._chunker.chunk_messages.call_count == 2
        repository.update_ingestion_progress.assert_any_await(
            "guild-1",
            "222",
            last_message_id="2",
            total_fetched=2,
        )
        assert any(call.args[0] == "Ingestion progress" for call in log_info.call_args_list)

    async def test_ingest_channel_yields_periodically(self, service, mock_deps):
        repository, _, _ = mock_deps
        repository.get_or_create_ingestion_progress = AsyncMock(return_value=_make_progress())
        repository.update_ingestion_progress = AsyncMock()
        messages = [_make_discord_message(i) for i in [1, 2, 3]]
        raw_messages = [_make_raw(id=i, content=f"Message {i} with enough text") for i in [1, 2, 3]]
        channel = FakeHistoryChannel(messages)
        service.store_chunks = AsyncMock(return_value=0)

        with (
            patch("intelstream.services.message_ingestion.YIELD_INTERVAL", 2),
            patch("intelstream.services.message_ingestion.asyncio.sleep", AsyncMock()) as sleep,
            patch(
                "intelstream.services.message_ingestion.discord_message_to_raw",
                side_effect=raw_messages,
            ),
        ):
            await service.ingest_channel(channel, "guild-1")

        sleep.assert_awaited_once_with(0.1)

    async def test_ingest_channel_records_pause_state_on_error(self, service, mock_deps):
        repository, _, _ = mock_deps
        repository.get_or_create_ingestion_progress = AsyncMock(
            return_value=_make_progress(last_message_id="5", total_fetched=7)
        )
        repository.update_ingestion_progress = AsyncMock()
        channel = FakeHistoryChannel([_make_discord_message(10)])

        with patch(
            "intelstream.services.message_ingestion.discord_message_to_raw",
            side_effect=RuntimeError("convert failed"),
        ):
            await service.ingest_channel(channel, "guild-1")

        repository.update_ingestion_progress.assert_any_await(
            "guild-1",
            "222",
            status="paused",
            total_fetched=7,
            last_message_id="5",
        )

    async def test_ingest_channel_records_buffer_last_id_on_error(self, service, mock_deps):
        repository, _, _ = mock_deps
        repository.get_or_create_ingestion_progress = AsyncMock(return_value=_make_progress())
        repository.update_ingestion_progress = AsyncMock()
        channel = FakeHistoryChannel([_make_discord_message(10)])
        raw = _make_raw(id=10, content="Buffered message with enough context to store")
        chunk = Chunk(
            messages=[raw],
            guild_id="guild-1",
            channel_id="222",
            channel_name="general",
        )
        service._chunker.chunk_messages = MagicMock(return_value=[chunk])
        service.store_chunks = AsyncMock(side_effect=RuntimeError("store failed"))

        with patch(
            "intelstream.services.message_ingestion.discord_message_to_raw",
            return_value=raw,
        ):
            await service.ingest_channel(channel, "guild-1")

        repository.update_ingestion_progress.assert_any_await(
            "guild-1",
            "222",
            status="paused",
            total_fetched=0,
            last_message_id=None,
        )

    async def test_ingest_channel_records_none_last_id_on_early_error(self, service, mock_deps):
        repository, _, _ = mock_deps
        repository.get_or_create_ingestion_progress = AsyncMock(return_value=_make_progress())
        repository.update_ingestion_progress = AsyncMock()
        channel = FakeHistoryChannel([_make_discord_message(10)])

        with patch(
            "intelstream.services.message_ingestion.discord_message_to_raw",
            side_effect=RuntimeError("convert failed"),
        ):
            await service.ingest_channel(channel, "guild-1")

        repository.update_ingestion_progress.assert_any_await(
            "guild-1",
            "222",
            status="paused",
            total_fetched=0,
            last_message_id=None,
        )

    async def test_run_backfill_filters_sorts_and_ingests_readable_channels(self, service):
        guild = MagicMock(spec=discord.Guild)
        guild.id = 123
        guild.name = "Guild"
        guild.me = MagicMock()

        def make_channel(name: str, last_message_id: int | None, readable: bool) -> MagicMock:
            channel = MagicMock(spec=discord.TextChannel)
            channel.name = name
            channel.last_message_id = last_message_id
            channel.permissions_for.return_value.read_message_history = readable
            return channel

        older = make_channel("older", 10, True)
        newest = make_channel("newest", 30, True)
        unreadable = make_channel("secret", 999, False)
        none_last = make_channel("none", None, True)
        guild.text_channels = [older, unreadable, newest, none_last]
        service.ingest_channel = AsyncMock()

        await service.run_backfill(guild)

        assert [call.args[0].name for call in service.ingest_channel.await_args_list] == [
            "newest",
            "older",
            "none",
        ]
        assert all(call.args[1] == "123" for call in service.ingest_channel.await_args_list)

    async def test_run_backfill_stops_when_paused_between_channels(self, service):
        guild = MagicMock(spec=discord.Guild)
        guild.id = 123
        guild.name = "Guild"
        guild.me = MagicMock()
        channels = []
        for name in ["first", "second"]:
            channel = MagicMock(spec=discord.TextChannel)
            channel.name = name
            channel.last_message_id = 1
            channel.permissions_for.return_value.read_message_history = True
            channels.append(channel)
        guild.text_channels = channels

        async def ingest_and_pause(*_args, **_kwargs):
            service.pause()

        service.ingest_channel = AsyncMock(side_effect=ingest_and_pause)

        await service.run_backfill(guild)

        service.ingest_channel.assert_awaited_once()

    def test_start_backfill_creates_named_task(self, service):
        guild = MagicMock(spec=discord.Guild)
        guild.id = 123
        task = MagicMock(spec=asyncio.Task)
        task.done.return_value = False
        service._paused = True

        def fake_create_task(coro, *, name: str):
            coro.close()
            fake_create_task.name = name
            return task

        fake_create_task.name = ""

        with patch(
            "intelstream.services.message_ingestion.asyncio.create_task",
            side_effect=fake_create_task,
        ) as create_task:
            service.start_backfill(guild)

        assert service._paused is False
        assert service._backfill_task is task
        create_task.assert_called_once()
        assert fake_create_task.name == "lore-backfill-123"

    def test_start_backfill_noops_when_task_already_running(self, service):
        task = MagicMock(spec=asyncio.Task)
        task.done.return_value = False
        service._backfill_task = task
        guild = MagicMock(spec=discord.Guild)

        with patch("intelstream.services.message_ingestion.asyncio.create_task") as create_task:
            service.start_backfill(guild)

        create_task.assert_not_called()

    async def test_run_backfill_safe_swallows_errors(self, service):
        guild = MagicMock(spec=discord.Guild)
        guild.name = "Guild"
        service.run_backfill = AsyncMock(side_effect=RuntimeError("boom"))

        await service._run_backfill_safe(guild)

        service.run_backfill.assert_awaited_once_with(guild)

    async def test_stop_backfill_sets_paused(self, service):
        await service.stop_backfill()

        assert service.is_paused is True

    async def test_stop_backfill_waits_for_running_task(self, service):
        finish = asyncio.Event()

        service._backfill_task = asyncio.create_task(finish.wait())
        asyncio.get_running_loop().call_soon(finish.set)

        await service.stop_backfill()

        assert service._backfill_task.done()
