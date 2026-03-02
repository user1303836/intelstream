from __future__ import annotations

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

    @app_commands.command(
        name="search",
        description="Search ingested articles by semantic similarity",
    )
    @app_commands.describe(query="Natural language search query")
    @app_commands.checks.cooldown(rate=5, per=60.0)
    async def search(self, interaction: discord.Interaction, query: str) -> None:
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

        for result in results:
            item = items_by_id.get(result.content_item_id)
            if item is None:
                continue

            title = _truncate(item.title, 100)
            preview = _truncate(item.summary or "", MAX_SUMMARY_PREVIEW)
            score_pct = f"{result.score * 100:.0f}%"

            value_parts = []
            if item.original_url:
                value_parts.append(f"[Link]({item.original_url})")
            value_parts.append(f"Relevance: {score_pct}")
            if preview:
                value_parts.append(preview)

            embed.add_field(
                name=title,
                value="\n".join(value_parts),
                inline=False,
            )

        embed.set_footer(text=f"{len(results)} results")
        await interaction.followup.send(embed=embed)

    @app_commands.command(
        name="index",
        description="Index all existing summarized content for search (admin only)",
    )
    @app_commands.checks.has_permissions(administrator=True)
    async def index(self, interaction: discord.Interaction) -> None:
        await interaction.response.defer(ephemeral=True)

        logger.info("index command invoked", user_id=interaction.user.id)

        total_indexed = 0
        offset = 0
        batch_size = 50

        while True:
            items = await self.bot.repository.get_summarized_content_items(
                offset=offset, limit=batch_size
            )
            if not items:
                break

            texts = [f"{item.title} {item.summary}" for item in items]
            embeddings = await self._embedding_service.embed_batch(texts)

            batch = [(item.id, emb) for item, emb in zip(items, embeddings, strict=True)]
            await self._vector_store.upsert_articles_batch(batch)

            total_indexed += len(items)
            offset += batch_size

            logger.info("Indexing progress", indexed=total_indexed)

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


def _truncate(text: str, max_len: int) -> str:
    if len(text) <= max_len:
        return text
    return text[: max_len - 3] + "..."
