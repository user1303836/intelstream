import httpx

from intelstream.adapters.base import ContentData
from intelstream.adapters.rss import RSSAdapter


class SubstackAdapter(RSSAdapter):
    def __init__(self, http_client: httpx.AsyncClient | None = None) -> None:
        super().__init__(http_client=http_client)

    @property
    def source_type(self) -> str:
        return "substack"

    async def get_feed_url(self, identifier: str) -> str:
        identifier = identifier.strip().lower()
        if identifier.startswith("http"):
            if not identifier.endswith("/feed"):
                return identifier.rstrip("/") + "/feed"
            return identifier
        return f"https://{identifier}.substack.com/feed"

    async def fetch_latest(
        self,
        identifier: str,
        feed_url: str | None = None,
        skip_content: bool = False,
    ) -> list[ContentData]:
        resolved_feed_url = feed_url or await self.get_feed_url(identifier)
        return await super().fetch_latest(
            identifier, feed_url=resolved_feed_url, skip_content=skip_content
        )
