from unittest.mock import AsyncMock, patch

import discord
import pytest

from intelstream.bot import IntelStreamBot, create_bot
from intelstream.config import Settings


@pytest.fixture
def mock_settings() -> Settings:
    with patch.dict(
        "os.environ",
        {
            "DISCORD_BOT_TOKEN": "test_token",
            "DISCORD_GUILD_ID": "123456789",
            "DISCORD_CHANNEL_ID": "987654321",
            "DISCORD_OWNER_ID": "111222333",
            "ANTHROPIC_API_KEY": "sk-ant-test",
            "DATABASE_URL": "sqlite+aiosqlite:///:memory:",
        },
    ):
        return Settings()


class TestIntelStreamBot:
    async def test_create_bot(self, mock_settings: Settings) -> None:
        bot = await create_bot(mock_settings)

        assert isinstance(bot, IntelStreamBot)
        assert bot.settings == mock_settings
        assert bot.repository is not None

        await bot.repository.close()

    async def test_bot_has_correct_intents(self, mock_settings: Settings) -> None:
        bot = await create_bot(mock_settings)

        assert bot.intents.message_content is True

        await bot.repository.close()

    async def test_notify_owner_without_owner_set(self, mock_settings: Settings) -> None:
        bot = await create_bot(mock_settings)
        bot._owner = None

        mock_response = AsyncMock()
        mock_response.status = 404
        error = discord.NotFound(mock_response, "User not found")
        bot.fetch_user = AsyncMock(side_effect=error)

        await bot.notify_owner("Test message")

        await bot.repository.close()
