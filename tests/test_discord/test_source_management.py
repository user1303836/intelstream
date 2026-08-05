import json
from datetime import UTC, datetime
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

import discord
import pytest
from discord import app_commands

from intelstream.database.exceptions import (
    DatabaseConnectionError,
    DuplicateSourceError,
    SourceNotFoundError,
)
from intelstream.database.models import PauseReason, SourceType
from intelstream.discord.cogs.source_management import (
    ConfirmSourceRemoveView,
    InvalidSourceURLError,
    SourceManagement,
    parse_source_identifier,
)
from intelstream.services.page_analyzer import PageAnalysisError


@pytest.fixture
def mock_bot():
    bot = MagicMock()
    bot.repository = MagicMock()
    bot.repository.get_source_by_identifier = AsyncMock(return_value=None)
    bot.repository.get_source_by_name = AsyncMock(return_value=None)
    bot.settings = MagicMock()
    bot.settings.default_poll_interval_minutes = 5
    bot.settings.get_poll_interval = MagicMock(return_value=5)
    bot.settings.youtube_api_key = "test-api-key"
    bot.settings.twitter_bearer_token = "test-twitter-token"
    bot.settings.llm_provider = "openai"
    bot.settings.llm_api_key = "test-openai-key"
    return bot


@pytest.fixture
def source_management(mock_bot):
    return SourceManagement(mock_bot)


def make_interaction() -> MagicMock:
    interaction = MagicMock(spec=discord.Interaction)
    interaction.response = MagicMock()
    interaction.response.defer = AsyncMock()
    interaction.response.send_message = AsyncMock()
    interaction.followup = MagicMock()
    interaction.followup.send = AsyncMock()
    interaction.edit_original_response = AsyncMock()
    interaction.user = MagicMock()
    interaction.user.id = 123
    interaction.guild_id = 456
    interaction.channel_id = 789
    return interaction


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

    def test_parse_substack_no_host(self):
        with pytest.raises(InvalidSourceURLError, match="No host found"):
            parse_source_identifier(SourceType.SUBSTACK, "not-a-url")

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

    def test_parse_substack_empty_subdomain(self):
        with pytest.raises(InvalidSourceURLError, match="Invalid Substack URL"):
            parse_source_identifier(SourceType.SUBSTACK, "https://.substack.com")

    def test_parse_substack_www_subdomain(self):
        with pytest.raises(InvalidSourceURLError, match="Invalid Substack URL"):
            parse_source_identifier(SourceType.SUBSTACK, "https://www.substack.com")

    def test_parse_youtube_no_channel(self):
        with pytest.raises(InvalidSourceURLError, match="Could not extract channel"):
            parse_source_identifier(SourceType.YOUTUBE, "https://www.youtube.com/")

    def test_parse_youtube_non_youtube_domain(self):
        with pytest.raises(InvalidSourceURLError, match=r"Expected youtube\.com"):
            parse_source_identifier(SourceType.YOUTUBE, "https://example.com/channel")

    def test_parse_rss_no_host(self):
        with pytest.raises(InvalidSourceURLError, match="No host found"):
            parse_source_identifier(SourceType.RSS, "not-a-url")

    def test_parse_arxiv_empty(self):
        with pytest.raises(InvalidSourceURLError, match="cannot be empty"):
            parse_source_identifier(SourceType.ARXIV, "   ")

    def test_parse_arxiv_category(self):
        identifier, feed_url = parse_source_identifier(SourceType.ARXIV, "cs.AI")
        assert identifier == "cs.AI"
        assert feed_url == "https://arxiv.org/rss/cs.AI"

    def test_parse_arxiv_list_url(self):
        identifier, feed_url = parse_source_identifier(
            SourceType.ARXIV,
            "https://arxiv.org/list/cs.AI/",
        )
        assert identifier == "cs.AI"
        assert feed_url == "https://arxiv.org/rss/cs.AI"

    def test_parse_arxiv_recent_list_url(self):
        identifier, feed_url = parse_source_identifier(
            SourceType.ARXIV,
            "https://arxiv.org/list/cs.AI/recent",
        )
        assert identifier == "cs.AI"
        assert feed_url == "https://arxiv.org/rss/cs.AI"

    def test_parse_arxiv_url_without_scheme(self):
        identifier, feed_url = parse_source_identifier(SourceType.ARXIV, "arxiv.org/rss/cs.AI")
        assert identifier == "cs.AI"
        assert feed_url == "https://arxiv.org/rss/cs.AI"

    def test_parse_arxiv_rss_url(self):
        identifier, feed_url = parse_source_identifier(
            SourceType.ARXIV,
            "https://arxiv.org/rss/stat.ML",
        )
        assert identifier == "stat.ML"
        assert feed_url == "https://arxiv.org/rss/stat.ML"

    def test_parse_arxiv_wrong_domain(self):
        with pytest.raises(InvalidSourceURLError, match=r"Expected arxiv\.org domain"):
            parse_source_identifier(SourceType.ARXIV, "https://example.com/list/cs.AI/")

    def test_parse_arxiv_list_url_without_category(self):
        with pytest.raises(InvalidSourceURLError, match=r"Expected an arxiv\.org list or RSS URL"):
            parse_source_identifier(SourceType.ARXIV, "https://arxiv.org/list/")

    def test_parse_arxiv_list_url_with_unextractable_category(self):
        class PersistentListPath(str):
            def rstrip(self, _chars: str | None = None) -> str:
                return self

        parsed = SimpleNamespace(
            scheme="https",
            netloc="arxiv.org",
            path=PersistentListPath("/list/"),
        )
        with (
            patch("intelstream.discord.cogs.source_management.urlparse", return_value=parsed),
            pytest.raises(InvalidSourceURLError, match="Could not extract category"),
        ):
            parse_source_identifier(SourceType.ARXIV, "https://arxiv.org/list/")

    def test_parse_arxiv_unexpected_path(self):
        with pytest.raises(InvalidSourceURLError, match=r"Expected an arxiv\.org list or RSS URL"):
            parse_source_identifier(SourceType.ARXIV, "https://arxiv.org/abs/1234.5678")

    def test_parse_arxiv_invalid_category(self):
        with pytest.raises(InvalidSourceURLError, match="Invalid Arxiv category"):
            parse_source_identifier(SourceType.ARXIV, "cs AI!")

    def test_parse_page_no_host(self):
        with pytest.raises(InvalidSourceURLError, match="No host found"):
            parse_source_identifier(SourceType.PAGE, "not-a-url")

    def test_parse_page_trims_trailing_slash(self):
        identifier, feed_url = parse_source_identifier(
            SourceType.PAGE, "https://example.com/articles/"
        )
        assert identifier == "example.com/articles"
        assert feed_url == "https://example.com/articles/"

    def test_parse_blog_no_host(self):
        with pytest.raises(InvalidSourceURLError, match="No host found"):
            parse_source_identifier(SourceType.BLOG, "not-a-url")

    def test_parse_blog_trims_trailing_slash(self):
        identifier, feed_url = parse_source_identifier(
            SourceType.BLOG, "https://blog.example.com/posts/"
        )
        assert identifier == "blog.example.com/posts"
        assert feed_url is None

    def test_parse_twitter_url(self):
        identifier, feed_url = parse_source_identifier(
            SourceType.TWITTER,
            "https://twitter.com/elonmusk",
        )
        assert identifier == "elonmusk"
        assert feed_url is None

    def test_parse_twitter_x_url(self):
        identifier, feed_url = parse_source_identifier(
            SourceType.TWITTER,
            "https://x.com/elonmusk",
        )
        assert identifier == "elonmusk"
        assert feed_url is None

    def test_parse_twitter_with_path(self):
        identifier, feed_url = parse_source_identifier(
            SourceType.TWITTER,
            "https://x.com/elonmusk/status/12345",
        )
        assert identifier == "elonmusk"
        assert feed_url is None

    def test_parse_twitter_uppercase_normalized(self):
        identifier, _feed_url = parse_source_identifier(
            SourceType.TWITTER,
            "https://x.com/ElonMusk",
        )
        assert identifier == "elonmusk"

    def test_parse_twitter_no_username(self):
        with pytest.raises(InvalidSourceURLError, match="Could not extract a valid username"):
            parse_source_identifier(SourceType.TWITTER, "https://twitter.com/")

    def test_parse_twitter_invalid_username(self):
        with pytest.raises(InvalidSourceURLError, match="Could not extract a valid username"):
            parse_source_identifier(SourceType.TWITTER, "https://x.com/../../admin")

    def test_parse_twitter_wrong_domain(self):
        with pytest.raises(InvalidSourceURLError, match=r"Expected twitter\.com or x\.com"):
            parse_source_identifier(SourceType.TWITTER, "https://example.com/user")

    def test_parse_unknown_source_type_returns_url(self):
        identifier, feed_url = parse_source_identifier(object(), "raw-source")

        assert identifier == "raw-source"
        assert feed_url is None


class TestConfirmSourceRemoveView:
    async def test_confirm_button_marks_confirmed_and_defers(self):
        view = ConfirmSourceRemoveView()
        interaction = make_interaction()

        await view.children[0].callback(interaction)

        assert view.confirmed is True
        interaction.response.defer.assert_awaited_once()

    async def test_cancel_button_marks_rejected_and_defers(self):
        view = ConfirmSourceRemoveView()
        interaction = make_interaction()

        await view.children[1].callback(interaction)

        assert view.confirmed is False
        interaction.response.defer.assert_awaited_once()


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
        assert call_kwargs["poll_interval_minutes"] == 5
        mock_bot.settings.get_poll_interval.assert_called_once_with(SourceType.SUBSTACK)
        interaction.followup.send.assert_called_once()
        call_kwargs = interaction.followup.send.call_args.kwargs
        assert "embed" in call_kwargs

    async def test_add_source_uses_selected_channel(
        self, source_management: SourceManagement, mock_bot: MagicMock
    ) -> None:
        interaction = MagicMock(spec=discord.Interaction)
        interaction.response = MagicMock()
        interaction.response.defer = AsyncMock()
        interaction.followup = MagicMock()
        interaction.followup.send = AsyncMock()
        interaction.user = MagicMock()
        interaction.user.id = 123
        interaction.guild_id = 456
        interaction.channel_id = 789

        target_channel = MagicMock(spec=discord.TextChannel)
        target_channel.id = 999

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
            channel=target_channel,
        )

        mock_bot.repository.add_source.assert_called_once()
        call_kwargs = mock_bot.repository.add_source.call_args.kwargs
        assert call_kwargs["channel_id"] == "999"

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
        mock_bot.repository.get_source_by_identifier.assert_awaited_once_with("test")
        mock_bot.repository.get_source_by_name.assert_awaited_once_with("Test Newsletter")
        interaction.followup.send.assert_called_once()
        call_args = interaction.followup.send.call_args
        assert "already exists" in call_args[0][0]

    async def test_add_duplicate_blog_skips_expensive_analysis(self, source_management, mock_bot):
        interaction = make_interaction()
        source_type_choice = MagicMock(value="blog", name="Blog")
        existing_source = MagicMock(name="Existing Blog")
        mock_bot.repository.get_source_by_identifier = AsyncMock(return_value=existing_source)
        adapter = MagicMock()
        adapter.analyze_site = AsyncMock()

        with (
            patch(
                "intelstream.discord.cogs.source_management.async_is_safe_url",
                return_value=(True, ""),
            ),
            patch(
                "intelstream.discord.cogs.source_management.SmartBlogAdapter",
                return_value=adapter,
            ),
        ):
            await source_management.source_add.callback(
                source_management,
                interaction,
                source_type=source_type_choice,
                name="Existing Blog",
                url="https://blog.example.com",
            )

        adapter.analyze_site.assert_not_awaited()
        mock_bot.repository.add_source.assert_not_called()

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

    async def test_add_twitter_without_bearer_token(self, source_management, mock_bot):
        mock_bot.settings.twitter_bearer_token = None

        interaction = MagicMock(spec=discord.Interaction)
        interaction.response = MagicMock()
        interaction.response.defer = AsyncMock()
        interaction.followup = MagicMock()
        interaction.followup.send = AsyncMock()

        source_type_choice = MagicMock()
        source_type_choice.value = "twitter"

        await source_management.source_add.callback(
            source_management,
            interaction,
            source_type=source_type_choice,
            name="Test Twitter",
            url="https://x.com/testuser",
        )

        mock_bot.repository.add_source.assert_not_called()
        call_args = interaction.followup.send.call_args
        assert "not available" in call_args[0][0]

    async def test_add_source_with_summarize_false(self, source_management, mock_bot):
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
        source_type_choice.value = "youtube"
        source_type_choice.name = "YouTube"

        mock_bot.repository.get_source_by_identifier = AsyncMock(return_value=None)
        mock_bot.repository.get_source_by_name = AsyncMock(return_value=None)

        mock_source = MagicMock()
        mock_source.id = "new-source-id"
        mock_bot.repository.add_source = AsyncMock(return_value=mock_source)

        await source_management.source_add.callback(
            source_management,
            interaction,
            source_type=source_type_choice,
            name="Notify Channel",
            url="https://www.youtube.com/@testchannel",
            summarize=False,
        )

        mock_bot.repository.add_source.assert_called_once()
        call_kwargs = mock_bot.repository.add_source.call_args.kwargs
        assert call_kwargs["skip_summary"] is True

    async def test_add_source_with_summarize_true(self, source_management, mock_bot):
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
            summarize=True,
        )

        mock_bot.repository.add_source.assert_called_once()
        call_kwargs = mock_bot.repository.add_source.call_args.kwargs
        assert call_kwargs["skip_summary"] is False

    async def test_add_arxiv_source_with_category_identifier(self, source_management, mock_bot):
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
        source_type_choice.value = "arxiv"
        source_type_choice.name = "Arxiv"

        mock_bot.repository.get_source_by_identifier = AsyncMock(return_value=None)
        mock_bot.repository.get_source_by_name = AsyncMock(return_value=None)

        mock_source = MagicMock()
        mock_source.id = "new-source-id"
        mock_bot.repository.add_source = AsyncMock(return_value=mock_source)

        await source_management.source_add.callback(
            source_management,
            interaction,
            source_type=source_type_choice,
            name="arxiv_cs.AI",
            url="cs.AI",
        )

        mock_bot.repository.add_source.assert_called_once()
        call_kwargs = mock_bot.repository.add_source.call_args.kwargs
        assert call_kwargs["identifier"] == "cs.AI"
        assert call_kwargs["feed_url"] == "https://arxiv.org/rss/cs.AI"

    async def test_add_arxiv_source_with_list_url(self, source_management, mock_bot):
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
        source_type_choice.value = "arxiv"
        source_type_choice.name = "Arxiv"

        mock_bot.repository.get_source_by_identifier = AsyncMock(return_value=None)
        mock_bot.repository.get_source_by_name = AsyncMock(return_value=None)

        mock_source = MagicMock()
        mock_source.id = "new-source-id"
        mock_bot.repository.add_source = AsyncMock(return_value=mock_source)

        await source_management.source_add.callback(
            source_management,
            interaction,
            source_type=source_type_choice,
            name="arxiv_cs.AI",
            url="https://arxiv.org/list/cs.AI/",
        )

        mock_bot.repository.add_source.assert_called_once()
        call_kwargs = mock_bot.repository.add_source.call_args.kwargs
        assert call_kwargs["identifier"] == "cs.AI"
        assert call_kwargs["feed_url"] == "https://arxiv.org/rss/cs.AI"

    async def test_add_invalid_source_type(self, source_management, mock_bot):
        interaction = make_interaction()
        source_type_choice = MagicMock()
        source_type_choice.value = "bad-type"

        await source_management.source_add.callback(
            source_management,
            interaction,
            source_type=source_type_choice,
            name="Bad",
            url="https://example.com/feed",
        )

        mock_bot.repository.add_source.assert_not_called()
        assert "Invalid source type" in interaction.followup.send.call_args.args[0]

    async def test_add_page_without_llm_key(self, source_management, mock_bot):
        mock_bot.settings.llm_api_key = None
        interaction = make_interaction()
        source_type_choice = MagicMock()
        source_type_choice.value = "page"

        await source_management.source_add.callback(
            source_management,
            interaction,
            source_type=source_type_choice,
            name="Page",
            url="https://example.com/news",
        )

        mock_bot.repository.add_source.assert_not_called()
        assert "not available" in interaction.followup.send.call_args.args[0]

    async def test_add_blog_without_llm_key(self, source_management, mock_bot):
        mock_bot.settings.llm_api_key = None
        interaction = make_interaction()
        source_type_choice = MagicMock()
        source_type_choice.value = "blog"

        await source_management.source_add.callback(
            source_management,
            interaction,
            source_type=source_type_choice,
            name="Blog",
            url="https://blog.example.com",
        )

        mock_bot.repository.add_source.assert_not_called()
        assert "not available" in interaction.followup.send.call_args.args[0]

    async def test_add_source_without_interaction_channel(self, source_management, mock_bot):
        interaction = make_interaction()
        interaction.channel_id = None
        source_type_choice = MagicMock()
        source_type_choice.value = "rss"

        await source_management.source_add.callback(
            source_management,
            interaction,
            source_type=source_type_choice,
            name="Feed",
            url="https://example.com/feed.xml",
        )

        mock_bot.repository.add_source.assert_not_called()
        assert "Could not determine target channel" in interaction.followup.send.call_args.args[0]

    async def test_add_invalid_url_reports_parse_error(self, source_management, mock_bot):
        interaction = make_interaction()
        source_type_choice = MagicMock()
        source_type_choice.value = "rss"

        await source_management.source_add.callback(
            source_management,
            interaction,
            source_type=source_type_choice,
            name="Feed",
            url="not-a-url",
        )

        mock_bot.repository.add_source.assert_not_called()
        assert "Invalid RSS URL" in interaction.followup.send.call_args.args[0]

    async def test_add_rejects_unsafe_url(self, source_management, mock_bot):
        interaction = make_interaction()
        source_type_choice = MagicMock()
        source_type_choice.value = "rss"
        source_type_choice.name = "RSS"

        with patch(
            "intelstream.discord.cogs.source_management.async_is_safe_url",
            return_value=(False, "private address"),
        ):
            await source_management.source_add.callback(
                source_management,
                interaction,
                source_type=source_type_choice,
                name="Feed",
                url="https://example.com/feed.xml",
            )

        mock_bot.repository.add_source.assert_not_called()
        assert "URL not allowed" in interaction.followup.send.call_args.args[0]

    async def test_add_handles_repository_duplicate_race(self, source_management, mock_bot):
        interaction = make_interaction()
        source_type_choice = MagicMock()
        source_type_choice.value = "rss"
        source_type_choice.name = "RSS"
        mock_bot.repository.get_source_by_identifier = AsyncMock(return_value=None)
        mock_bot.repository.get_source_by_name = AsyncMock(return_value=None)
        mock_bot.repository.add_source = AsyncMock(side_effect=DuplicateSourceError("dupe"))

        await source_management.source_add.callback(
            source_management,
            interaction,
            source_type=source_type_choice,
            name="Feed",
            url="https://example.com/feed.xml",
        )

        assert "already exists" in interaction.followup.send.call_args.args[0]

    async def test_add_page_stores_analyzed_extraction_profile(self, source_management, mock_bot):
        interaction = make_interaction()
        source_type_choice = MagicMock()
        source_type_choice.value = "page"
        source_type_choice.name = "Page"
        profile = MagicMock()
        profile.to_dict.return_value = {"post_selector": "article"}
        analyzer = MagicMock()
        analyzer.analyze = AsyncMock(return_value=profile)
        mock_source = MagicMock()
        mock_source.id = "source-id"
        mock_bot.repository.get_source_by_identifier = AsyncMock(return_value=None)
        mock_bot.repository.get_source_by_name = AsyncMock(return_value=None)
        mock_bot.repository.add_source = AsyncMock(return_value=mock_source)

        with patch(
            "intelstream.discord.cogs.source_management.PageAnalyzer", return_value=analyzer
        ):
            await source_management.source_add.callback(
                source_management,
                interaction,
                source_type=source_type_choice,
                name="Page",
                url="https://example.com/news",
            )

        call_kwargs = mock_bot.repository.add_source.call_args.kwargs
        assert json.loads(call_kwargs["extraction_profile"]) == {"post_selector": "article"}

    async def test_add_page_reports_analysis_error(self, source_management, mock_bot):
        interaction = make_interaction()
        source_type_choice = MagicMock()
        source_type_choice.value = "page"
        analyzer = MagicMock()
        analyzer.analyze = AsyncMock(side_effect=PageAnalysisError("no posts"))

        with patch(
            "intelstream.discord.cogs.source_management.PageAnalyzer", return_value=analyzer
        ):
            await source_management.source_add.callback(
                source_management,
                interaction,
                source_type=source_type_choice,
                name="Page",
                url="https://example.com/news",
            )

        mock_bot.repository.add_source.assert_not_called()
        assert "Failed to analyze page structure" in interaction.followup.send.call_args.args[0]

    async def test_add_page_rechecks_llm_key_before_analysis(self, source_management, mock_bot):
        class SettingsWithClearedLLMKey:
            default_poll_interval_minutes = 5
            twitter_bearer_token = "test-twitter-token"
            youtube_api_key = "test-api-key"

            def __init__(self) -> None:
                self.calls = 0

            @property
            def llm_api_key(self) -> str:
                self.calls += 1
                if self.calls == 1:
                    return "openai-key"
                raise ValueError("No API key configured")

        mock_bot.settings = SettingsWithClearedLLMKey()
        interaction = make_interaction()
        source_type_choice = MagicMock()
        source_type_choice.value = "page"

        await source_management.source_add.callback(
            source_management,
            interaction,
            source_type=source_type_choice,
            name="Page",
            url="https://example.com/news",
        )

        mock_bot.repository.add_source.assert_not_called()
        assert "require an LLM API key" in interaction.followup.send.call_args.args[0]

    async def test_add_blog_uses_discovered_metadata(self, source_management, mock_bot):
        interaction = make_interaction()
        source_type_choice = MagicMock()
        source_type_choice.value = "blog"
        source_type_choice.name = "Blog"
        result = MagicMock()
        result.success = True
        result.strategy = "rss"
        result.feed_url = "https://blog.example.com/feed"
        result.url_pattern = "/posts/*"
        result.post_count = 12
        adapter = MagicMock()
        adapter.analyze_site = AsyncMock(return_value=result)
        mock_source = MagicMock()
        mock_source.id = "source-id"
        mock_bot.repository.get_source_by_identifier = AsyncMock(return_value=None)
        mock_bot.repository.get_source_by_name = AsyncMock(return_value=None)
        mock_bot.repository.add_source = AsyncMock(return_value=mock_source)

        with (
            patch.object(source_management, "_get_llm_client", return_value=MagicMock()),
            patch(
                "intelstream.discord.cogs.source_management.async_is_safe_url",
                return_value=(True, None),
            ),
            patch(
                "intelstream.discord.cogs.source_management.SmartBlogAdapter",
                return_value=adapter,
            ),
        ):
            await source_management.source_add.callback(
                source_management,
                interaction,
                source_type=source_type_choice,
                name="Blog",
                url="https://blog.example.com",
            )

        call_kwargs = mock_bot.repository.add_source.call_args.kwargs
        assert call_kwargs["feed_url"] == "https://blog.example.com/feed"
        assert call_kwargs["discovery_strategy"] == "rss"
        assert call_kwargs["url_pattern"] == "/posts/*"
        embed = interaction.followup.send.call_args.kwargs["embed"]
        assert any(field.name == "Discovery Strategy" for field in embed.fields)

    async def test_add_blog_reports_analysis_failure(self, source_management, mock_bot):
        interaction = make_interaction()
        source_type_choice = MagicMock()
        source_type_choice.value = "blog"
        result = MagicMock()
        result.success = False
        result.error = "no strategy"
        adapter = MagicMock()
        adapter.analyze_site = AsyncMock(return_value=result)

        with (
            patch.object(source_management, "_get_llm_client", return_value=MagicMock()),
            patch(
                "intelstream.discord.cogs.source_management.async_is_safe_url",
                return_value=(True, None),
            ),
            patch(
                "intelstream.discord.cogs.source_management.SmartBlogAdapter",
                return_value=adapter,
            ),
        ):
            await source_management.source_add.callback(
                source_management,
                interaction,
                source_type=source_type_choice,
                name="Blog",
                url="https://blog.example.com",
            )

        mock_bot.repository.add_source.assert_not_called()
        assert "Failed to analyze blog" in interaction.followup.send.call_args.args[0]


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

    async def test_list_sources_formats_failure_pause_and_last_poll(
        self, source_management, mock_bot
    ):
        interaction = make_interaction()

        failed_source = MagicMock()
        failed_source.name = "Failed"
        failed_source.type = SourceType.RSS
        failed_source.is_active = False
        failed_source.pause_reason = PauseReason.CONSECUTIVE_FAILURES.value
        failed_source.consecutive_failures = 4
        failed_source.last_polled_at = datetime(2026, 1, 2, 3, 4, tzinfo=UTC)

        paused_source = MagicMock()
        paused_source.name = "Paused"
        paused_source.type = SourceType.BLOG
        paused_source.is_active = False
        paused_source.pause_reason = PauseReason.NONE.value
        paused_source.consecutive_failures = 0
        paused_source.last_polled_at = None

        mock_bot.repository.get_all_sources = AsyncMock(return_value=[failed_source, paused_source])

        await source_management.source_list.callback(source_management, interaction)

        embed = interaction.followup.send.call_args.kwargs["embed"]
        assert "Disabled: 4 consecutive failures" in embed.fields[0].value
        assert "2026-01-02 03:04 UTC" in embed.fields[0].value
        assert "**Status:** Paused" in embed.fields[1].value

    async def test_list_sources_caps_embed_fields_and_reports_total(
        self, source_management, mock_bot
    ):
        interaction = make_interaction()
        sources = []
        for index in range(30):
            source = MagicMock()
            source.name = f"Source {index} " + ("x" * 255)
            source.type = SourceType.RSS
            source.is_active = True
            source.pause_reason = PauseReason.NONE.value
            source.last_polled_at = None
            sources.append(source)
        mock_bot.repository.get_all_sources = AsyncMock(return_value=sources)

        await source_management.source_list.callback(source_management, interaction)

        embed = interaction.followup.send.call_args.kwargs["embed"]
        assert 0 < len(embed.fields) < 25
        assert all(len(field.name) <= 256 for field in embed.fields)
        total_text = (
            len(embed.title or "")
            + len(embed.footer.text or "")
            + sum(len(field.name) + len(field.value) for field in embed.fields)
        )
        assert total_text <= 6000
        assert embed.footer.text == f"Showing {len(embed.fields)} of 30 sources"


class TestSourceManagementRemove:
    def _make_confirmed_view(self) -> MagicMock:
        view = MagicMock(spec=ConfirmSourceRemoveView)
        view.confirmed = True
        view.wait = AsyncMock(return_value=False)
        return view

    def _make_cancelled_view(self) -> MagicMock:
        view = MagicMock(spec=ConfirmSourceRemoveView)
        view.confirmed = False
        view.wait = AsyncMock(return_value=False)
        return view

    def _make_timed_out_view(self) -> MagicMock:
        view = MagicMock(spec=ConfirmSourceRemoveView)
        view.confirmed = None
        view.wait = AsyncMock(return_value=True)
        return view

    @patch("intelstream.discord.cogs.source_management.ConfirmSourceRemoveView")
    async def test_remove_source_confirmed(self, mock_view_cls, source_management, mock_bot):
        mock_view_cls.return_value = self._make_confirmed_view()

        interaction = MagicMock(spec=discord.Interaction)
        interaction.response = MagicMock()
        interaction.response.defer = AsyncMock()
        interaction.followup = MagicMock()
        interaction.followup.send = AsyncMock()
        interaction.edit_original_response = AsyncMock()
        interaction.user = MagicMock()
        interaction.user.id = 123

        mock_source = MagicMock()
        mock_source.identifier = "test-identifier"
        mock_source.id = "source-id-1"
        mock_source.type = SourceType.SUBSTACK
        mock_source.is_active = True
        mock_bot.repository.get_source_by_name = AsyncMock(return_value=mock_source)
        mock_bot.repository.get_content_count_for_source = AsyncMock(return_value=0)
        mock_bot.repository.set_source_active = AsyncMock(return_value=mock_source)

        await source_management.source_remove.callback(
            source_management, interaction, name="Test Source"
        )

        mock_bot.repository.set_source_active.assert_called_once_with(
            "test-identifier",
            False,
            pause_reason=PauseReason.USER_PAUSED,
        )
        msg = interaction.edit_original_response.call_args.kwargs["content"]
        assert "archived" in msg

    @patch("intelstream.discord.cogs.source_management.ConfirmSourceRemoveView")
    async def test_remove_source_with_content(self, mock_view_cls, source_management, mock_bot):
        mock_view_cls.return_value = self._make_confirmed_view()

        interaction = MagicMock(spec=discord.Interaction)
        interaction.response = MagicMock()
        interaction.response.defer = AsyncMock()
        interaction.followup = MagicMock()
        interaction.followup.send = AsyncMock()
        interaction.edit_original_response = AsyncMock()
        interaction.user = MagicMock()
        interaction.user.id = 123

        mock_source = MagicMock()
        mock_source.identifier = "test-identifier"
        mock_source.id = "source-id-1"
        mock_source.type = SourceType.SUBSTACK
        mock_source.is_active = True
        mock_bot.repository.get_source_by_name = AsyncMock(return_value=mock_source)
        mock_bot.repository.get_content_count_for_source = AsyncMock(return_value=42)
        mock_bot.repository.set_source_active = AsyncMock(return_value=mock_source)

        await source_management.source_remove.callback(
            source_management, interaction, name="Test Source"
        )

        msg = interaction.edit_original_response.call_args.kwargs["content"]
        assert "42 content items" in msg
        assert "kept" in msg

    @patch("intelstream.discord.cogs.source_management.ConfirmSourceRemoveView")
    async def test_remove_source_cancelled(self, mock_view_cls, source_management, mock_bot):
        mock_view_cls.return_value = self._make_cancelled_view()

        interaction = MagicMock(spec=discord.Interaction)
        interaction.response = MagicMock()
        interaction.response.defer = AsyncMock()
        interaction.followup = MagicMock()
        interaction.followup.send = AsyncMock()
        interaction.edit_original_response = AsyncMock()
        interaction.user = MagicMock()
        interaction.user.id = 123

        mock_source = MagicMock()
        mock_source.identifier = "test-identifier"
        mock_source.id = "source-id-1"
        mock_source.type = SourceType.SUBSTACK
        mock_source.is_active = True
        mock_bot.repository.get_source_by_name = AsyncMock(return_value=mock_source)
        mock_bot.repository.get_content_count_for_source = AsyncMock(return_value=0)

        await source_management.source_remove.callback(
            source_management, interaction, name="Test Source"
        )

        mock_bot.repository.set_source_active.assert_not_called()
        msg = interaction.edit_original_response.call_args.kwargs["content"]
        assert "cancelled" in msg

    @patch("intelstream.discord.cogs.source_management.ConfirmSourceRemoveView")
    async def test_remove_source_timeout_cancels(self, mock_view_cls, source_management, mock_bot):
        mock_view_cls.return_value = self._make_timed_out_view()
        interaction = make_interaction()
        mock_source = MagicMock()
        mock_source.identifier = "test-identifier"
        mock_source.id = "source-id-1"
        mock_source.type = SourceType.SUBSTACK
        mock_source.is_active = True
        mock_bot.repository.get_source_by_name = AsyncMock(return_value=mock_source)
        mock_bot.repository.get_content_count_for_source = AsyncMock(return_value=0)

        await source_management.source_remove.callback(
            source_management, interaction, name="Test Source"
        )

        mock_bot.repository.set_source_active.assert_not_called()
        msg = interaction.edit_original_response.call_args.kwargs["content"]
        assert "cancelled" in msg

    @patch("intelstream.discord.cogs.source_management.ConfirmSourceRemoveView")
    async def test_remove_source_handles_source_not_found_during_archive(
        self, mock_view_cls, source_management, mock_bot
    ):
        mock_view_cls.return_value = self._make_confirmed_view()
        interaction = make_interaction()
        mock_source = MagicMock()
        mock_source.identifier = "test-identifier"
        mock_source.id = "source-id-1"
        mock_source.type = SourceType.SUBSTACK
        mock_source.is_active = True
        mock_bot.repository.get_source_by_name = AsyncMock(return_value=mock_source)
        mock_bot.repository.get_content_count_for_source = AsyncMock(return_value=0)
        mock_bot.repository.set_source_active = AsyncMock(side_effect=SourceNotFoundError("gone"))

        await source_management.source_remove.callback(
            source_management, interaction, name="Test Source"
        )

        msg = interaction.edit_original_response.call_args.kwargs["content"]
        assert "already archived or removed" in msg

    @patch("intelstream.discord.cogs.source_management.ConfirmSourceRemoveView")
    async def test_remove_source_handles_database_error(
        self, mock_view_cls, source_management, mock_bot
    ):
        mock_view_cls.return_value = self._make_confirmed_view()
        interaction = make_interaction()
        mock_source = MagicMock()
        mock_source.identifier = "test-identifier"
        mock_source.id = "source-id-1"
        mock_source.type = SourceType.SUBSTACK
        mock_source.is_active = True
        mock_bot.repository.get_source_by_name = AsyncMock(return_value=mock_source)
        mock_bot.repository.get_content_count_for_source = AsyncMock(return_value=0)
        mock_bot.repository.set_source_active = AsyncMock(
            side_effect=DatabaseConnectionError("db down")
        )

        await source_management.source_remove.callback(
            source_management, interaction, name="Test Source"
        )

        msg = interaction.edit_original_response.call_args.kwargs["content"]
        assert "database error" in msg

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

        mock_bot.repository.set_source_active.assert_not_called()
        call_args = interaction.followup.send.call_args
        assert "No source found" in call_args[0][0]

    @patch("intelstream.discord.cogs.source_management.ConfirmSourceRemoveView")
    async def test_remove_shows_confirmation_embed(
        self, mock_view_cls, source_management, mock_bot
    ):
        mock_view_cls.return_value = self._make_cancelled_view()

        interaction = MagicMock(spec=discord.Interaction)
        interaction.response = MagicMock()
        interaction.response.defer = AsyncMock()
        interaction.followup = MagicMock()
        interaction.followup.send = AsyncMock()
        interaction.edit_original_response = AsyncMock()

        mock_source = MagicMock()
        mock_source.identifier = "test-id"
        mock_source.id = "source-id-1"
        mock_source.type = SourceType.RSS
        mock_source.is_active = False
        mock_bot.repository.get_source_by_name = AsyncMock(return_value=mock_source)
        mock_bot.repository.get_content_count_for_source = AsyncMock(return_value=5)

        await source_management.source_remove.callback(
            source_management, interaction, name="My RSS"
        )

        call_kwargs = interaction.followup.send.call_args.kwargs
        embed = call_kwargs["embed"]
        assert embed.title == "Stop Monitoring Source"
        assert "My RSS" in embed.description
        field_names = [f.name for f in embed.fields]
        assert "Type" in field_names
        assert "Status" in field_names
        assert "Content Items" in field_names


class TestSourceManagementInfo:
    async def test_info_source_not_found(self, source_management, mock_bot):
        interaction = MagicMock(spec=discord.Interaction)
        interaction.response = MagicMock()
        interaction.response.defer = AsyncMock()
        interaction.followup = MagicMock()
        interaction.followup.send = AsyncMock()

        mock_bot.repository.get_source_by_name = AsyncMock(return_value=None)

        await source_management.source_info.callback(source_management, interaction, name="Unknown")

        call_args = interaction.followup.send.call_args
        assert "No source found" in call_args[0][0]

    async def test_info_active_source(self, source_management, mock_bot):
        interaction = MagicMock(spec=discord.Interaction)
        interaction.response = MagicMock()
        interaction.response.defer = AsyncMock()
        interaction.followup = MagicMock()
        interaction.followup.send = AsyncMock()

        mock_source = MagicMock()
        mock_source.name = "Test Source"
        mock_source.type = SourceType.SUBSTACK
        mock_source.identifier = "test"
        mock_source.is_active = True
        mock_source.feed_url = "https://test.substack.com/feed"
        mock_source.discovery_strategy = None
        mock_source.url_pattern = None
        mock_source.consecutive_failures = 0
        mock_source.skip_summary = False
        mock_source.last_polled_at = None
        mock_bot.repository.get_source_by_name = AsyncMock(return_value=mock_source)

        await source_management.source_info.callback(
            source_management, interaction, name="Test Source"
        )

        call_kwargs = interaction.followup.send.call_args.kwargs
        assert "embed" in call_kwargs
        embed = call_kwargs["embed"]
        assert embed.title == "Source: Test Source"
        field_names = [f.name for f in embed.fields]
        assert "Type" in field_names
        assert "Identifier" in field_names
        assert "Status" in field_names
        assert "Feed URL" in field_names
        assert "Failures" in field_names
        assert "Summarize" in field_names
        assert "Last Poll" in field_names

        status_field = next(f for f in embed.fields if f.name == "Status")
        assert status_field.value == "Active"

        summarize_field = next(f for f in embed.fields if f.name == "Summarize")
        assert summarize_field.value == "On"

    async def test_info_paused_source(self, source_management, mock_bot):
        interaction = MagicMock(spec=discord.Interaction)
        interaction.response = MagicMock()
        interaction.response.defer = AsyncMock()
        interaction.followup = MagicMock()
        interaction.followup.send = AsyncMock()

        mock_source = MagicMock()
        mock_source.name = "Paused Source"
        mock_source.type = SourceType.RSS
        mock_source.identifier = "example.com/feed"
        mock_source.is_active = False
        mock_source.pause_reason = PauseReason.USER_PAUSED.value
        mock_source.feed_url = "https://example.com/feed"
        mock_source.discovery_strategy = None
        mock_source.url_pattern = None
        mock_source.consecutive_failures = 0
        mock_source.skip_summary = True
        mock_source.last_polled_at = None
        mock_bot.repository.get_source_by_name = AsyncMock(return_value=mock_source)

        await source_management.source_info.callback(
            source_management, interaction, name="Paused Source"
        )

        call_kwargs = interaction.followup.send.call_args.kwargs
        embed = call_kwargs["embed"]
        status_field = next(f for f in embed.fields if f.name == "Status")
        assert status_field.value == "Paused by user"

        summarize_field = next(f for f in embed.fields if f.name == "Summarize")
        assert summarize_field.value == "Off"

    async def test_info_disabled_by_failures(self, source_management, mock_bot):
        interaction = MagicMock(spec=discord.Interaction)
        interaction.response = MagicMock()
        interaction.response.defer = AsyncMock()
        interaction.followup = MagicMock()
        interaction.followup.send = AsyncMock()

        mock_source = MagicMock()
        mock_source.name = "Failing Source"
        mock_source.type = SourceType.BLOG
        mock_source.identifier = "blog.example.com"
        mock_source.is_active = False
        mock_source.pause_reason = PauseReason.CONSECUTIVE_FAILURES.value
        mock_source.feed_url = None
        mock_source.discovery_strategy = "rss"
        mock_source.url_pattern = "/posts/*"
        mock_source.consecutive_failures = 5
        mock_source.skip_summary = False
        mock_source.last_polled_at = None
        mock_bot.repository.get_source_by_name = AsyncMock(return_value=mock_source)

        await source_management.source_info.callback(
            source_management, interaction, name="Failing Source"
        )

        call_kwargs = interaction.followup.send.call_args.kwargs
        embed = call_kwargs["embed"]
        status_field = next(f for f in embed.fields if f.name == "Status")
        assert status_field.value == "Disabled (5 failures)"

        field_names = [f.name for f in embed.fields]
        assert "Discovery Strategy" in field_names
        assert "URL Pattern" in field_names
        assert "Feed URL" not in field_names

    async def test_info_generic_paused_source_with_last_poll(self, source_management, mock_bot):
        interaction = make_interaction()
        mock_source = MagicMock()
        mock_source.name = "Paused Source"
        mock_source.type = SourceType.RSS
        mock_source.identifier = "example.com/feed"
        mock_source.is_active = False
        mock_source.pause_reason = PauseReason.NONE.value
        mock_source.feed_url = None
        mock_source.discovery_strategy = None
        mock_source.url_pattern = None
        mock_source.consecutive_failures = 0
        mock_source.skip_summary = False
        mock_source.last_polled_at = datetime(2026, 1, 2, 3, 4, tzinfo=UTC)
        mock_bot.repository.get_source_by_name = AsyncMock(return_value=mock_source)

        await source_management.source_info.callback(
            source_management, interaction, name="Paused Source"
        )

        embed = interaction.followup.send.call_args.kwargs["embed"]
        status_field = next(f for f in embed.fields if f.name == "Status")
        last_poll_field = next(f for f in embed.fields if f.name == "Last Poll")
        assert status_field.value == "Paused"
        assert last_poll_field.value == "2026-01-02 03:04 UTC"


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

    async def test_toggle_handles_source_not_found_during_update(self, source_management, mock_bot):
        interaction = make_interaction()
        mock_source = MagicMock()
        mock_source.identifier = "test-identifier"
        mock_source.is_active = False
        mock_bot.repository.get_source_by_name = AsyncMock(return_value=mock_source)
        mock_bot.repository.set_source_active = AsyncMock(side_effect=SourceNotFoundError("gone"))

        await source_management.source_toggle.callback(
            source_management, interaction, name="Test Source"
        )

        assert "no longer exists" in interaction.followup.send.call_args.args[0]

    async def test_toggle_handles_database_error(self, source_management, mock_bot):
        interaction = make_interaction()
        mock_source = MagicMock()
        mock_source.identifier = "test-identifier"
        mock_source.is_active = True
        mock_bot.repository.get_source_by_name = AsyncMock(return_value=mock_source)
        mock_bot.repository.set_source_active = AsyncMock(
            side_effect=DatabaseConnectionError("db down")
        )

        await source_management.source_toggle.callback(
            source_management, interaction, name="Test Source"
        )

        assert "database error" in interaction.followup.send.call_args.args[0]


class TestSourceAutocomplete:
    def _make_source(self, name: str, stype: SourceType, is_active: bool) -> MagicMock:
        s = MagicMock()
        s.name = name
        s.type = stype
        s.is_active = is_active
        return s

    async def test_autocomplete_returns_matching_sources(self, source_management, mock_bot):
        interaction = MagicMock(spec=discord.Interaction)
        interaction.channel_id = 789

        sources = [
            self._make_source("Alpha Blog", SourceType.BLOG, True),
            self._make_source("Beta RSS", SourceType.RSS, False),
            self._make_source("Gamma Newsletter", SourceType.SUBSTACK, True),
        ]
        mock_bot.repository.get_all_sources = AsyncMock(return_value=sources)

        choices = await source_management._source_name_autocomplete(interaction, "beta")

        assert len(choices) == 1
        assert choices[0].value == "Beta RSS"
        assert "[OFF]" in choices[0].name

    async def test_autocomplete_returns_all_on_empty_input(self, source_management, mock_bot):
        interaction = MagicMock(spec=discord.Interaction)
        interaction.channel_id = 789

        sources = [
            self._make_source("Source A", SourceType.BLOG, True),
            self._make_source("Source B", SourceType.RSS, True),
        ]
        mock_bot.repository.get_all_sources = AsyncMock(return_value=sources)

        choices = await source_management._source_name_autocomplete(interaction, "")

        assert len(choices) == 2

    async def test_autocomplete_limits_to_25(self, source_management, mock_bot):
        interaction = MagicMock(spec=discord.Interaction)
        interaction.channel_id = 789

        sources = [self._make_source(f"Source {i}", SourceType.RSS, True) for i in range(30)]
        mock_bot.repository.get_all_sources = AsyncMock(return_value=sources)

        choices = await source_management._source_name_autocomplete(interaction, "")

        assert len(choices) == 25

    async def test_autocomplete_includes_status_indicator(self, source_management, mock_bot):
        interaction = MagicMock(spec=discord.Interaction)
        interaction.channel_id = 789

        sources = [
            self._make_source("Active Source", SourceType.BLOG, True),
            self._make_source("Paused Source", SourceType.RSS, False),
        ]
        mock_bot.repository.get_all_sources = AsyncMock(return_value=sources)

        choices = await source_management._source_name_autocomplete(interaction, "")

        assert "[ON]" in choices[0].name
        assert "[OFF]" in choices[1].name

    async def test_autocomplete_includes_type(self, source_management, mock_bot):
        interaction = MagicMock(spec=discord.Interaction)
        interaction.channel_id = 789

        sources = [self._make_source("My Feed", SourceType.RSS, True)]
        mock_bot.repository.get_all_sources = AsyncMock(return_value=sources)

        choices = await source_management._source_name_autocomplete(interaction, "")

        assert "(rss)" in choices[0].name

    async def test_command_autocomplete_wrappers_delegate(self, source_management, mock_bot):
        interaction = MagicMock(spec=discord.Interaction)
        interaction.channel_id = 789
        sources = [self._make_source("My Feed", SourceType.RSS, True)]
        mock_bot.repository.get_all_sources = AsyncMock(return_value=sources)

        remove_choices = await source_management.source_remove_autocomplete(
            interaction,
            "feed",
        )
        info_choices = await source_management.source_info_autocomplete(
            interaction,
            "feed",
        )
        toggle_choices = await source_management.source_toggle_autocomplete(
            interaction,
            "feed",
        )

        assert [choice.value for choice in remove_choices] == ["My Feed"]
        assert [choice.value for choice in info_choices] == ["My Feed"]
        assert [choice.value for choice in toggle_choices] == ["My Feed"]


class TestSourceManagementLifecycle:
    def test_get_llm_client_is_cached_per_model(self, source_management):
        with patch("intelstream.discord.cogs.source_management.create_llm_client") as cls:
            cls.side_effect = [MagicMock(), MagicMock()]
            first = source_management._get_llm_client("model-a")
            second = source_management._get_llm_client("model-a")
            other = source_management._get_llm_client("model-b")

        assert first is second
        assert first is not other
        assert cls.call_count == 2

    async def test_cog_unload_closes_llm_clients_once(self, source_management):
        client = MagicMock()
        client.close = AsyncMock()

        with patch(
            "intelstream.discord.cogs.source_management.create_llm_client",
            return_value=client,
        ):
            source_management._get_llm_client("model-a")

        await source_management.cog_unload()
        await source_management.cog_unload()

        client.close.assert_awaited_once()

    async def test_cog_unload_noops_without_llm_clients(self, source_management):
        await source_management.cog_unload()

        assert source_management._llm_clients == {}

    async def test_setup_adds_cog(self, mock_bot):
        from intelstream.discord.cogs.source_management import setup

        mock_bot.add_cog = AsyncMock()

        await setup(mock_bot)

        mock_bot.add_cog.assert_awaited_once()
        assert isinstance(mock_bot.add_cog.call_args.args[0], SourceManagement)


def test_source_management_descriptions_match_archive_and_pause_behavior(source_management):
    assert (
        source_management.source_remove.description
        == "Archive a content source and stop polling it"
    )
    assert (
        source_management.source_toggle.description
        == "Pause or resume polling for a content source"
    )


class TestSourceManagementErrors:
    async def test_source_add_missing_permissions_message(self, source_management):
        interaction = make_interaction()

        await source_management.source_add_error(
            interaction,
            app_commands.MissingPermissions(["manage_guild"]),
        )

        assert "Manage Server" in interaction.response.send_message.call_args.args[0]

    async def test_source_add_non_permission_error_is_reraised(self, source_management):
        interaction = make_interaction()
        error = app_commands.AppCommandError("boom")

        with pytest.raises(app_commands.AppCommandError):
            await source_management.source_add_error(interaction, error)

    async def test_source_remove_missing_permissions_message(self, source_management):
        interaction = make_interaction()

        await source_management.source_remove_error(
            interaction,
            app_commands.MissingPermissions(["manage_guild"]),
        )

        assert "remove sources" in interaction.response.send_message.call_args.args[0]

    async def test_source_remove_non_permission_error_is_reraised(self, source_management):
        interaction = make_interaction()
        error = app_commands.AppCommandError("boom")

        with pytest.raises(app_commands.AppCommandError):
            await source_management.source_remove_error(interaction, error)

    async def test_source_toggle_missing_permissions_message(self, source_management):
        interaction = make_interaction()

        await source_management.source_toggle_error(
            interaction,
            app_commands.MissingPermissions(["manage_guild"]),
        )

        assert "toggle sources" in interaction.response.send_message.call_args.args[0]

    async def test_source_toggle_non_permission_error_is_reraised(self, source_management):
        interaction = make_interaction()
        error = app_commands.AppCommandError("boom")

        with pytest.raises(app_commands.AppCommandError):
            await source_management.source_toggle_error(interaction, error)
