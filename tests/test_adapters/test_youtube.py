from datetime import UTC, datetime
from typing import Any
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from googleapiclient.errors import HttpError
from youtube_transcript_api._errors import NoTranscriptFound, VideoUnavailable

from intelstream.adapters.base import ContentData
from intelstream.adapters.youtube import YouTubeAdapter


class TestYouTubeAdapter:
    def setup_method(self) -> None:
        self.mock_youtube = MagicMock()
        self.patcher = patch("intelstream.adapters.youtube.build", return_value=self.mock_youtube)
        self.patcher.start()

    def teardown_method(self) -> None:
        self.patcher.stop()

    async def test_source_type(self) -> None:
        adapter = YouTubeAdapter(api_key="test-key")
        assert adapter.source_type == "youtube"

    async def test_get_feed_url_returns_channel_url(self) -> None:
        self.mock_youtube.channels().list().execute.return_value = {
            "items": [{"id": "UCtest123456789012345"}]
        }

        adapter = YouTubeAdapter(api_key="test-key")
        url = await adapter.get_feed_url("@testchannel")

        assert url == "https://www.youtube.com/channel/UCtest123456789012345"

    async def test_resolve_channel_id_from_channel_id(self) -> None:
        adapter = YouTubeAdapter(api_key="test-key")
        channel_id = await adapter._resolve_channel_id("UCabcdefghij1234567890AB")

        assert channel_id == "UCabcdefghij1234567890AB"

    async def test_resolve_channel_id_from_handle(self) -> None:
        self.mock_youtube.channels().list().execute.return_value = {
            "items": [{"id": "UCresolved12345678901234"}]
        }

        adapter = YouTubeAdapter(api_key="test-key")
        channel_id = await adapter._resolve_channel_id("@testhandle")

        assert channel_id == "UCresolved12345678901234"

    async def test_resolve_channel_id_from_channel_url(self) -> None:
        adapter = YouTubeAdapter(api_key="test-key")
        channel_id = await adapter._resolve_channel_id(
            "https://www.youtube.com/channel/UCurlchannel123456789012"
        )

        assert channel_id == "UCurlchannel123456789012"

    async def test_resolve_channel_id_from_handle_url(self) -> None:
        self.mock_youtube.channels().list().execute.return_value = {
            "items": [{"id": "UChandleurl1234567890123"}]
        }

        adapter = YouTubeAdapter(api_key="test-key")
        channel_id = await adapter._resolve_channel_id("https://www.youtube.com/@somehandle")

        assert channel_id == "UChandleurl1234567890123"

    async def test_resolve_channel_id_not_found_raises(self) -> None:
        self.mock_youtube.channels().list().execute.return_value = {"items": []}
        self.mock_youtube.search().list().execute.return_value = {"items": []}

        adapter = YouTubeAdapter(api_key="test-key")

        with pytest.raises(ValueError, match="Could not find YouTube channel"):
            await adapter._resolve_channel_id("nonexistent")

    async def test_resolve_channel_id_returns_unrecognized_uc_identifier(self) -> None:
        adapter = YouTubeAdapter(api_key="test-key")

        assert await adapter._resolve_channel_id("UCshort") == "UCshort"

    @patch("intelstream.adapters.youtube.YouTubeTranscriptApi")
    async def test_fetch_latest_success(self, mock_transcript_api: MagicMock) -> None:
        self.mock_youtube.channels().list().execute.side_effect = [
            {"items": [{"id": "UCtest123456789012345AB"}]},
            {
                "items": [
                    {"contentDetails": {"relatedPlaylists": {"uploads": "UUtest123456789012345AB"}}}
                ]
            },
        ]

        self.mock_youtube.playlistItems().list().execute.return_value = {
            "items": [
                {
                    "snippet": {
                        "title": "Test Video",
                        "channelTitle": "Test Channel",
                        "publishedAt": "2024-01-15T12:00:00Z",
                        "resourceId": {"videoId": "video123"},
                        "thumbnails": {
                            "high": {"url": "https://img.youtube.com/vi/video123/hq.jpg"}
                        },
                    },
                    "contentDetails": {"videoPublishedAt": "2024-01-15T12:00:00Z"},
                }
            ]
        }

        mock_entry1 = MagicMock()
        mock_entry1.text = "Hello"
        mock_entry2 = MagicMock()
        mock_entry2.text = "World"
        mock_transcript = MagicMock()
        mock_transcript.fetch.return_value = [mock_entry1, mock_entry2]
        mock_transcript_list = MagicMock()
        mock_transcript_list.find_manually_created_transcript.return_value = mock_transcript
        mock_transcript_api.return_value.list.return_value = mock_transcript_list

        adapter = YouTubeAdapter(api_key="test-key")
        items = await adapter.fetch_latest("@testchannel")

        assert len(items) == 1
        item = items[0]
        assert item.title == "Test Video"
        assert item.author == "Test Channel"
        assert item.external_id == "video123"
        assert item.original_url == "https://www.youtube.com/watch?v=video123"
        assert item.raw_content == "Hello World"
        assert item.thumbnail_url == "https://img.youtube.com/vi/video123/hq.jpg"

    async def test_fetch_latest_uses_explicit_max_results(self) -> None:
        self.mock_youtube.channels().list().execute.side_effect = [
            {"items": [{"id": "UCtest123456789012345AB"}]},
            {
                "items": [
                    {"contentDetails": {"relatedPlaylists": {"uploads": "UUtest123456789012345AB"}}}
                ]
            },
        ]
        self.mock_youtube.playlistItems().list().execute.return_value = {"items": []}
        adapter = YouTubeAdapter(api_key="test-key")

        await adapter.fetch_latest("@testchannel", max_results=3)

        playlist_call = self.mock_youtube.playlistItems().list.call_args.kwargs
        assert playlist_call["maxResults"] == 3

    async def test_fetch_latest_continues_after_video_processing_error(self) -> None:
        self.mock_youtube.channels().list().execute.side_effect = [
            {"items": [{"id": "UCtest123456789012345AB"}]},
            {
                "items": [
                    {"contentDetails": {"relatedPlaylists": {"uploads": "UUtest123456789012345AB"}}}
                ]
            },
        ]
        self.mock_youtube.playlistItems().list().execute.return_value = {
            "items": [
                {"snippet": {"resourceId": {"videoId": "bad"}}},
                {"snippet": {"resourceId": {"videoId": "good"}}},
            ]
        }
        recovered = ContentData(
            external_id="good",
            title="Good",
            original_url="https://www.youtube.com/watch?v=good",
            author="Channel",
            published_at=datetime(2024, 1, 1, tzinfo=UTC),
        )
        adapter = YouTubeAdapter(api_key="test-key")
        adapter._create_content_data = AsyncMock(side_effect=[ValueError("bad"), recovered])

        assert await adapter.fetch_latest("@testchannel") == [recovered]

    @patch("intelstream.adapters.youtube.YouTubeTranscriptApi")
    async def test_fetch_latest_no_transcript(self, mock_transcript_api: MagicMock) -> None:
        self.mock_youtube.channels().list().execute.side_effect = [
            {"items": [{"id": "UCtest123456789012345AB"}]},
            {
                "items": [
                    {"contentDetails": {"relatedPlaylists": {"uploads": "UUtest123456789012345AB"}}}
                ]
            },
        ]

        self.mock_youtube.playlistItems().list().execute.return_value = {
            "items": [
                {
                    "snippet": {
                        "title": "No Transcript Video",
                        "channelTitle": "Test Channel",
                        "resourceId": {"videoId": "novideo"},
                        "thumbnails": {},
                    },
                    "contentDetails": {},
                }
            ]
        }

        from youtube_transcript_api._errors import TranscriptsDisabled

        mock_transcript_api.return_value.list.side_effect = TranscriptsDisabled("novideo")

        adapter = YouTubeAdapter(api_key="test-key")
        items = await adapter.fetch_latest("@testchannel")

        assert len(items) == 1
        assert items[0].raw_content is None

    async def test_fetch_latest_api_error(self) -> None:
        http_error = HttpError(resp=MagicMock(status=403), content=b"API quota exceeded")
        self.mock_youtube.channels().list().execute.side_effect = http_error

        adapter = YouTubeAdapter(api_key="test-key")

        with pytest.raises(HttpError):
            await adapter.fetch_latest("@testchannel")

    async def test_fetch_latest_reraises_generic_error(self) -> None:
        adapter = YouTubeAdapter(api_key="test-key")
        adapter._resolve_channel_id = AsyncMock(side_effect=RuntimeError("broken"))

        with pytest.raises(RuntimeError, match="broken"):
            await adapter.fetch_latest("@testchannel")

    async def test_parse_datetime_valid(self) -> None:
        adapter = YouTubeAdapter(api_key="test-key")

        result = adapter._parse_datetime("2024-01-15T12:30:00Z")

        assert result == datetime(2024, 1, 15, 12, 30, 0, tzinfo=UTC)

    async def test_parse_datetime_none_returns_now(self) -> None:
        adapter = YouTubeAdapter(api_key="test-key")

        result = adapter._parse_datetime(None)

        assert result.tzinfo == UTC
        assert (datetime.now(UTC) - result).total_seconds() < 5

    async def test_parse_datetime_invalid_returns_now(self) -> None:
        adapter = YouTubeAdapter(api_key="test-key")

        result = adapter._parse_datetime("not-a-date")

        assert result.tzinfo == UTC

    async def test_get_best_thumbnail_priority(self) -> None:
        adapter = YouTubeAdapter(api_key="test-key")

        thumbnails = {
            "default": {"url": "https://example.com/default.jpg"},
            "medium": {"url": "https://example.com/medium.jpg"},
            "high": {"url": "https://example.com/high.jpg"},
            "maxres": {"url": "https://example.com/maxres.jpg"},
        }

        result = adapter._get_best_thumbnail(thumbnails)

        assert result == "https://example.com/maxres.jpg"

    async def test_get_best_thumbnail_fallback(self) -> None:
        adapter = YouTubeAdapter(api_key="test-key")

        thumbnails = {
            "default": {"url": "https://example.com/default.jpg"},
        }

        result = adapter._get_best_thumbnail(thumbnails)

        assert result == "https://example.com/default.jpg"

    async def test_get_best_thumbnail_empty(self) -> None:
        adapter = YouTubeAdapter(api_key="test-key")

        result = adapter._get_best_thumbnail({})

        assert result is None

    async def test_get_best_thumbnail_returns_none_for_empty_best_url(self) -> None:
        adapter = YouTubeAdapter(api_key="test-key")

        result = adapter._get_best_thumbnail(
            {
                "maxres": {},
                "default": {"url": "https://example.com/default.jpg"},
            }
        )

        assert result is None

    async def test_extract_channel_id_from_c_url(self) -> None:
        self.mock_youtube.channels().list().execute.return_value = {
            "items": [{"id": "UCcustom12345678901234AB"}]
        }

        adapter = YouTubeAdapter(api_key="test-key")
        channel_id = await adapter._extract_channel_id_from_url(
            "https://www.youtube.com/c/customname"
        )

        assert channel_id == "UCcustom12345678901234AB"

    async def test_extract_channel_id_from_user_url(self) -> None:
        self.mock_youtube.channels().list().execute.return_value = {
            "items": [{"id": "UCusername1234567890123AB"}]
        }

        adapter = YouTubeAdapter(api_key="test-key")
        channel_id = await adapter._extract_channel_id_from_url(
            "https://www.youtube.com/user/someusername"
        )

        assert channel_id == "UCusername1234567890123AB"

    async def test_extract_channel_id_from_channel_url_with_bad_id_raises(self) -> None:
        adapter = YouTubeAdapter(api_key="test-key")

        with pytest.raises(ValueError, match="Could not extract channel ID"):
            await adapter._extract_channel_id_from_url("https://www.youtube.com/channel/not-a-uc")

    async def test_extract_channel_id_invalid_url_raises(self) -> None:
        adapter = YouTubeAdapter(api_key="test-key")

        with pytest.raises(ValueError, match="Could not extract channel ID"):
            await adapter._extract_channel_id_from_url("https://www.youtube.com/watch?v=somevideo")

    async def test_fetch_latest_skip_content_skips_transcript(self) -> None:
        self.mock_youtube.channels().list().execute.side_effect = [
            {"items": [{"id": "UCtest123456789012345AB"}]},
            {
                "items": [
                    {"contentDetails": {"relatedPlaylists": {"uploads": "UUtest123456789012345AB"}}}
                ]
            },
        ]

        self.mock_youtube.playlistItems().list().execute.return_value = {
            "items": [
                {
                    "snippet": {
                        "title": "Test Video",
                        "channelTitle": "Test Channel",
                        "publishedAt": "2024-01-15T12:00:00Z",
                        "resourceId": {"videoId": "video123"},
                        "thumbnails": {
                            "high": {"url": "https://img.youtube.com/vi/video123/hq.jpg"}
                        },
                    },
                    "contentDetails": {"videoPublishedAt": "2024-01-15T12:00:00Z"},
                }
            ]
        }

        adapter = YouTubeAdapter(api_key="test-key")

        with patch.object(adapter, "_fetch_transcript") as mock_fetch_transcript:
            items = await adapter.fetch_latest("@testchannel", skip_content=True)

            mock_fetch_transcript.assert_not_called()

        assert len(items) == 1
        assert items[0].raw_content is None
        assert items[0].title == "Test Video"
        assert items[0].original_url == "https://www.youtube.com/watch?v=video123"

    async def test_get_channel_id_falls_back_to_username_lookup(self) -> None:
        self.mock_youtube.channels().list().execute.side_effect = [
            {"items": []},
            {"items": [{"id": "UCusername1234567890123AB"}]},
        ]

        adapter = YouTubeAdapter(api_key="test-key")

        assert await adapter._get_channel_id_by_handle_or_username("legacyname") == (
            "UCusername1234567890123AB"
        )

    async def test_get_channel_id_falls_back_to_search_lookup(self) -> None:
        self.mock_youtube.channels().list().execute.side_effect = [{"items": []}, {"items": []}]
        self.mock_youtube.search().list().execute.return_value = {
            "items": [{"snippet": {"channelId": "UCsearch12345678901234AB"}}]
        }

        adapter = YouTubeAdapter(api_key="test-key")

        assert await adapter._get_channel_id_by_handle_or_username("@searchname") == (
            "UCsearch12345678901234AB"
        )

    async def test_get_uploads_playlist_id_raises_when_channel_missing(self) -> None:
        self.mock_youtube.channels().list().execute.return_value = {"items": []}
        adapter = YouTubeAdapter(api_key="test-key")

        with pytest.raises(ValueError, match="Channel not found"):
            await adapter._get_uploads_playlist_id("UCmissing12345678901234")

    async def test_get_playlist_videos_returns_empty_list_without_items(self) -> None:
        self.mock_youtube.playlistItems().list().execute.return_value = {}
        adapter = YouTubeAdapter(api_key="test-key")

        assert await adapter._get_playlist_videos("UUplaylist", 5) == []

    async def test_create_content_data_uses_content_details_video_id_and_defaults(
        self,
    ) -> None:
        adapter = YouTubeAdapter(api_key="test-key")
        adapter._fetch_transcript = AsyncMock(return_value="Transcript")
        video = {
            "snippet": {
                "publishedAt": None,
                "thumbnails": {},
            },
            "contentDetails": {
                "videoId": "contentVideo",
                "videoPublishedAt": "2024-02-03T04:05:06Z",
            },
        }

        item = await adapter._create_content_data(video)

        assert item.external_id == "contentVideo"
        assert item.title == "Untitled"
        assert item.author == "Unknown Channel"
        assert item.published_at == datetime(2024, 2, 3, 4, 5, 6, tzinfo=UTC)
        assert item.raw_content == "Transcript"
        assert item.thumbnail_url is None

    async def test_create_content_data_raises_without_video_id(self) -> None:
        adapter = YouTubeAdapter(api_key="test-key")

        with pytest.raises(ValueError, match="Could not extract video ID"):
            await adapter._create_content_data({"snippet": {}, "contentDetails": {}})

    async def test_fetch_transcript_timeout_returns_none(self) -> None:
        adapter = YouTubeAdapter(api_key="test-key")

        async def fake_wait_for(awaitable: Any, **_kwargs: object) -> None:
            awaitable.close()
            raise TimeoutError

        with patch("intelstream.adapters.youtube.asyncio.wait_for", side_effect=fake_wait_for):
            assert await adapter._fetch_transcript("video123") is None

    async def test_fetch_transcript_video_unavailable_returns_none(self) -> None:
        adapter = YouTubeAdapter(api_key="test-key")

        async def fake_wait_for(awaitable: Any, **_kwargs: object) -> None:
            awaitable.close()
            raise VideoUnavailable("video123")

        with patch("intelstream.adapters.youtube.asyncio.wait_for", side_effect=fake_wait_for):
            assert await adapter._fetch_transcript("video123") is None

    async def test_fetch_transcript_generic_error_returns_none(self) -> None:
        adapter = YouTubeAdapter(api_key="test-key")

        async def fake_wait_for(awaitable: Any, **_kwargs: object) -> None:
            awaitable.close()
            raise RuntimeError("api failed")

        with patch("intelstream.adapters.youtube.asyncio.wait_for", side_effect=fake_wait_for):
            assert await adapter._fetch_transcript("video123") is None

    @patch("intelstream.adapters.youtube.YouTubeTranscriptApi")
    def test_fetch_transcript_sync_falls_back_to_generated_transcript(
        self, mock_transcript_api: MagicMock
    ) -> None:
        transcript = MagicMock()
        transcript.fetch.return_value = [MagicMock(text="Generated"), MagicMock(text="Text")]
        transcript_list = MagicMock()
        transcript_list.find_manually_created_transcript.side_effect = NoTranscriptFound(
            "video123", ["en"], transcript_list
        )
        transcript_list.find_generated_transcript.return_value = transcript
        mock_transcript_api.return_value.list.return_value = transcript_list
        adapter = YouTubeAdapter(api_key="test-key")

        assert adapter._fetch_transcript_sync("video123") == "Generated Text"

    @patch("intelstream.adapters.youtube.YouTubeTranscriptApi")
    def test_fetch_transcript_sync_translates_first_available_transcript(
        self, mock_transcript_api: MagicMock
    ) -> None:
        translated = MagicMock()
        translated.fetch.return_value = [MagicMock(text="Translated")]
        transcript = MagicMock()
        transcript.language_code = "es"
        transcript.translate.return_value = translated
        transcript_list = MagicMock()
        transcript_list.find_manually_created_transcript.side_effect = NoTranscriptFound(
            "video123", ["en"], transcript_list
        )
        transcript_list.find_generated_transcript.side_effect = NoTranscriptFound(
            "video123", ["en"], transcript_list
        )
        transcript_list.__iter__.return_value = iter([transcript])
        mock_transcript_api.return_value.list.return_value = transcript_list
        adapter = YouTubeAdapter(api_key="test-key")

        assert adapter._fetch_transcript_sync("video123") == "Translated"
        transcript.translate.assert_called_once_with("en")

    @patch("intelstream.adapters.youtube.YouTubeTranscriptApi")
    def test_fetch_transcript_sync_returns_none_without_any_transcripts(
        self, mock_transcript_api: MagicMock
    ) -> None:
        transcript_list = MagicMock()
        transcript_list.find_manually_created_transcript.side_effect = NoTranscriptFound(
            "video123", ["en"], transcript_list
        )
        transcript_list.find_generated_transcript.side_effect = NoTranscriptFound(
            "video123", ["en"], transcript_list
        )
        transcript_list.__iter__.return_value = iter([])
        mock_transcript_api.return_value.list.return_value = transcript_list
        adapter = YouTubeAdapter(api_key="test-key")

        assert adapter._fetch_transcript_sync("video123") is None
