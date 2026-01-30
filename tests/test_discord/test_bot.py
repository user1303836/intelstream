from unittest.mock import AsyncMock, MagicMock, patch

import discord
import pytest
from discord import app_commands

from intelstream.bot import IntelStreamBot, RestrictedCommandTree, create_bot
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


class TestRestrictedCommandTreeErrorHandler:
    @pytest.fixture
    def mock_interaction(self) -> MagicMock:
        interaction = MagicMock(spec=discord.Interaction)
        interaction.user = MagicMock()
        interaction.user.id = 123456
        interaction.channel_id = 789012
        interaction.command = MagicMock()
        interaction.command.name = "test_command"
        interaction.response = MagicMock()
        interaction.response.is_done = MagicMock(return_value=False)
        interaction.response.send_message = AsyncMock()
        interaction.followup = MagicMock()
        interaction.followup.send = AsyncMock()
        return interaction

    async def test_handles_forbidden_error(self, mock_interaction: MagicMock) -> None:
        mock_response = MagicMock()
        mock_response.status = 403
        error = app_commands.CommandInvokeError(
            mock_interaction.command,
            discord.Forbidden(mock_response, "Missing permissions"),
        )

        await RestrictedCommandTree.on_error(MagicMock(), mock_interaction, error)

        mock_interaction.response.send_message.assert_not_called()
        mock_interaction.followup.send.assert_not_called()

    async def test_handles_not_found_error(self, mock_interaction: MagicMock) -> None:
        mock_response = MagicMock()
        mock_response.status = 404
        error = app_commands.CommandInvokeError(
            mock_interaction.command,
            discord.NotFound(mock_response, "Interaction expired"),
        )

        await RestrictedCommandTree.on_error(MagicMock(), mock_interaction, error)

        mock_interaction.response.send_message.assert_not_called()
        mock_interaction.followup.send.assert_not_called()

    async def test_handles_http_exception_with_response(self, mock_interaction: MagicMock) -> None:
        mock_response = MagicMock()
        mock_response.status = 500
        error = app_commands.CommandInvokeError(
            mock_interaction.command,
            discord.HTTPException(mock_response, "Server error"),
        )

        mock_self = MagicMock()
        mock_self._send_error_response = AsyncMock()

        await RestrictedCommandTree.on_error(mock_self, mock_interaction, error)

        mock_self._send_error_response.assert_called_once()
        args = mock_self._send_error_response.call_args[0]
        assert args[0] == mock_interaction
        assert "Discord error" in args[1]

    async def test_handles_generic_exception(self, mock_interaction: MagicMock) -> None:
        error = app_commands.CommandInvokeError(
            mock_interaction.command,
            ValueError("Something went wrong"),
        )

        mock_self = MagicMock()
        mock_self._send_error_response = AsyncMock()

        await RestrictedCommandTree.on_error(mock_self, mock_interaction, error)

        mock_self._send_error_response.assert_called_once()
        args = mock_self._send_error_response.call_args[0]
        assert args[0] == mock_interaction
        assert "unexpected error" in args[1]

    async def test_send_error_response_uses_followup_when_response_done(
        self, mock_interaction: MagicMock
    ) -> None:
        mock_interaction.response.is_done = MagicMock(return_value=True)

        await RestrictedCommandTree._send_error_response(
            MagicMock(), mock_interaction, "Test error message"
        )

        mock_interaction.followup.send.assert_called_once_with("Test error message", ephemeral=True)
        mock_interaction.response.send_message.assert_not_called()

    async def test_send_error_response_uses_response_when_not_done(
        self, mock_interaction: MagicMock
    ) -> None:
        mock_interaction.response.is_done = MagicMock(return_value=False)

        await RestrictedCommandTree._send_error_response(
            MagicMock(), mock_interaction, "Test error message"
        )

        mock_interaction.response.send_message.assert_called_once_with(
            "Test error message", ephemeral=True
        )
        mock_interaction.followup.send.assert_not_called()
