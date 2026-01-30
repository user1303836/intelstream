from typing import TYPE_CHECKING

import discord
import structlog

from intelstream.database.models import ContentItem, SourceType

if TYPE_CHECKING:
    from intelstream.bot import IntelStreamBot

logger = structlog.get_logger()

SOURCE_TYPE_LABELS: dict[SourceType, str] = {
    SourceType.SUBSTACK: "Substack",
    SourceType.YOUTUBE: "YouTube",
    SourceType.RSS: "RSS",
    SourceType.PAGE: "Web",
}

TRUNCATION_NOTICE = "\n\n*[Summary truncated]*"


def truncate_summary_at_bullet(summary: str, max_length: int) -> str:
    """Truncate summary at a complete bullet point boundary.

    Tries to keep complete bullet points (lines starting with - or *)
    rather than cutting mid-sentence.
    """
    if len(summary) <= max_length:
        return summary

    truncate_target = max_length - len(TRUNCATION_NOTICE)

    lines = summary.split("\n")
    result_lines: list[str] = []
    current_length = 0

    for line in lines:
        line_length = len(line) + (1 if result_lines else 0)

        if current_length + line_length > truncate_target:
            break

        result_lines.append(line)
        current_length += line_length

    if not result_lines:
        return summary[:truncate_target] + TRUNCATION_NOTICE

    result = "\n".join(result_lines)

    last_line = result_lines[-1] if result_lines else ""
    is_sub_bullet = last_line.strip().startswith("- ") and last_line.startswith("  ")

    if is_sub_bullet:
        found_parent = False
        for j in range(len(result_lines) - 1, -1, -1):
            line = result_lines[j]
            if line.strip().startswith("- **") and not line.startswith("  "):
                result_lines = result_lines[: j + 1]
                found_parent = True
                break

        if not found_parent:
            result_lines = result_lines[:-1]

        result = "\n".join(result_lines)

    return result.rstrip() + TRUNCATION_NOTICE


class ContentPoster:
    def __init__(self, bot: "IntelStreamBot", max_message_length: int = 2000) -> None:
        self._bot = bot
        self._max_message_length = max_message_length

    def format_message(
        self,
        content_item: ContentItem,
        source_type: SourceType,
        source_name: str,
    ) -> str:
        header_parts: list[str] = []

        if content_item.author:
            header_parts.append(f"**{content_item.author}**")

        title = content_item.title
        if content_item.original_url:
            header_parts.append(f"[{title}]({content_item.original_url})")
        else:
            header_parts.append(f"**{title}**")

        header_parts.append("")

        source_label = SOURCE_TYPE_LABELS.get(source_type, "Unknown")
        footer = f"\n*{source_label} | {source_name}*"

        header = "\n".join(header_parts)
        overhead = len(header) + len(footer)

        summary = content_item.summary or "No summary available."

        available_for_summary = self._max_message_length - overhead
        if len(summary) > available_for_summary:
            summary = truncate_summary_at_bullet(summary, available_for_summary)

        message = header + summary + footer

        if len(message) > self._max_message_length:
            logger.warning(
                "Message still exceeds limit after truncation",
                length=len(message),
                max_length=self._max_message_length,
            )
            if summary.endswith(TRUNCATION_NOTICE):
                summary = summary[: -len(TRUNCATION_NOTICE)]
            excess = len(message) - self._max_message_length + len(TRUNCATION_NOTICE)
            summary = summary[:-excess] + TRUNCATION_NOTICE
            message = header + summary + footer

        return message

    async def post_content(
        self,
        channel: discord.TextChannel,
        content_item: ContentItem,
        source_type: SourceType,
        source_name: str,
    ) -> discord.Message:
        content = self.format_message(content_item, source_type, source_name)
        message = await channel.send(content=content)

        logger.info(
            "Posted content to Discord",
            content_id=content_item.id,
            channel_id=channel.id,
            message_id=message.id,
        )

        return message

    async def post_unposted_items(self, guild_id: int) -> int:
        items = await self._bot.repository.get_unposted_content_items()

        if not items:
            logger.debug("No unposted content items to post")
            return 0

        source_ids = {item.source_id for item in items}
        sources_map = await self._bot.repository.get_sources_by_ids(source_ids)

        posted_count = 0

        for item in items:
            try:
                source = sources_map.get(item.source_id)
                if source is None:
                    logger.warning("Source not found for content item", item_id=item.id)
                    continue

                # Skip sources belonging to a different guild.
                # Sources without guild_id are legacy/global and can post to any guild.
                if source.guild_id and str(guild_id) != source.guild_id:
                    continue

                if not source.channel_id:
                    config = await self._bot.repository.get_discord_config(str(guild_id))
                    if config is None or not config.is_active:
                        logger.debug(
                            "No channel for source and no guild config",
                            source_id=source.id,
                            guild_id=guild_id,
                        )
                        continue
                    channel_id = config.channel_id
                else:
                    channel_id = source.channel_id

                channel = self._bot.get_channel(int(channel_id))
                if channel is None or not isinstance(channel, discord.TextChannel):
                    logger.warning(
                        "Could not find channel for source",
                        source_id=source.id,
                        channel_id=channel_id,
                    )
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
