from abc import ABC, abstractmethod
from dataclasses import dataclass
from datetime import datetime


@dataclass
class ContentData:
    external_id: str
    title: str
    original_url: str
    author: str
    published_at: datetime
    raw_content: str | None = None
    thumbnail_url: str | None = None


class BaseAdapter(ABC):
    @property
    @abstractmethod
    def source_type(self) -> str:
        pass

    @abstractmethod
    async def fetch_latest(
        self,
        identifier: str,
        feed_url: str | None = None,
        skip_content: bool = False,
    ) -> list[ContentData]:
        pass

    @abstractmethod
    async def get_feed_url(self, identifier: str) -> str:
        pass

    async def close(self) -> None:
        """Release resources owned by the adapter."""
        return None
