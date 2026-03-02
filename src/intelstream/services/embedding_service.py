from __future__ import annotations

import asyncio

import structlog
from sentence_transformers import SentenceTransformer

logger = structlog.get_logger(__name__)


class EmbeddingService:
    def __init__(self, model_name: str = "all-MiniLM-L6-v2") -> None:
        self._model_name = model_name
        self._model: SentenceTransformer | None = None

    async def initialize(self) -> None:
        self._model = await asyncio.to_thread(SentenceTransformer, self._model_name)
        logger.info("Embedding model loaded", model=self._model_name)

    async def embed_text(self, text: str) -> list[float]:
        if self._model is None:
            raise RuntimeError("EmbeddingService not initialized")
        embedding = await asyncio.to_thread(self._model.encode, text)
        return embedding.tolist()

    async def embed_batch(self, texts: list[str]) -> list[list[float]]:
        if self._model is None:
            raise RuntimeError("EmbeddingService not initialized")
        if not texts:
            return []
        embeddings = await asyncio.to_thread(self._model.encode, texts)
        return embeddings.tolist()  # type: ignore[no-any-return]
