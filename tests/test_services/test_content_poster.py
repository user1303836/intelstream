from datetime import UTC, datetime
from unittest.mock import AsyncMock, MagicMock

import discord
import pytest

from intelstream.database.models import ContentItem, SourceType
from intelstream.services.content_poster import (
    MAX_EMBED_DESCRIPTION,
    MAX_EMBED_TITLE,
    SOURCE_TYPE_COLORS,
    SOURCE_TYPE_LABELS,
    TRUNCATION_NOTICE,
    ContentPoster,
    truncate_summary_at_bullet,
)


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


class TestContentPosterFormatEmbed:
    def test_format_embed_returns_embed(self, content_poster, sample_content_item):
        embed = content_poster.format_embed(
            content_item=sample_content_item,
            source_type=SourceType.SUBSTACK,
            source_name="Test Substack",
        )

        assert isinstance(embed, discord.Embed)

    def test_format_embed_has_title(self, content_poster, sample_content_item):
        embed = content_poster.format_embed(
            content_item=sample_content_item,
            source_type=SourceType.SUBSTACK,
            source_name="Test Substack",
        )

        assert embed.title == sample_content_item.title

    def test_format_embed_title_is_clickable_link(self, content_poster, sample_content_item):
        embed = content_poster.format_embed(
            content_item=sample_content_item,
            source_type=SourceType.SUBSTACK,
            source_name="Test Substack",
        )

        assert embed.url == sample_content_item.original_url

    def test_format_embed_has_summary_in_description(self, content_poster, sample_content_item):
        embed = content_poster.format_embed(
            content_item=sample_content_item,
            source_type=SourceType.SUBSTACK,
            source_name="Test Substack",
        )

        assert embed.description == sample_content_item.summary

    def test_format_embed_has_author(self, content_poster, sample_content_item):
        embed = content_poster.format_embed(
            content_item=sample_content_item,
            source_type=SourceType.SUBSTACK,
            source_name="Test Substack",
        )

        assert embed.author.name == sample_content_item.author

    def test_format_embed_without_author(self, content_poster, sample_content_item):
        sample_content_item.author = None

        embed = content_poster.format_embed(
            content_item=sample_content_item,
            source_type=SourceType.SUBSTACK,
            source_name="Test Substack",
        )

        assert embed.author.name is None

    def test_format_embed_has_source_footer(self, content_poster, sample_content_item):
        embed = content_poster.format_embed(
            content_item=sample_content_item,
            source_type=SourceType.SUBSTACK,
            source_name="My Newsletter",
        )

        assert embed.footer.text == "Substack | My Newsletter"

    def test_format_embed_has_color_per_source_type(self, content_poster, sample_content_item):
        for source_type, expected_color in SOURCE_TYPE_COLORS.items():
            embed = content_poster.format_embed(
                content_item=sample_content_item,
                source_type=source_type,
                source_name="Test",
            )
            assert embed.color == expected_color

    def test_format_embed_has_thumbnail(self, content_poster, sample_content_item):
        embed = content_poster.format_embed(
            content_item=sample_content_item,
            source_type=SourceType.YOUTUBE,
            source_name="Test",
        )

        assert embed.image.url == sample_content_item.thumbnail_url

    def test_format_embed_no_thumbnail_when_none(self, content_poster, sample_content_item):
        sample_content_item.thumbnail_url = None

        embed = content_poster.format_embed(
            content_item=sample_content_item,
            source_type=SourceType.SUBSTACK,
            source_name="Test",
        )

        assert embed.image.url is None

    def test_format_embed_has_timestamp(self, content_poster, sample_content_item):
        embed = content_poster.format_embed(
            content_item=sample_content_item,
            source_type=SourceType.SUBSTACK,
            source_name="Test",
        )

        assert embed.timestamp == sample_content_item.published_at

    def test_format_embed_without_summary(self, content_poster, sample_content_item):
        sample_content_item.summary = None

        embed = content_poster.format_embed(
            content_item=sample_content_item,
            source_type=SourceType.SUBSTACK,
            source_name="Test Substack",
        )

        assert embed.description == "No summary available."

    def test_format_embed_truncates_long_title(self, content_poster, sample_content_item):
        sample_content_item.title = "A" * 300

        embed = content_poster.format_embed(
            content_item=sample_content_item,
            source_type=SourceType.RSS,
            source_name="Test",
        )

        assert len(embed.title) <= MAX_EMBED_TITLE
        assert embed.title.endswith("...")

    def test_format_embed_truncates_long_description(self, content_poster, sample_content_item):
        sample_content_item.summary = "A" * (MAX_EMBED_DESCRIPTION + 500)

        embed = content_poster.format_embed(
            content_item=sample_content_item,
            source_type=SourceType.RSS,
            source_name="Test",
        )

        assert len(embed.description) <= MAX_EMBED_DESCRIPTION
        assert TRUNCATION_NOTICE.strip() in embed.description

    def test_format_embed_url_none_when_no_url(self, content_poster, sample_content_item):
        sample_content_item.original_url = None

        embed = content_poster.format_embed(
            content_item=sample_content_item,
            source_type=SourceType.SUBSTACK,
            source_name="Test",
        )

        assert embed.url is None

    def test_format_embed_source_labels_in_footer(self, content_poster, sample_content_item):
        for source_type, expected_label in SOURCE_TYPE_LABELS.items():
            embed = content_poster.format_embed(
                content_item=sample_content_item,
                source_type=source_type,
                source_name="Test",
            )
            assert embed.footer.text == f"{expected_label} | Test"

    def test_format_embed_unknown_source_type(self, content_poster, sample_content_item):
        unknown_type = MagicMock()
        unknown_type.value = "unknown"

        embed = content_poster.format_embed(
            content_item=sample_content_item,
            source_type=unknown_type,
            source_name="Test",
        )

        assert embed.footer.text == "Unknown | Test"
        assert embed.color == discord.Color.greyple()


class TestContentPosterPostContent:
    async def test_post_content_sends_embed(self, content_poster, sample_content_item):
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
        assert "embed" in call_kwargs
        assert isinstance(call_kwargs["embed"], discord.Embed)
        assert result == mock_message

    async def test_post_content_embed_contains_item_info(self, content_poster, sample_content_item):
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
        embed = call_kwargs["embed"]
        assert embed.title == sample_content_item.title
        assert embed.description == sample_content_item.summary

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

    async def test_post_content_skip_summary_false_sends_embed(
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
        assert "embed" in call_kwargs
        assert isinstance(call_kwargs["embed"], discord.Embed)


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
