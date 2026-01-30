from datetime import UTC, datetime
from unittest.mock import AsyncMock, MagicMock, patch

import discord
import pytest

from intelstream.discord.cogs.summarize import Summarize
from intelstream.services.web_fetcher import WebContent, WebFetchError


@pytest.fixture
def mock_bot():
    bot = MagicMock()
    bot.settings = MagicMock()
    bot.settings.anthropic_api_key = "test-api-key"
    bot.settings.youtube_api_key = "test-youtube-key"
    bot.settings.http_timeout_seconds = 30.0
    bot.settings.summary_model_interactive = "claude-sonnet-4-20250514"
    bot.settings.summary_max_tokens = 2048
    bot.settings.summary_max_input_length = 100000
    return bot


@pytest.fixture
def summarize_cog(mock_bot):
    cog = Summarize(mock_bot)
    cog._summarizer = MagicMock()
    cog._summarizer.summarize = AsyncMock(return_value="This is a test summary.")
    cog._http_client = MagicMock()
    return cog


@pytest.fixture
def mock_interaction():
    interaction = MagicMock(spec=discord.Interaction)
    interaction.response = MagicMock()
    interaction.response.defer = AsyncMock()
    interaction.followup = MagicMock()
    interaction.followup.send = AsyncMock()
    interaction.user = MagicMock()
    interaction.user.id = 12345
    return interaction


class TestDetectUrlType:
    def test_detect_youtube_com(self, summarize_cog):
        assert summarize_cog.detect_url_type("https://www.youtube.com/watch?v=abc123") == "youtube"
        assert summarize_cog.detect_url_type("https://youtube.com/watch?v=abc123") == "youtube"

    def test_detect_youtu_be(self, summarize_cog):
        assert summarize_cog.detect_url_type("https://youtu.be/abc123") == "youtube"

    def test_detect_substack(self, summarize_cog):
        assert summarize_cog.detect_url_type("https://example.substack.com/p/article") == "substack"
        assert summarize_cog.detect_url_type("https://newsletter.substack.com/p/post") == "substack"

    def test_detect_twitter(self, summarize_cog):
        assert summarize_cog.detect_url_type("https://twitter.com/user/status/123") == "twitter"
        assert summarize_cog.detect_url_type("https://x.com/user/status/123") == "twitter"

    def test_detect_generic_web(self, summarize_cog):
        assert summarize_cog.detect_url_type("https://example.com/article") == "web"
        assert summarize_cog.detect_url_type("https://nytimes.com/2024/article") == "web"
        assert summarize_cog.detect_url_type("https://blog.example.org/post") == "web"


class TestExtractYoutubeVideoId:
    def test_extract_from_watch_url(self, summarize_cog):
        url = "https://www.youtube.com/watch?v=dQw4w9WgXcQ"
        assert summarize_cog._extract_youtube_video_id(url) == "dQw4w9WgXcQ"

    def test_extract_from_short_url(self, summarize_cog):
        url = "https://youtu.be/dQw4w9WgXcQ"
        assert summarize_cog._extract_youtube_video_id(url) == "dQw4w9WgXcQ"

    def test_extract_from_embed_url(self, summarize_cog):
        url = "https://www.youtube.com/embed/dQw4w9WgXcQ"
        assert summarize_cog._extract_youtube_video_id(url) == "dQw4w9WgXcQ"

    def test_extract_returns_none_for_invalid(self, summarize_cog):
        url = "https://example.com/not-a-video"
        assert summarize_cog._extract_youtube_video_id(url) is None


class TestCreateSummaryEmbed:
    def test_creates_embed_with_all_fields(self, summarize_cog):
        embed = summarize_cog.create_summary_embed(
            url="https://example.com/article",
            title="Test Article",
            summary="This is a test summary.",
            source_type="web",
            author="John Doe",
            thumbnail_url="https://example.com/image.jpg",
            published_at=datetime(2024, 1, 15, 12, 0, 0, tzinfo=UTC),
        )

        assert isinstance(embed, discord.Embed)
        assert embed.title == "Test Article"
        assert embed.url == "https://example.com/article"
        assert embed.description == "This is a test summary."
        assert embed.author.name == "John Doe"

    def test_creates_embed_without_optional_fields(self, summarize_cog):
        embed = summarize_cog.create_summary_embed(
            url="https://example.com/article",
            title="Test Article",
            summary="This is a test summary.",
            source_type="web",
        )

        assert isinstance(embed, discord.Embed)
        assert embed.title == "Test Article"
        assert embed.author.name is None

    def test_truncates_long_title(self, summarize_cog):
        long_title = "A" * 300

        embed = summarize_cog.create_summary_embed(
            url="https://example.com/article",
            title=long_title,
            summary="Summary",
            source_type="web",
        )

        assert len(embed.title) == 256
        assert embed.title.endswith("...")

    def test_truncates_long_summary(self, summarize_cog):
        long_summary = "A" * 5000

        embed = summarize_cog.create_summary_embed(
            url="https://example.com/article",
            title="Title",
            summary=long_summary,
            source_type="web",
        )

        assert len(embed.description) == 4096
        assert embed.description.endswith("...")

    def test_sets_youtube_color(self, summarize_cog):
        embed = summarize_cog.create_summary_embed(
            url="https://youtube.com/watch?v=test",
            title="Video",
            summary="Summary",
            source_type="youtube",
        )

        assert embed.color == discord.Color.red()

    def test_sets_substack_color(self, summarize_cog):
        embed = summarize_cog.create_summary_embed(
            url="https://example.substack.com/p/post",
            title="Article",
            summary="Summary",
            source_type="substack",
        )

        assert embed.color == discord.Color.from_rgb(255, 103, 25)

    def test_sets_web_color(self, summarize_cog):
        embed = summarize_cog.create_summary_embed(
            url="https://example.com/article",
            title="Article",
            summary="Summary",
            source_type="web",
        )

        assert embed.color == discord.Color.blue()

    def test_sets_domain_as_footer_for_web(self, summarize_cog):
        embed = summarize_cog.create_summary_embed(
            url="https://example.com/article",
            title="Article",
            summary="Summary",
            source_type="web",
        )

        assert embed.footer.text == "example.com"

    def test_sets_youtube_footer(self, summarize_cog):
        embed = summarize_cog.create_summary_embed(
            url="https://youtube.com/watch?v=test",
            title="Video",
            summary="Summary",
            source_type="youtube",
        )

        assert embed.footer.text == "YouTube"

    def test_sets_image_when_thumbnail_provided(self, summarize_cog):
        embed = summarize_cog.create_summary_embed(
            url="https://example.com/article",
            title="Article",
            summary="Summary",
            source_type="web",
            thumbnail_url="https://example.com/image.jpg",
        )

        assert embed.image.url == "https://example.com/image.jpg"


class TestSummarizeCommand:
    async def test_rejects_invalid_url(self, summarize_cog, mock_interaction):
        await summarize_cog.summarize.callback(summarize_cog, mock_interaction, "not-a-url")

        mock_interaction.followup.send.assert_called_once()
        call_args = mock_interaction.followup.send.call_args
        assert "valid URL" in call_args[0][0]
        assert call_args[1]["ephemeral"] is True

    async def test_rejects_non_http_url(self, summarize_cog, mock_interaction):
        await summarize_cog.summarize.callback(
            summarize_cog, mock_interaction, "ftp://example.com/file"
        )

        mock_interaction.followup.send.assert_called_once()
        call_args = mock_interaction.followup.send.call_args
        assert "HTTP" in call_args[0][0]
        assert call_args[1]["ephemeral"] is True

    async def test_rejects_twitter_url(self, summarize_cog, mock_interaction):
        await summarize_cog.summarize.callback(
            summarize_cog, mock_interaction, "https://twitter.com/user/status/123"
        )

        mock_interaction.followup.send.assert_called_once()
        call_args = mock_interaction.followup.send.call_args
        assert "not supported" in call_args[0][0]
        assert call_args[1]["ephemeral"] is True

    async def test_handles_fetch_error(self, summarize_cog, mock_interaction):
        with patch.object(
            summarize_cog, "_fetch_web_content", AsyncMock(side_effect=WebFetchError("Test error"))
        ):
            await summarize_cog.summarize.callback(
                summarize_cog, mock_interaction, "https://example.com/article"
            )

        mock_interaction.followup.send.assert_called_once()
        call_args = mock_interaction.followup.send.call_args
        assert "Test error" in call_args[0][0]
        assert call_args[1]["ephemeral"] is True

    async def test_handles_insufficient_content(self, summarize_cog, mock_interaction):
        mock_content = WebContent(
            url="https://example.com/article",
            title="Short Article",
            content="Too short",
        )

        with patch.object(
            summarize_cog, "_fetch_web_content", AsyncMock(return_value=mock_content)
        ):
            await summarize_cog.summarize.callback(
                summarize_cog, mock_interaction, "https://example.com/article"
            )

        mock_interaction.followup.send.assert_called_once()
        call_args = mock_interaction.followup.send.call_args
        assert "enough content" in call_args[0][0]
        assert call_args[1]["ephemeral"] is True

    async def test_successful_web_summarization(self, summarize_cog, mock_interaction):
        mock_content = WebContent(
            url="https://example.com/article",
            title="Test Article",
            content="This is enough content for summarization. " * 10,
            author="John Doe",
        )

        with patch.object(
            summarize_cog, "_fetch_web_content", AsyncMock(return_value=mock_content)
        ):
            await summarize_cog.summarize.callback(
                summarize_cog, mock_interaction, "https://example.com/article"
            )

        mock_interaction.response.defer.assert_called_once()
        mock_interaction.followup.send.assert_called_once()

        call_kwargs = mock_interaction.followup.send.call_args[1]
        assert "embed" in call_kwargs
        embed = call_kwargs["embed"]
        assert embed.title == "Test Article"
        assert embed.description == "This is a test summary."

    async def test_defers_response(self, summarize_cog, mock_interaction):
        mock_content = WebContent(
            url="https://example.com/article",
            title="Test Article",
            content="This is enough content for summarization. " * 10,
        )

        with patch.object(
            summarize_cog, "_fetch_web_content", AsyncMock(return_value=mock_content)
        ):
            await summarize_cog.summarize.callback(
                summarize_cog, mock_interaction, "https://example.com/article"
            )

        mock_interaction.response.defer.assert_called_once()

    async def test_routes_youtube_url_correctly(self, summarize_cog, mock_interaction):
        mock_content = WebContent(
            url="https://youtube.com/watch?v=test",
            title="Test Video",
            content="Video transcript content. " * 10,
            author="Channel Name",
        )

        with patch.object(
            summarize_cog, "_fetch_youtube_content", AsyncMock(return_value=mock_content)
        ) as mock_fetch:
            await summarize_cog.summarize.callback(
                summarize_cog, mock_interaction, "https://youtube.com/watch?v=test"
            )

            mock_fetch.assert_called_once_with("https://youtube.com/watch?v=test")

    async def test_routes_substack_url_correctly(self, summarize_cog, mock_interaction):
        mock_content = WebContent(
            url="https://example.substack.com/p/article",
            title="Test Article",
            content="Article content here. " * 10,
            author="Author Name",
        )

        with patch.object(
            summarize_cog, "_fetch_substack_content", AsyncMock(return_value=mock_content)
        ) as mock_fetch:
            await summarize_cog.summarize.callback(
                summarize_cog, mock_interaction, "https://example.substack.com/p/article"
            )

            mock_fetch.assert_called_once_with("https://example.substack.com/p/article")

    async def test_handles_summarization_error(self, summarize_cog, mock_interaction):
        mock_content = WebContent(
            url="https://example.com/article",
            title="Test Article",
            content="This is enough content for summarization. " * 10,
        )

        summarize_cog._summarizer.summarize = AsyncMock(side_effect=Exception("API Error"))

        with patch.object(
            summarize_cog, "_fetch_web_content", AsyncMock(return_value=mock_content)
        ):
            await summarize_cog.summarize.callback(
                summarize_cog, mock_interaction, "https://example.com/article"
            )

        call_args = mock_interaction.followup.send.call_args
        assert "Failed to generate summary" in call_args[0][0]
        assert call_args[1]["ephemeral"] is True


class TestCogLifecycle:
    async def test_cog_load_initializes_http_client(self, mock_bot):
        cog = Summarize(mock_bot)
        assert cog._http_client is None

        await cog.cog_load()

        assert cog._http_client is not None
        assert cog._summarizer is not None

        await cog.cog_unload()

    async def test_cog_unload_closes_http_client(self, mock_bot):
        cog = Summarize(mock_bot)
        await cog.cog_load()

        mock_client = MagicMock()
        mock_client.aclose = AsyncMock()
        cog._http_client = mock_client

        await cog.cog_unload()

        mock_client.aclose.assert_called_once()
