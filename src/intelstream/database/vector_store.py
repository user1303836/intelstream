from __future__ import annotations

import asyncio
import os
from dataclasses import dataclass
from typing import Any

import structlog
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
    def __init__(self, data_dir: str, dimensions: int = 384) -> None:
        self._data_dir = data_dir
        self._dimensions = dimensions
        self._articles: zvec.Collection | None = None
        self._message_chunks: zvec.Collection | None = None

    async def initialize(self) -> None:
        await asyncio.to_thread(os.makedirs, self._data_dir, exist_ok=True)
        articles_path = f"{self._data_dir}/articles"
        try:
            schema = zvec.CollectionSchema(
                name="articles",
                vectors=zvec.VectorSchema("embedding", zvec.DataType.VECTOR_FP32, self._dimensions),
            )
            self._articles = await asyncio.to_thread(
                zvec.create_and_open, path=articles_path, schema=schema
            )
            logger.info("Created new articles vector collection")
        except Exception:
            self._articles = await asyncio.to_thread(
                zvec.open, path=articles_path, option=zvec.CollectionOption()
            )
            logger.info("Opened existing articles vector collection")

        chunks_path = f"{self._data_dir}/message_chunks"
        try:
            schema = zvec.CollectionSchema(
                name="message_chunks",
                vectors=zvec.VectorSchema("embedding", zvec.DataType.VECTOR_FP32, self._dimensions),
            )
            self._message_chunks = await asyncio.to_thread(
                zvec.create_and_open, path=chunks_path, schema=schema
            )
            logger.info("Created new message_chunks vector collection")
        except Exception:
            self._message_chunks = await asyncio.to_thread(
                zvec.open, path=chunks_path, option=zvec.CollectionOption()
            )
            logger.info("Opened existing message_chunks vector collection")

    async def upsert_article(self, content_item_id: str, embedding: list[float]) -> None:
        if self._articles is None:
            raise RuntimeError("VectorStore not initialized")
        doc = zvec.Doc(
            id=content_item_id,
            vectors={"embedding": embedding},
        )
        await asyncio.to_thread(self._articles.upsert, [doc])

    async def upsert_articles_batch(self, items: list[tuple[str, list[float]]]) -> None:
        if self._articles is None:
            raise RuntimeError("VectorStore not initialized")
        if not items:
            return
        docs = [zvec.Doc(id=item_id, vectors={"embedding": emb}) for item_id, emb in items]
        await asyncio.to_thread(self._articles.upsert, docs)

    async def search_articles(
        self, query_embedding: list[float], topk: int = 5
    ) -> list[SearchResult]:
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

    async def upsert_message_chunk(self, chunk_id: str, embedding: list[float]) -> None:
        if self._message_chunks is None:
            raise RuntimeError("VectorStore not initialized")
        doc = zvec.Doc(
            id=chunk_id,
            vectors={"embedding": embedding},
        )
        await asyncio.to_thread(self._message_chunks.upsert, [doc])

    async def upsert_message_chunks_batch(self, items: list[tuple[str, list[float]]]) -> None:
        if self._message_chunks is None:
            raise RuntimeError("VectorStore not initialized")
        if not items:
            return
        docs = [zvec.Doc(id=cid, vectors={"embedding": emb}) for cid, emb in items]
        await asyncio.to_thread(self._message_chunks.upsert, docs)

    async def search_message_chunks(
        self, query_embedding: list[float], topk: int = 30
    ) -> list[ChunkSearchResult]:
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

    async def close(self) -> None:
        if self._articles is not None:
            await asyncio.to_thread(self._articles.flush)
            self._articles = None
        if self._message_chunks is not None:
            await asyncio.to_thread(self._message_chunks.flush)
            self._message_chunks = None
