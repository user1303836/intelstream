import re
from datetime import UTC, datetime
from typing import Any

import httpx
import structlog
from googleapiclient.discovery import build
from googleapiclient.errors import HttpError
from youtube_transcript_api import YouTubeTranscriptApi
from youtube_transcript_api._errors import (
    NoTranscriptFound,
    TranscriptsDisabled,
    VideoUnavailable,
)

from intelstream.adapters.base import BaseAdapter, ContentData

logger = structlog.get_logger()

YOUTUBE_VIDEO_URL = "https://www.youtube.com/watch?v="
CHANNEL_ID_PATTERN = re.compile(r"^UC[\w-]{22}$")
HANDLE_PATTERN = re.compile(r"^@[\w.-]+$")


class YouTubeAdapter(BaseAdapter):
    def __init__(self, api_key: str, http_client: httpx.AsyncClient | None = None) -> None:
        self._api_key = api_key
        self._client = http_client
        self._youtube: Any = build("youtube", "v3", developerKey=api_key)

    @property
    def source_type(self) -> str:
        return "youtube"

    async def get_feed_url(self, identifier: str) -> str:
        channel_id = await self._resolve_channel_id(identifier)
        return f"https://www.youtube.com/channel/{channel_id}"

    async def fetch_latest(
        self,
        identifier: str,
        feed_url: str | None = None,  # noqa: ARG002
        max_results: int = 5,
    ) -> list[ContentData]:
        logger.debug("Fetching YouTube videos", identifier=identifier)

        try:
            channel_id = await self._resolve_channel_id(identifier)

            uploads_playlist_id = await self._get_uploads_playlist_id(channel_id)

            videos = await self._get_playlist_videos(uploads_playlist_id, max_results)

            items: list[ContentData] = []
            for video in videos:
                try:
                    item = await self._create_content_data(video)
                    items.append(item)
                except Exception as e:
                    logger.warning(
                        "Failed to process video",
                        video_id=video.get("snippet", {}).get("resourceId", {}).get("videoId"),
                        error=str(e),
                    )
                    continue

            logger.info("Fetched YouTube content", identifier=identifier, count=len(items))
            return items

        except HttpError as e:
            logger.error(
                "YouTube API error",
                identifier=identifier,
                status_code=e.resp.status,
                error=str(e),
            )
            raise
        except Exception as e:
            logger.error("Error fetching YouTube content", identifier=identifier, error=str(e))
            raise

    async def _resolve_channel_id(self, identifier: str) -> str:
        identifier = identifier.strip()

        if CHANNEL_ID_PATTERN.match(identifier):
            return identifier

        if identifier.startswith("https://") or identifier.startswith("http://"):
            return await self._extract_channel_id_from_url(identifier)

        if HANDLE_PATTERN.match(identifier) or not identifier.startswith("UC"):
            return await self._get_channel_id_by_handle_or_username(identifier)

        return identifier

    async def _extract_channel_id_from_url(self, url: str) -> str:
        if "/channel/" in url:
            match = re.search(r"/channel/(UC[\w-]{22})", url)
            if match:
                return match.group(1)

        if "/@" in url:
            match = re.search(r"/@([\w.-]+)", url)
            if match:
                handle = "@" + match.group(1)
                return await self._get_channel_id_by_handle_or_username(handle)

        if "/c/" in url or "/user/" in url:
            match = re.search(r"/(?:c|user)/([\w-]+)", url)
            if match:
                return await self._get_channel_id_by_handle_or_username(match.group(1))

        raise ValueError(f"Could not extract channel ID from URL: {url}")

    async def _get_channel_id_by_handle_or_username(self, identifier: str) -> str:
        identifier = identifier.lstrip("@")

        request = self._youtube.channels().list(part="id", forHandle=identifier)
        response: dict[str, Any] = request.execute()

        if response.get("items"):
            return str(response["items"][0]["id"])

        request = self._youtube.channels().list(part="id", forUsername=identifier)
        response = request.execute()

        if response.get("items"):
            return str(response["items"][0]["id"])

        request = self._youtube.search().list(
            part="snippet", q=identifier, type="channel", maxResults=1
        )
        response = request.execute()

        if response.get("items"):
            return str(response["items"][0]["snippet"]["channelId"])

        raise ValueError(f"Could not find YouTube channel: {identifier}")

    async def _get_uploads_playlist_id(self, channel_id: str) -> str:
        request = self._youtube.channels().list(part="contentDetails", id=channel_id)
        response: dict[str, Any] = request.execute()

        if not response.get("items"):
            raise ValueError(f"Channel not found: {channel_id}")

        return str(response["items"][0]["contentDetails"]["relatedPlaylists"]["uploads"])

    async def _get_playlist_videos(
        self, playlist_id: str, max_results: int
    ) -> list[dict[str, Any]]:
        request = self._youtube.playlistItems().list(
            part="snippet,contentDetails",
            playlistId=playlist_id,
            maxResults=max_results,
        )
        response: dict[str, Any] = request.execute()
        return list(response.get("items", []))

    async def _create_content_data(self, video: dict[str, Any]) -> ContentData:
        snippet: dict[str, Any] = video.get("snippet", {})
        content_details: dict[str, Any] = video.get("contentDetails", {})

        video_id = content_details.get("videoId") or snippet.get("resourceId", {}).get("videoId")

        if not video_id:
            raise ValueError("Could not extract video ID")

        video_id = str(video_id)
        title = str(snippet.get("title", "Untitled"))
        original_url = YOUTUBE_VIDEO_URL + video_id
        author = str(snippet.get("channelTitle", "Unknown Channel"))

        published_str = snippet.get("publishedAt") or content_details.get("videoPublishedAt")
        published_at = self._parse_datetime(str(published_str) if published_str else None)

        thumbnails: dict[str, Any] = snippet.get("thumbnails", {})
        thumbnail_url = self._get_best_thumbnail(thumbnails)

        transcript = await self._fetch_transcript(video_id)

        return ContentData(
            external_id=video_id,
            title=title,
            original_url=original_url,
            author=author,
            published_at=published_at,
            raw_content=transcript,
            thumbnail_url=thumbnail_url,
        )

    def _parse_datetime(self, dt_string: str | None) -> datetime:
        if not dt_string:
            return datetime.now(UTC)

        try:
            dt_string = dt_string.replace("Z", "+00:00")
            return datetime.fromisoformat(dt_string)
        except (ValueError, TypeError):
            return datetime.now(UTC)

    def _get_best_thumbnail(self, thumbnails: dict[str, Any]) -> str | None:
        for quality in ["maxres", "standard", "high", "medium", "default"]:
            if quality in thumbnails:
                url = thumbnails[quality].get("url")
                return str(url) if url else None
        return None

    async def _fetch_transcript(self, video_id: str) -> str | None:
        try:
            transcript_list = YouTubeTranscriptApi.list_transcripts(video_id)  # type: ignore[attr-defined]

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
            return " ".join(str(entry["text"]) for entry in entries)

        except TranscriptsDisabled:
            logger.debug("Transcripts disabled for video", video_id=video_id)
            return None
        except VideoUnavailable:
            logger.debug("Video unavailable", video_id=video_id)
            return None
        except Exception as e:
            logger.warning("Failed to fetch transcript", video_id=video_id, error=str(e))
            return None
