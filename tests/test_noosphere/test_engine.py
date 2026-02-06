from datetime import UTC, datetime, timedelta
from unittest.mock import AsyncMock, MagicMock

import pytest

from intelstream.noosphere.config import NoosphereSettings
from intelstream.noosphere.engine import NoosphereCog, NoosphereEngine


class TestNoosphereEngine:
    @pytest.fixture
    def settings(self) -> NoosphereSettings:
        return NoosphereSettings(enabled=True, dormancy_threshold_hours=48.0)

    @pytest.fixture
    def bot(self) -> MagicMock:
        bot = MagicMock()
        bot.dispatch = MagicMock()
        bot.guilds = []
        bot.wait_until_ready = AsyncMock()
        return bot

    @pytest.fixture
    def engine(self, bot: MagicMock, settings: NoosphereSettings) -> NoosphereEngine:
        return NoosphereEngine(bot, "guild_123", settings)

    async def test_initialize(self, engine: NoosphereEngine) -> None:
        await engine.initialize()
        assert engine.is_active

    async def test_tick_advances_phi(self, engine: NoosphereEngine) -> None:
        initial_tick = engine._tick_count
        await engine.tick()
        assert engine._tick_count == initial_tick + 1

    async def test_tick_dispatches_event(self, engine: NoosphereEngine, bot: MagicMock) -> None:
        await engine.tick()
        bot.dispatch.assert_called()

    async def test_tick_inactive_does_nothing(self, engine: NoosphereEngine) -> None:
        await engine.shutdown()
        initial_tick = engine._tick_count
        await engine.tick()
        assert engine._tick_count == initial_tick

    async def test_tick_cryptobiotic_does_nothing(self, engine: NoosphereEngine) -> None:
        engine._is_cryptobiotic = True
        initial_tick = engine._tick_count
        await engine.tick()
        assert engine._tick_count == initial_tick

    async def test_process_message_updates_activity(self, engine: NoosphereEngine) -> None:
        message = MagicMock()
        message.author.bot = False
        message.content = "test"
        message.channel.id = 123
        message.author.id = 456

        before = engine._last_human_message
        await engine.process_message(message)
        assert engine._last_human_message >= before

    async def test_process_message_ignores_bots(
        self, engine: NoosphereEngine, bot: MagicMock
    ) -> None:
        message = MagicMock()
        message.author.bot = True
        await engine.process_message(message)
        bot.dispatch.assert_not_called()

    async def test_dormancy_triggers_cryptobiosis(
        self, engine: NoosphereEngine, bot: MagicMock
    ) -> None:
        engine._last_human_message = datetime.now(UTC) - timedelta(hours=49)
        await engine._check_dormancy()
        assert engine.is_cryptobiotic
        bot.dispatch.assert_called_with(
            "cryptobiosis_trigger",
            guild_id="guild_123",
            entering_or_exiting="entering",
        )

    async def test_message_exits_cryptobiosis(self, engine: NoosphereEngine) -> None:
        engine._is_cryptobiotic = True
        message = MagicMock()
        message.author.bot = False
        message.content = "hello"
        message.channel.id = 123
        message.author.id = 456
        await engine.process_message(message)
        assert not engine.is_cryptobiotic

    async def test_shutdown(self, engine: NoosphereEngine) -> None:
        await engine.shutdown()
        assert not engine.is_active


class TestNoosphereCog:
    @pytest.fixture
    def settings(self) -> NoosphereSettings:
        return NoosphereSettings(enabled=True)

    @pytest.fixture
    def bot(self) -> MagicMock:
        bot = MagicMock()
        bot.dispatch = MagicMock()
        bot.guilds = []
        bot.wait_until_ready = AsyncMock()
        bot.add_cog = AsyncMock()
        return bot

    def test_creates_engines_per_guild(self, bot: MagicMock, settings: NoosphereSettings) -> None:
        cog = NoosphereCog(bot, settings)
        engine = cog._get_or_create_engine("guild_1")
        assert engine.guild_id == "guild_1"
        assert "guild_1" in cog.engines

    def test_reuses_engine(self, bot: MagicMock, settings: NoosphereSettings) -> None:
        cog = NoosphereCog(bot, settings)
        e1 = cog._get_or_create_engine("guild_1")
        e2 = cog._get_or_create_engine("guild_1")
        assert e1 is e2
