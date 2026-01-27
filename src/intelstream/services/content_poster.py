from datetime import UTC, datetime
from typing import TYPE_CHECKING

import discord
import structlog

from intelstream.database.models import ContentItem, SourceType

if TYPE_CHECKING:
    from intelstream.bot import IntelStreamBot

logger = structlog.get_logger()

SOURCE_TYPE_COLORS: dict[SourceType, discord.Color] = {
    SourceType.SUBSTACK: discord.Color.from_rgb(255, 103, 25),
    SourceType.YOUTUBE: discord.Color.red(),
    SourceType.RSS: discord.Color.blue(),
}

SOURCE_TYPE_ICONS: dict[SourceType, str] = {
    SourceType.SUBSTACK: "Substack",
    SourceType.YOUTUBE: "YouTube",
    SourceType.RSS: "RSS Feed",
}

MAX_EMBED_DESCRIPTION = 4096
MAX_EMBED_TITLE = 256


class ContentPoster:
    def __init__(self, bot: "IntelStreamBot") -> None:
        self._bot = bot

    def create_embed(
        self,
        content_item: ContentItem,
        source_type: SourceType,
        source_name: str,
    ) -> discord.Embed:
        title = content_item.title
        if len(title) > MAX_EMBED_TITLE:
            title = title[: MAX_EMBED_TITLE - 3] + "..."

        description = content_item.summary or "No summary available."
        if len(description) > MAX_EMBED_DESCRIPTION:
            description = description[: MAX_EMBED_DESCRIPTION - 3] + "..."

        color = SOURCE_TYPE_COLORS.get(source_type, discord.Color.greyple())

        embed = discord.Embed(
            title=title,
            url=content_item.original_url,
            description=description,
            color=color,
            timestamp=content_item.published_at or datetime.now(UTC),
        )

        if content_item.author:
            embed.set_author(name=content_item.author)

        if content_item.thumbnail_url:
            embed.set_image(url=content_item.thumbnail_url)

        source_icon = SOURCE_TYPE_ICONS.get(source_type, "Unknown")
        embed.set_footer(text=f"{source_icon} | {source_name}")

        return embed

    async def post_content(
        self,
        channel: discord.TextChannel,
        content_item: ContentItem,
        source_type: SourceType,
        source_name: str,
    ) -> discord.Message:
        embed = self.create_embed(content_item, source_type, source_name)
        message = await channel.send(embed=embed)

        logger.info(
            "Posted content to Discord",
            content_id=content_item.id,
            channel_id=channel.id,
            message_id=message.id,
        )

        return message

    async def post_unposted_items(self, guild_id: int) -> int:
        config = await self._bot.repository.get_discord_config(str(guild_id))

        if config is None:
            logger.info(
                "No Discord config for guild - run /config channel to set up posting",
                guild_id=guild_id,
            )
            return 0

        if not config.is_active:
            logger.info("Discord config is inactive for guild", guild_id=guild_id)
            return 0

        channel = self._bot.get_channel(int(config.channel_id))
        if channel is None or not isinstance(channel, discord.TextChannel):
            logger.warning(
                "Could not find output channel - check bot permissions and channel ID",
                guild_id=guild_id,
                channel_id=config.channel_id,
            )
            return 0

        items = await self._bot.repository.get_unposted_content_items()

        if not items:
            logger.debug("No unposted content items to post")
            return 0

        posted_count = 0

        for item in items:
            try:
                source = await self._bot.repository.get_source_by_id(item.source_id)
                if source is None:
                    logger.warning("Source not found for content item", item_id=item.id)
                    continue

                message = await self.post_content(
                    channel=channel,
                    content_item=item,
                    source_type=source.type,
                    source_name=source.name,
                )

                await self._bot.repository.mark_content_item_posted(
                    content_id=item.id,
                    discord_message_id=str(message.id),
                )

                posted_count += 1

            except discord.HTTPException as e:
                logger.error(
                    "Failed to post content item",
                    item_id=item.id,
                    error=str(e),
                )
            except Exception as e:
                logger.error(
                    "Unexpected error posting content item",
                    item_id=item.id,
                    error=str(e),
                )

        logger.info("Posted unposted items", count=posted_count, guild_id=guild_id)
        return posted_count
