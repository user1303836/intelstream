from __future__ import annotations

import asyncio
from contextlib import suppress
from datetime import UTC, datetime
from typing import TYPE_CHECKING

import discord
import structlog
from discord import app_commands
from discord.ext import commands

from intelstream.database.models import ArticleChunkMeta, ContentItem
from intelstream.database.vector_store import ArticleChunkVector
from intelstream.services.article_search import (
    ArticleChunker,
    ArticleIndexChunk,
    ArticleReranker,
    ArticleSearchHit,
    aggregate_article_hits,
    build_article_chunk_id,
)

if TYPE_CHECKING:
    from intelstream.bot import IntelStreamBot
    from intelstream.database.vector_store import VectorStore
    from intelstream.services.embedding_service import EmbeddingService

logger = structlog.get_logger(__name__)

MAX_SUMMARY_PREVIEW = 150
MAX_MATCH_PREVIEW = 220
INDEX_BATCH_SIZE = 50
HEALTH_CHECK_TOPK = 10
INDEX_RECOVERY_MAX_ATTEMPTS = 3
INDEX_RECOVERY_BASE_DELAY_SECONDS = 2.0


class Search(commands.Cog):
    def __init__(
        self,
        bot: IntelStreamBot,
        embedding_service: EmbeddingService,
        vector_store: VectorStore,
    ) -> None:
        self.bot = bot
        self._embedding_service = embedding_service
        self._vector_store = vector_store
        self._index_rebuild_task: asyncio.Task[None] | None = None
        self._index_rebuild_error: str | None = None
        self._article_chunker = ArticleChunker(
            chunk_size_chars=_int_setting(self.bot.settings, "article_chunk_size_chars", 1200),
            overlap_chars=_int_setting(self.bot.settings, "article_chunk_overlap_chars", 200),
        )
        self._reranker = ArticleReranker(
            enabled=_bool_setting(self.bot.settings, "article_search_reranker_enabled", True),
            model_name=_str_setting(
                self.bot.settings,
                "article_search_reranker_model",
                "cross-encoder/ms-marco-MiniLM-L6-v2",
            ),
        )

    async def cog_load(self) -> None:
        self._start_index_rebuild()
        logger.info("Search cog loaded")

    async def cog_unload(self) -> None:
        if self._index_rebuild_task is not None:
            self._index_rebuild_task.cancel()
            with suppress(asyncio.CancelledError):
                await self._index_rebuild_task
        logger.info("Search cog unloaded")

    @app_commands.command(
        name="search",
        description="Search ingested articles by semantic similarity",
    )
    @app_commands.describe(query="Natural language search query")
    @app_commands.checks.cooldown(rate=5, per=60.0)
    async def search(self, interaction: discord.Interaction, query: str) -> None:
        if self._index_rebuild_task is not None and not self._index_rebuild_task.done():
            await interaction.response.send_message(
                "Search is temporarily unavailable while the article index is being rebuilt.",
                ephemeral=True,
            )
            return

        if self._index_rebuild_error is not None:
            self._start_index_rebuild()
            await interaction.response.send_message(
                "Search is temporarily unavailable while the article index recovers. Try again in a moment.",
                ephemeral=True,
            )
            return

        await interaction.response.defer()

        logger.info(
            "search command invoked",
            user_id=interaction.user.id,
            query=query,
        )

        results = await self._search_articles(query)
        if not results:
            await interaction.followup.send(
                "No strong matches found. Try broader wording or a more specific query.",
                ephemeral=True,
            )
            return

        embed = discord.Embed(
            title="Search Results",
            description=(
                f'Query: "{_truncate(_clean_preview(query), 120)}"\n'
                f"Showing the strongest semantic matches across indexed article excerpts."
            ),
            color=discord.Color.blurple(),
            timestamp=datetime.now(UTC),
        )

        for index, (item, hit) in enumerate(results, start=1):
            title = _truncate(item.title, 100)
            summary = _truncate(_clean_preview(item.summary or ""), MAX_SUMMARY_PREVIEW)
            snippet = _truncate(_clean_preview(hit.best_chunk_text), MAX_MATCH_PREVIEW)

            meta_parts = []
            if item.original_url:
                meta_parts.append(f"[Open article]({item.original_url})")
            meta_parts.append(f"Relevance {round(hit.score * 100)}%")
            meta_parts.append(_supporting_excerpt_label(hit.supporting_chunks))

            value_parts = [" • ".join(meta_parts)]
            if snippet:
                value_parts.append(f"Best match: {snippet}")
            if summary and summary != snippet:
                value_parts.append(f"Summary: {summary}")
            embed.add_field(
                name=f"{index}. {title}",
                value="\n".join(value_parts),
                inline=False,
            )

        embed.set_footer(text=f"{len(results)} result(s)")
        await interaction.followup.send(embed=embed)

    @app_commands.command(
        name="index",
        description="Index all existing summarized content for search (admin only)",
    )
    @app_commands.checks.has_permissions(administrator=True)
    async def index(self, interaction: discord.Interaction) -> None:
        await interaction.response.defer(ephemeral=True)

        logger.info("index command invoked", user_id=interaction.user.id)

        if self._index_rebuild_task is not None and not self._index_rebuild_task.done():
            await interaction.followup.send(
                "The article index is already being rebuilt.", ephemeral=True
            )
            return

        indexed_articles, indexed_chunks = await self._rebuild_article_index()
        self._index_rebuild_error = None

        await interaction.followup.send(
            f"Indexed {indexed_articles} articles across {indexed_chunks} semantic chunks.",
            ephemeral=True,
        )
        logger.info(
            "Index complete",
            indexed_articles=indexed_articles,
            indexed_chunks=indexed_chunks,
        )

    @search.error
    async def search_error(
        self, interaction: discord.Interaction, error: app_commands.AppCommandError
    ) -> None:
        if isinstance(error, app_commands.CommandOnCooldown):
            await interaction.response.send_message(
                f"Search is on cooldown. Try again in {int(error.retry_after)}s.",
                ephemeral=True,
            )
        else:
            raise error

    @index.error
    async def index_error(
        self, interaction: discord.Interaction, error: app_commands.AppCommandError
    ) -> None:
        if isinstance(error, app_commands.MissingPermissions):
            await interaction.response.send_message(
                "Administrator permissions required.", ephemeral=True
            )
        else:
            raise error

    async def _ensure_article_index(self) -> None:
        for attempt in range(1, INDEX_RECOVERY_MAX_ATTEMPTS + 1):
            try:
                expected_count = await self.bot.repository.count_summarized_content_items()
                if expected_count == 0:
                    self._index_rebuild_error = None
                    logger.info("No summarized content found; skipping article index rebuild")
                    return

                if await self._article_index_is_healthy(expected_count):
                    self._index_rebuild_error = None
                    logger.info("Article search index is healthy", items=expected_count)
                    return

                logger.warning(
                    "Article search index is unhealthy; rebuilding from summarized content",
                    attempt=attempt,
                    expected_items=expected_count,
                )
                rebuilt = await self._rebuild_article_index()
                self._index_rebuild_error = None
                logger.info("Article search index rebuilt", indexed=rebuilt)
                return
            except asyncio.CancelledError:
                raise
            except Exception as exc:
                self._index_rebuild_error = f"{type(exc).__name__}: {exc}"
                logger.error(
                    "Failed to rebuild article search index",
                    attempt=attempt,
                    error=str(exc),
                    error_type=type(exc).__name__,
                )
                if attempt >= INDEX_RECOVERY_MAX_ATTEMPTS:
                    return

                delay_seconds = INDEX_RECOVERY_BASE_DELAY_SECONDS * attempt
                logger.warning(
                    "Retrying article search index rebuild",
                    attempt=attempt + 1,
                    delay_seconds=delay_seconds,
                )
                await asyncio.sleep(delay_seconds)

    async def _article_index_is_healthy(self, expected_count: int) -> bool:
        indexed_article_count = await self.bot.repository.count_article_chunk_items()
        if indexed_article_count != expected_count:
            logger.warning(
                "Article search index article count mismatch",
                expected=expected_count,
                indexed=indexed_article_count,
            )
            return False

        stored_chunk_count = await self.bot.repository.count_article_chunk_metas()
        vector_chunk_count = await self._vector_store.article_chunk_doc_count()
        if stored_chunk_count != vector_chunk_count:
            logger.warning(
                "Article search index chunk count mismatch",
                stored=stored_chunk_count,
                indexed=vector_chunk_count,
            )
            return False

        sample_batch = await self.bot.repository.get_summarized_content_items(limit=1)
        if not sample_batch:
            return True

        sample = sample_batch[0]
        sample_chunks = self._article_chunker.build_chunks(
            title=sample.title,
            raw_content=sample.raw_content,
            summary=sample.summary,
        )
        if not sample_chunks:
            logger.warning(
                "Article search index probe skipped; sample item had no chunks",
                sample_item_id=sample.id,
            )
            return False

        query_embedding = await self._embedding_service.embed_text(sample_chunks[0].search_text)
        results = await self._vector_store.search_article_chunks(
            query_embedding, topk=HEALTH_CHECK_TOPK
        )
        if any(result.content_item_id == sample.id for result in results):
            return True

        logger.warning(
            "Article search index probe failed",
            sample_item_id=sample.id,
            result_ids=[result.content_item_id for result in results],
        )
        return False

    async def _rebuild_article_index(self, batch_size: int = INDEX_BATCH_SIZE) -> tuple[int, int]:
        total_items = await self.bot.repository.count_summarized_content_items()
        await self._vector_store.recreate_article_chunks_collection()
        await self.bot.repository.delete_all_article_chunk_metas()

        if total_items == 0:
            logger.info("No summarized content to index")
            return (0, 0)

        indexed_articles = 0
        indexed_chunks = 0
        offset = 0

        while True:
            items = await self.bot.repository.get_summarized_content_items(
                offset=offset,
                limit=batch_size,
            )
            if not items:
                break

            pending_chunks: list[tuple[ContentItem, ArticleIndexChunk]] = []
            for item in items:
                for chunk in self._article_chunker.build_chunks(
                    title=item.title,
                    raw_content=item.raw_content,
                    summary=item.summary,
                ):
                    pending_chunks.append((item, chunk))

            if pending_chunks:
                embeddings = await self._embedding_service.embed_batch(
                    [chunk.search_text for _, chunk in pending_chunks]
                )
                metas: list[ArticleChunkMeta] = []
                vector_items: list[ArticleChunkVector] = []
                batch_article_ids: set[str] = set()

                for (item, chunk), embedding in zip(pending_chunks, embeddings, strict=True):
                    chunk_id = build_article_chunk_id(item.id, chunk.chunk_index)
                    metas.append(
                        ArticleChunkMeta(
                            id=chunk_id,
                            content_item_id=item.id,
                            chunk_index=chunk.chunk_index,
                            text=chunk.text,
                        )
                    )
                    vector_items.append(
                        ArticleChunkVector(
                            chunk_id=chunk_id,
                            content_item_id=item.id,
                            chunk_index=chunk.chunk_index,
                            text=chunk.text,
                            search_text=chunk.search_text,
                            embedding=embedding,
                        )
                    )
                    batch_article_ids.add(item.id)

                await self.bot.repository.add_article_chunk_metas_batch(metas)
                await self._vector_store.upsert_article_chunks_batch(vector_items)
                indexed_articles += len(batch_article_ids)
                indexed_chunks += len(metas)

            offset += len(items)

            if indexed_articles == total_items or offset % (batch_size * 10) == 0:
                logger.info(
                    "Article index rebuild progress",
                    indexed_articles=indexed_articles,
                    indexed_chunks=indexed_chunks,
                    total_articles=total_items,
                )

        return indexed_articles, indexed_chunks

    async def _search_articles(self, query: str) -> list[tuple[ContentItem, ArticleSearchHit]]:
        query_embedding = await self._embedding_service.embed_text(query)
        candidate_limit = max(
            _int_setting(self.bot.settings, "article_search_candidate_limit", 24),
            self.bot.settings.search_result_limit,
        )
        candidates = await self._vector_store.search_article_chunks(
            query_embedding,
            topk=candidate_limit,
        )
        if not candidates:
            return []

        ranked_chunks = await self._reranker.rerank(query, candidates)
        hits = aggregate_article_hits(
            ranked_chunks,
            limit=self.bot.settings.search_result_limit,
            min_relevance_score=_float_setting(
                self.bot.settings,
                "article_search_min_relevance_score",
                0.35,
            ),
        )
        if not hits:
            return []

        items = await self.bot.repository.get_content_items_by_ids(
            [hit.content_item_id for hit in hits]
        )
        items_by_id = {item.id: item for item in items}
        return [
            (item, hit)
            for hit in hits
            if (item := items_by_id.get(hit.content_item_id)) is not None
        ]

    def _start_index_rebuild(self) -> None:
        if self._index_rebuild_task is not None and not self._index_rebuild_task.done():
            return
        self._index_rebuild_task = asyncio.create_task(
            self._ensure_article_index(),
            name="article-index-rebuild",
        )


def _truncate(text: str, max_len: int) -> str:
    if len(text) <= max_len:
        return text
    return text[: max_len - 3] + "..."


def _clean_preview(text: str) -> str:
    return " ".join(text.split())


def _supporting_excerpt_label(count: int) -> str:
    if count == 1:
        return "1 matching excerpt"
    return f"{count} matching excerpts"


def _int_setting(settings: object, name: str, default: int) -> int:
    value = getattr(settings, name, default)
    if isinstance(value, bool):
        return default
    if isinstance(value, int):
        return value
    return default


def _float_setting(settings: object, name: str, default: float) -> float:
    value = getattr(settings, name, default)
    if isinstance(value, (int, float)) and not isinstance(value, bool):
        return float(value)
    return default


def _bool_setting(settings: object, name: str, default: bool) -> bool:
    value = getattr(settings, name, default)
    if isinstance(value, bool):
        return value
    return default


def _str_setting(settings: object, name: str, default: str) -> str:
    value = getattr(settings, name, default)
    if isinstance(value, str):
        return value
    return default
