from datetime import UTC, datetime
from unittest.mock import MagicMock, patch

import pytest
from googleapiclient.errors import HttpError

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

    async def test_extract_channel_id_invalid_url_raises(self) -> None:
        adapter = YouTubeAdapter(api_key="test-key")

        with pytest.raises(ValueError, match="Could not extract channel ID"):
            await adapter._extract_channel_id_from_url("https://www.youtube.com/watch?v=somevideo")
