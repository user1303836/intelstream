from datetime import UTC, datetime

import httpx
import pytest
import respx

from intelstream.adapters.twitter import TwitterAdapter

SAMPLE_USER_RESPONSE = {
    "data": {
        "id": "2244994945",
        "name": "Test User",
        "username": "testuser",
    }
}

SAMPLE_TWEETS_RESPONSE = {
    "data": [
        {
            "id": "12345",
            "text": "This is a test tweet with some content",
            "created_at": "2024-12-10T07:00:30.000Z",
            "author_id": "2244994945",
            "public_metrics": {
                "retweet_count": 5,
                "like_count": 10,
                "reply_count": 2,
            },
        },
        {
            "id": "12346",
            "text": "Another tweet with a quote",
            "created_at": "2024-12-11T08:00:00.000Z",
            "author_id": "2244994945",
            "referenced_tweets": [
                {"type": "quoted", "id": "99999"},
            ],
        },
    ],
    "includes": {
        "users": [
            {
                "id": "2244994945",
                "name": "Test User",
                "username": "testuser",
                "profile_image_url": "https://pbs.twimg.com/profile.jpg",
            },
        ],
        "tweets": [
            {
                "id": "99999",
                "text": "Original quoted content here",
            },
        ],
    },
    "meta": {
        "result_count": 2,
        "newest_id": "12346",
        "oldest_id": "12345",
    },
}


class TestTwitterAdapter:
    async def test_source_type(self) -> None:
        adapter = TwitterAdapter(bearer_token="test-token")
        assert adapter.source_type == "twitter"

    async def test_get_feed_url(self) -> None:
        adapter = TwitterAdapter(bearer_token="test-token")
        url = await adapter.get_feed_url("testuser")
        assert url == "https://x.com/testuser"

    @respx.mock
    async def test_fetch_latest_success(self) -> None:
        respx.get("https://api.x.com/2/users/by/username/testuser").mock(
            return_value=httpx.Response(200, json=SAMPLE_USER_RESPONSE)
        )
        respx.get("https://api.x.com/2/users/2244994945/tweets").mock(
            return_value=httpx.Response(200, json=SAMPLE_TWEETS_RESPONSE)
        )

        async with httpx.AsyncClient() as client:
            adapter = TwitterAdapter(bearer_token="test-token", http_client=client)
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
        respx.get("https://api.x.com/2/users/by/username/testuser").mock(
            return_value=httpx.Response(200, json=SAMPLE_USER_RESPONSE)
        )
        respx.get("https://api.x.com/2/users/2244994945/tweets").mock(
            return_value=httpx.Response(200, json=SAMPLE_TWEETS_RESPONSE)
        )

        async with httpx.AsyncClient() as client:
            adapter = TwitterAdapter(bearer_token="test-token", http_client=client)
            items = await adapter.fetch_latest("testuser")

        second = items[1]
        assert second.raw_content is not None
        assert "[Quoted: Original quoted content here]" in second.raw_content

    @respx.mock
    async def test_fetch_latest_skip_content(self) -> None:
        respx.get("https://api.x.com/2/users/by/username/testuser").mock(
            return_value=httpx.Response(200, json=SAMPLE_USER_RESPONSE)
        )
        respx.get("https://api.x.com/2/users/2244994945/tweets").mock(
            return_value=httpx.Response(200, json=SAMPLE_TWEETS_RESPONSE)
        )

        async with httpx.AsyncClient() as client:
            adapter = TwitterAdapter(bearer_token="test-token", http_client=client)
            items = await adapter.fetch_latest("testuser", skip_content=True)

        assert len(items) == 2
        for item in items:
            assert item.raw_content is None

    @respx.mock
    async def test_fetch_latest_http_error(self) -> None:
        respx.get("https://api.x.com/2/users/by/username/testuser").mock(
            return_value=httpx.Response(401)
        )

        async with httpx.AsyncClient() as client:
            adapter = TwitterAdapter(bearer_token="bad-token", http_client=client)
            with pytest.raises(httpx.HTTPStatusError):
                await adapter.fetch_latest("testuser")

    @respx.mock
    async def test_fetch_latest_user_not_found(self) -> None:
        respx.get("https://api.x.com/2/users/by/username/nonexistent").mock(
            return_value=httpx.Response(
                200,
                json={
                    "errors": [
                        {
                            "title": "Not Found Error",
                            "detail": "Could not find user with username: [nonexistent].",
                        }
                    ]
                },
            )
        )

        async with httpx.AsyncClient() as client:
            adapter = TwitterAdapter(bearer_token="test-token", http_client=client)
            items = await adapter.fetch_latest("nonexistent")

        assert len(items) == 0

    @respx.mock
    async def test_fetch_latest_api_error(self) -> None:
        respx.get("https://api.x.com/2/users/by/username/testuser").mock(
            return_value=httpx.Response(200, json=SAMPLE_USER_RESPONSE)
        )
        respx.get("https://api.x.com/2/users/2244994945/tweets").mock(
            return_value=httpx.Response(
                200,
                json={
                    "errors": [
                        {
                            "title": "Authorization Error",
                            "detail": "Not authorized to view this resource.",
                        }
                    ]
                },
            )
        )

        async with httpx.AsyncClient() as client:
            adapter = TwitterAdapter(bearer_token="test-token", http_client=client)
            items = await adapter.fetch_latest("testuser")

        assert len(items) == 0

    def test_make_title_short_text(self) -> None:
        adapter = TwitterAdapter(bearer_token="test-token")
        assert adapter._make_title("Short tweet") == "Short tweet"

    def test_make_title_long_text(self) -> None:
        adapter = TwitterAdapter(bearer_token="test-token")
        long_text = "A" * 200
        title = adapter._make_title(long_text)
        assert len(title) == 100
        assert title.endswith("...")

    def test_make_title_multiline(self) -> None:
        adapter = TwitterAdapter(bearer_token="test-token")
        title = adapter._make_title("First line\nSecond line")
        assert title == "First line"

    def test_parse_iso_date_valid(self) -> None:
        adapter = TwitterAdapter(bearer_token="test-token")
        result = adapter._parse_iso_date("2024-12-10T07:00:30.000Z")
        assert result == datetime(2024, 12, 10, 7, 0, 30, tzinfo=UTC)

    def test_parse_iso_date_none(self) -> None:
        adapter = TwitterAdapter(bearer_token="test-token")
        result = adapter._parse_iso_date(None)
        assert result.tzinfo is not None

    def test_parse_iso_date_invalid(self) -> None:
        adapter = TwitterAdapter(bearer_token="test-token")
        result = adapter._parse_iso_date("not-a-date")
        assert result.tzinfo is not None

    @respx.mock
    async def test_fetch_sends_correct_auth_header(self) -> None:
        user_route = respx.get("https://api.x.com/2/users/by/username/testuser").mock(
            return_value=httpx.Response(200, json=SAMPLE_USER_RESPONSE)
        )
        respx.get("https://api.x.com/2/users/2244994945/tweets").mock(
            return_value=httpx.Response(200, json={"data": [], "meta": {"result_count": 0}})
        )

        async with httpx.AsyncClient() as client:
            adapter = TwitterAdapter(bearer_token="my-secret-token", http_client=client)
            await adapter.fetch_latest("testuser")

        assert user_route.called
        request = user_route.calls[0].request
        assert request.headers["Authorization"] == "Bearer my-secret-token"

    @respx.mock
    async def test_fetch_sends_correct_params(self) -> None:
        respx.get("https://api.x.com/2/users/by/username/testuser").mock(
            return_value=httpx.Response(200, json=SAMPLE_USER_RESPONSE)
        )
        tweets_route = respx.get("https://api.x.com/2/users/2244994945/tweets").mock(
            return_value=httpx.Response(200, json={"data": [], "meta": {"result_count": 0}})
        )

        async with httpx.AsyncClient() as client:
            adapter = TwitterAdapter(bearer_token="test-token", http_client=client)
            await adapter.fetch_latest("testuser")

        request = tweets_route.calls[0].request
        url_str = str(request.url)
        assert "max_results=5" in url_str
        assert "exclude=retweets" in url_str

    @respx.mock
    async def test_fetch_without_http_client(self) -> None:
        respx.get("https://api.x.com/2/users/by/username/testuser").mock(
            return_value=httpx.Response(200, json=SAMPLE_USER_RESPONSE)
        )
        respx.get("https://api.x.com/2/users/2244994945/tweets").mock(
            return_value=httpx.Response(200, json=SAMPLE_TWEETS_RESPONSE)
        )

        adapter = TwitterAdapter(bearer_token="test-token")
        items = await adapter.fetch_latest("testuser")

        assert len(items) == 2

    @respx.mock
    async def test_user_id_caching(self) -> None:
        user_route = respx.get("https://api.x.com/2/users/by/username/testuser").mock(
            return_value=httpx.Response(200, json=SAMPLE_USER_RESPONSE)
        )
        respx.get("https://api.x.com/2/users/2244994945/tweets").mock(
            return_value=httpx.Response(200, json={"data": [], "meta": {"result_count": 0}})
        )

        async with httpx.AsyncClient() as client:
            adapter = TwitterAdapter(bearer_token="test-token", http_client=client)
            await adapter.fetch_latest("testuser")
            await adapter.fetch_latest("testuser")

        assert user_route.call_count == 1

    @respx.mock
    async def test_media_thumbnail_in_tweet(self) -> None:
        response_with_media = {
            "data": [
                {
                    "id": "55555",
                    "text": "Check out this image",
                    "created_at": "2024-12-10T07:00:30.000Z",
                    "author_id": "2244994945",
                    "attachments": {
                        "media_keys": ["media_1"],
                    },
                },
            ],
            "includes": {
                "users": [
                    {
                        "id": "2244994945",
                        "name": "Test User",
                        "username": "testuser",
                        "profile_image_url": "https://pbs.twimg.com/profile.jpg",
                    },
                ],
                "media": [
                    {
                        "media_key": "media_1",
                        "type": "photo",
                        "url": "https://pbs.twimg.com/media/photo123.jpg",
                    },
                ],
            },
            "meta": {"result_count": 1},
        }

        respx.get("https://api.x.com/2/users/by/username/testuser").mock(
            return_value=httpx.Response(200, json=SAMPLE_USER_RESPONSE)
        )
        respx.get("https://api.x.com/2/users/2244994945/tweets").mock(
            return_value=httpx.Response(200, json=response_with_media)
        )

        async with httpx.AsyncClient() as client:
            adapter = TwitterAdapter(bearer_token="test-token", http_client=client)
            items = await adapter.fetch_latest("testuser")

        assert len(items) == 1
        assert items[0].thumbnail_url == "https://pbs.twimg.com/media/photo123.jpg"

    @respx.mock
    async def test_empty_timeline(self) -> None:
        respx.get("https://api.x.com/2/users/by/username/testuser").mock(
            return_value=httpx.Response(200, json=SAMPLE_USER_RESPONSE)
        )
        respx.get("https://api.x.com/2/users/2244994945/tweets").mock(
            return_value=httpx.Response(200, json={"meta": {"result_count": 0}})
        )

        async with httpx.AsyncClient() as client:
            adapter = TwitterAdapter(bearer_token="test-token", http_client=client)
            items = await adapter.fetch_latest("testuser")

        assert len(items) == 0

    @respx.mock
    async def test_tweet_url_without_username(self) -> None:
        response_no_user = {
            "data": [
                {
                    "id": "77777",
                    "text": "Tweet without user expansion",
                    "created_at": "2024-12-10T07:00:30.000Z",
                    "author_id": "9999",
                },
            ],
            "includes": {},
            "meta": {"result_count": 1},
        }

        respx.get("https://api.x.com/2/users/by/username/testuser").mock(
            return_value=httpx.Response(200, json=SAMPLE_USER_RESPONSE)
        )
        respx.get("https://api.x.com/2/users/2244994945/tweets").mock(
            return_value=httpx.Response(200, json=response_no_user)
        )

        async with httpx.AsyncClient() as client:
            adapter = TwitterAdapter(bearer_token="test-token", http_client=client)
            items = await adapter.fetch_latest("testuser")

        assert len(items) == 1
        assert items[0].original_url == "https://x.com/i/status/77777"
        assert items[0].author == "Unknown"

    @respx.mock
    async def test_note_tweet_uses_long_form_text(self) -> None:
        response_with_note = {
            "data": [
                {
                    "id": "88888",
                    "text": "This is the truncated version...",
                    "note_tweet": {
                        "text": "This is the full long-form tweet text that exceeds 280 characters and would normally be truncated in the regular text field.",
                    },
                    "created_at": "2024-12-10T07:00:30.000Z",
                    "author_id": "2244994945",
                },
            ],
            "includes": {
                "users": [
                    {
                        "id": "2244994945",
                        "name": "Test User",
                        "username": "testuser",
                        "profile_image_url": "https://pbs.twimg.com/profile.jpg",
                    },
                ],
            },
            "meta": {"result_count": 1},
        }

        respx.get("https://api.x.com/2/users/by/username/testuser").mock(
            return_value=httpx.Response(200, json=SAMPLE_USER_RESPONSE)
        )
        respx.get("https://api.x.com/2/users/2244994945/tweets").mock(
            return_value=httpx.Response(200, json=response_with_note)
        )

        async with httpx.AsyncClient() as client:
            adapter = TwitterAdapter(bearer_token="test-token", http_client=client)
            items = await adapter.fetch_latest("testuser")

        assert len(items) == 1
        assert items[0].raw_content is not None
        assert "full long-form tweet text" in items[0].raw_content
        assert "truncated version" not in items[0].raw_content
