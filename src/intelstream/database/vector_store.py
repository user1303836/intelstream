from __future__ import annotations

import asyncio
import os
import shutil
from dataclasses import dataclass
from pathlib import Path
from typing import TYPE_CHECKING, Any

import structlog

if TYPE_CHECKING:
    import zvec

logger = structlog.get_logger(__name__)


@dataclass
class SearchResult:
    content_item_id: str
    score: float


@dataclass
class ChunkSearchResult:
    chunk_id: str
    score: float


class VectorStore:
    _ARTICLES_COLLECTION = "articles"
    _MESSAGE_CHUNKS_COLLECTION = "message_chunks"

    def __init__(self, data_dir: str, dimensions: int = 384) -> None:
        self._data_dir = data_dir
        self._dimensions = dimensions
        self._articles: zvec.Collection | None = None
        self._message_chunks: zvec.Collection | None = None

    async def initialize(self) -> None:
        await asyncio.to_thread(os.makedirs, self._data_dir, exist_ok=True)
        self._articles = await self._open_or_create_collection(self._ARTICLES_COLLECTION)
        self._message_chunks = await self._open_or_create_collection(
            self._MESSAGE_CHUNKS_COLLECTION
        )

    def _collection_path(self, collection_name: str) -> str:
        return str(Path(self._data_dir) / collection_name)

    def _collection_attr_name(self, collection_name: str) -> str:
        if collection_name == self._ARTICLES_COLLECTION:
            return "_articles"
        if collection_name == self._MESSAGE_CHUNKS_COLLECTION:
            return "_message_chunks"
        raise ValueError(f"Unknown collection name: {collection_name}")

    def _build_schema(self, collection_name: str) -> zvec.CollectionSchema:
        import zvec

        return zvec.CollectionSchema(
            name=collection_name,
            vectors=zvec.VectorSchema("embedding", zvec.DataType.VECTOR_FP32, self._dimensions),
        )

    async def _open_or_create_collection(self, collection_name: str) -> zvec.Collection:
        import zvec

        path = self._collection_path(collection_name)
        try:
            collection = await asyncio.to_thread(
                zvec.create_and_open,
                path=path,
                schema=self._build_schema(collection_name),
            )
            logger.info("Created new vector collection", collection=collection_name)
            return collection
        except Exception:
            collection = await asyncio.to_thread(
                zvec.open,
                path=path,
                option=zvec.CollectionOption(),
            )
            logger.info("Opened existing vector collection", collection=collection_name)
            return collection

    async def _recreate_collection(self, collection_name: str) -> zvec.Collection:
        attr_name = self._collection_attr_name(collection_name)
        collection = getattr(self, attr_name)
        path = self._collection_path(collection_name)

        if collection is not None:
            try:
                await asyncio.to_thread(collection.destroy)
            except Exception:
                logger.warning(
                    "Failed to destroy vector collection cleanly, removing files manually",
                    collection=collection_name,
                    path=path,
                )
            finally:
                setattr(self, attr_name, None)

        if await asyncio.to_thread(os.path.exists, path):
            await asyncio.to_thread(shutil.rmtree, path, True)

        recreated = await self._open_or_create_collection(collection_name)
        setattr(self, attr_name, recreated)
        return recreated

    async def _doc_count(self, collection: zvec.Collection | None) -> int:
        if collection is None:
            raise RuntimeError("VectorStore not initialized")
        return await asyncio.to_thread(lambda: int(collection.stats.doc_count))

    async def upsert_article(self, content_item_id: str, embedding: list[float]) -> None:
        import zvec

        if self._articles is None:
            raise RuntimeError("VectorStore not initialized")
        doc = zvec.Doc(
            id=content_item_id,
            vectors={"embedding": embedding},
        )
        await asyncio.to_thread(self._articles.upsert, [doc])

    async def upsert_articles_batch(self, items: list[tuple[str, list[float]]]) -> None:
        import zvec

        if self._articles is None:
            raise RuntimeError("VectorStore not initialized")
        if not items:
            return
        docs = [zvec.Doc(id=item_id, vectors={"embedding": emb}) for item_id, emb in items]
        await asyncio.to_thread(self._articles.upsert, docs)

    async def search_articles(
        self, query_embedding: list[float], topk: int = 5
    ) -> list[SearchResult]:
        import zvec

        if self._articles is None:
            raise RuntimeError("VectorStore not initialized")
        results: Any = await asyncio.to_thread(
            self._articles.query,
            zvec.VectorQuery("embedding", vector=query_embedding),
            topk=topk,
        )
        return [SearchResult(content_item_id=r.id, score=r.score) for r in results]

    async def delete_article(self, content_item_id: str) -> None:
        if self._articles is None:
            raise RuntimeError("VectorStore not initialized")
        await asyncio.to_thread(self._articles.delete, content_item_id)

    async def article_doc_count(self) -> int:
        return await self._doc_count(self._articles)

    async def upsert_message_chunk(self, chunk_id: str, embedding: list[float]) -> None:
        import zvec

        if self._message_chunks is None:
            raise RuntimeError("VectorStore not initialized")
        doc = zvec.Doc(
            id=chunk_id,
            vectors={"embedding": embedding},
        )
        await asyncio.to_thread(self._message_chunks.upsert, [doc])

    async def upsert_message_chunks_batch(self, items: list[tuple[str, list[float]]]) -> None:
        import zvec

        if self._message_chunks is None:
            raise RuntimeError("VectorStore not initialized")
        if not items:
            return
        docs = [zvec.Doc(id=cid, vectors={"embedding": emb}) for cid, emb in items]
        await asyncio.to_thread(self._message_chunks.upsert, docs)

    async def search_message_chunks(
        self, query_embedding: list[float], topk: int = 30
    ) -> list[ChunkSearchResult]:
        import zvec

        if self._message_chunks is None:
            raise RuntimeError("VectorStore not initialized")
        results: Any = await asyncio.to_thread(
            self._message_chunks.query,
            zvec.VectorQuery("embedding", vector=query_embedding),
            topk=topk,
        )
        return [ChunkSearchResult(chunk_id=r.id, score=r.score) for r in results]

    async def delete_message_chunks_by_ids(self, chunk_ids: list[str]) -> None:
        if self._message_chunks is None:
            raise RuntimeError("VectorStore not initialized")
        for chunk_id in chunk_ids:
            await asyncio.to_thread(self._message_chunks.delete, chunk_id)

    async def message_chunk_doc_count(self) -> int:
        return await self._doc_count(self._message_chunks)

    async def recreate_message_chunks_collection(self) -> None:
        await self._recreate_collection(self._MESSAGE_CHUNKS_COLLECTION)

    async def close(self) -> None:
        if self._articles is not None:
            await asyncio.to_thread(self._articles.flush)
            self._articles = None
        if self._message_chunks is not None:
            await asyncio.to_thread(self._message_chunks.flush)
            self._message_chunks = None
