from datetime import datetime

import pytest

from intelstream.database.models import SourceType
from intelstream.database.repository import Repository


@pytest.fixture
async def repository():
    repo = Repository("sqlite+aiosqlite:///:memory:")
    await repo.initialize()
    yield repo
    await repo.close()


class TestSourceOperations:
    async def test_add_source(self, repository: Repository) -> None:
        source = await repository.add_source(
            source_type=SourceType.SUBSTACK,
            name="Test Substack",
            identifier="test-substack",
            feed_url="https://test.substack.com/feed",
            poll_interval_minutes=10,
        )

        assert source.id is not None
        assert source.name == "Test Substack"
        assert source.type == SourceType.SUBSTACK
        assert source.identifier == "test-substack"
        assert source.feed_url == "https://test.substack.com/feed"
        assert source.poll_interval_minutes == 10
        assert source.is_active is True

    async def test_get_source_by_identifier(self, repository: Repository) -> None:
        await repository.add_source(
            source_type=SourceType.YOUTUBE,
            name="Test YouTube",
            identifier="UC12345",
        )

        source = await repository.get_source_by_identifier("UC12345")
        assert source is not None
        assert source.name == "Test YouTube"

        missing = await repository.get_source_by_identifier("nonexistent")
        assert missing is None

    async def test_get_all_sources(self, repository: Repository) -> None:
        await repository.add_source(
            source_type=SourceType.SUBSTACK,
            name="Source 1",
            identifier="source-1",
        )
        await repository.add_source(
            source_type=SourceType.YOUTUBE,
            name="Source 2",
            identifier="source-2",
        )

        sources = await repository.get_all_sources()
        assert len(sources) == 2

    async def test_set_source_active(self, repository: Repository) -> None:
        await repository.add_source(
            source_type=SourceType.RSS,
            name="Test RSS",
            identifier="test-rss",
        )

        source = await repository.set_source_active("test-rss", False)
        assert source is not None
        assert source.is_active is False

        sources = await repository.get_all_sources(active_only=True)
        assert len(sources) == 0

        all_sources = await repository.get_all_sources(active_only=False)
        assert len(all_sources) == 1

    async def test_delete_source(self, repository: Repository) -> None:
        await repository.add_source(
            source_type=SourceType.SUBSTACK,
            name="To Delete",
            identifier="to-delete",
        )

        result = await repository.delete_source("to-delete")
        assert result is True

        source = await repository.get_source_by_identifier("to-delete")
        assert source is None

        result = await repository.delete_source("nonexistent")
        assert result is False


class TestContentItemOperations:
    async def test_add_content_item(self, repository: Repository) -> None:
        source = await repository.add_source(
            source_type=SourceType.SUBSTACK,
            name="Test Source",
            identifier="test-source",
        )

        content = await repository.add_content_item(
            source_id=source.id,
            external_id="https://test.substack.com/p/article-1",
            title="Test Article",
            original_url="https://test.substack.com/p/article-1",
            author="Test Author",
            published_at=datetime(2024, 1, 15, 12, 0, 0),
            raw_content="This is the article content.",
        )

        assert content.id is not None
        assert content.title == "Test Article"
        assert content.posted_to_discord is False

    async def test_content_item_exists(self, repository: Repository) -> None:
        source = await repository.add_source(
            source_type=SourceType.YOUTUBE,
            name="Test Channel",
            identifier="test-channel",
        )

        await repository.add_content_item(
            source_id=source.id,
            external_id="video123",
            title="Test Video",
            original_url="https://youtube.com/watch?v=video123",
            author="Test Creator",
            published_at=datetime.utcnow(),
        )

        assert await repository.content_item_exists("video123") is True
        assert await repository.content_item_exists("nonexistent") is False

    async def test_update_and_mark_posted(self, repository: Repository) -> None:
        source = await repository.add_source(
            source_type=SourceType.RSS,
            name="Test Blog",
            identifier="test-blog",
        )

        content = await repository.add_content_item(
            source_id=source.id,
            external_id="blog-post-1",
            title="Blog Post",
            original_url="https://blog.example.com/post-1",
            author="Blogger",
            published_at=datetime.utcnow(),
            raw_content="Blog content here.",
        )

        await repository.update_content_item_summary(content.id, "This is the summary.")

        await repository.mark_content_item_posted(content.id, "discord-msg-123")

        updated = await repository.get_content_item_by_external_id("blog-post-1")
        assert updated is not None
        assert updated.summary == "This is the summary."
        assert updated.posted_to_discord is True
        assert updated.discord_message_id == "discord-msg-123"

    async def test_get_unposted_content_items(self, repository: Repository) -> None:
        source = await repository.add_source(
            source_type=SourceType.SUBSTACK,
            name="Test",
            identifier="test",
        )

        content1 = await repository.add_content_item(
            source_id=source.id,
            external_id="post-1",
            title="Post 1",
            original_url="https://example.com/1",
            author="Author",
            published_at=datetime(2024, 1, 1),
        )

        content2 = await repository.add_content_item(
            source_id=source.id,
            external_id="post-2",
            title="Post 2",
            original_url="https://example.com/2",
            author="Author",
            published_at=datetime(2024, 1, 2),
        )

        await repository.update_content_item_summary(content1.id, "Summary 1")
        await repository.update_content_item_summary(content2.id, "Summary 2")

        unposted = await repository.get_unposted_content_items()
        assert len(unposted) == 2

        await repository.mark_content_item_posted(content1.id, "msg-1")

        unposted = await repository.get_unposted_content_items()
        assert len(unposted) == 1
        assert unposted[0].external_id == "post-2"


class TestDiscordConfigOperations:
    async def test_get_or_create_discord_config(self, repository: Repository) -> None:
        config = await repository.get_or_create_discord_config(
            guild_id="guild-123",
            channel_id="channel-456",
        )

        assert config.guild_id == "guild-123"
        assert config.channel_id == "channel-456"

        updated = await repository.get_or_create_discord_config(
            guild_id="guild-123",
            channel_id="channel-789",
        )

        assert updated.id == config.id
        assert updated.channel_id == "channel-789"

    async def test_get_discord_config(self, repository: Repository) -> None:
        await repository.get_or_create_discord_config(
            guild_id="guild-abc",
            channel_id="channel-def",
        )

        config = await repository.get_discord_config("guild-abc")
        assert config is not None
        assert config.channel_id == "channel-def"

        missing = await repository.get_discord_config("nonexistent")
        assert missing is None
