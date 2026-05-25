from unittest.mock import AsyncMock, MagicMock

import discord
import pytest
from discord import app_commands

from intelstream.discord.cogs.config_management import ConfigManagement, setup


@pytest.fixture
def mock_bot():
    bot = MagicMock()
    bot.repository = MagicMock()
    bot.settings = MagicMock()
    bot.settings.content_poll_interval_minutes = 5
    bot.user = MagicMock()
    bot.user.id = 999
    return bot


@pytest.fixture
def config_management(mock_bot):
    return ConfigManagement(mock_bot)


class TestConfigManagementChannel:
    async def test_config_channel_success(self, config_management, mock_bot):
        interaction = MagicMock(spec=discord.Interaction)
        interaction.response = MagicMock()
        interaction.response.defer = AsyncMock()
        interaction.followup = MagicMock()
        interaction.followup.send = AsyncMock()
        interaction.user = MagicMock()
        interaction.user.id = 123

        mock_guild = MagicMock(spec=discord.Guild)
        mock_guild.id = 456
        interaction.guild = mock_guild

        mock_channel = MagicMock(spec=discord.TextChannel)
        mock_channel.id = 789
        mock_channel.mention = "#test-channel"

        mock_bot_member = MagicMock(spec=discord.Member)
        mock_guild.get_member = MagicMock(return_value=mock_bot_member)

        mock_permissions = MagicMock(spec=discord.Permissions)
        mock_permissions.send_messages = True
        mock_permissions.embed_links = True
        mock_channel.permissions_for = MagicMock(return_value=mock_permissions)

        mock_config = MagicMock()
        mock_config.id = "config-id"
        mock_bot.repository.get_or_create_discord_config = AsyncMock(return_value=mock_config)

        await config_management.config_channel.callback(
            config_management, interaction, channel=mock_channel
        )

        mock_bot.repository.get_or_create_discord_config.assert_called_once_with(
            guild_id="456",
            channel_id="789",
        )
        call_kwargs = interaction.followup.send.call_args.kwargs
        assert "embed" in call_kwargs

    async def test_config_channel_not_in_guild(self, config_management, mock_bot):
        interaction = MagicMock(spec=discord.Interaction)
        interaction.response = MagicMock()
        interaction.response.defer = AsyncMock()
        interaction.followup = MagicMock()
        interaction.followup.send = AsyncMock()
        interaction.guild = None

        mock_channel = MagicMock(spec=discord.TextChannel)

        await config_management.config_channel.callback(
            config_management, interaction, channel=mock_channel
        )

        mock_bot.repository.get_or_create_discord_config.assert_not_called()
        call_args = interaction.followup.send.call_args
        assert "server" in call_args[0][0].lower()

    async def test_config_channel_no_send_permission(self, config_management, mock_bot):
        interaction = MagicMock(spec=discord.Interaction)
        interaction.response = MagicMock()
        interaction.response.defer = AsyncMock()
        interaction.followup = MagicMock()
        interaction.followup.send = AsyncMock()

        mock_guild = MagicMock(spec=discord.Guild)
        mock_guild.id = 456
        interaction.guild = mock_guild

        mock_channel = MagicMock(spec=discord.TextChannel)
        mock_channel.id = 789
        mock_channel.mention = "#test-channel"

        mock_bot_member = MagicMock(spec=discord.Member)
        mock_guild.get_member = MagicMock(return_value=mock_bot_member)

        mock_permissions = MagicMock(spec=discord.Permissions)
        mock_permissions.send_messages = False
        mock_permissions.embed_links = True
        mock_channel.permissions_for = MagicMock(return_value=mock_permissions)

        await config_management.config_channel.callback(
            config_management, interaction, channel=mock_channel
        )

        mock_bot.repository.get_or_create_discord_config.assert_not_called()
        call_args = interaction.followup.send.call_args
        assert "permission" in call_args[0][0].lower()

    async def test_config_channel_no_embed_permission(self, config_management, mock_bot):
        interaction = MagicMock(spec=discord.Interaction)
        interaction.response = MagicMock()
        interaction.response.defer = AsyncMock()
        interaction.followup = MagicMock()
        interaction.followup.send = AsyncMock()

        mock_guild = MagicMock(spec=discord.Guild)
        mock_guild.id = 456
        interaction.guild = mock_guild

        mock_channel = MagicMock(spec=discord.TextChannel)
        mock_channel.id = 789
        mock_channel.mention = "#test-channel"

        mock_bot_member = MagicMock(spec=discord.Member)
        mock_guild.get_member = MagicMock(return_value=mock_bot_member)

        mock_permissions = MagicMock(spec=discord.Permissions)
        mock_permissions.send_messages = True
        mock_permissions.embed_links = False
        mock_channel.permissions_for = MagicMock(return_value=mock_permissions)

        await config_management.config_channel.callback(
            config_management, interaction, channel=mock_channel
        )

        mock_bot.repository.get_or_create_discord_config.assert_not_called()
        call_args = interaction.followup.send.call_args
        assert "embed" in call_args[0][0].lower()

    async def test_config_channel_succeeds_when_bot_member_not_cached(
        self, config_management, mock_bot
    ):
        interaction = MagicMock(spec=discord.Interaction)
        interaction.response = MagicMock()
        interaction.response.defer = AsyncMock()
        interaction.followup = MagicMock()
        interaction.followup.send = AsyncMock()
        interaction.user = MagicMock(id=123)

        mock_guild = MagicMock(spec=discord.Guild)
        mock_guild.id = 456
        mock_guild.get_member = MagicMock(return_value=None)
        interaction.guild = mock_guild

        mock_channel = MagicMock(spec=discord.TextChannel)
        mock_channel.id = 789
        mock_channel.mention = "#test-channel"
        mock_channel.permissions_for = MagicMock()

        mock_config = MagicMock(id="config-id")
        mock_bot.repository.get_or_create_discord_config = AsyncMock(return_value=mock_config)

        await config_management.config_channel.callback(
            config_management, interaction, channel=mock_channel
        )

        mock_channel.permissions_for.assert_not_called()
        mock_bot.repository.get_or_create_discord_config.assert_awaited_once_with(
            guild_id="456",
            channel_id="789",
        )


class TestConfigManagementShow:
    async def test_config_show_with_config(self, config_management, mock_bot):
        interaction = MagicMock(spec=discord.Interaction)
        interaction.response = MagicMock()
        interaction.response.defer = AsyncMock()
        interaction.followup = MagicMock()
        interaction.followup.send = AsyncMock()

        mock_guild = MagicMock(spec=discord.Guild)
        mock_guild.id = 456
        interaction.guild = mock_guild

        mock_config = MagicMock()
        mock_config.channel_id = "789"
        mock_config.is_active = True
        mock_bot.repository.get_discord_config = AsyncMock(return_value=mock_config)

        mock_channel = MagicMock(spec=discord.TextChannel)
        mock_channel.mention = "#output-channel"
        mock_bot.get_channel = MagicMock(return_value=mock_channel)

        mock_bot.repository.get_all_sources = AsyncMock(return_value=[])

        await config_management.config_show.callback(config_management, interaction)

        call_kwargs = interaction.followup.send.call_args.kwargs
        assert "embed" in call_kwargs
        embed = call_kwargs["embed"]
        assert any(field.name == "Output Channel" for field in embed.fields)
        assert any(field.name == "Status" for field in embed.fields)

    async def test_config_show_without_config(self, config_management, mock_bot):
        interaction = MagicMock(spec=discord.Interaction)
        interaction.response = MagicMock()
        interaction.response.defer = AsyncMock()
        interaction.followup = MagicMock()
        interaction.followup.send = AsyncMock()

        mock_guild = MagicMock(spec=discord.Guild)
        mock_guild.id = 456
        interaction.guild = mock_guild

        mock_bot.repository.get_discord_config = AsyncMock(return_value=None)
        mock_bot.repository.get_all_sources = AsyncMock(return_value=[])

        await config_management.config_show.callback(config_management, interaction)

        call_kwargs = interaction.followup.send.call_args.kwargs
        assert "embed" in call_kwargs
        embed = call_kwargs["embed"]
        output_field = next(f for f in embed.fields if f.name == "Output Channel")
        assert "Not configured" in output_field.value

    async def test_config_show_not_in_guild(self, config_management, mock_bot):
        interaction = MagicMock(spec=discord.Interaction)
        interaction.response = MagicMock()
        interaction.response.defer = AsyncMock()
        interaction.followup = MagicMock()
        interaction.followup.send = AsyncMock()
        interaction.guild = None

        await config_management.config_show.callback(config_management, interaction)

        mock_bot.repository.get_discord_config.assert_not_called()
        call_args = interaction.followup.send.call_args
        assert "server" in call_args[0][0].lower()

    async def test_config_show_displays_source_count(self, config_management, mock_bot):
        interaction = MagicMock(spec=discord.Interaction)
        interaction.response = MagicMock()
        interaction.response.defer = AsyncMock()
        interaction.followup = MagicMock()
        interaction.followup.send = AsyncMock()

        mock_guild = MagicMock(spec=discord.Guild)
        mock_guild.id = 456
        interaction.guild = mock_guild

        mock_bot.repository.get_discord_config = AsyncMock(return_value=None)

        source1 = MagicMock()
        source1.is_active = True
        source1.guild_id = "456"
        source2 = MagicMock()
        source2.is_active = False
        source2.guild_id = "456"
        source3 = MagicMock()
        source3.is_active = True
        source3.guild_id = "456"
        mock_bot.repository.get_all_sources = AsyncMock(return_value=[source1, source2, source3])

        await config_management.config_show.callback(config_management, interaction)

        call_kwargs = interaction.followup.send.call_args.kwargs
        embed = call_kwargs["embed"]
        sources_field = next(f for f in embed.fields if f.name == "Sources")
        assert "2 active / 3 total" in sources_field.value

    async def test_config_show_marks_unknown_channel_and_paused_status(
        self, config_management, mock_bot
    ):
        interaction = MagicMock(spec=discord.Interaction)
        interaction.response = MagicMock()
        interaction.response.defer = AsyncMock()
        interaction.followup = MagicMock()
        interaction.followup.send = AsyncMock()

        mock_guild = MagicMock(spec=discord.Guild)
        mock_guild.id = 456
        interaction.guild = mock_guild

        mock_config = MagicMock()
        mock_config.channel_id = "789"
        mock_config.is_active = False
        mock_bot.repository.get_discord_config = AsyncMock(return_value=mock_config)
        mock_bot.repository.get_all_sources = AsyncMock(return_value=[])
        mock_bot.get_channel = MagicMock(return_value=None)

        await config_management.config_show.callback(config_management, interaction)

        embed = interaction.followup.send.call_args.kwargs["embed"]
        output_field = next(f for f in embed.fields if f.name == "Output Channel")
        status_field = next(f for f in embed.fields if f.name == "Status")
        assert output_field.value == "Unknown (789)"
        assert status_field.value == "Paused"


class TestConfigManagementErrors:
    async def test_config_channel_error_handles_missing_permissions(self, config_management):
        interaction = MagicMock(spec=discord.Interaction)
        interaction.response = MagicMock()
        interaction.response.send_message = AsyncMock()

        await config_management.config_channel_error(
            interaction,
            app_commands.MissingPermissions(["manage_guild"]),
        )

        interaction.response.send_message.assert_awaited_once()
        assert "Manage Server" in interaction.response.send_message.await_args.args[0]

    async def test_config_channel_error_reraises_other_errors(self, config_management):
        interaction = MagicMock(spec=discord.Interaction)
        error = app_commands.AppCommandError("boom")

        with pytest.raises(app_commands.AppCommandError):
            await config_management.config_channel_error(interaction, error)


class TestSetup:
    async def test_setup_adds_config_management_cog(self, mock_bot):
        mock_bot.add_cog = AsyncMock()

        await setup(mock_bot)

        added_cog = mock_bot.add_cog.await_args.args[0]
        assert isinstance(added_cog, ConfigManagement)
        assert added_cog.bot is mock_bot
