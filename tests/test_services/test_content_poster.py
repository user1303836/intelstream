from datetime import UTC, datetime
from unittest.mock import AsyncMock, MagicMock

import discord
import pytest

from intelstream.database.models import ContentItem, SourceType
from intelstream.services.content_poster import (
    SOURCE_TYPE_LABELS,
    TRUNCATION_NOTICE,
    ContentPoster,
    truncate_summary_at_bullet,
)

DEFAULT_MAX_MESSAGE_LENGTH = 2000


@pytest.fixture
def mock_bot():
    bot = MagicMock()
    bot.repository = MagicMock()
    return bot


@pytest.fixture
def content_poster(mock_bot):
    return ContentPoster(mock_bot)


@pytest.fixture
def sample_content_item():
    item = MagicMock(spec=ContentItem)
    item.id = "test-item-id"
    item.title = "Test Article Title"
    item.summary = "This is a test summary of the article."
    item.original_url = "https://example.com/article"
    item.author = "Test Author"
    item.thumbnail_url = "https://example.com/image.jpg"
    item.published_at = datetime(2024, 1, 15, 12, 0, 0, tzinfo=UTC)
    item.source_id = "test-source-id"
    return item


class TestContentPosterFormatMessage:
    def test_format_message_basic(self, content_poster, sample_content_item):
        message = content_poster.format_message(
            content_item=sample_content_item,
            source_type=SourceType.SUBSTACK,
            source_name="Test Substack",
        )

        assert isinstance(message, str)
        assert sample_content_item.title in message
        assert sample_content_item.summary in message
        assert sample_content_item.author in message

    def test_format_message_includes_author_bold(self, content_poster, sample_content_item):
        message = content_poster.format_message(
            content_item=sample_content_item,
            source_type=SourceType.SUBSTACK,
            source_name="Test Substack",
        )

        assert f"**{sample_content_item.author}**" in message

    def test_format_message_includes_title_as_link(self, content_poster, sample_content_item):
        message = content_poster.format_message(
            content_item=sample_content_item,
            source_type=SourceType.SUBSTACK,
            source_name="Test Substack",
        )

        expected_link = f"[{sample_content_item.title}]({sample_content_item.original_url})"
        assert expected_link in message

    def test_format_message_title_bold_when_no_url(self, content_poster, sample_content_item):
        sample_content_item.original_url = None

        message = content_poster.format_message(
            content_item=sample_content_item,
            source_type=SourceType.SUBSTACK,
            source_name="Test Substack",
        )

        assert f"**{sample_content_item.title}**" in message

    def test_format_message_without_summary(self, content_poster, sample_content_item):
        sample_content_item.summary = None

        message = content_poster.format_message(
            content_item=sample_content_item,
            source_type=SourceType.SUBSTACK,
            source_name="Test Substack",
        )

        assert "No summary available." in message

    def test_format_message_without_author(self, content_poster, sample_content_item):
        sample_content_item.author = None

        message = content_poster.format_message(
            content_item=sample_content_item,
            source_type=SourceType.SUBSTACK,
            source_name="Test Substack",
        )

        assert "**None**" not in message
        assert sample_content_item.title in message

    def test_format_message_includes_source_footer(self, content_poster, sample_content_item):
        message = content_poster.format_message(
            content_item=sample_content_item,
            source_type=SourceType.SUBSTACK,
            source_name="My Newsletter",
        )

        expected_footer = f"*{SOURCE_TYPE_LABELS[SourceType.SUBSTACK]} | My Newsletter*"
        assert expected_footer in message

    def test_format_message_source_labels_by_type(self, content_poster, sample_content_item):
        for source_type, expected_label in SOURCE_TYPE_LABELS.items():
            message = content_poster.format_message(
                content_item=sample_content_item,
                source_type=source_type,
                source_name="Test",
            )
            assert f"*{expected_label} | Test*" in message

    def test_format_message_truncates_long_content(self, content_poster, sample_content_item):
        sample_content_item.summary = "A" * (DEFAULT_MAX_MESSAGE_LENGTH + 500)

        message = content_poster.format_message(
            content_item=sample_content_item,
            source_type=SourceType.RSS,
            source_name="Test RSS",
        )

        assert len(message) <= DEFAULT_MAX_MESSAGE_LENGTH
        assert TRUNCATION_NOTICE.strip() in message

    def test_format_message_unknown_source_type(self, content_poster, sample_content_item):
        unknown_type = MagicMock()
        unknown_type.value = "unknown"

        message = content_poster.format_message(
            content_item=sample_content_item,
            source_type=unknown_type,
            source_name="Test",
        )

        assert "*Unknown | Test*" in message


class TestContentPosterPostContent:
    async def test_post_content_sends_message(self, content_poster, sample_content_item):
        mock_channel = MagicMock(spec=discord.TextChannel)
        mock_message = MagicMock(spec=discord.Message)
        mock_message.id = 12345
        mock_channel.send = AsyncMock(return_value=mock_message)

        result = await content_poster.post_content(
            channel=mock_channel,
            content_item=sample_content_item,
            source_type=SourceType.SUBSTACK,
            source_name="Test",
        )

        mock_channel.send.assert_called_once()
        call_kwargs = mock_channel.send.call_args.kwargs
        assert "content" in call_kwargs
        assert isinstance(call_kwargs["content"], str)
        assert result == mock_message

    async def test_post_content_message_contains_item_info(
        self, content_poster, sample_content_item
    ):
        mock_channel = MagicMock(spec=discord.TextChannel)
        mock_message = MagicMock(spec=discord.Message)
        mock_message.id = 12345
        mock_channel.send = AsyncMock(return_value=mock_message)

        await content_poster.post_content(
            channel=mock_channel,
            content_item=sample_content_item,
            source_type=SourceType.SUBSTACK,
            source_name="Test",
        )

        call_kwargs = mock_channel.send.call_args.kwargs
        content = call_kwargs["content"]
        assert sample_content_item.title in content
        assert sample_content_item.summary in content


class TestContentPosterPostUnpostedItems:
    async def test_returns_zero_when_no_config(self, content_poster, mock_bot):
        mock_bot.repository.get_discord_config = AsyncMock(return_value=None)

        result = await content_poster.post_unposted_items(guild_id=123)

        assert result == 0

    async def test_returns_zero_when_config_inactive(self, content_poster, mock_bot):
        mock_config = MagicMock()
        mock_config.is_active = False
        mock_bot.repository.get_discord_config = AsyncMock(return_value=mock_config)

        result = await content_poster.post_unposted_items(guild_id=123)

        assert result == 0

    async def test_returns_zero_when_channel_not_found(self, content_poster, mock_bot):
        mock_config = MagicMock()
        mock_config.is_active = True
        mock_config.channel_id = "999"
        mock_bot.repository.get_discord_config = AsyncMock(return_value=mock_config)
        mock_bot.get_channel = MagicMock(return_value=None)

        result = await content_poster.post_unposted_items(guild_id=123)

        assert result == 0

    async def test_returns_zero_when_no_items(self, content_poster, mock_bot):
        mock_config = MagicMock()
        mock_config.is_active = True
        mock_config.channel_id = "456"
        mock_bot.repository.get_discord_config = AsyncMock(return_value=mock_config)

        mock_channel = MagicMock(spec=discord.TextChannel)
        mock_bot.get_channel = MagicMock(return_value=mock_channel)

        mock_bot.repository.get_unposted_content_items = AsyncMock(return_value=[])

        result = await content_poster.post_unposted_items(guild_id=123)

        assert result == 0

    async def test_posts_items_and_marks_posted(
        self, content_poster, mock_bot, sample_content_item
    ):
        mock_config = MagicMock()
        mock_config.is_active = True
        mock_config.channel_id = "456"
        mock_bot.repository.get_discord_config = AsyncMock(return_value=mock_config)

        mock_channel = MagicMock(spec=discord.TextChannel)
        mock_message = MagicMock(spec=discord.Message)
        mock_message.id = 789
        mock_channel.send = AsyncMock(return_value=mock_message)
        mock_bot.get_channel = MagicMock(return_value=mock_channel)

        mock_bot.repository.get_unposted_content_items = AsyncMock(
            return_value=[sample_content_item]
        )

        mock_source = MagicMock()
        mock_source.type = SourceType.SUBSTACK
        mock_source.name = "Test Source"
        mock_bot.repository.get_source_by_id = AsyncMock(return_value=mock_source)
        mock_bot.repository.mark_content_item_posted = AsyncMock()
        mock_bot.repository.has_source_posted_content = AsyncMock(return_value=True)

        result = await content_poster.post_unposted_items(guild_id=123)

        assert result == 1
        mock_bot.repository.mark_content_item_posted.assert_called_once_with(
            content_id=sample_content_item.id,
            discord_message_id="789",
        )

    async def test_continues_on_http_exception(self, content_poster, mock_bot, sample_content_item):
        mock_config = MagicMock()
        mock_config.is_active = True
        mock_config.channel_id = "456"
        mock_bot.repository.get_discord_config = AsyncMock(return_value=mock_config)

        mock_channel = MagicMock(spec=discord.TextChannel)
        mock_response = MagicMock()
        mock_response.status = 500
        mock_channel.send = AsyncMock(
            side_effect=discord.HTTPException(mock_response, "Server Error")
        )
        mock_bot.get_channel = MagicMock(return_value=mock_channel)

        mock_bot.repository.get_unposted_content_items = AsyncMock(
            return_value=[sample_content_item]
        )

        mock_source = MagicMock()
        mock_source.type = SourceType.SUBSTACK
        mock_source.name = "Test Source"
        mock_bot.repository.get_source_by_id = AsyncMock(return_value=mock_source)
        mock_bot.repository.has_source_posted_content = AsyncMock(return_value=True)

        result = await content_poster.post_unposted_items(guild_id=123)

        assert result == 0

    async def test_skips_item_when_source_not_found(
        self, content_poster, mock_bot, sample_content_item
    ):
        mock_config = MagicMock()
        mock_config.is_active = True
        mock_config.channel_id = "456"
        mock_bot.repository.get_discord_config = AsyncMock(return_value=mock_config)

        mock_channel = MagicMock(spec=discord.TextChannel)
        mock_bot.get_channel = MagicMock(return_value=mock_channel)

        mock_bot.repository.get_unposted_content_items = AsyncMock(
            return_value=[sample_content_item]
        )
        mock_bot.repository.get_source_by_id = AsyncMock(return_value=None)
        mock_bot.repository.has_source_posted_content = AsyncMock(return_value=True)

        result = await content_poster.post_unposted_items(guild_id=123)

        assert result == 0


class TestTruncateSummaryAtBullet:
    def test_returns_unchanged_when_under_limit(self):
        summary = "Short summary"
        result = truncate_summary_at_bullet(summary, 100)
        assert result == summary

    def test_truncates_at_line_boundary(self):
        summary = "This is line one with more content here\nThis is line two with more text\nThis is line three with even more"
        result = truncate_summary_at_bullet(summary, 80)
        assert "This is line one" in result
        assert TRUNCATION_NOTICE.strip() in result
        assert "line three" not in result

    def test_preserves_complete_bullet_points(self):
        summary = """- **Point 1:** Description
  - Sub point A
  - Sub point B
- **Point 2:** Another description"""
        result = truncate_summary_at_bullet(summary, 60)
        assert "- **Point 1:**" in result
        assert TRUNCATION_NOTICE.strip() in result

    def test_backs_up_from_sub_bullet_to_parent(self):
        summary = """- **Point 1:** First point
  - Sub point A
  - Sub point B
- **Point 2:** Second point"""
        result = truncate_summary_at_bullet(summary, 70)
        assert "- **Point 1:**" in result
        assert TRUNCATION_NOTICE.strip() in result

    def test_fallback_truncation_when_no_lines_fit(self):
        summary = "A" * 200
        result = truncate_summary_at_bullet(summary, 50)
        assert len(result) <= 50
        assert TRUNCATION_NOTICE.strip() in result

    def test_handles_empty_summary(self):
        result = truncate_summary_at_bullet("", 100)
        assert result == ""

    def test_exact_limit_not_truncated(self):
        summary = "Exactly fits"
        result = truncate_summary_at_bullet(summary, len(summary))
        assert result == summary
        assert TRUNCATION_NOTICE not in result
