import contextlib
import re
from datetime import UTC, datetime
from typing import TYPE_CHECKING
from urllib.parse import urlparse

import discord
import httpx
import structlog
from discord import app_commands
from discord.ext import commands
from googleapiclient.discovery import build
from youtube_transcript_api import YouTubeTranscriptApi
from youtube_transcript_api._errors import (
    NoTranscriptFound,
    TranscriptsDisabled,
    VideoUnavailable,
)

from intelstream.adapters.substack import SubstackAdapter
from intelstream.services.summarizer import SummarizationService
from intelstream.services.web_fetcher import WebContent, WebFetcher, WebFetchError

if TYPE_CHECKING:
    from intelstream.bot import IntelStreamBot

logger = structlog.get_logger()

YOUTUBE_VIDEO_PATTERNS = [
    re.compile(r"(?:youtube\.com/watch\?v=|youtu\.be/)([\w-]{11})"),
    re.compile(r"youtube\.com/embed/([\w-]{11})"),
    re.compile(r"youtube\.com/v/([\w-]{11})"),
]

SOURCE_TYPE_COLORS = {
    "youtube": discord.Color.red(),
    "substack": discord.Color.from_rgb(255, 103, 25),
    "web": discord.Color.blue(),
}

SOURCE_TYPE_ICONS = {
    "youtube": "YouTube",
    "substack": "Substack",
    "web": "Web",
}

MAX_EMBED_DESCRIPTION = 4096
MAX_EMBED_TITLE = 256


class Summarize(commands.Cog):
    def __init__(self, bot: "IntelStreamBot") -> None:
        self.bot = bot
        self._http_client: httpx.AsyncClient | None = None
        self._summarizer: SummarizationService | None = None

    async def cog_load(self) -> None:
        self._http_client = httpx.AsyncClient(
            timeout=30.0,
            follow_redirects=True,
            headers={"User-Agent": "Mozilla/5.0 (compatible; IntelStream/1.0)"},
        )
        self._summarizer = SummarizationService(api_key=self.bot.settings.anthropic_api_key)
        logger.info("Summarize cog loaded")

    async def cog_unload(self) -> None:
        if self._http_client:
            await self._http_client.aclose()
        logger.info("Summarize cog unloaded")

    def detect_url_type(self, url: str) -> str:
        parsed = urlparse(url)
        domain = parsed.netloc.lower()

        if "youtube.com" in domain or "youtu.be" in domain:
            return "youtube"

        if "substack.com" in domain:
            return "substack"

        if "twitter.com" in domain or "x.com" in domain:
            return "twitter"

        return "web"

    def _is_substack_url(self, url: str) -> bool:
        parsed = urlparse(url)
        domain = parsed.netloc.lower()
        return "substack.com" in domain

    def _extract_youtube_video_id(self, url: str) -> str | None:
        for pattern in YOUTUBE_VIDEO_PATTERNS:
            match = pattern.search(url)
            if match:
                return match.group(1)
        return None

    def create_summary_embed(
        self,
        url: str,
        title: str,
        summary: str,
        source_type: str,
        author: str | None = None,
        thumbnail_url: str | None = None,
        published_at: datetime | None = None,
    ) -> discord.Embed:
        if len(title) > MAX_EMBED_TITLE:
            title = title[: MAX_EMBED_TITLE - 3] + "..."

        if len(summary) > MAX_EMBED_DESCRIPTION:
            summary = summary[: MAX_EMBED_DESCRIPTION - 3] + "..."

        color = SOURCE_TYPE_COLORS.get(source_type, discord.Color.greyple())

        embed = discord.Embed(
            title=title,
            url=url,
            description=summary,
            color=color,
            timestamp=published_at or datetime.now(UTC),
        )

        if author:
            embed.set_author(name=author)

        if thumbnail_url:
            embed.set_image(url=thumbnail_url)

        source_icon = SOURCE_TYPE_ICONS.get(source_type, "Web")
        if source_type == "web":
            parsed = urlparse(url)
            source_icon = parsed.netloc
        embed.set_footer(text=source_icon)

        return embed

    async def _fetch_youtube_content(self, url: str) -> WebContent:
        video_id = self._extract_youtube_video_id(url)
        if not video_id:
            raise WebFetchError("Could not extract video ID from URL")

        api_key = self.bot.settings.youtube_api_key
        if not api_key:
            raise WebFetchError("YouTube API key not configured")

        youtube = build("youtube", "v3", developerKey=api_key)

        request = youtube.videos().list(part="snippet", id=video_id)
        response = request.execute()

        if not response.get("items"):
            raise WebFetchError("Video not found")

        video = response["items"][0]
        snippet = video.get("snippet", {})

        title = snippet.get("title", "Untitled")
        author = snippet.get("channelTitle")
        published_str = snippet.get("publishedAt")

        published_at = None
        if published_str:
            with contextlib.suppress(ValueError):
                published_at = datetime.fromisoformat(published_str.replace("Z", "+00:00"))

        thumbnails = snippet.get("thumbnails", {})
        thumbnail_url = None
        for quality in ["maxres", "standard", "high", "medium", "default"]:
            if quality in thumbnails:
                thumbnail_url = thumbnails[quality].get("url")
                break

        transcript = await self._fetch_youtube_transcript(video_id)
        if not transcript:
            description = snippet.get("description", "")
            transcript = description if description else "No transcript available."

        return WebContent(
            url=url,
            title=title,
            content=transcript,
            author=author,
            thumbnail_url=thumbnail_url,
            published_at=published_at,
        )

    async def _fetch_youtube_transcript(self, video_id: str) -> str | None:
        try:
            ytt_api = YouTubeTranscriptApi()
            transcript_list = ytt_api.list(video_id)

            try:
                transcript = transcript_list.find_manually_created_transcript(["en"])
            except NoTranscriptFound:
                try:
                    transcript = transcript_list.find_generated_transcript(["en"])
                except NoTranscriptFound:
                    transcripts = list(transcript_list)
                    if transcripts:
                        transcript = transcripts[0]
                        if transcript.language_code != "en":
                            transcript = transcript.translate("en")
                    else:
                        return None

            entries = transcript.fetch()
            return " ".join(str(entry.text) for entry in entries)

        except (TranscriptsDisabled, VideoUnavailable):
            return None
        except Exception as e:
            logger.warning("Failed to fetch transcript", video_id=video_id, error=str(e))
            return None

    async def _fetch_substack_content(self, url: str) -> WebContent:
        adapter = SubstackAdapter(http_client=self._http_client)

        parsed = urlparse(url)
        path = parsed.path

        if "/p/" not in path:
            raise WebFetchError(
                "Invalid Substack article URL. Expected format: https://example.substack.com/p/article-slug"
            )

        items = await adapter.fetch_latest(parsed.netloc)

        for item in items:
            if item.original_url == url or url in item.original_url or item.original_url in url:
                return WebContent(
                    url=item.original_url,
                    title=item.title,
                    content=item.raw_content or "",
                    author=item.author,
                    thumbnail_url=item.thumbnail_url,
                    published_at=item.published_at,
                )

        raise WebFetchError(
            "Could not find the article. It may be behind a paywall or the URL is invalid."
        )

    async def _fetch_web_content(self, url: str) -> WebContent:
        fetcher = WebFetcher(http_client=self._http_client)
        return await fetcher.fetch(url)

    @app_commands.command(
        name="summarize",
        description="Get an AI summary of any URL (YouTube, Substack, or web page)",
    )
    @app_commands.describe(url="URL to summarize (YouTube video, Substack article, or any webpage)")
    async def summarize(self, interaction: discord.Interaction, url: str) -> None:
        await interaction.response.defer()

        parsed = urlparse(url)
        if not parsed.scheme or not parsed.netloc:
            await interaction.followup.send("Please provide a valid URL.", ephemeral=True)
            return

        if not parsed.scheme.startswith("http"):
            await interaction.followup.send("Please provide an HTTP or HTTPS URL.", ephemeral=True)
            return

        source_type = self.detect_url_type(url)

        if source_type == "twitter":
            await interaction.followup.send(
                "Twitter/X is not supported. Try YouTube, Substack, or other web pages.",
                ephemeral=True,
            )
            return

        try:
            if source_type == "youtube":
                content = await self._fetch_youtube_content(url)
            elif source_type == "substack":
                content = await self._fetch_substack_content(url)
            else:
                content = await self._fetch_web_content(url)

        except WebFetchError as e:
            await interaction.followup.send(str(e), ephemeral=True)
            return
        except Exception as e:
            logger.error("Failed to fetch content", url=url, error=str(e))
            await interaction.followup.send(
                "Could not fetch content from that URL. The page may be behind a paywall or require login.",
                ephemeral=True,
            )
            return

        if not content.content or len(content.content.strip()) < 50:
            await interaction.followup.send(
                "The page doesn't have enough content to summarize.", ephemeral=True
            )
            return

        try:
            if not self._summarizer:
                self._summarizer = SummarizationService(api_key=self.bot.settings.anthropic_api_key)

            summary = await self._summarizer.summarize(
                content=content.content,
                title=content.title,
                source_type=source_type,
                author=content.author,
            )

        except Exception as e:
            logger.error("Failed to generate summary", url=url, error=str(e))
            await interaction.followup.send(
                "Failed to generate summary. Please try again.", ephemeral=True
            )
            return

        embed = self.create_summary_embed(
            url=content.url,
            title=content.title,
            summary=summary,
            source_type=source_type,
            author=content.author,
            thumbnail_url=content.thumbnail_url,
            published_at=content.published_at,
        )

        await interaction.followup.send(embed=embed)

        logger.info(
            "Summarized content",
            url=url,
            source_type=source_type,
            user_id=interaction.user.id,
        )


async def setup(bot: "IntelStreamBot") -> None:
    await bot.add_cog(Summarize(bot))
