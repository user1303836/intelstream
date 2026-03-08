from __future__ import annotations

import asyncio
from contextlib import suppress
from datetime import UTC, datetime
from typing import TYPE_CHECKING

import discord
import structlog
from discord import app_commands
from discord.ext import commands

if TYPE_CHECKING:
    from intelstream.bot import IntelStreamBot
    from intelstream.database.vector_store import VectorStore
    from intelstream.services.embedding_service import EmbeddingService

logger = structlog.get_logger(__name__)

MAX_SUMMARY_PREVIEW = 200
INDEX_BATCH_SIZE = 50
HEALTH_CHECK_TOPK = 10


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

    async def cog_load(self) -> None:
        self._index_rebuild_task = asyncio.create_task(
            self._ensure_article_index(),
            name="article-index-rebuild",
        )
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
            await interaction.response.send_message(
                "Search is temporarily unavailable because the article index needs recovery.",
                ephemeral=True,
            )
            return

        await interaction.response.defer()

        logger.info(
            "search command invoked",
            user_id=interaction.user.id,
            query=query,
        )

        query_embedding = await self._embedding_service.embed_text(query)

        topk = self.bot.settings.search_result_limit
        results = await self._vector_store.search_articles(query_embedding, topk=topk)

        if not results:
            await interaction.followup.send(
                "No results found. The search index may be empty.", ephemeral=True
            )
            return

        item_ids = [r.content_item_id for r in results]
        items = await self.bot.repository.get_content_items_by_ids(item_ids)
        items_by_id = {item.id: item for item in items}

        embed = discord.Embed(
            title=f'Search: "{_truncate(query, 80)}"',
            color=discord.Color.blue(),
            timestamp=datetime.now(UTC),
        )
        rendered_results = 0

        for result in results:
            item = items_by_id.get(result.content_item_id)
            if item is None:
                continue

            title = _truncate(item.title, 100)
            preview = _truncate(item.summary or "", MAX_SUMMARY_PREVIEW)

            value_parts = []
            if item.original_url:
                value_parts.append(f"[Link]({item.original_url})")
            value_parts.append(f"Similarity score: {result.score:.2f}")
            if preview:
                value_parts.append(preview)

            embed.add_field(
                name=title,
                value="\n".join(value_parts),
                inline=False,
            )
            rendered_results += 1

        if rendered_results == 0:
            await interaction.followup.send(
                "No results found. The search index may need rebuilding.",
                ephemeral=True,
            )
            return

        embed.set_footer(text=f"{rendered_results} results")
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

        total_indexed = await self._rebuild_article_index()
        self._index_rebuild_error = None

        await interaction.followup.send(
            f"Indexed {total_indexed} articles for search.", ephemeral=True
        )
        logger.info("Index complete", total_indexed=total_indexed)

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
        try:
            expected_count = await self.bot.repository.count_summarized_content_items()
            if expected_count == 0:
                logger.info("No summarized content found; skipping article index rebuild")
                return

            if await self._article_index_is_healthy(expected_count):
                logger.info("Article search index is healthy", items=expected_count)
                return

            logger.warning(
                "Article search index is unhealthy; rebuilding from summarized content",
                expected_items=expected_count,
            )
            rebuilt = await self._rebuild_article_index()
            logger.info("Article search index rebuilt", indexed=rebuilt)
        except asyncio.CancelledError:
            raise
        except Exception as exc:
            self._index_rebuild_error = str(exc)
            logger.exception("Failed to rebuild article search index", error=str(exc))

    async def _article_index_is_healthy(self, expected_count: int) -> bool:
        indexed_count = await self._vector_store.article_doc_count()
        if indexed_count != expected_count:
            logger.warning(
                "Article search index count mismatch",
                expected=expected_count,
                indexed=indexed_count,
            )
            return False

        sample_batch = await self.bot.repository.get_summarized_content_items(limit=1)
        if not sample_batch:
            return True

        sample = sample_batch[0]
        query_embedding = await self._embedding_service.embed_text(
            f"{sample.title} {sample.summary}"
        )
        results = await self._vector_store.search_articles(
            query_embedding,
            topk=HEALTH_CHECK_TOPK,
        )
        if any(result.content_item_id == sample.id for result in results):
            return True

        logger.warning(
            "Article search index probe failed",
            sample_item_id=sample.id,
            result_ids=[result.content_item_id for result in results],
        )
        return False

    async def _rebuild_article_index(self, batch_size: int = INDEX_BATCH_SIZE) -> int:
        total_items = await self.bot.repository.count_summarized_content_items()
        await self._vector_store.recreate_articles_collection()

        if total_items == 0:
            logger.info("No summarized content to index")
            return 0

        indexed = 0
        offset = 0

        while True:
            items = await self.bot.repository.get_summarized_content_items(
                offset=offset,
                limit=batch_size,
            )
            if not items:
                break

            texts = [f"{item.title} {item.summary}" for item in items]
            embeddings = await self._embedding_service.embed_batch(texts)
            batch = [(item.id, emb) for item, emb in zip(items, embeddings, strict=True)]
            await self._vector_store.upsert_articles_batch(batch)

            indexed += len(items)
            offset += len(items)

            if indexed == total_items or indexed % (batch_size * 10) == 0:
                logger.info(
                    "Article index rebuild progress",
                    indexed=indexed,
                    total=total_items,
                )

        return indexed


def _truncate(text: str, max_len: int) -> str:
    if len(text) <= max_len:
        return text
    return text[: max_len - 3] + "..."
