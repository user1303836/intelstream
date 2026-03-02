from __future__ import annotations

import asyncio
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import structlog
import zvec

logger = structlog.get_logger(__name__)


@dataclass
class SearchResult:
    content_item_id: str
    score: float


class VectorStore:
    def __init__(self, data_dir: str, dimensions: int = 384) -> None:
        self._data_dir = data_dir
        self._dimensions = dimensions
        self._articles: zvec.Collection | None = None

    async def initialize(self) -> None:
        Path(self._data_dir).mkdir(parents=True, exist_ok=True)
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

    async def close(self) -> None:
        if self._articles is not None:
            await asyncio.to_thread(self._articles.flush)
            self._articles = None
