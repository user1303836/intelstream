from datetime import UTC, datetime
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

import discord
import pytest
from youtube_transcript_api._errors import (
    NoTranscriptFound,
    TranscriptsDisabled,
    VideoUnavailable,
)

from intelstream.discord.cogs.summarize import Summarize, setup
from intelstream.services.web_fetcher import WebContent, WebFetchError


@pytest.fixture
def mock_bot():
    bot = MagicMock()
    bot.settings = MagicMock()
    bot.settings.llm_provider = "anthropic"
    bot.settings.llm_api_key = "test-api-key"
    bot.settings.youtube_api_key = "test-youtube-key"
    bot.settings.http_timeout_seconds = 30.0
    bot.settings.summary_model_interactive = "claude-sonnet-4-6"
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

    def test_is_substack_url(self, summarize_cog):
        assert summarize_cog._is_substack_url("https://example.substack.com/p/post") is True
        assert summarize_cog._is_substack_url("https://example.com/p/post") is False


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

    def test_extract_from_v_url(self, summarize_cog):
        url = "https://www.youtube.com/v/dQw4w9WgXcQ"
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

    def test_unknown_source_type_uses_default_color_and_footer(self, summarize_cog):
        embed = summarize_cog.create_summary_embed(
            url="https://example.com/article",
            title="Article",
            summary="Summary",
            source_type="mystery",
        )

        assert embed.color == discord.Color.greyple()
        assert embed.footer.text == "Web"


class TestFetchYoutubeContent:
    async def test_fetch_youtube_requires_video_id(self, summarize_cog):
        with pytest.raises(WebFetchError, match="video ID"):
            await summarize_cog._fetch_youtube_content("https://youtube.com/watch")

    async def test_fetch_youtube_requires_api_key(self, summarize_cog, mock_bot):
        mock_bot.settings.youtube_api_key = None

        with pytest.raises(WebFetchError, match="API key"):
            await summarize_cog._fetch_youtube_content("https://youtube.com/watch?v=dQw4w9WgXcQ")

    async def test_fetch_youtube_reports_missing_video(self, summarize_cog):
        with (
            patch("intelstream.discord.cogs.summarize.build"),
            patch(
                "intelstream.discord.cogs.summarize.asyncio.to_thread",
                AsyncMock(return_value={"items": []}),
            ),
            pytest.raises(WebFetchError, match="Video not found"),
        ):
            await summarize_cog._fetch_youtube_content("https://youtube.com/watch?v=dQw4w9WgXcQ")

    async def test_fetch_youtube_uses_description_when_transcript_missing(self, summarize_cog):
        response = {
            "items": [
                {
                    "snippet": {
                        "title": "Video Title",
                        "channelTitle": "Channel",
                        "publishedAt": "2026-05-25T12:30:00Z",
                        "description": "Description fallback",
                        "thumbnails": {
                            "medium": {"url": "https://example.com/medium.jpg"},
                            "high": {"url": "https://example.com/high.jpg"},
                        },
                    }
                }
            ]
        }

        with (
            patch("intelstream.discord.cogs.summarize.build") as build,
            patch(
                "intelstream.discord.cogs.summarize.asyncio.to_thread",
                AsyncMock(return_value=response),
            ),
            patch.object(summarize_cog, "_fetch_youtube_transcript", AsyncMock(return_value=None)),
        ):
            content = await summarize_cog._fetch_youtube_content(
                "https://youtube.com/watch?v=dQw4w9WgXcQ"
            )

        build.assert_called_once_with("youtube", "v3", developerKey="test-youtube-key")
        assert content.title == "Video Title"
        assert content.author == "Channel"
        assert content.content == "Description fallback"
        assert content.thumbnail_url == "https://example.com/high.jpg"
        assert content.published_at == datetime(2026, 5, 25, 12, 30, tzinfo=UTC)

    async def test_fetch_youtube_uses_transcript_when_available(self, summarize_cog):
        response = {
            "items": [
                {
                    "snippet": {
                        "title": "Video Title",
                        "description": "Description fallback",
                        "thumbnails": {},
                    }
                }
            ]
        }

        with (
            patch("intelstream.discord.cogs.summarize.build"),
            patch(
                "intelstream.discord.cogs.summarize.asyncio.to_thread",
                AsyncMock(return_value=response),
            ),
            patch.object(
                summarize_cog,
                "_fetch_youtube_transcript",
                AsyncMock(return_value="Transcript text"),
            ),
        ):
            content = await summarize_cog._fetch_youtube_content(
                "https://youtube.com/watch?v=dQw4w9WgXcQ"
            )

        assert content.content == "Transcript text"


class TestFetchYoutubeTranscript:
    async def test_fetch_transcript_uses_manual_transcript(self, summarize_cog):
        transcript = MagicMock()
        transcript.fetch.return_value = [
            SimpleNamespace(text="Manual"),
            SimpleNamespace(text="transcript"),
        ]
        transcript_list = MagicMock()
        transcript_list.find_manually_created_transcript.return_value = transcript
        api = MagicMock()
        api.list.return_value = transcript_list

        with patch("intelstream.discord.cogs.summarize.YouTubeTranscriptApi", return_value=api):
            result = await summarize_cog._fetch_youtube_transcript("video-id")

        assert result == "Manual transcript"
        transcript_list.find_manually_created_transcript.assert_called_once_with(["en"])

    async def test_fetch_transcript_falls_back_to_generated_transcript(self, summarize_cog):
        generated = MagicMock()
        generated.fetch.return_value = [SimpleNamespace(text="Generated transcript")]
        transcript_list = MagicMock()
        transcript_list.find_manually_created_transcript.side_effect = NoTranscriptFound(
            "video-id", ["en"], []
        )
        transcript_list.find_generated_transcript.return_value = generated
        api = MagicMock()
        api.list.return_value = transcript_list

        with patch("intelstream.discord.cogs.summarize.YouTubeTranscriptApi", return_value=api):
            result = await summarize_cog._fetch_youtube_transcript("video-id")

        assert result == "Generated transcript"

    async def test_fetch_transcript_translates_first_available_transcript(self, summarize_cog):
        translated = MagicMock()
        translated.fetch.return_value = [SimpleNamespace(text="Translated transcript")]
        foreign = MagicMock()
        foreign.language_code = "es"
        foreign.translate.return_value = translated

        class TranscriptList:
            def find_manually_created_transcript(self, _languages):
                raise NoTranscriptFound("video-id", ["en"], [])

            def find_generated_transcript(self, _languages):
                raise NoTranscriptFound("video-id", ["en"], [])

            def __iter__(self):
                return iter([foreign])

        api = MagicMock()
        api.list.return_value = TranscriptList()

        with patch("intelstream.discord.cogs.summarize.YouTubeTranscriptApi", return_value=api):
            result = await summarize_cog._fetch_youtube_transcript("video-id")

        assert result == "Translated transcript"
        foreign.translate.assert_called_once_with("en")

    async def test_fetch_transcript_returns_first_available_english_transcript(self, summarize_cog):
        english = MagicMock()
        english.language_code = "en"
        english.fetch.return_value = [SimpleNamespace(text="English transcript")]

        class TranscriptList:
            def find_manually_created_transcript(self, _languages):
                raise NoTranscriptFound("video-id", ["en"], [])

            def find_generated_transcript(self, _languages):
                raise NoTranscriptFound("video-id", ["en"], [])

            def __iter__(self):
                return iter([english])

        api = MagicMock()
        api.list.return_value = TranscriptList()

        with patch("intelstream.discord.cogs.summarize.YouTubeTranscriptApi", return_value=api):
            result = await summarize_cog._fetch_youtube_transcript("video-id")

        assert result == "English transcript"
        english.translate.assert_not_called()

    async def test_fetch_transcript_returns_none_when_no_transcripts_exist(self, summarize_cog):
        class TranscriptList:
            def find_manually_created_transcript(self, _languages):
                raise NoTranscriptFound("video-id", ["en"], [])

            def find_generated_transcript(self, _languages):
                raise NoTranscriptFound("video-id", ["en"], [])

            def __iter__(self):
                return iter([])

        api = MagicMock()
        api.list.return_value = TranscriptList()

        with patch("intelstream.discord.cogs.summarize.YouTubeTranscriptApi", return_value=api):
            assert await summarize_cog._fetch_youtube_transcript("video-id") is None

    @pytest.mark.parametrize(
        "error",
        [TranscriptsDisabled("video-id"), VideoUnavailable("video-id")],
    )
    async def test_fetch_transcript_returns_none_for_expected_transcript_errors(
        self, summarize_cog, error
    ):
        api = MagicMock()
        api.list.side_effect = error

        with patch("intelstream.discord.cogs.summarize.YouTubeTranscriptApi", return_value=api):
            assert await summarize_cog._fetch_youtube_transcript("video-id") is None

    async def test_fetch_transcript_returns_none_for_unexpected_error(self, summarize_cog):
        api = MagicMock()
        api.list.side_effect = RuntimeError("boom")

        with patch("intelstream.discord.cogs.summarize.YouTubeTranscriptApi", return_value=api):
            assert await summarize_cog._fetch_youtube_transcript("video-id") is None


class TestFetchSubstackContent:
    async def test_fetch_substack_rejects_non_article_url(self, summarize_cog):
        with pytest.raises(WebFetchError, match="Invalid Substack article URL"):
            await summarize_cog._fetch_substack_content("https://example.substack.com/about")

    async def test_fetch_substack_returns_matching_feed_item(self, summarize_cog):
        item = MagicMock()
        item.original_url = "https://example.substack.com/p/article"
        item.title = "Article"
        item.raw_content = "Article body"
        item.author = "Author"
        item.thumbnail_url = "https://example.com/image.jpg"
        item.published_at = datetime(2026, 5, 25, tzinfo=UTC)
        adapter = MagicMock()
        adapter.fetch_latest = AsyncMock(return_value=[item])

        with patch("intelstream.discord.cogs.summarize.SubstackAdapter", return_value=adapter):
            content = await summarize_cog._fetch_substack_content(
                "https://example.substack.com/p/article"
            )

        adapter.fetch_latest.assert_awaited_once_with("example.substack.com")
        assert content.title == "Article"
        assert content.content == "Article body"
        assert content.author == "Author"

    async def test_fetch_substack_matches_url_containment_and_empty_content(self, summarize_cog):
        miss = MagicMock()
        miss.original_url = "https://example.substack.com/p/other"
        hit = MagicMock()
        hit.original_url = "https://example.substack.com/p/article?utm_source=feed"
        hit.title = "Article"
        hit.raw_content = None
        hit.author = "Author"
        hit.thumbnail_url = None
        hit.published_at = datetime(2026, 5, 25, tzinfo=UTC)
        adapter = MagicMock()
        adapter.fetch_latest = AsyncMock(return_value=[miss, hit])

        with patch("intelstream.discord.cogs.summarize.SubstackAdapter", return_value=adapter):
            content = await summarize_cog._fetch_substack_content(
                "https://example.substack.com/p/article"
            )

        assert content.url == hit.original_url
        assert content.content == ""

    async def test_fetch_substack_reports_missing_article(self, summarize_cog):
        adapter = MagicMock()
        adapter.fetch_latest = AsyncMock(return_value=[])

        with (
            patch("intelstream.discord.cogs.summarize.SubstackAdapter", return_value=adapter),
            pytest.raises(WebFetchError, match="Could not find the article"),
        ):
            await summarize_cog._fetch_substack_content("https://example.substack.com/p/missing")


class TestFetchWebContent:
    async def test_fetch_web_content_uses_web_fetcher(self, summarize_cog):
        fetcher = MagicMock()
        fetcher.fetch = AsyncMock(
            return_value=WebContent(url="https://example.com", title="T", content="Body")
        )

        with patch("intelstream.discord.cogs.summarize.WebFetcher", return_value=fetcher):
            content = await summarize_cog._fetch_web_content("https://example.com")

        fetcher.fetch.assert_awaited_once_with("https://example.com")
        assert content.title == "T"


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

    async def test_rejects_unsafe_url(self, summarize_cog, mock_interaction):
        with patch(
            "intelstream.discord.cogs.summarize.is_safe_url",
            return_value=(False, "private network target"),
        ):
            await summarize_cog.summarize.callback(
                summarize_cog, mock_interaction, "https://example.com/article"
            )

        call_args = mock_interaction.followup.send.call_args
        assert "private network target" in call_args[0][0]
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
            summarize_cog,
            "_fetch_web_content",
            AsyncMock(side_effect=WebFetchError("Test error")),
        ):
            await summarize_cog.summarize.callback(
                summarize_cog, mock_interaction, "https://example.com/article"
            )

        mock_interaction.followup.send.assert_called_once()
        call_args = mock_interaction.followup.send.call_args
        assert "Test error" in call_args[0][0]
        assert call_args[1]["ephemeral"] is True

    async def test_handles_unexpected_fetch_exception(self, summarize_cog, mock_interaction):
        with patch.object(
            summarize_cog,
            "_fetch_web_content",
            AsyncMock(side_effect=RuntimeError("boom")),
        ):
            await summarize_cog.summarize.callback(
                summarize_cog, mock_interaction, "https://example.com/article"
            )

        call_args = mock_interaction.followup.send.call_args
        assert "Could not fetch content" in call_args[0][0]
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

    async def test_handles_blank_content(self, summarize_cog, mock_interaction):
        mock_content = WebContent(
            url="https://example.com/article",
            title="Blank Article",
            content="   ",
        )

        with patch.object(
            summarize_cog, "_fetch_web_content", AsyncMock(return_value=mock_content)
        ):
            await summarize_cog.summarize.callback(
                summarize_cog, mock_interaction, "https://example.com/article"
            )

        assert "enough content" in mock_interaction.followup.send.call_args[0][0]

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
            summarize_cog,
            "_fetch_youtube_content",
            AsyncMock(return_value=mock_content),
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
            summarize_cog,
            "_fetch_substack_content",
            AsyncMock(return_value=mock_content),
        ) as mock_fetch:
            await summarize_cog.summarize.callback(
                summarize_cog,
                mock_interaction,
                "https://example.substack.com/p/article",
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

    async def test_lazily_initializes_summarizer_when_missing(
        self, summarize_cog, mock_interaction
    ):
        summarize_cog._summarizer = None
        mock_content = WebContent(
            url="https://example.com/article",
            title="Test Article",
            content="This is enough content for summarization. " * 10,
        )
        summarizer = MagicMock()
        summarizer.summarize = AsyncMock(return_value="Lazy summary")

        with (
            patch.object(summarize_cog, "_fetch_web_content", AsyncMock(return_value=mock_content)),
            patch("intelstream.discord.cogs.summarize.create_llm_client") as create_client,
            patch(
                "intelstream.discord.cogs.summarize.SummarizationService",
                return_value=summarizer,
            ) as summarization_service,
        ):
            await summarize_cog.summarize.callback(
                summarize_cog, mock_interaction, "https://example.com/article"
            )

        create_client.assert_called_once_with(
            provider="anthropic",
            api_key="test-api-key",
            model="claude-sonnet-4-6",
        )
        summarization_service.assert_called_once()
        assert (
            mock_interaction.followup.send.call_args.kwargs["embed"].description == "Lazy summary"
        )


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
        mock_summarizer = MagicMock()
        mock_summarizer.close = AsyncMock()
        cog._summarizer = mock_summarizer

        await cog.cog_unload()

        mock_client.aclose.assert_called_once()
        mock_summarizer.close.assert_awaited_once()

    async def test_cog_unload_noops_without_resources(self, mock_bot):
        cog = Summarize(mock_bot)

        await cog.cog_unload()

        assert cog._http_client is None
        assert cog._summarizer is None

    async def test_setup_adds_summarize_cog(self, mock_bot):
        mock_bot.add_cog = AsyncMock()

        await setup(mock_bot)

        added_cog = mock_bot.add_cog.await_args.args[0]
        assert isinstance(added_cog, Summarize)
        assert added_cog.bot is mock_bot


class TestSummarizeCooldown:
    async def test_cooldown_error_sends_retry_message(self, summarize_cog, mock_interaction):
        from discord import app_commands

        mock_interaction.response.send_message = AsyncMock()
        error = app_commands.CommandOnCooldown(
            app_commands.Cooldown(rate=10, per=300.0), retry_after=125.5
        )

        await summarize_cog.summarize_error(mock_interaction, error)

        mock_interaction.response.send_message.assert_called_once()
        call_args = mock_interaction.response.send_message.call_args
        assert "too frequently" in call_args[0][0]
        assert "2m 5s" in call_args[0][0]
        assert call_args[1]["ephemeral"] is True

    async def test_cooldown_error_shows_seconds_only_for_short_wait(
        self, summarize_cog, mock_interaction
    ):
        from discord import app_commands

        mock_interaction.response.send_message = AsyncMock()
        error = app_commands.CommandOnCooldown(
            app_commands.Cooldown(rate=10, per=300.0), retry_after=45.0
        )

        await summarize_cog.summarize_error(mock_interaction, error)

        call_args = mock_interaction.response.send_message.call_args
        assert "45s" in call_args[0][0]
        assert "m " not in call_args[0][0]

    async def test_non_cooldown_error_is_reraised(self, summarize_cog, mock_interaction):
        from discord import app_commands

        error = app_commands.MissingPermissions(["manage_guild"])

        with pytest.raises(app_commands.MissingPermissions):
            await summarize_cog.summarize_error(mock_interaction, error)
