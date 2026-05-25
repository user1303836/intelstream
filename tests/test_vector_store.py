import subprocess
import sys
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from intelstream.database.vector_store import ArticleChunkVector, VectorStore


def _can_import_zvec() -> bool:
    result = subprocess.run(
        [sys.executable, "-c", "import zvec"],
        capture_output=True,
        timeout=10,
    )
    return result.returncode == 0


pytestmark = pytest.mark.skipif(not _can_import_zvec(), reason="zvec native library not available")


@pytest.fixture
async def vector_store(tmp_path):
    store = VectorStore(data_dir=str(tmp_path / "vectors"), dimensions=4, model_name="model-a")
    await store.initialize()
    yield store
    await store.close()


class TestInitialize:
    async def test_creates_directory(self, tmp_path):
        store = VectorStore(data_dir=str(tmp_path / "new_dir"), dimensions=4, model_name="model-a")
        await store.initialize()
        assert (tmp_path / "new_dir").exists()
        await store.close()

    async def test_defers_article_collection_open_until_first_use(self, tmp_path):
        store = VectorStore(
            data_dir=str(tmp_path / "lazy_open"), dimensions=4, model_name="model-a"
        )
        await store.initialize()

        assert store._articles is None

        await store.upsert_article("doc1", [0.1, 0.2, 0.3, 0.4])
        assert store._articles is not None

        await store.close()

    async def test_missing_article_metadata_treated_as_unavailable(self, tmp_path):
        collection_dir = tmp_path / "vectors" / "article_chunks"
        collection_dir.mkdir(parents=True)
        (collection_dir / "manifest.0").write_text("placeholder")

        store = VectorStore(data_dir=str(tmp_path / "vectors"), dimensions=4, model_name="model-a")
        await store.initialize()

        assert await store.article_doc_count() == 0
        assert store._articles is None

        await store.close()

    async def test_missing_message_metadata_treated_as_unavailable(self, tmp_path):
        collection_dir = tmp_path / "vectors" / "message_chunks" / "guild-1"
        collection_dir.mkdir(parents=True)
        (collection_dir / "manifest.0").write_text("placeholder")

        store = VectorStore(data_dir=str(tmp_path / "vectors"), dimensions=4, model_name="model-a")
        await store.initialize()

        assert await store.message_chunk_doc_count("guild-1") == 0

        await store.close()

    async def test_reopens_existing_collection(self, tmp_path):
        data_dir = str(tmp_path / "reopen_test")
        store1 = VectorStore(data_dir=data_dir, dimensions=4, model_name="model-a")
        await store1.initialize()
        await store1.upsert_article("doc1", [0.1, 0.2, 0.3, 0.4])
        await store1.close()

        store2 = VectorStore(data_dir=data_dir, dimensions=4, model_name="model-a")
        await store2.initialize()
        results = await store2.search_articles([0.1, 0.2, 0.3, 0.4], topk=1)
        assert len(results) == 1
        assert results[0].content_item_id == "doc1"
        await store2.close()

    async def test_recreates_articles_collection_on_dimension_mismatch(self, tmp_path):
        data_dir = str(tmp_path / "dimension_mismatch")
        store1 = VectorStore(data_dir=data_dir, dimensions=4, model_name="model-a")
        await store1.initialize()
        await store1.upsert_article("doc1", [0.1, 0.2, 0.3, 0.4])
        await store1.close()

        store2 = VectorStore(data_dir=data_dir, dimensions=3, model_name="model-a")
        await store2.initialize()

        assert await store2.article_doc_count() == 0
        results = await store2.search_articles([0.1, 0.2, 0.3], topk=1)
        assert results == []
        await store2.close()

    async def test_recreates_articles_collection_on_model_mismatch(self, tmp_path):
        data_dir = str(tmp_path / "model_mismatch")
        store1 = VectorStore(data_dir=data_dir, dimensions=4, model_name="model-a")
        await store1.initialize()
        await store1.upsert_article("doc1", [0.1, 0.2, 0.3, 0.4])
        await store1.close()

        store2 = VectorStore(data_dir=data_dir, dimensions=4, model_name="model-b")
        await store2.initialize()

        assert await store2.article_doc_count() == 0
        results = await store2.search_articles([0.1, 0.2, 0.3, 0.4], topk=1)
        assert results == []
        await store2.close()

    async def test_initialize_warns_when_legacy_message_collection_files_exist(self, tmp_path):
        legacy_root = tmp_path / "vectors" / "message_chunks"
        legacy_root.mkdir(parents=True)
        (legacy_root / "manifest.0").write_text("legacy")
        (legacy_root / "guild-1").mkdir()

        store = VectorStore(data_dir=str(tmp_path / "vectors"), dimensions=4, model_name="model-a")

        with patch("intelstream.database.vector_store.logger.warning") as warning:
            await store.initialize()

        warning.assert_called_once()
        assert warning.call_args.kwargs["files"] == ["manifest.0"]
        await store.close()


class TestInternals:
    def test_unknown_collection_attr_name_raises(self, tmp_path):
        store = VectorStore(data_dir=str(tmp_path / "vectors"), dimensions=4, model_name="model-a")

        with pytest.raises(ValueError, match="Unknown collection name"):
            store._collection_attr_name("unknown")

    def test_read_collection_metadata_returns_none_when_missing(self, tmp_path):
        store = VectorStore(data_dir=str(tmp_path / "vectors"), dimensions=4, model_name="model-a")

        assert store._read_collection_metadata("article_chunks") is None

    def test_read_collection_metadata_rejects_non_object_json(self, tmp_path):
        collection_dir = tmp_path / "vectors" / "article_chunks"
        collection_dir.mkdir(parents=True)
        (collection_dir / "intelstream-index.json").write_text("[]")
        store = VectorStore(data_dir=str(tmp_path / "vectors"), dimensions=4, model_name="model-a")

        assert store._read_collection_metadata("article_chunks") is None

    def test_read_collection_metadata_rejects_invalid_json(self, tmp_path):
        collection_dir = tmp_path / "vectors" / "article_chunks"
        collection_dir.mkdir(parents=True)
        (collection_dir / "intelstream-index.json").write_text("{")
        store = VectorStore(data_dir=str(tmp_path / "vectors"), dimensions=4, model_name="model-a")

        assert store._read_collection_metadata("article_chunks") is None

    async def test_collection_needs_recreate_allows_missing_metadata(self, tmp_path):
        store = VectorStore(data_dir=str(tmp_path / "vectors"), dimensions=4, model_name="model-a")
        store._collection_dimension = MagicMock(return_value=4)
        store._read_collection_metadata = MagicMock(return_value=None)

        assert await store._collection_needs_recreate("article_chunks", MagicMock()) is None

    async def test_collection_needs_recreate_detects_stored_dimension_mismatch(self, tmp_path):
        store = VectorStore(data_dir=str(tmp_path / "vectors"), dimensions=4, model_name="model-a")
        store._collection_dimension = MagicMock(return_value=4)
        store._read_collection_metadata = MagicMock(
            return_value={"dimensions": 3, "model_name": "model-a"}
        )

        reason = await store._collection_needs_recreate("article_chunks", MagicMock())

        assert reason == "stored metadata dimensions mismatch (3 != 4)"

    async def test_destroy_collection_falls_back_to_removing_files(self, tmp_path):
        collection_dir = tmp_path / "vectors" / "article_chunks"
        collection_dir.mkdir(parents=True)
        (collection_dir / "manifest.0").write_text("data")
        collection = MagicMock()
        collection.destroy.side_effect = RuntimeError("destroy failed")
        store = VectorStore(data_dir=str(tmp_path / "vectors"), dimensions=4, model_name="model-a")

        await store._destroy_collection_at_path(
            "article_chunks",
            collection,
            str(collection_dir),
        )

        assert not collection_dir.exists()

    async def test_open_or_create_opens_existing_without_metadata_validation(self, tmp_path):
        import zvec

        opened = MagicMock()
        store = VectorStore(data_dir=str(tmp_path / "vectors"), dimensions=4, model_name="model-a")

        with (
            patch("zvec.create_and_open", side_effect=RuntimeError("exists")),
            patch("zvec.open", return_value=opened) as open_collection,
        ):
            result = await store._open_or_create_collection(
                "message_chunks_guild-1",
                path=str(tmp_path / "vectors" / "message_chunks" / "guild-1"),
            )

        assert result is opened
        open_collection.assert_called_once()
        assert isinstance(open_collection.call_args.kwargs["option"], zvec.CollectionOption)

    async def test_open_or_create_rewrites_metadata_for_existing_compatible_collection(
        self, tmp_path
    ):
        opened = MagicMock()
        store = VectorStore(data_dir=str(tmp_path / "vectors"), dimensions=4, model_name="model-a")
        store._collection_needs_recreate = AsyncMock(return_value=None)
        store._write_collection_metadata = MagicMock()

        with (
            patch("zvec.create_and_open", side_effect=RuntimeError("exists")),
            patch("zvec.open", return_value=opened),
        ):
            result = await store._open_or_create_collection(
                "article_chunks",
                validate_metadata=True,
            )

        assert result is opened
        store._collection_needs_recreate.assert_awaited_once()
        store._write_collection_metadata.assert_called_once()

    async def test_open_or_create_recreates_incompatible_existing_collection(self, tmp_path):
        opened = MagicMock()
        recreated = MagicMock()
        store = VectorStore(data_dir=str(tmp_path / "vectors"), dimensions=4, model_name="model-a")
        store._collection_needs_recreate = AsyncMock(return_value="model mismatch")
        store._destroy_collection_at_path = AsyncMock()
        store._write_collection_metadata = MagicMock()

        with (
            patch(
                "zvec.create_and_open",
                side_effect=[RuntimeError("exists"), recreated],
            ),
            patch("zvec.open", return_value=opened),
        ):
            result = await store._open_or_create_collection(
                "article_chunks",
                validate_metadata=True,
            )

        assert result is recreated
        store._destroy_collection_at_path.assert_awaited_once()
        store._write_collection_metadata.assert_called_once()

    async def test_doc_count_raises_for_missing_collection(self, tmp_path):
        store = VectorStore(data_dir=str(tmp_path / "vectors"), dimensions=4, model_name="model-a")

        with pytest.raises(RuntimeError, match="not initialized"):
            await store._doc_count(None)


class TestUpsertAndSearch:
    async def test_upsert_and_search(self, vector_store):
        await vector_store.upsert_article("item-1", [1.0, 0.0, 0.0, 0.0])
        await vector_store.upsert_article("item-2", [0.0, 1.0, 0.0, 0.0])
        await vector_store.upsert_article("item-3", [0.0, 0.0, 1.0, 0.0])

        results = await vector_store.search_articles([1.0, 0.0, 0.0, 0.0], topk=2)
        assert len(results) == 2
        assert results[0].content_item_id == "item-1"
        assert isinstance(results[0].score, float)

    async def test_upsert_overwrites(self, vector_store):
        await vector_store.upsert_article("item-1", [1.0, 0.0, 0.0, 0.0])
        await vector_store.upsert_article("item-1", [0.0, 1.0, 0.0, 0.0])

        results = await vector_store.search_articles([0.0, 1.0, 0.0, 0.0], topk=1)
        assert len(results) == 1
        assert results[0].content_item_id == "item-1"

    async def test_search_empty_collection(self, vector_store):
        results = await vector_store.search_articles([1.0, 0.0, 0.0, 0.0], topk=5)
        assert results == []

    async def test_message_chunk_doc_count(self, vector_store):
        assert await vector_store.message_chunk_doc_count("guild-1") == 0

        await vector_store.upsert_message_chunk("guild-1", "chunk-1", [1.0, 0.0, 0.0, 0.0])
        await vector_store.upsert_message_chunk("guild-1", "chunk-2", [0.0, 1.0, 0.0, 0.0])

        assert await vector_store.message_chunk_doc_count("guild-1") == 2
        assert vector_store._collection_metadata_path(
            vector_store._message_chunk_collection_name("guild-1"),
            vector_store._message_chunk_collection_path("guild-1"),
        ).exists()

    async def test_message_chunk_collections_are_guild_scoped(self, vector_store):
        await vector_store.upsert_message_chunk("guild-1", "chunk-1", [1.0, 0.0, 0.0, 0.0])
        await vector_store.upsert_message_chunk("guild-2", "chunk-2", [0.0, 1.0, 0.0, 0.0])

        guild_1_results = await vector_store.search_message_chunks(
            "guild-1",
            [1.0, 0.0, 0.0, 0.0],
            topk=5,
        )
        guild_2_results = await vector_store.search_message_chunks(
            "guild-2",
            [1.0, 0.0, 0.0, 0.0],
            topk=5,
        )

        assert [result.chunk_id for result in guild_1_results] == ["chunk-1"]
        assert [result.chunk_id for result in guild_2_results] == ["chunk-2"]

    async def test_article_chunk_search_returns_metadata(self, vector_store):
        await vector_store.upsert_article_chunk(
            chunk_id="item-1__0000",
            content_item_id="item-1",
            chunk_index=0,
            text="Chunk text",
            search_text="Title\n\nChunk text",
            embedding=[1.0, 0.0, 0.0, 0.0],
        )

        results = await vector_store.search_article_chunks([1.0, 0.0, 0.0, 0.0], topk=1)

        assert len(results) == 1
        assert results[0].content_item_id == "item-1"
        assert results[0].text == "Chunk text"

    async def test_search_message_chunks_returns_empty_when_collection_absent(self, tmp_path):
        store = VectorStore(data_dir=str(tmp_path / "vectors"), dimensions=4, model_name="model-a")
        await store.initialize()

        assert await store.search_message_chunks("guild-1", [1.0, 0.0, 0.0, 0.0]) == []

        await store.close()


class TestUpsertBatch:
    async def test_batch_upsert(self, vector_store):
        items = [
            ("a", [1.0, 0.0, 0.0, 0.0]),
            ("b", [0.0, 1.0, 0.0, 0.0]),
            ("c", [0.0, 0.0, 1.0, 0.0]),
        ]
        await vector_store.upsert_articles_batch(items)

        results = await vector_store.search_articles([1.0, 0.0, 0.0, 0.0], topk=3)
        assert len(results) == 3
        assert results[0].content_item_id == "a"

    async def test_batch_upsert_empty(self, vector_store):
        await vector_store.upsert_articles_batch([])

    async def test_upsert_article_chunks_raises_when_collection_creation_returns_none(
        self, tmp_path
    ):
        store = VectorStore(data_dir=str(tmp_path / "vectors"), dimensions=4, model_name="model-a")
        store._initialized = True
        store._article_collection = AsyncMock(return_value=None)

        with pytest.raises(RuntimeError, match="not initialized"):
            await store.upsert_article_chunks_batch([])

    async def test_article_chunk_batch_upsert_splits_large_batches(self, tmp_path):
        store = VectorStore(data_dir=str(tmp_path / "vectors"), dimensions=4, model_name="model-a")
        store._initialized = True
        store._articles = MagicMock()

        items = [
            ArticleChunkVector(
                chunk_id=f"item-{index:04d}",
                content_item_id=f"item-{index:04d}",
                chunk_index=index,
                text="chunk text",
                search_text="title\n\nchunk text",
                embedding=[1.0, 0.0, 0.0, 0.0],
            )
            for index in range(300)
        ]

        await store.upsert_article_chunks_batch(items)

        assert store._articles.upsert.call_count == 2
        assert len(store._articles.upsert.call_args_list[0].args[0]) == 256
        assert len(store._articles.upsert.call_args_list[1].args[0]) == 44

    async def test_message_chunk_batch_upsert_empty_does_not_write(self, tmp_path):
        store = VectorStore(data_dir=str(tmp_path / "vectors"), dimensions=4, model_name="model-a")
        store._initialized = True
        store._message_chunks["guild-1"] = MagicMock()

        await store.upsert_message_chunks_batch("guild-1", [])

        store._message_chunks["guild-1"].upsert.assert_not_called()

    async def test_message_chunk_batch_upsert_splits_large_batches(self, tmp_path):
        store = VectorStore(data_dir=str(tmp_path / "vectors"), dimensions=4, model_name="model-a")
        store._initialized = True
        store._message_chunks["guild-1"] = MagicMock()
        items = [
            (f"chunk-{index:04d}", [1.0, 0.0, 0.0, 0.0])
            for index in range(300)
        ]

        await store.upsert_message_chunks_batch("guild-1", items)

        collection = store._message_chunks["guild-1"]
        assert collection.upsert.call_count == 2
        assert len(collection.upsert.call_args_list[0].args[0]) == 256
        assert len(collection.upsert.call_args_list[1].args[0]) == 44

    async def test_upsert_message_chunk_raises_when_collection_creation_returns_none(
        self, tmp_path
    ):
        store = VectorStore(data_dir=str(tmp_path / "vectors"), dimensions=4, model_name="model-a")
        store._initialized = True
        store._message_chunk_collection = AsyncMock(return_value=None)

        with pytest.raises(RuntimeError, match="not initialized"):
            await store.upsert_message_chunk("guild-1", "chunk-1", [1.0, 0.0, 0.0, 0.0])

    async def test_upsert_message_chunks_batch_raises_when_collection_creation_returns_none(
        self, tmp_path
    ):
        store = VectorStore(data_dir=str(tmp_path / "vectors"), dimensions=4, model_name="model-a")
        store._initialized = True
        store._message_chunk_collection = AsyncMock(return_value=None)

        with pytest.raises(RuntimeError, match="not initialized"):
            await store.upsert_message_chunks_batch("guild-1", [])


class TestDelete:
    async def test_delete_article(self, vector_store):
        await vector_store.upsert_article("item-1", [1.0, 0.0, 0.0, 0.0])
        await vector_store.delete_article("item-1")

        results = await vector_store.search_articles([1.0, 0.0, 0.0, 0.0], topk=1)
        assert len(results) == 0

    async def test_delete_article_chunks_noops_when_collection_absent(self, tmp_path):
        store = VectorStore(data_dir=str(tmp_path / "vectors"), dimensions=4, model_name="model-a")
        await store.initialize()

        await store.delete_article_chunks(["missing"])

        await store.close()

    async def test_delete_message_chunks_noops_when_collection_absent(self, tmp_path):
        store = VectorStore(data_dir=str(tmp_path / "vectors"), dimensions=4, model_name="model-a")
        await store.initialize()

        await store.delete_message_chunks_by_ids("guild-1", ["missing"])

        await store.close()

    async def test_delete_message_chunks_deletes_each_id(self, tmp_path):
        store = VectorStore(data_dir=str(tmp_path / "vectors"), dimensions=4, model_name="model-a")
        store._initialized = True
        collection = MagicMock()
        store._message_chunks["guild-1"] = collection

        await store.delete_message_chunks_by_ids("guild-1", ["chunk-1", "chunk-2"])

        assert [call.args[0] for call in collection.delete.call_args_list] == [
            "chunk-1",
            "chunk-2",
        ]


class TestRecreateCollections:
    async def test_recreate_articles_collection(self, vector_store):
        await vector_store.upsert_article("item-1", [1.0, 0.0, 0.0, 0.0])
        assert await vector_store.article_doc_count() == 1

        await vector_store.recreate_articles_collection()

        assert await vector_store.article_doc_count() == 0
        results = await vector_store.search_articles([1.0, 0.0, 0.0, 0.0], topk=1)
        assert results == []

    async def test_recreate_message_chunks_collection(self, vector_store):
        await vector_store.upsert_message_chunk("guild-1", "chunk-1", [1.0, 0.0, 0.0, 0.0])
        assert await vector_store.message_chunk_doc_count("guild-1") == 1

        await vector_store.recreate_message_chunks_collection("guild-1")

        assert await vector_store.message_chunk_doc_count("guild-1") == 0
        results = await vector_store.search_message_chunks("guild-1", [1.0, 0.0, 0.0, 0.0], topk=1)
        assert results == []


class TestNotInitialized:
    async def test_upsert_raises(self):
        store = VectorStore(data_dir="/tmp/noinit", dimensions=4, model_name="model-a")
        with pytest.raises(RuntimeError, match="not initialized"):
            await store.upsert_article("x", [1.0, 0.0, 0.0, 0.0])

    async def test_search_raises(self):
        store = VectorStore(data_dir="/tmp/noinit", dimensions=4, model_name="model-a")
        with pytest.raises(RuntimeError, match="not initialized"):
            await store.search_articles([1.0, 0.0, 0.0, 0.0])

    async def test_delete_raises(self):
        store = VectorStore(data_dir="/tmp/noinit", dimensions=4, model_name="model-a")
        with pytest.raises(RuntimeError, match="not initialized"):
            await store.delete_article("x")
