import pytest

from intelstream.database.vector_store import VectorStore


@pytest.fixture
async def vector_store(tmp_path):
    store = VectorStore(data_dir=str(tmp_path / "vectors"), dimensions=4)
    await store.initialize()
    yield store
    await store.close()


class TestInitialize:
    async def test_creates_directory(self, tmp_path):
        store = VectorStore(data_dir=str(tmp_path / "new_dir"), dimensions=4)
        await store.initialize()
        assert (tmp_path / "new_dir").exists()
        await store.close()

    async def test_reopens_existing_collection(self, tmp_path):
        data_dir = str(tmp_path / "reopen_test")
        store1 = VectorStore(data_dir=data_dir, dimensions=4)
        await store1.initialize()
        await store1.upsert_article("doc1", [0.1, 0.2, 0.3, 0.4])
        await store1.close()

        store2 = VectorStore(data_dir=data_dir, dimensions=4)
        await store2.initialize()
        results = await store2.search_articles([0.1, 0.2, 0.3, 0.4], topk=1)
        assert len(results) == 1
        assert results[0].content_item_id == "doc1"
        await store2.close()


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


class TestDelete:
    async def test_delete_article(self, vector_store):
        await vector_store.upsert_article("item-1", [1.0, 0.0, 0.0, 0.0])
        await vector_store.delete_article("item-1")

        results = await vector_store.search_articles([1.0, 0.0, 0.0, 0.0], topk=1)
        assert len(results) == 0


class TestNotInitialized:
    async def test_upsert_raises(self):
        store = VectorStore(data_dir="/tmp/noinit", dimensions=4)
        with pytest.raises(RuntimeError, match="not initialized"):
            await store.upsert_article("x", [1.0, 0.0, 0.0, 0.0])

    async def test_search_raises(self):
        store = VectorStore(data_dir="/tmp/noinit", dimensions=4)
        with pytest.raises(RuntimeError, match="not initialized"):
            await store.search_articles([1.0, 0.0, 0.0, 0.0])

    async def test_delete_raises(self):
        store = VectorStore(data_dir="/tmp/noinit", dimensions=4)
        with pytest.raises(RuntimeError, match="not initialized"):
            await store.delete_article("x")
