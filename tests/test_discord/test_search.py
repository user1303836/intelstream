from datetime import UTC, datetime
from unittest.mock import AsyncMock, MagicMock

import discord
import pytest
from discord import app_commands

from intelstream.discord.cogs.search import SearchCog
from intelstream.services.search import SearchResult


@pytest.fixture
def mock_bot():
    bot = MagicMock()
    bot.settings = MagicMock()
    bot.settings.voyage_api_key = "test-voyage-key"
    bot.settings.search_max_results = 5
    bot.settings.search_similarity_threshold = 0.3
    bot.search_service = MagicMock()
    bot.search_service.search = AsyncMock()
    return bot


@pytest.fixture
def search_cog(mock_bot):
    return SearchCog(mock_bot)


@pytest.fixture
def mock_interaction():
    interaction = MagicMock(spec=discord.Interaction)
    interaction.response = MagicMock()
    interaction.response.defer = AsyncMock()
    interaction.response.send_message = AsyncMock()
    interaction.followup = MagicMock()
    interaction.followup.send = AsyncMock()
    interaction.user = MagicMock()
    interaction.user.id = 12345
    interaction.guild_id = 123456789
    return interaction


@pytest.fixture
def sample_results():
    return [
        SearchResult(
            content_item_id="item-1",
            title="Scaling Laws for Transformers",
            summary="A paper about scaling",
            original_url="https://arxiv.org/abs/1234",
            source_type="arxiv",
            source_name="ArXiv cs.CL",
            published_at=datetime(2024, 1, 15, tzinfo=UTC),
            score=0.94,
        ),
        SearchResult(
            content_item_id="item-2",
            title="RLHF Techniques Overview",
            summary="An overview of RLHF",
            original_url="https://example.substack.com/p/rlhf",
            source_type="substack",
            source_name="AI Newsletter",
            published_at=datetime(2024, 1, 10, tzinfo=UTC),
            score=0.87,
        ),
    ]


class TestSearchCog:
    async def test_search_command_returns_embed_with_results(
        self, search_cog, mock_bot, mock_interaction, sample_results
    ):
        mock_bot.search_service.search.return_value = sample_results

        await search_cog.search.callback(
            search_cog, mock_interaction, query="scaling laws", days=None, source_type=None
        )

        mock_interaction.response.defer.assert_called_once_with(ephemeral=True)
        mock_interaction.followup.send.assert_called_once()
        call_kwargs = mock_interaction.followup.send.call_args.kwargs
        assert isinstance(call_kwargs["embed"], discord.Embed)
        assert call_kwargs["ephemeral"] is True

    async def test_search_command_handles_no_results(self, search_cog, mock_bot, mock_interaction):
        mock_bot.search_service.search.return_value = []

        await search_cog.search.callback(
            search_cog, mock_interaction, query="nonexistent topic", days=None, source_type=None
        )

        mock_interaction.followup.send.assert_called_once()
        call_args = mock_interaction.followup.send.call_args
        assert "No relevant results found" in call_args.args[0]

    async def test_search_command_handles_service_unavailable(
        self, search_cog, mock_bot, mock_interaction
    ):
        mock_bot.search_service = None

        await search_cog.search.callback(
            search_cog, mock_interaction, query="test query", days=None, source_type=None
        )

        mock_interaction.response.send_message.assert_called_once()
        call_args = mock_interaction.response.send_message.call_args
        assert "not configured" in call_args.args[0]

    async def test_search_command_rejects_short_query(self, search_cog, mock_interaction):
        await search_cog.search.callback(
            search_cog, mock_interaction, query="ab", days=None, source_type=None
        )

        mock_interaction.response.send_message.assert_called_once()
        call_args = mock_interaction.response.send_message.call_args
        assert "3 and 200 characters" in call_args.args[0]

    async def test_search_command_rejects_long_query(self, search_cog, mock_interaction):
        long_query = "a" * 201
        await search_cog.search.callback(
            search_cog, mock_interaction, query=long_query, days=None, source_type=None
        )

        mock_interaction.response.send_message.assert_called_once()
        call_args = mock_interaction.response.send_message.call_args
        assert "3 and 200 characters" in call_args.args[0]

    async def test_search_command_rejects_zero_days(self, search_cog, mock_interaction):
        await search_cog.search.callback(
            search_cog, mock_interaction, query="test query", days=0, source_type=None
        )

        mock_interaction.response.send_message.assert_called_once()
        call_args = mock_interaction.response.send_message.call_args
        assert "positive" in call_args.args[0]

    async def test_search_command_rejects_negative_days(self, search_cog, mock_interaction):
        await search_cog.search.callback(
            search_cog, mock_interaction, query="test query", days=-5, source_type=None
        )

        mock_interaction.response.send_message.assert_called_once()
        call_args = mock_interaction.response.send_message.call_args
        assert "positive" in call_args.args[0]

    async def test_search_error_handler_returns_cooldown_message(
        self, search_cog, mock_interaction
    ):
        error = app_commands.CommandOnCooldown(app_commands.Cooldown(5, 60.0), 30.0)

        await search_cog.search_error(mock_interaction, error)

        mock_interaction.response.send_message.assert_called_once()
        call_args = mock_interaction.response.send_message.call_args
        assert "cooldown" in call_args.args[0]

    async def test_search_command_handles_search_exception(
        self, search_cog, mock_bot, mock_interaction
    ):
        mock_bot.search_service.search.side_effect = Exception("API error")

        await search_cog.search.callback(
            search_cog, mock_interaction, query="test query", days=None, source_type=None
        )

        mock_interaction.followup.send.assert_called_once()
        call_args = mock_interaction.followup.send.call_args
        assert "error occurred" in call_args.args[0]
