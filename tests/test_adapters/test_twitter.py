from datetime import UTC, datetime

import httpx
import pytest
import respx

from intelstream.adapters.twitter import TwitterAdapter

SAMPLE_TWEETS_RESPONSE = {
    "tweets": [
        {
            "type": "tweet",
            "id": "12345",
            "url": "https://x.com/testuser/status/12345",
            "text": "This is a test tweet with some content",
            "createdAt": "Tue Dec 10 07:00:30 +0000 2024",
            "author": {
                "userName": "testuser",
                "id": "user123",
                "name": "Test User",
                "profilePicture": "https://pbs.twimg.com/profile.jpg",
            },
            "retweetCount": 5,
            "likeCount": 10,
            "quoted_tweet": None,
            "retweeted_tweet": None,
        },
        {
            "type": "tweet",
            "id": "12346",
            "url": "https://x.com/testuser/status/12346",
            "text": "Another tweet with a quote",
            "createdAt": "Wed Dec 11 08:00:00 +0000 2024",
            "author": {
                "userName": "testuser",
                "id": "user123",
                "name": "Test User",
                "profilePicture": "https://pbs.twimg.com/profile.jpg",
            },
            "retweetCount": 0,
            "likeCount": 3,
            "quoted_tweet": {
                "text": "Original quoted content here",
            },
            "retweeted_tweet": None,
        },
    ],
    "has_next_page": False,
    "next_cursor": "",
    "status": "success",
    "message": "",
}


class TestTwitterAdapter:
    async def test_source_type(self) -> None:
        adapter = TwitterAdapter(api_key="test-key")
        assert adapter.source_type == "twitter"

    async def test_get_feed_url(self) -> None:
        adapter = TwitterAdapter(api_key="test-key")
        url = await adapter.get_feed_url("testuser")
        assert url == "https://x.com/testuser"

    @respx.mock
    async def test_fetch_latest_success(self) -> None:
        respx.get("https://api.twitterapi.io/twitter/user/last_tweets").mock(
            return_value=httpx.Response(200, json=SAMPLE_TWEETS_RESPONSE)
        )

        async with httpx.AsyncClient() as client:
            adapter = TwitterAdapter(api_key="test-key", http_client=client)
            items = await adapter.fetch_latest("testuser")

        assert len(items) == 2

        first = items[0]
        assert first.external_id == "12345"
        assert first.title == "This is a test tweet with some content"
        assert first.original_url == "https://x.com/testuser/status/12345"
        assert first.author == "Test User"
        assert first.raw_content == "This is a test tweet with some content"
        assert first.thumbnail_url == "https://pbs.twimg.com/profile.jpg"
        assert first.published_at == datetime(2024, 12, 10, 7, 0, 30, tzinfo=UTC)

    @respx.mock
    async def test_fetch_latest_includes_quoted_text(self) -> None:
        respx.get("https://api.twitterapi.io/twitter/user/last_tweets").mock(
            return_value=httpx.Response(200, json=SAMPLE_TWEETS_RESPONSE)
        )

        async with httpx.AsyncClient() as client:
            adapter = TwitterAdapter(api_key="test-key", http_client=client)
            items = await adapter.fetch_latest("testuser")

        second = items[1]
        assert second.raw_content is not None
        assert "[Quoted: Original quoted content here]" in second.raw_content

    @respx.mock
    async def test_fetch_latest_skips_retweets(self) -> None:
        response_with_rt = {
            "tweets": [
                {
                    "type": "tweet",
                    "id": "rt1",
                    "url": "https://x.com/testuser/status/rt1",
                    "text": "RT content",
                    "createdAt": "Tue Dec 10 07:00:30 +0000 2024",
                    "author": {"userName": "testuser", "name": "Test"},
                    "retweeted_tweet": {"id": "original", "text": "Original"},
                    "quoted_tweet": None,
                },
            ],
            "status": "success",
            "message": "",
        }
        respx.get("https://api.twitterapi.io/twitter/user/last_tweets").mock(
            return_value=httpx.Response(200, json=response_with_rt)
        )

        async with httpx.AsyncClient() as client:
            adapter = TwitterAdapter(api_key="test-key", http_client=client)
            items = await adapter.fetch_latest("testuser")

        assert len(items) == 0

    @respx.mock
    async def test_fetch_latest_skip_content(self) -> None:
        respx.get("https://api.twitterapi.io/twitter/user/last_tweets").mock(
            return_value=httpx.Response(200, json=SAMPLE_TWEETS_RESPONSE)
        )

        async with httpx.AsyncClient() as client:
            adapter = TwitterAdapter(api_key="test-key", http_client=client)
            items = await adapter.fetch_latest("testuser", skip_content=True)

        assert len(items) == 2
        for item in items:
            assert item.raw_content is None

    @respx.mock
    async def test_fetch_latest_http_error(self) -> None:
        respx.get("https://api.twitterapi.io/twitter/user/last_tweets").mock(
            return_value=httpx.Response(401)
        )

        async with httpx.AsyncClient() as client:
            adapter = TwitterAdapter(api_key="test-key", http_client=client)
            with pytest.raises(httpx.HTTPStatusError):
                await adapter.fetch_latest("testuser")

    @respx.mock
    async def test_fetch_latest_api_error_status(self) -> None:
        error_response = {"status": "error", "message": "User not found"}
        respx.get("https://api.twitterapi.io/twitter/user/last_tweets").mock(
            return_value=httpx.Response(200, json=error_response)
        )

        async with httpx.AsyncClient() as client:
            adapter = TwitterAdapter(api_key="test-key", http_client=client)
            items = await adapter.fetch_latest("nonexistent")

        assert len(items) == 0

    def test_make_title_short_text(self) -> None:
        adapter = TwitterAdapter(api_key="test-key")
        assert adapter._make_title("Short tweet") == "Short tweet"

    def test_make_title_long_text(self) -> None:
        adapter = TwitterAdapter(api_key="test-key")
        long_text = "A" * 200
        title = adapter._make_title(long_text)
        assert len(title) == 100
        assert title.endswith("...")

    def test_make_title_multiline(self) -> None:
        adapter = TwitterAdapter(api_key="test-key")
        title = adapter._make_title("First line\nSecond line")
        assert title == "First line"

    def test_parse_twitter_date_valid(self) -> None:
        adapter = TwitterAdapter(api_key="test-key")
        result = adapter._parse_twitter_date("Tue Dec 10 07:00:30 +0000 2024")
        assert result == datetime(2024, 12, 10, 7, 0, 30, tzinfo=UTC)

    def test_parse_twitter_date_none(self) -> None:
        adapter = TwitterAdapter(api_key="test-key")
        result = adapter._parse_twitter_date(None)
        assert result.tzinfo is not None

    def test_parse_twitter_date_invalid(self) -> None:
        adapter = TwitterAdapter(api_key="test-key")
        result = adapter._parse_twitter_date("not-a-date")
        assert result.tzinfo is not None

    @respx.mock
    async def test_fetch_sends_correct_headers(self) -> None:
        route = respx.get("https://api.twitterapi.io/twitter/user/last_tweets").mock(
            return_value=httpx.Response(
                200, json={"tweets": [], "status": "success", "message": ""}
            )
        )

        async with httpx.AsyncClient() as client:
            adapter = TwitterAdapter(api_key="my-secret-key", http_client=client)
            await adapter.fetch_latest("testuser")

        assert route.called
        request = route.calls[0].request
        assert request.headers["X-API-Key"] == "my-secret-key"

    @respx.mock
    async def test_fetch_sends_correct_params(self) -> None:
        route = respx.get("https://api.twitterapi.io/twitter/user/last_tweets").mock(
            return_value=httpx.Response(
                200, json={"tweets": [], "status": "success", "message": ""}
            )
        )

        async with httpx.AsyncClient() as client:
            adapter = TwitterAdapter(api_key="test-key", http_client=client)
            await adapter.fetch_latest("elonmusk")

        request = route.calls[0].request
        assert "userName=elonmusk" in str(request.url)
        assert "includeReplies=false" in str(request.url)

    @respx.mock
    async def test_fetch_without_http_client(self) -> None:
        respx.get("https://api.twitterapi.io/twitter/user/last_tweets").mock(
            return_value=httpx.Response(200, json=SAMPLE_TWEETS_RESPONSE)
        )

        adapter = TwitterAdapter(api_key="test-key")
        items = await adapter.fetch_latest("testuser")

        assert len(items) == 2
