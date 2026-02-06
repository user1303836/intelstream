from __future__ import annotations

import asyncio
from functools import cached_property
from typing import TYPE_CHECKING

import numpy as np
import structlog

from intelstream.noosphere.constants import EMBEDDING_DIM, EMBEDDING_MODEL_MULTILINGUAL

if TYPE_CHECKING:
    from sentence_transformers import SentenceTransformer

logger = structlog.get_logger(__name__)


class EmbeddingService:
    def __init__(self, model_name: str = EMBEDDING_MODEL_MULTILINGUAL) -> None:
        self._model_name = model_name
        self._model: SentenceTransformer | None = None

    @cached_property
    def dimension(self) -> int:
        return EMBEDDING_DIM

    def _get_model(self) -> SentenceTransformer:
        if self._model is None:
            from sentence_transformers import SentenceTransformer

            logger.info("Loading embedding model", model=self._model_name)
            self._model = SentenceTransformer(self._model_name)
        return self._model

    async def embed(self, text: str) -> np.ndarray:
        result: np.ndarray = (await self.embed_batch([text]))[0]
        return result

    async def embed_batch(self, texts: list[str]) -> np.ndarray:
        if not texts:
            return np.empty((0, self.dimension), dtype=np.float32)
        loop = asyncio.get_running_loop()
        model = self._get_model()
        embeddings: np.ndarray = await loop.run_in_executor(
            None, lambda: model.encode(texts, normalize_embeddings=True, show_progress_bar=False)
        )
        return embeddings.astype(np.float32)

    def embed_sync(self, texts: list[str]) -> np.ndarray:
        if not texts:
            return np.empty((0, self.dimension), dtype=np.float32)
        model = self._get_model()
        embeddings: np.ndarray = model.encode(
            texts, normalize_embeddings=True, show_progress_bar=False
        )
        return embeddings.astype(np.float32)
