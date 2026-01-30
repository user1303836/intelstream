from unittest.mock import AsyncMock, MagicMock

import discord
import pytest

from intelstream.database.models import PauseReason, SourceType
from intelstream.discord.cogs.source_management import (
    SourceManagement,
    parse_source_identifier,
)


@pytest.fixture
def mock_bot():
    bot = MagicMock()
    bot.repository = MagicMock()
    bot.settings = MagicMock()
    bot.settings.default_poll_interval_minutes = 5
    bot.settings.youtube_api_key = "test-api-key"
    return bot


@pytest.fixture
def source_management(mock_bot):
    return SourceManagement(mock_bot)


class TestParseSourceIdentifier:
    def test_parse_substack_url(self):
        identifier, feed_url = parse_source_identifier(
            SourceType.SUBSTACK,
            "https://example.substack.com",
        )
        assert identifier == "example"
        assert feed_url == "https://example.substack.com/feed"

    def test_parse_substack_custom_domain(self):
        identifier, feed_url = parse_source_identifier(
            SourceType.SUBSTACK,
            "https://newsletter.example.com",
        )
        assert identifier == "newsletter.example.com"
        assert feed_url == "https://newsletter.example.com/feed"

    def test_parse_youtube_handle(self):
        identifier, feed_url = parse_source_identifier(
            SourceType.YOUTUBE,
            "https://www.youtube.com/@channelname",
        )
        assert identifier == "channelname"
        assert feed_url is None

    def test_parse_youtube_channel_id(self):
        identifier, feed_url = parse_source_identifier(
            SourceType.YOUTUBE,
            "https://www.youtube.com/channel/UC12345",
        )
        assert identifier == "UC12345"
        assert feed_url is None

    def test_parse_youtube_custom_url(self):
        identifier, feed_url = parse_source_identifier(
            SourceType.YOUTUBE,
            "https://www.youtube.com/c/customname",
        )
        assert identifier == "customname"
        assert feed_url is None

    def test_parse_rss_url(self):
        identifier, feed_url = parse_source_identifier(
            SourceType.RSS,
            "https://example.com/feed.xml",
        )
        assert identifier == "example.com/feed.xml"
        assert feed_url == "https://example.com/feed.xml"


class TestSourceManagementAdd:
    async def test_add_source_success(self, source_management, mock_bot):
        interaction = MagicMock(spec=discord.Interaction)
        interaction.response = MagicMock()
        interaction.response.defer = AsyncMock()
        interaction.followup = MagicMock()
        interaction.followup.send = AsyncMock()
        interaction.user = MagicMock()
        interaction.user.id = 123
        interaction.guild_id = 456
        interaction.channel_id = 789

        source_type_choice = MagicMock()
        source_type_choice.value = "substack"
        source_type_choice.name = "Substack"

        mock_bot.repository.get_source_by_identifier = AsyncMock(return_value=None)
        mock_bot.repository.get_source_by_name = AsyncMock(return_value=None)

        mock_source = MagicMock()
        mock_source.id = "new-source-id"
        mock_bot.repository.add_source = AsyncMock(return_value=mock_source)

        await source_management.source_add.callback(
            source_management,
            interaction,
            source_type=source_type_choice,
            name="Test Newsletter",
            url="https://test.substack.com",
        )

        interaction.response.defer.assert_called_once_with(ephemeral=True)
        mock_bot.repository.add_source.assert_called_once()
        call_kwargs = mock_bot.repository.add_source.call_args.kwargs
        assert call_kwargs["guild_id"] == "456"
        assert call_kwargs["channel_id"] == "789"
        interaction.followup.send.assert_called_once()
        call_kwargs = interaction.followup.send.call_args.kwargs
        assert "embed" in call_kwargs

    async def test_add_source_duplicate_identifier(self, source_management, mock_bot):
        interaction = MagicMock(spec=discord.Interaction)
        interaction.response = MagicMock()
        interaction.response.defer = AsyncMock()
        interaction.followup = MagicMock()
        interaction.followup.send = AsyncMock()

        source_type_choice = MagicMock()
        source_type_choice.value = "substack"

        existing_source = MagicMock()
        existing_source.name = "Existing Source"
        mock_bot.repository.get_source_by_identifier = AsyncMock(return_value=existing_source)

        await source_management.source_add.callback(
            source_management,
            interaction,
            source_type=source_type_choice,
            name="Test Newsletter",
            url="https://test.substack.com",
        )

        mock_bot.repository.add_source.assert_not_called()
        interaction.followup.send.assert_called_once()
        call_args = interaction.followup.send.call_args
        assert "already exists" in call_args[0][0]

    async def test_add_source_duplicate_name(self, source_management, mock_bot):
        interaction = MagicMock(spec=discord.Interaction)
        interaction.response = MagicMock()
        interaction.response.defer = AsyncMock()
        interaction.followup = MagicMock()
        interaction.followup.send = AsyncMock()

        source_type_choice = MagicMock()
        source_type_choice.value = "substack"

        mock_bot.repository.get_source_by_identifier = AsyncMock(return_value=None)

        existing_source = MagicMock()
        mock_bot.repository.get_source_by_name = AsyncMock(return_value=existing_source)

        await source_management.source_add.callback(
            source_management,
            interaction,
            source_type=source_type_choice,
            name="Test Newsletter",
            url="https://test.substack.com",
        )

        mock_bot.repository.add_source.assert_not_called()
        interaction.followup.send.assert_called_once()
        call_args = interaction.followup.send.call_args
        assert "already exists" in call_args[0][0]

    async def test_add_youtube_without_api_key(self, source_management, mock_bot):
        mock_bot.settings.youtube_api_key = None

        interaction = MagicMock(spec=discord.Interaction)
        interaction.response = MagicMock()
        interaction.response.defer = AsyncMock()
        interaction.followup = MagicMock()
        interaction.followup.send = AsyncMock()

        source_type_choice = MagicMock()
        source_type_choice.value = "youtube"

        await source_management.source_add.callback(
            source_management,
            interaction,
            source_type=source_type_choice,
            name="Test Channel",
            url="https://www.youtube.com/@testchannel",
        )

        mock_bot.repository.add_source.assert_not_called()
        call_args = interaction.followup.send.call_args
        assert "not available" in call_args[0][0]


class TestSourceManagementList:
    async def test_list_sources_empty(self, source_management, mock_bot):
        interaction = MagicMock(spec=discord.Interaction)
        interaction.response = MagicMock()
        interaction.response.defer = AsyncMock()
        interaction.followup = MagicMock()
        interaction.followup.send = AsyncMock()

        mock_bot.repository.get_all_sources = AsyncMock(return_value=[])

        await source_management.source_list.callback(source_management, interaction)

        interaction.followup.send.assert_called_once()
        call_args = interaction.followup.send.call_args
        assert "No sources configured" in call_args[0][0]

    async def test_list_sources_with_sources(self, source_management, mock_bot):
        interaction = MagicMock(spec=discord.Interaction)
        interaction.response = MagicMock()
        interaction.response.defer = AsyncMock()
        interaction.followup = MagicMock()
        interaction.followup.send = AsyncMock()

        source1 = MagicMock()
        source1.name = "Source 1"
        source1.type = SourceType.SUBSTACK
        source1.is_active = True
        source1.pause_reason = PauseReason.NONE.value
        source1.last_polled_at = None
        source1.channel_id = "123456789"

        source2 = MagicMock()
        source2.name = "Source 2"
        source2.type = SourceType.RSS
        source2.is_active = False
        source2.pause_reason = PauseReason.USER_PAUSED.value
        source2.consecutive_failures = 0
        source2.last_polled_at = None
        source2.channel_id = None

        mock_bot.repository.get_all_sources = AsyncMock(return_value=[source1, source2])

        await source_management.source_list.callback(source_management, interaction)

        call_kwargs = interaction.followup.send.call_args.kwargs
        assert "embed" in call_kwargs
        embed = call_kwargs["embed"]
        assert len(embed.fields) == 2


class TestSourceManagementRemove:
    async def test_remove_source_success(self, source_management, mock_bot):
        interaction = MagicMock(spec=discord.Interaction)
        interaction.response = MagicMock()
        interaction.response.defer = AsyncMock()
        interaction.followup = MagicMock()
        interaction.followup.send = AsyncMock()
        interaction.user = MagicMock()
        interaction.user.id = 123

        mock_source = MagicMock()
        mock_source.identifier = "test-identifier"
        mock_bot.repository.get_source_by_name = AsyncMock(return_value=mock_source)
        mock_bot.repository.delete_source = AsyncMock(return_value=True)

        await source_management.source_remove.callback(
            source_management, interaction, name="Test Source"
        )

        mock_bot.repository.delete_source.assert_called_once_with("test-identifier")
        call_args = interaction.followup.send.call_args
        assert "removed" in call_args[0][0]

    async def test_remove_source_not_found(self, source_management, mock_bot):
        interaction = MagicMock(spec=discord.Interaction)
        interaction.response = MagicMock()
        interaction.response.defer = AsyncMock()
        interaction.followup = MagicMock()
        interaction.followup.send = AsyncMock()

        mock_bot.repository.get_source_by_name = AsyncMock(return_value=None)

        await source_management.source_remove.callback(
            source_management, interaction, name="Unknown"
        )

        mock_bot.repository.delete_source.assert_not_called()
        call_args = interaction.followup.send.call_args
        assert "No source found" in call_args[0][0]


class TestSourceManagementToggle:
    async def test_toggle_source_enable(self, source_management, mock_bot):
        interaction = MagicMock(spec=discord.Interaction)
        interaction.response = MagicMock()
        interaction.response.defer = AsyncMock()
        interaction.followup = MagicMock()
        interaction.followup.send = AsyncMock()
        interaction.user = MagicMock()
        interaction.user.id = 123

        mock_source = MagicMock()
        mock_source.identifier = "test-identifier"
        mock_source.is_active = False
        mock_bot.repository.get_source_by_name = AsyncMock(return_value=mock_source)

        updated_source = MagicMock()
        updated_source.is_active = True
        mock_bot.repository.set_source_active = AsyncMock(return_value=updated_source)

        await source_management.source_toggle.callback(
            source_management, interaction, name="Test Source"
        )

        mock_bot.repository.set_source_active.assert_called_once_with(
            "test-identifier", True, pause_reason=PauseReason.NONE
        )
        call_args = interaction.followup.send.call_args
        assert "enabled" in call_args[0][0]

    async def test_toggle_source_disable(self, source_management, mock_bot):
        interaction = MagicMock(spec=discord.Interaction)
        interaction.response = MagicMock()
        interaction.response.defer = AsyncMock()
        interaction.followup = MagicMock()
        interaction.followup.send = AsyncMock()
        interaction.user = MagicMock()
        interaction.user.id = 123

        mock_source = MagicMock()
        mock_source.identifier = "test-identifier"
        mock_source.is_active = True
        mock_bot.repository.get_source_by_name = AsyncMock(return_value=mock_source)

        updated_source = MagicMock()
        updated_source.is_active = False
        mock_bot.repository.set_source_active = AsyncMock(return_value=updated_source)

        await source_management.source_toggle.callback(
            source_management, interaction, name="Test Source"
        )

        mock_bot.repository.set_source_active.assert_called_once_with(
            "test-identifier", False, pause_reason=PauseReason.USER_PAUSED
        )
        call_args = interaction.followup.send.call_args
        assert "disabled" in call_args[0][0]

    async def test_toggle_source_not_found(self, source_management, mock_bot):
        interaction = MagicMock(spec=discord.Interaction)
        interaction.response = MagicMock()
        interaction.response.defer = AsyncMock()
        interaction.followup = MagicMock()
        interaction.followup.send = AsyncMock()

        mock_bot.repository.get_source_by_name = AsyncMock(return_value=None)

        await source_management.source_toggle.callback(
            source_management, interaction, name="Unknown"
        )

        mock_bot.repository.set_source_active.assert_not_called()
        call_args = interaction.followup.send.call_args
        assert "No source found" in call_args[0][0]
