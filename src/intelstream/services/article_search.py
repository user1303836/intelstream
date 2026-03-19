from __future__ import annotations

import asyncio
import math
import re
from dataclasses import dataclass
from typing import TYPE_CHECKING, Any

import structlog

if TYPE_CHECKING:
    from intelstream.database.vector_store import ArticleChunkSearchResult

logger = structlog.get_logger(__name__)

_SENTENCE_SPLIT_RE = re.compile(r"(?<=[.!?])\s+|\n+")
_WHITESPACE_RE = re.compile(r"[ \t]+")


@dataclass(frozen=True)
class ArticleIndexChunk:
    chunk_index: int
    text: str
    search_text: str


@dataclass(frozen=True)
class RankedArticleChunk:
    chunk_id: str
    content_item_id: str
    chunk_index: int
    text: str
    vector_score: float
    relevance_score: float


@dataclass(frozen=True)
class ArticleSearchHit:
    content_item_id: str
    score: float
    best_chunk_text: str
    supporting_chunks: int
    vector_score: float


class ArticleChunker:
    def __init__(self, chunk_size_chars: int = 1200, overlap_chars: int = 200) -> None:
        self._chunk_size_chars = chunk_size_chars
        self._overlap_chars = overlap_chars

    def build_chunks(
        self,
        *,
        title: str,
        raw_content: str | None,
        summary: str | None,
    ) -> list[ArticleIndexChunk]:
        source_text = _coerce_text(raw_content) or _coerce_text(summary)
        if not source_text:
            return []

        text_chunks = self._chunk_text(source_text)
        return [
            ArticleIndexChunk(
                chunk_index=index,
                text=chunk_text,
                search_text=self._build_search_text(title, chunk_text),
            )
            for index, chunk_text in enumerate(text_chunks)
        ]

    def _chunk_text(self, text: str) -> list[str]:
        normalized = _normalize_text(text)
        if not normalized:
            return []

        units = [unit for unit in _SENTENCE_SPLIT_RE.split(normalized) if unit]
        if not units:
            return [normalized[: self._chunk_size_chars]]

        chunks: list[str] = []
        current_units: list[str] = []
        current_len = 0

        for unit in units:
            if len(unit) > self._chunk_size_chars:
                for segment in self._split_long_unit(unit):
                    current_units, current_len = self._append_unit(
                        current_units=current_units,
                        current_len=current_len,
                        unit=segment,
                        chunks=chunks,
                    )
                continue

            current_units, current_len = self._append_unit(
                current_units=current_units,
                current_len=current_len,
                unit=unit,
                chunks=chunks,
            )

        if current_units:
            chunks.append(" ".join(current_units))

        return chunks

    def _append_unit(
        self,
        *,
        current_units: list[str],
        current_len: int,
        unit: str,
        chunks: list[str],
    ) -> tuple[list[str], int]:
        separator_len = 1 if current_units else 0
        projected_len = current_len + separator_len + len(unit)
        if current_units and projected_len > self._chunk_size_chars:
            chunks.append(" ".join(current_units))
            current_units = self._build_overlap(current_units)
            current_len = _joined_length(current_units)

        current_units.append(unit)
        current_len = _joined_length(current_units)
        return current_units, current_len

    def _build_overlap(self, current_units: list[str]) -> list[str]:
        if not current_units or self._overlap_chars <= 0:
            return []

        overlap_units: list[str] = []
        overlap_len = 0
        for unit in reversed(current_units):
            overlap_units.append(unit)
            overlap_len += len(unit) + 1
            if overlap_len >= self._overlap_chars:
                break
        overlap_units.reverse()
        return overlap_units

    def _build_search_text(self, title: str, chunk_text: str) -> str:
        title_text = title.strip()
        if not title_text:
            return chunk_text
        return f"{title_text}\n\n{chunk_text}"

    def _split_long_unit(self, unit: str) -> list[str]:
        words = unit.split()
        if not words:
            return []

        segments: list[str] = []
        current_words: list[str] = []

        for word in words:
            candidate = " ".join([*current_words, word])
            if current_words and len(candidate) > self._chunk_size_chars:
                segments.append(" ".join(current_words))
                current_words = [word]
            else:
                current_words.append(word)

        if current_words:
            segments.append(" ".join(current_words))

        return segments


class ArticleReranker:
    def __init__(
        self,
        *,
        enabled: bool,
        model_name: str,
    ) -> None:
        self._enabled = enabled
        self._model_name = model_name
        self._model: Any | None = None
        self._load_failed = False
        self._lock = asyncio.Lock()

    async def rerank(
        self,
        query: str,
        candidates: list[ArticleChunkSearchResult],
    ) -> list[RankedArticleChunk]:
        if not candidates:
            return []

        model = await self._get_model()
        if model is None:
            return [
                RankedArticleChunk(
                    chunk_id=candidate.chunk_id,
                    content_item_id=candidate.content_item_id,
                    chunk_index=candidate.chunk_index,
                    text=candidate.text,
                    vector_score=candidate.score,
                    relevance_score=_clamp_score(candidate.score),
                )
                for candidate in candidates
            ]

        pairs = [(query, candidate.search_text) for candidate in candidates]
        scores = await asyncio.to_thread(model.predict, pairs)

        ranked = [
            RankedArticleChunk(
                chunk_id=candidate.chunk_id,
                content_item_id=candidate.content_item_id,
                chunk_index=candidate.chunk_index,
                text=candidate.text,
                vector_score=candidate.score,
                relevance_score=_sigmoid(float(score)),
            )
            for candidate, score in zip(candidates, scores, strict=True)
        ]
        ranked.sort(
            key=lambda candidate: (candidate.relevance_score, candidate.vector_score), reverse=True
        )
        return ranked

    async def _get_model(self) -> Any | None:
        if not self._enabled or self._load_failed:
            return None
        if self._model is not None:
            return self._model

        async with self._lock:
            if self._model is not None:
                return self._model
            if self._load_failed:
                return None

            try:
                from sentence_transformers import CrossEncoder

                self._model = await asyncio.to_thread(lambda: CrossEncoder(self._model_name))
                logger.info("Article reranker loaded", model=self._model_name)
            except Exception as exc:  # pragma: no cover - depends on local model/runtime state
                self._load_failed = True
                logger.warning(
                    "Failed to initialize article reranker; falling back to vector scores",
                    model=self._model_name,
                    error=str(exc),
                )
                return None

        return self._model


def build_article_chunk_id(content_item_id: str, chunk_index: int) -> str:
    return f"{content_item_id}__{chunk_index:04d}"


def aggregate_article_hits(
    ranked_chunks: list[RankedArticleChunk],
    *,
    limit: int,
    min_relevance_score: float,
) -> list[ArticleSearchHit]:
    grouped: dict[str, list[RankedArticleChunk]] = {}
    for chunk in ranked_chunks:
        grouped.setdefault(chunk.content_item_id, []).append(chunk)

    hits: list[ArticleSearchHit] = []
    for content_item_id, chunks in grouped.items():
        best_chunk = chunks[0]
        if best_chunk.relevance_score < min_relevance_score:
            continue

        support_bonus = min(0.08, 0.02 * max(0, len(chunks) - 1))
        hits.append(
            ArticleSearchHit(
                content_item_id=content_item_id,
                score=min(1.0, best_chunk.relevance_score + support_bonus),
                best_chunk_text=best_chunk.text,
                supporting_chunks=len(chunks),
                vector_score=best_chunk.vector_score,
            )
        )

    hits.sort(key=lambda hit: (hit.score, hit.vector_score), reverse=True)
    return hits[:limit]


def _normalize_text(text: str) -> str:
    normalized = text.replace("\r\n", "\n")
    normalized = _WHITESPACE_RE.sub(" ", normalized)
    normalized = re.sub(r"\n{3,}", "\n\n", normalized)
    normalized = re.sub(r" *\n *", "\n", normalized)
    return normalized.strip()


def _coerce_text(value: str | None) -> str:
    if not isinstance(value, str):
        return ""
    return value.strip()


def _joined_length(units: list[str]) -> int:
    if not units:
        return 0
    return sum(len(unit) for unit in units) + max(0, len(units) - 1)


def _sigmoid(score: float) -> float:
    if score >= 0:
        z = math.exp(-score)
        return 1.0 / (1.0 + z)
    z = math.exp(score)
    return z / (1.0 + z)


def _clamp_score(score: float) -> float:
    return max(0.0, min(1.0, float(score)))
