from __future__ import annotations

import hashlib
import json
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from typing import TYPE_CHECKING, Protocol, runtime_checkable

import numpy as np
import structlog

if TYPE_CHECKING:
    from intelstream.database.models import ContentEmbedding, ContentItem, Source
    from intelstream.database.repository import Repository

logger = structlog.get_logger()


@runtime_checkable
class EmbeddingProvider(Protocol):
    async def embed(self, texts: list[str]) -> list[list[float]]: ...

    @property
    def dimension(self) -> int: ...

    @property
    def model_name(self) -> str: ...


class VoyageEmbeddingProvider:
    def __init__(self, api_key: str, model: str = "voyage-3.5-lite") -> None:
        import voyageai

        self._client = voyageai.AsyncClient(api_key=api_key)  # type: ignore[attr-defined]
        self._model = model

    async def embed(self, texts: list[str]) -> list[list[float]]:
        result = await self._client.embed(texts, model=self._model)
        return result.embeddings  # type: ignore[return-value]

    @property
    def dimension(self) -> int:
        return 1024

    @property
    def model_name(self) -> str:
        return self._model


def build_embedding_text(item: ContentItem, source: Source) -> str:
    parts = [item.title]
    if item.summary:
        parts.append(item.summary)
    parts.append(f"Source: {source.name} ({source.type.value})")
    if item.author:
        parts.append(f"Author: {item.author}")
    return " ".join(parts)


def compute_text_hash(text: str) -> str:
    return hashlib.sha256(text.encode()).hexdigest()


def cosine_similarity(query: np.ndarray, candidates: np.ndarray) -> np.ndarray:
    query_len = np.linalg.norm(query)
    if query_len == 0:
        return np.zeros(candidates.shape[0], dtype=np.float32)
    query_norm = query / query_len
    candidate_norms = np.linalg.norm(candidates, axis=1, keepdims=True)
    candidate_norms = np.where(candidate_norms == 0, 1.0, candidate_norms)
    candidates_norm = candidates / candidate_norms
    return candidates_norm @ query_norm  # type: ignore[no-any-return]


@dataclass
class SearchResult:
    content_item_id: str
    title: str
    summary: str
    original_url: str
    source_type: str
    source_name: str
    published_at: datetime
    score: float


class SearchService:
    def __init__(
        self,
        repository: Repository,
        embedding_provider: EmbeddingProvider,
    ) -> None:
        self._repository = repository
        self._provider = embedding_provider
        self._embeddings_cache: dict[str, np.ndarray] = {}
        self._cache_loaded = False

    async def search(
        self,
        query: str,
        guild_id: str | None = None,
        source_type: str | None = None,
        days: int | None = None,
        limit: int = 5,
        threshold: float = 0.3,
    ) -> list[SearchResult]:
        query_embedding = (await self._provider.embed([query]))[0]
        query_array = np.array(query_embedding, dtype=np.float32)
        candidates = await self._get_candidates(guild_id, source_type, days)
        return self._rank(query_array, candidates, limit, threshold)

    async def embed_pending(self) -> int:
        items = await self._repository.get_items_without_embeddings(limit=100)
        count = 0
        for item in items:
            try:
                source = await self._repository.get_source_by_id(item.source_id)
                if not source:
                    continue
                text = build_embedding_text(item, source)
                text_hash = compute_text_hash(text)
                embeddings = await self._provider.embed([text])
                embedding_json = json.dumps(embeddings[0])
                await self._repository.add_content_embedding(
                    content_item_id=item.id,
                    embedding_json=embedding_json,
                    model_name=self._provider.model_name,
                    text_hash=text_hash,
                )
                self._embeddings_cache[item.id] = np.array(embeddings[0], dtype=np.float32)
                count += 1
            except Exception:
                logger.warning("Failed to embed content item", item_id=item.id, exc_info=True)
                continue
        return count

    async def _ensure_cache_loaded(self) -> None:
        if self._cache_loaded:
            return
        await self._check_model_consistency()
        embeddings = await self._repository.get_all_embeddings()
        for emb in embeddings:
            self._embeddings_cache[emb.content_item_id] = np.array(
                json.loads(emb.embedding_json), dtype=np.float32
            )
        self._cache_loaded = True

    async def _check_model_consistency(self) -> None:
        latest = await self._repository.get_latest_embedding()
        if latest and latest.model_name != self._provider.model_name:
            logger.warning(
                "Embedding model changed, triggering full re-embed",
                old_model=latest.model_name,
                new_model=self._provider.model_name,
            )
            await self._repository.clear_all_embeddings()
            self._embeddings_cache.clear()
            self._cache_loaded = False

    async def _get_candidates(
        self, guild_id: str | None, source_type: str | None, days: int | None
    ) -> list[tuple[ContentEmbedding, ContentItem, Source]]:
        await self._ensure_cache_loaded()
        since = datetime.now(UTC) - timedelta(days=days) if days else None
        return await self._repository.get_embeddings_with_items(
            guild_id=guild_id, source_type=source_type, since=since
        )

    def _rank(
        self,
        query_array: np.ndarray,
        candidates: list[tuple[ContentEmbedding, ContentItem, Source]],
        limit: int,
        threshold: float,
    ) -> list[SearchResult]:
        if not candidates:
            return []
        embeddings = []
        for emb, _item, _source in candidates:
            cached = self._embeddings_cache.get(emb.content_item_id)
            if cached is not None:
                embeddings.append(cached)
            else:
                embeddings.append(np.array(json.loads(emb.embedding_json), dtype=np.float32))
        candidates_matrix = np.stack(embeddings)
        scores = cosine_similarity(query_array, candidates_matrix)
        scored = [
            (float(score), emb, item, source)
            for score, (emb, item, source) in zip(scores, candidates, strict=True)
            if score >= threshold
        ]
        scored.sort(key=lambda x: x[0], reverse=True)
        results = []
        for score, _emb, item, source in scored[:limit]:
            results.append(
                SearchResult(
                    content_item_id=item.id,
                    title=item.title,
                    summary=item.summary or "",
                    original_url=item.original_url,
                    source_type=source.type.value,
                    source_name=source.name,
                    published_at=item.published_at,
                    score=score,
                )
            )
        return results
