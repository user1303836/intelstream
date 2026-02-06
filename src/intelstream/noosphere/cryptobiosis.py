from __future__ import annotations

import enum
import time
from typing import TYPE_CHECKING

import structlog
from discord.ext import commands

if TYPE_CHECKING:
    from intelstream.bot import IntelStreamBot
    from intelstream.noosphere.shared.data_models import CommunityStateVector

logger = structlog.get_logger(__name__)


class CryptobiosisState(enum.StrEnum):
    ACTIVE = "active"
    ENTERING = "entering"
    CRYPTOBIOTIC = "cryptobiotic"


class CryptobiosisMonitor:
    def __init__(
        self,
        dormancy_threshold_minutes: float = 2880.0,
        entering_threshold_minutes: float = 1440.0,
        wakeup_threshold_minutes: float = 5.0,
    ) -> None:
        self._dormancy_threshold = dormancy_threshold_minutes * 60.0
        self._entering_threshold = entering_threshold_minutes * 60.0
        self._wakeup_threshold = wakeup_threshold_minutes * 60.0
        self._state = CryptobiosisState.ACTIVE
        self._last_activity: float = time.monotonic()
        self._activity_resumed_at: float | None = None

    @property
    def state(self) -> CryptobiosisState:
        return self._state

    def record_activity(self) -> None:
        now = time.monotonic()
        self._last_activity = now
        if self._state != CryptobiosisState.ACTIVE and self._activity_resumed_at is None:
            self._activity_resumed_at = now

    def tick(self) -> CryptobiosisState:
        now = time.monotonic()
        idle = now - self._last_activity

        if self._state == CryptobiosisState.ACTIVE:
            if idle > self._entering_threshold:
                self._state = CryptobiosisState.ENTERING
                self._activity_resumed_at = None
                logger.info("cryptobiosis entering", idle_seconds=idle)

        elif self._state == CryptobiosisState.ENTERING:
            if self._activity_resumed_at is not None:
                resumed_duration = now - self._activity_resumed_at
                if resumed_duration > self._wakeup_threshold:
                    self._state = CryptobiosisState.ACTIVE
                    self._activity_resumed_at = None
                    logger.info("cryptobiosis aborted, returning to active")
                    return self._state
            if idle > self._dormancy_threshold:
                self._state = CryptobiosisState.CRYPTOBIOTIC
                self._activity_resumed_at = None
                logger.info("cryptobiosis entered", idle_seconds=idle)

        elif (
            self._state == CryptobiosisState.CRYPTOBIOTIC and self._activity_resumed_at is not None
        ):
            resumed_duration = now - self._activity_resumed_at
            if resumed_duration > self._wakeup_threshold:
                self._state = CryptobiosisState.ACTIVE
                self._activity_resumed_at = None
                logger.info("cryptobiosis exited")

        return self._state


class CryptobiosisCog(commands.Cog):
    def __init__(self, bot: IntelStreamBot) -> None:
        self.bot = bot
        self._monitors: dict[str, CryptobiosisMonitor] = {}

    def _get_monitor(self, guild_id: str) -> CryptobiosisMonitor:
        if guild_id not in self._monitors:
            self._monitors[guild_id] = CryptobiosisMonitor()
        return self._monitors[guild_id]

    @commands.Cog.listener("on_state_vector_updated")
    async def _on_state_vector(self, csv: CommunityStateVector) -> None:
        monitor = self._get_monitor(csv.guild_id)
        if csv.activity_rate > 0:
            monitor.record_activity()
        old_state = monitor.state
        new_state = monitor.tick()
        if old_state != new_state:
            self.bot.dispatch(
                "cryptobiosis_trigger",
                {
                    "guild_id": csv.guild_id,
                    "old_state": old_state.value,
                    "new_state": new_state.value,
                },
            )
