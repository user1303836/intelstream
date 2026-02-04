from datetime import UTC, datetime

import httpx
import structlog

from intelstream.adapters.base import BaseAdapter, ContentData

logger = structlog.get_logger()

TWITTER_API_BASE = "https://api.twitterapi.io"
TWITTER_DATE_FORMAT = "%a %b %d %H:%M:%S %z %Y"
TITLE_MAX_LENGTH = 100


class TwitterAdapter(BaseAdapter):
    def __init__(self, api_key: str, http_client: httpx.AsyncClient | None = None) -> None:
        self._api_key = api_key
        self._client = http_client

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

        headers = {"X-API-Key": self._api_key}
        params: dict[str, str] = {"userName": identifier, "includeReplies": "false"}

        if self._client:
            response = await self._client.get(
                f"{TWITTER_API_BASE}/twitter/user/last_tweets",
                headers=headers,
                params=params,
            )
        else:
            async with httpx.AsyncClient(timeout=30.0) as client:
                response = await client.get(
                    f"{TWITTER_API_BASE}/twitter/user/last_tweets",
                    headers=headers,
                    params=params,
                )

        response.raise_for_status()
        data = response.json()

        tweets_raw = data.get("tweets", [])
        logger.debug(
            "Twitter API response",
            identifier=identifier,
            status=data.get("status"),
            tweet_count=len(tweets_raw),
            has_next_page=data.get("has_next_page"),
        )

        if data.get("status") != "success":
            logger.error(
                "Twitter API returned error",
                identifier=identifier,
                message=data.get("message"),
            )
            return []

        items: list[ContentData] = []
        for tweet in tweets_raw:
            if tweet.get("retweeted_tweet"):
                continue

            try:
                item = self._parse_tweet(tweet, skip_content=skip_content)
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

    def _parse_tweet(self, tweet: dict[str, object], skip_content: bool = False) -> ContentData:
        tweet_id = str(tweet["id"])
        text = str(tweet.get("text", ""))
        url = str(tweet.get("url", f"https://x.com/i/status/{tweet_id}"))

        author_data = tweet.get("author") or {}
        if not isinstance(author_data, dict):
            author_data = {}
        author_name = str(author_data.get("name") or author_data.get("userName", "Unknown"))
        profile_pic = author_data.get("profilePicture")

        title = self._make_title(text)
        published_at = self._parse_twitter_date(
            str(tweet["createdAt"]) if tweet.get("createdAt") else None
        )

        raw_content = None
        if not skip_content:
            raw_content = text
            quoted = tweet.get("quoted_tweet")
            if isinstance(quoted, dict) and quoted.get("text"):
                raw_content += f"\n\n[Quoted: {quoted['text']}]"

        return ContentData(
            external_id=tweet_id,
            title=title,
            original_url=url,
            author=author_name,
            published_at=published_at,
            raw_content=raw_content,
            thumbnail_url=str(profile_pic) if profile_pic else None,
        )

    def _make_title(self, text: str) -> str:
        first_line = text.split("\n")[0]
        if len(first_line) <= TITLE_MAX_LENGTH:
            return first_line
        return first_line[: TITLE_MAX_LENGTH - 3] + "..."

    def _parse_twitter_date(self, date_str: str | None) -> datetime:
        if not date_str:
            return datetime.now(UTC)
        try:
            return datetime.strptime(date_str, TWITTER_DATE_FORMAT)
        except (ValueError, TypeError):
            return datetime.now(UTC)
