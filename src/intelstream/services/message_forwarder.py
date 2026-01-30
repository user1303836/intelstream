from asyncio import Semaphore

import discord
import structlog

logger = structlog.get_logger()

MAX_TOTAL_ATTACHMENT_SIZE = 25 * 1024 * 1024  # 25MB total limit


class MessageForwarder:
    def __init__(self, bot: discord.Client) -> None:
        self.bot = bot
        self._semaphore = Semaphore(5)

    async def forward_message(
        self,
        message: discord.Message,
        destination_id: int,
        destination_type: str,
    ) -> discord.Message | None:
        async with self._semaphore:
            try:
                destination = await self._get_destination(destination_id, destination_type)
                if destination is None:
                    logger.warning(
                        "Forwarding destination not found",
                        destination_id=destination_id,
                        destination_type=destination_type,
                    )
                    return None

                if isinstance(destination, discord.Thread) and destination.archived:
                    try:
                        await destination.edit(archived=False)
                    except discord.Forbidden:
                        logger.warning("Cannot unarchive thread", thread_id=destination_id)
                        return None

                content = self._build_forwarded_content(message)
                embeds = message.embeds[:10] if message.embeds else []
                files = await self._download_attachments(message, destination)

                forwarded = await destination.send(
                    content=content,
                    embeds=embeds,
                    files=files,
                )

                logger.info(
                    "Message forwarded",
                    source_channel=message.channel.id,
                    destination=destination_id,
                    message_id=message.id,
                )

                return forwarded

            except discord.Forbidden:
                logger.error(
                    "Missing permissions to forward message",
                    destination_id=destination_id,
                )
                return None
            except discord.HTTPException as e:
                logger.error(
                    "Failed to forward message",
                    error=str(e),
                    destination_id=destination_id,
                )
                return None

    async def _get_destination(
        self, destination_id: int, destination_type: str
    ) -> discord.TextChannel | discord.Thread | None:
        logger.debug(
            "Resolving forwarding destination",
            destination_id=destination_id,
            destination_type=destination_type,
        )

        if destination_type == "thread":
            channel = self.bot.get_channel(destination_id)
            logger.debug(
                "Thread lookup via get_channel",
                destination_id=destination_id,
                found=channel is not None,
                channel_type=type(channel).__name__ if channel else None,
            )
            if isinstance(channel, discord.Thread):
                logger.debug(
                    "Thread found via get_channel",
                    thread_id=destination_id,
                    thread_name=channel.name,
                    archived=channel.archived,
                )
                return channel

            logger.debug(
                "Thread not in channel cache, searching guilds",
                destination_id=destination_id,
                guild_count=len(self.bot.guilds),
            )
            for guild in self.bot.guilds:
                thread = guild.get_thread(destination_id)
                if thread is not None:
                    logger.debug(
                        "Thread found via guild search",
                        thread_id=destination_id,
                        thread_name=thread.name,
                        guild_id=guild.id,
                        archived=thread.archived,
                    )
                    return thread

            logger.debug(
                "Thread not in any guild cache, attempting API fetch",
                destination_id=destination_id,
            )
            for guild in self.bot.guilds:
                try:
                    fetched = await guild.fetch_channel(destination_id)
                    if isinstance(fetched, discord.Thread):
                        logger.info(
                            "Thread fetched from API",
                            thread_id=destination_id,
                            thread_name=fetched.name,
                            guild_id=guild.id,
                            archived=fetched.archived,
                        )
                        return fetched
                except discord.NotFound:
                    continue
                except discord.Forbidden:
                    logger.debug(
                        "No permission to fetch channel in guild",
                        guild_id=guild.id,
                        destination_id=destination_id,
                    )
                    continue

            logger.warning(
                "Thread not found in any cache or via API",
                destination_id=destination_id,
                guilds_searched=[g.id for g in self.bot.guilds],
            )
            return None

        channel = self.bot.get_channel(destination_id)
        logger.debug(
            "Channel lookup via get_channel",
            destination_id=destination_id,
            found=channel is not None,
            channel_type=type(channel).__name__ if channel else None,
        )
        if isinstance(channel, discord.TextChannel):
            return channel

        logger.warning(
            "Channel not found or wrong type",
            destination_id=destination_id,
            actual_type=type(channel).__name__ if channel else None,
        )
        return None

    async def _download_attachments(
        self, message: discord.Message, destination: discord.TextChannel | discord.Thread
    ) -> list[discord.File]:
        files: list[discord.File] = []
        total_size = 0
        for attachment in message.attachments[:10]:
            if attachment.size > destination.guild.filesize_limit:
                logger.warning(
                    "Attachment too large to forward",
                    filename=attachment.filename,
                    size=attachment.size,
                    limit=destination.guild.filesize_limit,
                )
                continue
            if total_size + attachment.size > MAX_TOTAL_ATTACHMENT_SIZE:
                logger.warning(
                    "Skipping remaining attachments due to total size limit",
                    current_total=total_size,
                    attachment_size=attachment.size,
                    limit=MAX_TOTAL_ATTACHMENT_SIZE,
                    skipped_count=len(message.attachments[:10]) - len(files),
                )
                break
            try:
                file = await attachment.to_file()
                files.append(file)
                total_size += attachment.size
            except discord.HTTPException as e:
                logger.warning(
                    "Failed to download attachment",
                    filename=attachment.filename,
                    attachment_id=attachment.id,
                    error=str(e),
                )
        return files

    def _build_forwarded_content(self, message: discord.Message) -> str:
        return message.content
