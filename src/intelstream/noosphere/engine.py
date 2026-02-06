from __future__ import annotations

from datetime import UTC, datetime
from typing import TYPE_CHECKING

import structlog
from discord.ext import commands, tasks

from intelstream.noosphere.config import NoosphereSettings
from intelstream.noosphere.constants import MessageClassification
from intelstream.noosphere.shared.data_models import CommunityStateVector, ProcessedMessage
from intelstream.noosphere.shared.mode_manager import ModeManager
from intelstream.noosphere.shared.phi_parameter import PhiParameter

if TYPE_CHECKING:
    import discord

logger = structlog.get_logger(__name__)


class NoosphereEngine:
    """Central orchestrator for the Noosphere Engine.

    Manages the phi oscillator, coordinates between components,
    and handles mode transitions. One instance per guild.
    """

    def __init__(self, bot: commands.Bot, guild_id: str, settings: NoosphereSettings):
        self.bot = bot
        self.guild_id = guild_id
        self.settings = settings

        self.phi = PhiParameter()
        self.mode_manager = ModeManager(guild_id)

        self._is_active = True
        self._is_cryptobiotic = False
        self._last_human_message: datetime = datetime.now(UTC)
        self._tick_count = 0

    @property
    def is_active(self) -> bool:
        return self._is_active

    @property
    def is_cryptobiotic(self) -> bool:
        return self._is_cryptobiotic

    async def initialize(self) -> None:
        logger.info("NoosphereEngine initialized", guild_id=self.guild_id)

    async def tick(self) -> None:
        """Main loop tick. Advances phi phase and computes mode weights."""
        if not self._is_active or self._is_cryptobiotic:
            return

        self.phi.advance()
        self._tick_count += 1

        mode_weights = self.phi.mode_weights()

        csv = CommunityStateVector(
            guild_id=self.guild_id,
            timestamp=datetime.now(UTC),
        )

        self.bot.dispatch("state_vector_updated", csv, mode_weights, self._tick_count)

        await self._check_dormancy()

    async def process_message(self, message: discord.Message) -> None:
        """Process an incoming message through the engine."""
        if message.author.bot:
            return

        self._last_human_message = datetime.now(UTC)

        if self._is_cryptobiotic:
            await self._exit_cryptobiosis()

        processed = ProcessedMessage(
            guild_id=self.guild_id,
            channel_id=str(message.channel.id),
            user_id=str(message.author.id),
            message_id=str(message.id),
            content=message.content,
            timestamp=datetime.now(UTC),
            is_bot=False,
            classification=MessageClassification.ANTHROPHONY,
        )

        self.bot.dispatch("message_processed", processed)

    async def _check_dormancy(self) -> None:
        """Check if the guild should enter cryptobiosis."""
        now = datetime.now(UTC)
        hours_inactive = (now - self._last_human_message).total_seconds() / 3600

        if hours_inactive >= self.settings.dormancy_threshold_hours and not self._is_cryptobiotic:
            await self._enter_cryptobiosis()

    async def _enter_cryptobiosis(self) -> None:
        self._is_cryptobiotic = True
        logger.info(
            "Entering cryptobiosis",
            guild_id=self.guild_id,
            hours_inactive=(datetime.now(UTC) - self._last_human_message).total_seconds() / 3600,
        )
        self.bot.dispatch(
            "cryptobiosis_trigger",
            guild_id=self.guild_id,
            entering_or_exiting="entering",
        )

    async def _exit_cryptobiosis(self) -> None:
        self._is_cryptobiotic = False
        logger.info("Exiting cryptobiosis", guild_id=self.guild_id)
        self.bot.dispatch(
            "cryptobiosis_trigger",
            guild_id=self.guild_id,
            entering_or_exiting="exiting",
        )

    async def shutdown(self) -> None:
        self._is_active = False
        logger.info("NoosphereEngine shutdown", guild_id=self.guild_id)


class NoosphereCog(commands.Cog, name="Noosphere"):
    """Top-level cog that manages NoosphereEngine instances per guild."""

    def __init__(self, bot: commands.Bot, settings: NoosphereSettings | None = None) -> None:
        self.bot = bot
        self.settings = settings or NoosphereSettings()
        self.engines: dict[str, NoosphereEngine] = {}
        self._tick_task_running = False

    async def cog_load(self) -> None:
        if self.settings.enabled:
            self._start_tick_loop()
            await self._load_sub_cogs()
            logger.info("NoosphereCog loaded")

    async def cog_unload(self) -> None:
        self._tick_loop.cancel()
        for engine in self.engines.values():
            await engine.shutdown()
        logger.info("NoosphereCog unloaded")

    async def _load_sub_cogs(self) -> None:
        """Load all Phase 3 sub-cogs."""
        from intelstream.noosphere.crystal_room.cog import CrystalRoomCog
        from intelstream.noosphere.ghost_channel.cog import GhostChannelCog
        from intelstream.noosphere.morphogenetic_field.cog import MorphogeneticPulseCog
        from intelstream.noosphere.shared.mode_manager import ModeManagerCog

        cogs: list[commands.Cog] = [
            CrystalRoomCog(self.bot, self.settings),
            GhostChannelCog(self.bot, self.settings),
            MorphogeneticPulseCog(self.bot, self.settings),
            ModeManagerCog(self.bot),
        ]

        for cog in cogs:
            try:
                await self.bot.add_cog(cog)
                logger.info("Loaded noosphere sub-cog", cog=cog.qualified_name)
            except Exception:
                logger.exception("Failed to load noosphere sub-cog", cog=type(cog).__name__)

    def _get_or_create_engine(self, guild_id: str) -> NoosphereEngine:
        if guild_id not in self.engines:
            engine = NoosphereEngine(self.bot, guild_id, self.settings)
            self.engines[guild_id] = engine
        return self.engines[guild_id]

    def _start_tick_loop(self) -> None:
        if not self._tick_task_running:
            self._tick_loop.start()
            self._tick_task_running = True

    @tasks.loop(minutes=5)
    async def _tick_loop(self) -> None:
        for engine in list(self.engines.values()):
            try:
                await engine.tick()
            except Exception:
                logger.exception("Engine tick failed", guild_id=engine.guild_id)

    @_tick_loop.before_loop
    async def _before_tick_loop(self) -> None:
        await self.bot.wait_until_ready()

    @commands.Cog.listener()
    async def on_message(self, message: discord.Message) -> None:
        if message.author.bot or not message.guild:
            return
        if not self.settings.enabled:
            return
        guild_id = str(message.guild.id)
        engine = self._get_or_create_engine(guild_id)
        await engine.process_message(message)

    @commands.Cog.listener()
    async def on_ready(self) -> None:
        if not self.settings.enabled:
            return
        for guild in self.bot.guilds:
            guild_id = str(guild.id)
            engine = self._get_or_create_engine(guild_id)
            await engine.initialize()
        logger.info("NoosphereEngine initialized for all guilds", count=len(self.engines))
