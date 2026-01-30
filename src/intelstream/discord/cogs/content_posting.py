from typing import TYPE_CHECKING

import structlog
from discord.ext import commands, tasks

from intelstream.services.content_poster import ContentPoster
from intelstream.services.pipeline import ContentPipeline
from intelstream.services.summarizer import SummarizationService

if TYPE_CHECKING:
    from intelstream.bot import IntelStreamBot

logger = structlog.get_logger()


class ContentPosting(commands.Cog):
    MAX_CONSECUTIVE_FAILURES = 5
    MAX_BACKOFF_MULTIPLIER = 4

    def __init__(self, bot: "IntelStreamBot") -> None:
        self.bot = bot
        self._pipeline: ContentPipeline | None = None
        self._poster: ContentPoster | None = None
        self._initialized = False
        self._consecutive_failures = 0
        self._base_interval: int = 5

    async def cog_load(self) -> None:
        summarizer = SummarizationService(
            api_key=self.bot.settings.anthropic_api_key,
            model=self.bot.settings.summary_model,
            max_tokens=self.bot.settings.summary_max_tokens,
            max_input_length=self.bot.settings.summary_max_input_length,
        )

        self._pipeline = ContentPipeline(
            settings=self.bot.settings,
            repository=self.bot.repository,
            summarizer=summarizer,
        )
        await self._pipeline.initialize()

        self._poster = ContentPoster(
            self.bot,
            max_message_length=self.bot.settings.discord_max_message_length,
        )
        self._initialized = True

        self._base_interval = self.bot.settings.content_poll_interval_minutes
        self.content_loop.change_interval(minutes=self._base_interval)
        self.content_loop.start()

        logger.info(
            "Content posting cog loaded",
            poll_interval=self._base_interval,
        )

    async def cog_unload(self) -> None:
        self.content_loop.cancel()

        if self._pipeline:
            await self._pipeline.close()

        self._initialized = False
        logger.info("Content posting cog unloaded")

    @tasks.loop(minutes=5)
    async def content_loop(self) -> None:
        if not self._initialized or not self._pipeline or not self._poster:
            logger.warning("Content loop skipped: not initialized")
            return

        if self._consecutive_failures == self.MAX_CONSECUTIVE_FAILURES:
            logger.error(
                "Content loop circuit breaker triggered, will retry hourly",
                consecutive_failures=self._consecutive_failures,
            )
            await self.bot.notify_owner(
                f"Content loop hit {self.MAX_CONSECUTIVE_FAILURES} consecutive failures. "
                "Switching to hourly retries until recovered."
            )
            self._consecutive_failures += 1
            self.content_loop.change_interval(minutes=60)

        try:
            new_items, summarized = await self._pipeline.run_cycle()

            logger.info(
                "Pipeline cycle complete",
                new_items=new_items,
                summarized=summarized,
            )

            for guild in self.bot.guilds:
                try:
                    posted = await self._poster.post_unposted_items(guild.id)
                    if posted > 0:
                        logger.info(
                            "Posted items to guild",
                            guild_id=guild.id,
                            guild_name=guild.name,
                            count=posted,
                        )
                except Exception as e:
                    logger.error(
                        "Error posting to guild",
                        guild_id=guild.id,
                        error=str(e),
                    )

            self._reset_backoff()

        except Exception as e:
            self._consecutive_failures += 1
            logger.error(
                "Content loop error",
                error=str(e),
                consecutive_failures=self._consecutive_failures,
            )

            if self._consecutive_failures == 1:
                await self.bot.notify_owner(f"Content loop error: {e}")

            self._apply_backoff()

    @content_loop.before_loop
    async def before_content_loop(self) -> None:
        await self.bot.wait_until_ready()
        logger.info("Content loop ready to start")

    @content_loop.error  # type: ignore[type-var]
    async def content_loop_error(self, error: Exception) -> None:
        self._consecutive_failures += 1
        logger.error(
            "Content loop encountered an error",
            error=str(error),
            consecutive_failures=self._consecutive_failures,
        )

        if self._consecutive_failures == 1:
            await self.bot.notify_owner(f"Content loop error: {error}")

        self._apply_backoff()

    def _apply_backoff(self) -> None:
        if self._consecutive_failures > self.MAX_CONSECUTIVE_FAILURES:
            return
        multiplier = min(2 ** (self._consecutive_failures - 1), self.MAX_BACKOFF_MULTIPLIER)
        new_interval = self._base_interval * multiplier
        self.content_loop.change_interval(minutes=new_interval)
        logger.info(
            "Applied backoff to content loop",
            new_interval_minutes=new_interval,
            consecutive_failures=self._consecutive_failures,
        )

    def _reset_backoff(self) -> None:
        if self._consecutive_failures > 0:
            self._consecutive_failures = 0
            self.content_loop.change_interval(minutes=self._base_interval)
            logger.info("Content loop backoff reset")


async def setup(bot: "IntelStreamBot") -> None:
    await bot.add_cog(ContentPosting(bot))
