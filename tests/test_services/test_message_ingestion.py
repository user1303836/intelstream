from datetime import UTC, datetime, timedelta
from unittest.mock import AsyncMock, MagicMock

import pytest

from intelstream.services.message_ingestion import (
    Chunk,
    MessageChunker,
    MessageIngestionService,
    RawMessage,
    _is_trivial,
    _should_discard_chunk,
    _should_skip_message,
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


class TestIsTrivial:
    def test_empty_string(self):
        assert _is_trivial("") is True

    def test_whitespace_only(self):
        assert _is_trivial("   ") is True

    def test_url_only(self):
        assert _is_trivial("https://example.com/page") is True

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
