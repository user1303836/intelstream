from datetime import UTC, datetime
from typing import Any

import httpx
import structlog

from intelstream.adapters.base import BaseAdapter, ContentData

logger = structlog.get_logger()

X_API_BASE = "https://api.x.com/2"
TITLE_MAX_LENGTH = 100

TWEET_FIELDS = "created_at,author_id,referenced_tweets,attachments,public_metrics,note_tweet"
USER_FIELDS = "name,username,profile_image_url"
MEDIA_FIELDS = "url,preview_image_url,type"
EXPANSIONS = "author_id,attachments.media_keys,referenced_tweets.id"


class TwitterAdapter(BaseAdapter):
    def __init__(self, bearer_token: str, http_client: httpx.AsyncClient | None = None) -> None:
        self._bearer_token = bearer_token
        self._client = http_client
        self._user_id_cache: dict[str, str] = {}

    @property
    def source_type(self) -> str:
        return "twitter"

    async def get_feed_url(self, identifier: str) -> str:
        return f"https://x.com/{identifier}"

    async def fetch_latest(
        self,
        identifier: str,
        feed_url: str | None = None,  # noqa: ARG002
        skip_content: bool = False,
    ) -> list[ContentData]:
        logger.debug("Fetching Twitter timeline", identifier=identifier, skip_content=skip_content)

        user_id = await self._resolve_user_id(identifier)
        if not user_id:
            return []

        params: dict[str, str] = {
            "max_results": "5",
            "exclude": "retweets,replies",
            "tweet.fields": TWEET_FIELDS,
            "user.fields": USER_FIELDS,
            "expansions": EXPANSIONS,
        }

        if not skip_content:
            params["media.fields"] = MEDIA_FIELDS

        response = await self._request(f"{X_API_BASE}/users/{user_id}/tweets", params=params)
        data = response.json()

        if "errors" in data and "data" not in data:
            for error in data["errors"]:
                logger.error(
                    "X API error",
                    identifier=identifier,
                    error_title=error.get("title"),
                    error_detail=error.get("detail"),
                )
            return []

        tweets_raw: list[dict[str, Any]] = data.get("data", [])
        includes: dict[str, Any] = data.get("includes", {})
        meta: dict[str, Any] = data.get("meta", {})

        logger.debug(
            "X API response",
            identifier=identifier,
            tweet_count=len(tweets_raw),
            result_count=meta.get("result_count"),
        )

        users_map = self._build_users_map(includes)
        media_map = self._build_media_map(includes)
        referenced_tweets_map = self._build_referenced_tweets_map(includes)

        items: list[ContentData] = []
        for tweet in tweets_raw:
            try:
                item = self._parse_tweet(
                    tweet,
                    users_map=users_map,
                    media_map=media_map,
                    referenced_tweets_map=referenced_tweets_map,
                    skip_content=skip_content,
                )
                items.append(item)
            except Exception as e:
                logger.warning(
                    "Failed to parse tweet",
                    tweet_id=tweet.get("id"),
                    error=str(e),
                )
                continue

        logger.info("Fetched Twitter content", identifier=identifier, count=len(items))
        return items

    async def _resolve_user_id(self, username: str) -> str | None:
        if username in self._user_id_cache:
            return self._user_id_cache[username]

        response = await self._request(
            f"{X_API_BASE}/users/by/username/{username}",
            params={"user.fields": "id"},
        )

        data = response.json()

        if "errors" in data and "data" not in data:
            for error in data["errors"]:
                logger.error(
                    "X API user lookup error",
                    username=username,
                    error_title=error.get("title"),
                    error_detail=error.get("detail"),
                )
            return None

        user_data: dict[str, Any] | None = data.get("data")
        if not user_data:
            logger.error("X API user not found", username=username)
            return None

        user_id = str(user_data["id"])
        self._user_id_cache[username] = user_id
        return user_id

    async def _request(self, url: str, params: dict[str, str] | None = None) -> httpx.Response:
        headers = {"Authorization": f"Bearer {self._bearer_token}"}

        if self._client:
            response = await self._client.get(url, headers=headers, params=params)
        else:
            async with httpx.AsyncClient(timeout=30.0) as client:
                response = await client.get(url, headers=headers, params=params)

        response.raise_for_status()
        return response

    def _build_users_map(self, includes: dict[str, Any]) -> dict[str, dict[str, Any]]:
        users: list[dict[str, Any]] = includes.get("users", [])
        return {str(u["id"]): u for u in users}

    def _build_media_map(self, includes: dict[str, Any]) -> dict[str, dict[str, Any]]:
        media: list[dict[str, Any]] = includes.get("media", [])
        return {str(m["media_key"]): m for m in media}

    def _build_referenced_tweets_map(self, includes: dict[str, Any]) -> dict[str, dict[str, Any]]:
        tweets: list[dict[str, Any]] = includes.get("tweets", [])
        return {str(t["id"]): t for t in tweets}

    def _parse_tweet(
        self,
        tweet: dict[str, Any],
        users_map: dict[str, dict[str, Any]],
        media_map: dict[str, dict[str, Any]],
        referenced_tweets_map: dict[str, dict[str, Any]],
        skip_content: bool = False,
    ) -> ContentData:
        tweet_id = str(tweet["id"])
        note_tweet = tweet.get("note_tweet")
        text = (
            str(note_tweet["text"])
            if isinstance(note_tweet, dict) and "text" in note_tweet
            else str(tweet.get("text", ""))
        )
        author_id = str(tweet.get("author_id", ""))

        author_info = users_map.get(author_id, {})
        author_name = str(author_info.get("name") or author_info.get("username", "Unknown"))
        username = str(author_info.get("username", ""))
        profile_pic = author_info.get("profile_image_url")

        url = (
            f"https://x.com/{username}/status/{tweet_id}"
            if username
            else f"https://x.com/i/status/{tweet_id}"
        )

        title = self._make_title(text)
        published_at = self._parse_iso_date(tweet.get("created_at"))

        raw_content = None
        if not skip_content:
            raw_content = text

            quoted_text = self._get_quoted_tweet_text(tweet, referenced_tweets_map)
            if quoted_text:
                raw_content += f"\n\n[Quoted: {quoted_text}]"

        thumbnail_url = self._get_thumbnail_url(tweet, media_map, profile_pic)

        return ContentData(
            external_id=tweet_id,
            title=title,
            original_url=url,
            author=author_name,
            published_at=published_at,
            raw_content=raw_content,
            thumbnail_url=thumbnail_url,
        )

    def _get_quoted_tweet_text(
        self,
        tweet: dict[str, Any],
        referenced_tweets_map: dict[str, dict[str, Any]],
    ) -> str | None:
        refs: list[dict[str, Any]] = tweet.get("referenced_tweets", [])
        for ref in refs:
            if ref.get("type") == "quoted":
                ref_id = str(ref["id"])
                quoted = referenced_tweets_map.get(ref_id)
                if quoted:
                    return str(quoted.get("text", ""))
        return None

    def _get_thumbnail_url(
        self,
        tweet: dict[str, Any],
        media_map: dict[str, dict[str, Any]],
        profile_pic: str | None,
    ) -> str | None:
        attachments: dict[str, Any] = tweet.get("attachments", {})
        media_keys: list[str] = attachments.get("media_keys", [])

        for key in media_keys:
            media = media_map.get(key, {})
            media_url = media.get("url") or media.get("preview_image_url")
            if media_url:
                return str(media_url)

        return str(profile_pic) if profile_pic else None

    def _make_title(self, text: str) -> str:
        first_line = text.split("\n")[0]
        if len(first_line) <= TITLE_MAX_LENGTH:
            return first_line
        return first_line[: TITLE_MAX_LENGTH - 3] + "..."

    def _parse_iso_date(self, date_str: Any) -> datetime:
        if not date_str:
            return datetime.now(UTC)
        try:
            s = str(date_str).replace("Z", "+00:00")
            return datetime.fromisoformat(s)
        except (ValueError, TypeError):
            return datetime.now(UTC)
