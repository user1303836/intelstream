from datetime import UTC, datetime

import pytest

from intelstream.adapters.base import BaseAdapter, ContentData
from intelstream.adapters.strategies.base import (
    DiscoveredPost,
    DiscoveryResult,
    DiscoveryStrategy,
)


class SuperAdapter(BaseAdapter):
    @property
    def source_type(self):
        return super().source_type

    async def fetch_latest(self, identifier, feed_url=None, skip_content=False):
        return await super().fetch_latest(identifier, feed_url, skip_content)

    async def get_feed_url(self, identifier):
        return await super().get_feed_url(identifier)


class SuperStrategy(DiscoveryStrategy):
    @property
    def name(self):
        return super().name

    async def discover(self, url, url_pattern=None):
        return await super().discover(url, url_pattern)


def test_base_adapter_is_abstract() -> None:
    with pytest.raises(TypeError, match="abstract"):
        BaseAdapter()


async def test_base_adapter_super_methods_are_noops() -> None:
    adapter = SuperAdapter()

    assert adapter.source_type is None
    assert await adapter.fetch_latest("identifier", feed_url="feed", skip_content=True) is None
    assert await adapter.get_feed_url("identifier") is None
    assert await adapter.close() is None


def test_content_data_defaults() -> None:
    published_at = datetime(2024, 1, 1, tzinfo=UTC)
    content = ContentData(
        external_id="external-1",
        title="Title",
        original_url="https://example.com/post",
        author="Author",
        published_at=published_at,
    )

    assert content.raw_content is None
    assert content.thumbnail_url is None
    assert content.published_at == published_at


def test_discovery_strategy_is_abstract() -> None:
    with pytest.raises(TypeError, match="abstract"):
        DiscoveryStrategy()


async def test_discovery_strategy_super_methods_are_noops() -> None:
    strategy = SuperStrategy()

    assert strategy.name is None
    assert await strategy.discover("https://example.com", url_pattern="/posts/*") is None


def test_discovery_dataclass_defaults() -> None:
    post = DiscoveredPost(url="https://example.com/post", title="Post")
    result = DiscoveryResult(posts=[post])

    assert post.published_at is None
    assert result.feed_url is None
    assert result.url_pattern is None
    assert result.posts == [post]
