from datetime import UTC, datetime
from unittest.mock import AsyncMock, MagicMock, call, patch

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

    def test_format_message_handles_overhead_longer_than_limit(self, sample_content_item):
        poster = ContentPoster(MagicMock(), max_message_length=80)
        sample_content_item.title = "A very long title " * 12
        sample_content_item.summary = "Short summary"

        message = poster.format_message(
            content_item=sample_content_item,
            source_type=SourceType.RSS,
            source_name="Very long source name " * 6,
        )

        assert len(message) <= 80
        assert "RSS" in message

    def test_format_message_adds_notice_when_second_pass_truncates(self, sample_content_item):
        poster = ContentPoster(MagicMock(), max_message_length=120)
        sample_content_item.summary = "Original summary that is too long" * 20

        with patch(
            "intelstream.services.content_poster.truncate_summary_at_bullet",
            return_value="A" * 200,
        ):
            message = poster.format_message(
                content_item=sample_content_item,
                source_type=SourceType.RSS,
                source_name="Test RSS",
            )

        assert len(message) <= 120
        assert TRUNCATION_NOTICE.strip() in message


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
        assert call_kwargs["allowed_mentions"].everyone is False
        assert call_kwargs["allowed_mentions"].users is False
        assert call_kwargs["allowed_mentions"].roles is False
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

    async def test_post_content_skip_summary_sends_bare_url(
        self, content_poster, sample_content_item
    ):
        mock_channel = MagicMock(spec=discord.TextChannel)
        mock_message = MagicMock(spec=discord.Message)
        mock_message.id = 12345
        mock_channel.send = AsyncMock(return_value=mock_message)

        await content_poster.post_content(
            channel=mock_channel,
            content_item=sample_content_item,
            source_type=SourceType.YOUTUBE,
            source_name="Test",
            skip_summary=True,
        )

        call_kwargs = mock_channel.send.call_args.kwargs
        assert call_kwargs["content"] == sample_content_item.original_url

    async def test_post_content_skip_summary_no_url_raises(
        self, content_poster, sample_content_item
    ):
        sample_content_item.original_url = None
        mock_channel = MagicMock(spec=discord.TextChannel)

        with pytest.raises(ValueError, match="No URL available"):
            await content_poster.post_content(
                channel=mock_channel,
                content_item=sample_content_item,
                source_type=SourceType.YOUTUBE,
                source_name="Test",
                skip_summary=True,
            )

        mock_channel.send.assert_not_called()

    async def test_post_content_skip_summary_false_sends_formatted(
        self, content_poster, sample_content_item
    ):
        mock_channel = MagicMock(spec=discord.TextChannel)
        mock_message = MagicMock(spec=discord.Message)
        mock_message.id = 12345
        mock_channel.send = AsyncMock(return_value=mock_message)

        await content_poster.post_content(
            channel=mock_channel,
            content_item=sample_content_item,
            source_type=SourceType.YOUTUBE,
            source_name="Test",
            skip_summary=False,
        )

        call_kwargs = mock_channel.send.call_args.kwargs
        assert sample_content_item.title in call_kwargs["content"]
        assert sample_content_item.summary in call_kwargs["content"]


class TestContentPosterPostUnpostedItems:
    async def test_returns_zero_when_no_items(self, content_poster, mock_bot):
        mock_bot.repository.get_unposted_content_items = AsyncMock(return_value=[])

        result = await content_poster.post_unposted_items(guild_id=123)

        assert result == 0

    async def test_posts_to_source_channel(self, content_poster, mock_bot, sample_content_item):
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
        mock_source.skip_summary = False
        mock_source.guild_id = "123"
        mock_source.channel_id = "456"
        mock_bot.repository.get_sources_by_ids = AsyncMock(
            return_value={sample_content_item.source_id: mock_source}
        )
        mock_bot.repository.mark_content_item_posted = AsyncMock()

        result = await content_poster.post_unposted_items(guild_id=123)

        assert result == 1
        mock_bot.get_channel.assert_called_with(456)
        mock_bot.repository.mark_content_item_posted.assert_called_once_with(
            content_id=sample_content_item.id,
            discord_message_id="789",
        )

    async def test_posts_multiple_items_with_one_source_lookup(
        self, content_poster, mock_bot, sample_content_item
    ):
        second_item = MagicMock(spec=ContentItem)
        second_item.id = "second-item-id"
        second_item.title = "Second Article"
        second_item.summary = "Second summary"
        second_item.original_url = "https://example.com/second"
        second_item.author = "Second Author"
        second_item.source_id = sample_content_item.source_id

        first_message = MagicMock(spec=discord.Message)
        first_message.id = 101
        second_message = MagicMock(spec=discord.Message)
        second_message.id = 202
        mock_channel = MagicMock(spec=discord.TextChannel)
        mock_channel.send = AsyncMock(side_effect=[first_message, second_message])
        mock_bot.get_channel = MagicMock(return_value=mock_channel)

        mock_bot.repository.get_unposted_content_items = AsyncMock(
            return_value=[sample_content_item, second_item]
        )

        mock_source = MagicMock()
        mock_source.type = SourceType.SUBSTACK
        mock_source.name = "Shared Source"
        mock_source.skip_summary = False
        mock_source.guild_id = "123"
        mock_source.channel_id = "456"
        mock_bot.repository.get_sources_by_ids = AsyncMock(
            return_value={sample_content_item.source_id: mock_source}
        )
        mock_bot.repository.mark_content_item_posted = AsyncMock()

        result = await content_poster.post_unposted_items(guild_id=123)

        assert result == 2
        mock_bot.repository.get_sources_by_ids.assert_awaited_once_with(
            {sample_content_item.source_id}
        )
        assert mock_channel.send.await_count == 2
        mock_bot.repository.mark_content_item_posted.assert_has_awaits(
            [
                call(content_id=sample_content_item.id, discord_message_id="101"),
                call(content_id=second_item.id, discord_message_id="202"),
            ]
        )

    async def test_scans_past_unpostable_first_page(
        self, content_poster, mock_bot, sample_content_item
    ):
        blocked_items = []
        for index in range(10):
            item = MagicMock(spec=ContentItem)
            item.id = f"blocked-{index}"
            item.source_id = "blocked-source"
            item.published_at = datetime(2024, 1, index + 1, tzinfo=UTC)
            blocked_items.append(item)

        blocked_source = MagicMock()
        blocked_source.guild_id = "999"
        eligible_source = MagicMock()
        eligible_source.guild_id = "123"
        eligible_source.channel_id = "456"
        eligible_source.type = SourceType.RSS
        eligible_source.name = "Eligible"
        eligible_source.skip_summary = False

        message = MagicMock(spec=discord.Message)
        message.id = 777
        channel = MagicMock(spec=discord.TextChannel)
        channel.send = AsyncMock(return_value=message)
        mock_bot.get_channel = MagicMock(return_value=channel)
        mock_bot.repository.get_unposted_content_items = AsyncMock(
            side_effect=[blocked_items, [sample_content_item]]
        )
        mock_bot.repository.get_sources_by_ids = AsyncMock(
            side_effect=[
                {"blocked-source": blocked_source},
                {sample_content_item.source_id: eligible_source},
            ]
        )
        mock_bot.repository.mark_content_item_posted = AsyncMock()

        result = await content_poster.post_unposted_items(guild_id=123)

        assert result == 1
        assert mock_bot.repository.get_unposted_content_items.await_count == 2
        mock_bot.repository.mark_content_item_posted.assert_awaited_once_with(
            content_id=sample_content_item.id,
            discord_message_id="777",
        )

    async def test_falls_back_to_guild_config_when_no_source_channel(
        self, content_poster, mock_bot, sample_content_item
    ):
        mock_config = MagicMock()
        mock_config.is_active = True
        mock_config.channel_id = "999"
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
        mock_source.skip_summary = False
        mock_source.guild_id = None
        mock_source.channel_id = None
        mock_bot.repository.get_sources_by_ids = AsyncMock(
            return_value={sample_content_item.source_id: mock_source}
        )
        mock_bot.repository.mark_content_item_posted = AsyncMock()

        result = await content_poster.post_unposted_items(guild_id=123)

        assert result == 1
        mock_bot.get_channel.assert_called_with(999)

    async def test_skips_when_guild_config_inactive(
        self, content_poster, mock_bot, sample_content_item
    ):
        mock_config = MagicMock()
        mock_config.is_active = False
        mock_bot.repository.get_discord_config = AsyncMock(return_value=mock_config)
        mock_bot.repository.get_unposted_content_items = AsyncMock(
            return_value=[sample_content_item]
        )

        mock_source = MagicMock()
        mock_source.type = SourceType.SUBSTACK
        mock_source.name = "Test Source"
        mock_source.skip_summary = False
        mock_source.guild_id = None
        mock_source.channel_id = None
        mock_bot.repository.get_sources_by_ids = AsyncMock(
            return_value={sample_content_item.source_id: mock_source}
        )

        result = await content_poster.post_unposted_items(guild_id=123)

        assert result == 0
        mock_bot.get_channel.assert_not_called()

    async def test_posts_to_thread_channel(self, content_poster, mock_bot, sample_content_item):
        mock_channel = MagicMock(spec=discord.Thread)
        mock_message = MagicMock(spec=discord.Message)
        mock_message.id = 789
        mock_channel.send = AsyncMock(return_value=mock_message)
        mock_bot.get_channel = MagicMock(return_value=mock_channel)
        mock_bot.repository.get_unposted_content_items = AsyncMock(
            return_value=[sample_content_item]
        )

        mock_source = MagicMock()
        mock_source.type = SourceType.RSS
        mock_source.name = "Thread Source"
        mock_source.skip_summary = False
        mock_source.guild_id = "123"
        mock_source.channel_id = "456"
        mock_bot.repository.get_sources_by_ids = AsyncMock(
            return_value={sample_content_item.source_id: mock_source}
        )
        mock_bot.repository.mark_content_item_posted = AsyncMock()

        result = await content_poster.post_unposted_items(guild_id=123)

        assert result == 1
        mock_channel.send.assert_awaited_once()
        mock_bot.repository.mark_content_item_posted.assert_awaited_once()

    async def test_skips_item_from_different_guild(
        self, content_poster, mock_bot, sample_content_item
    ):
        mock_bot.repository.get_unposted_content_items = AsyncMock(
            return_value=[sample_content_item]
        )

        mock_source = MagicMock()
        mock_source.type = SourceType.SUBSTACK
        mock_source.name = "Test Source"
        mock_source.skip_summary = False
        mock_source.guild_id = "999"
        mock_source.channel_id = "456"
        mock_bot.repository.get_sources_by_ids = AsyncMock(
            return_value={sample_content_item.source_id: mock_source}
        )

        result = await content_poster.post_unposted_items(guild_id=123)

        assert result == 0

    async def test_skips_when_no_channel_and_no_config(
        self, content_poster, mock_bot, sample_content_item
    ):
        mock_bot.repository.get_discord_config = AsyncMock(return_value=None)

        mock_bot.repository.get_unposted_content_items = AsyncMock(
            return_value=[sample_content_item]
        )

        mock_source = MagicMock()
        mock_source.type = SourceType.SUBSTACK
        mock_source.name = "Test Source"
        mock_source.skip_summary = False
        mock_source.guild_id = None
        mock_source.channel_id = None
        mock_bot.repository.get_sources_by_ids = AsyncMock(
            return_value={sample_content_item.source_id: mock_source}
        )

        result = await content_poster.post_unposted_items(guild_id=123)

        assert result == 0

    async def test_skips_when_channel_not_found(
        self, content_poster, mock_bot, sample_content_item
    ):
        mock_bot.get_channel = MagicMock(return_value=None)

        mock_bot.repository.get_unposted_content_items = AsyncMock(
            return_value=[sample_content_item]
        )

        mock_source = MagicMock()
        mock_source.type = SourceType.SUBSTACK
        mock_source.name = "Test Source"
        mock_source.skip_summary = False
        mock_source.guild_id = "123"
        mock_source.channel_id = "456"
        mock_bot.repository.get_sources_by_ids = AsyncMock(
            return_value={sample_content_item.source_id: mock_source}
        )

        result = await content_poster.post_unposted_items(guild_id=123)

        assert result == 0

    async def test_continues_on_http_exception(self, content_poster, mock_bot, sample_content_item):
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
        mock_source.skip_summary = False
        mock_source.guild_id = "123"
        mock_source.channel_id = "456"
        mock_bot.repository.get_sources_by_ids = AsyncMock(
            return_value={sample_content_item.source_id: mock_source}
        )

        result = await content_poster.post_unposted_items(guild_id=123)

        assert result == 0

    async def test_continues_on_unexpected_posting_error(
        self, content_poster, mock_bot, sample_content_item
    ):
        sample_content_item.original_url = None
        mock_bot.repository.get_unposted_content_items = AsyncMock(
            return_value=[sample_content_item]
        )

        mock_source = MagicMock()
        mock_source.type = SourceType.YOUTUBE
        mock_source.name = "URL Only Source"
        mock_source.skip_summary = True
        mock_source.guild_id = "123"
        mock_source.channel_id = "456"
        mock_bot.repository.get_sources_by_ids = AsyncMock(
            return_value={sample_content_item.source_id: mock_source}
        )
        mock_bot.get_channel = MagicMock(return_value=MagicMock(spec=discord.TextChannel))
        mock_bot.repository.mark_content_item_posted = AsyncMock()

        result = await content_poster.post_unposted_items(guild_id=123)

        assert result == 0
        mock_bot.repository.mark_content_item_posted.assert_not_awaited()

    async def test_skips_item_when_source_not_found(
        self, content_poster, mock_bot, sample_content_item
    ):
        mock_bot.repository.get_unposted_content_items = AsyncMock(
            return_value=[sample_content_item]
        )
        mock_bot.repository.get_sources_by_ids = AsyncMock(return_value={})

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

    def test_fallback_truncation_when_split_produces_no_lines(self):
        class SplitlessSummary(str):
            def __len__(self) -> int:
                return 200

            def split(self, *_args: object, **_kwargs: object) -> list[str]:
                return []

        result = truncate_summary_at_bullet(SplitlessSummary("A" * 200), 50)

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

    def test_removes_orphan_sub_bullet_without_parent(self):
        summary = """Some intro text
  - Sub point without parent
  - Another sub point
- **Point 1:** First point"""
        result = truncate_summary_at_bullet(summary, 70)
        assert "Some intro text" in result
        assert "Sub point without parent" not in result
        assert TRUNCATION_NOTICE.strip() in result
