from datetime import UTC, datetime

import pytest
from sqlalchemy import text
from sqlalchemy.ext.asyncio import create_async_engine

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

    async def test_add_source_with_channel(self, repository: Repository) -> None:
        source = await repository.add_source(
            source_type=SourceType.SUBSTACK,
            name="Channel Scoped Source",
            identifier="channel-scoped",
            feed_url="https://test.substack.com/feed",
            guild_id="guild-123",
            channel_id="channel-456",
        )

        assert source.id is not None
        assert source.guild_id == "guild-123"
        assert source.channel_id == "channel-456"

    async def test_add_source_poll_interval_too_low(self, repository: Repository) -> None:
        with pytest.raises(ValueError, match="poll_interval_minutes must be between"):
            await repository.add_source(
                source_type=SourceType.SUBSTACK,
                name="Test",
                identifier="test-low",
                poll_interval_minutes=0,
            )

    async def test_add_source_poll_interval_too_high(self, repository: Repository) -> None:
        with pytest.raises(ValueError, match="poll_interval_minutes must be between"):
            await repository.add_source(
                source_type=SourceType.SUBSTACK,
                name="Test",
                identifier="test-high",
                poll_interval_minutes=61,
            )

    async def test_add_source_poll_interval_at_boundaries(self, repository: Repository) -> None:
        source_min = await repository.add_source(
            source_type=SourceType.SUBSTACK,
            name="Min Interval",
            identifier="test-min",
            poll_interval_minutes=1,
        )
        assert source_min.poll_interval_minutes == 1

        source_max = await repository.add_source(
            source_type=SourceType.SUBSTACK,
            name="Max Interval",
            identifier="test-max",
            poll_interval_minutes=60,
        )
        assert source_max.poll_interval_minutes == 60

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

    async def test_get_all_sources_filtered_by_channel(self, repository: Repository) -> None:
        await repository.add_source(
            source_type=SourceType.SUBSTACK,
            name="Channel A Source",
            identifier="source-a",
            channel_id="channel-a",
        )
        await repository.add_source(
            source_type=SourceType.YOUTUBE,
            name="Channel B Source",
            identifier="source-b",
            channel_id="channel-b",
        )
        await repository.add_source(
            source_type=SourceType.RSS,
            name="No Channel Source",
            identifier="source-none",
        )

        sources_a = await repository.get_all_sources(channel_id="channel-a")
        assert len(sources_a) == 1
        assert sources_a[0].name == "Channel A Source"

        sources_b = await repository.get_all_sources(channel_id="channel-b")
        assert len(sources_b) == 1
        assert sources_b[0].name == "Channel B Source"

        all_sources = await repository.get_all_sources()
        assert len(all_sources) == 3

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
            published_at=datetime.now(UTC),
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
            published_at=datetime.now(UTC),
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


class TestFirstPostingOperations:
    async def test_has_source_posted_content_false_when_none_posted(
        self, repository: Repository
    ) -> None:
        source = await repository.add_source(
            source_type=SourceType.SUBSTACK,
            name="Test",
            identifier="test",
        )

        await repository.add_content_item(
            source_id=source.id,
            external_id="post-1",
            title="Post 1",
            original_url="https://example.com/1",
            author="Author",
            published_at=datetime(2024, 1, 1),
        )

        has_posted = await repository.has_source_posted_content(source.id)
        assert has_posted is False

    async def test_has_source_posted_content_true_when_posted(self, repository: Repository) -> None:
        source = await repository.add_source(
            source_type=SourceType.SUBSTACK,
            name="Test",
            identifier="test",
        )

        content = await repository.add_content_item(
            source_id=source.id,
            external_id="post-1",
            title="Post 1",
            original_url="https://example.com/1",
            author="Author",
            published_at=datetime(2024, 1, 1),
        )

        await repository.mark_content_item_posted(content.id, "msg-123")

        has_posted = await repository.has_source_posted_content(source.id)
        assert has_posted is True

    async def test_get_most_recent_item_for_source(self, repository: Repository) -> None:
        source = await repository.add_source(
            source_type=SourceType.RSS,
            name="Test",
            identifier="test",
        )

        await repository.add_content_item(
            source_id=source.id,
            external_id="old-post",
            title="Old Post",
            original_url="https://example.com/old",
            author="Author",
            published_at=datetime(2024, 1, 1),
        )

        await repository.add_content_item(
            source_id=source.id,
            external_id="new-post",
            title="New Post",
            original_url="https://example.com/new",
            author="Author",
            published_at=datetime(2024, 1, 15),
        )

        most_recent = await repository.get_most_recent_item_for_source(source.id)
        assert most_recent is not None
        assert most_recent.external_id == "new-post"

    async def test_get_most_recent_item_for_source_empty(self, repository: Repository) -> None:
        source = await repository.add_source(
            source_type=SourceType.RSS,
            name="Test",
            identifier="test",
        )

        most_recent = await repository.get_most_recent_item_for_source(source.id)
        assert most_recent is None

    async def test_mark_items_as_backfilled(self, repository: Repository) -> None:
        source = await repository.add_source(
            source_type=SourceType.ARXIV,
            name="Test",
            identifier="test",
        )

        await repository.add_content_item(
            source_id=source.id,
            external_id="old-1",
            title="Old 1",
            original_url="https://example.com/old1",
            author="Author",
            published_at=datetime(2024, 1, 1),
        )

        await repository.add_content_item(
            source_id=source.id,
            external_id="old-2",
            title="Old 2",
            original_url="https://example.com/old2",
            author="Author",
            published_at=datetime(2024, 1, 2),
        )

        content3 = await repository.add_content_item(
            source_id=source.id,
            external_id="new",
            title="New",
            original_url="https://example.com/new",
            author="Author",
            published_at=datetime(2024, 1, 15),
        )

        backfilled_count = await repository.mark_items_as_backfilled(
            source_id=source.id,
            exclude_item_id=content3.id,
        )

        assert backfilled_count == 2

        item1 = await repository.get_content_item_by_external_id("old-1")
        assert item1 is not None
        assert item1.posted_to_discord is True
        assert item1.discord_message_id == "backfilled"

        item3 = await repository.get_content_item_by_external_id("new")
        assert item3 is not None
        assert item3.posted_to_discord is False

    async def test_mark_items_as_backfilled_skips_summarized_items(
        self, repository: Repository
    ) -> None:
        source = await repository.add_source(
            source_type=SourceType.ARXIV,
            name="Test",
            identifier="test",
        )

        await repository.add_content_item(
            source_id=source.id,
            external_id="unsummarized",
            title="Unsummarized",
            original_url="https://example.com/1",
            author="Author",
            published_at=datetime(2024, 1, 1),
        )

        summarized = await repository.add_content_item(
            source_id=source.id,
            external_id="summarized",
            title="Summarized",
            original_url="https://example.com/2",
            author="Author",
            published_at=datetime(2024, 1, 2),
        )
        await repository.update_content_item_summary(summarized.id, "This has a summary")

        backfilled_count = await repository.mark_items_as_backfilled(source_id=source.id)

        assert backfilled_count == 1

        item1 = await repository.get_content_item_by_external_id("unsummarized")
        assert item1 is not None
        assert item1.posted_to_discord is True
        assert item1.discord_message_id == "backfilled"

        item2 = await repository.get_content_item_by_external_id("summarized")
        assert item2 is not None
        assert item2.posted_to_discord is False

    async def test_mark_items_as_backfilled_excludes_already_posted(
        self, repository: Repository
    ) -> None:
        source = await repository.add_source(
            source_type=SourceType.ARXIV,
            name="Test",
            identifier="test",
        )

        content1 = await repository.add_content_item(
            source_id=source.id,
            external_id="already-posted",
            title="Already Posted",
            original_url="https://example.com/1",
            author="Author",
            published_at=datetime(2024, 1, 1),
        )

        await repository.mark_content_item_posted(content1.id, "real-msg-123")

        await repository.add_content_item(
            source_id=source.id,
            external_id="unposted",
            title="Unposted",
            original_url="https://example.com/2",
            author="Author",
            published_at=datetime(2024, 1, 2),
        )

        backfilled_count = await repository.mark_items_as_backfilled(source_id=source.id)

        assert backfilled_count == 1

        item1 = await repository.get_content_item_by_external_id("already-posted")
        assert item1 is not None
        assert item1.discord_message_id == "real-msg-123"


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


class TestMigrations:
    async def test_migrate_adds_missing_columns_to_sources(self, tmp_path) -> None:
        db_path = tmp_path / "test.db"
        db_url = f"sqlite+aiosqlite:///{db_path}"

        engine = create_async_engine(db_url, echo=False)
        async with engine.begin() as conn:
            await conn.execute(
                text("""
                CREATE TABLE sources (
                    id VARCHAR(36) PRIMARY KEY,
                    type VARCHAR(10) NOT NULL,
                    name VARCHAR(255) NOT NULL,
                    identifier VARCHAR(512) NOT NULL UNIQUE,
                    feed_url VARCHAR(512),
                    extraction_profile TEXT,
                    poll_interval_minutes INTEGER DEFAULT 5,
                    is_active BOOLEAN DEFAULT 1,
                    last_polled_at DATETIME,
                    created_at DATETIME,
                    updated_at DATETIME
                )
            """)
            )
        await engine.dispose()

        repo = Repository(db_url)
        await repo.initialize()

        async with repo._engine.begin() as conn:
            result = await conn.execute(text("PRAGMA table_info(sources)"))
            columns = {row[1] for row in result.fetchall()}

        assert "discovery_strategy" in columns
        assert "url_pattern" in columns
        assert "last_content_hash" in columns
        assert "consecutive_failures" in columns
        assert "guild_id" in columns
        assert "channel_id" in columns

        await repo.close()

    async def test_migrate_is_idempotent(self, repository: Repository) -> None:
        await repository.initialize()
        await repository.initialize()

        sources = await repository.get_all_sources()
        assert sources == []

    async def test_migrate_sources_to_channel(self, repository: Repository) -> None:
        await repository.add_source(
            source_type=SourceType.SUBSTACK,
            name="No Channel",
            identifier="no-channel",
        )

        await repository.add_source(
            source_type=SourceType.RSS,
            name="Has Channel",
            identifier="has-channel",
            guild_id="existing-guild",
            channel_id="existing-channel",
        )

        migrated_count = await repository.migrate_sources_to_channel(
            guild_id="new-guild",
            channel_id="new-channel",
        )

        assert migrated_count == 1

        updated_source = await repository.get_source_by_identifier("no-channel")
        assert updated_source is not None
        assert updated_source.guild_id == "new-guild"
        assert updated_source.channel_id == "new-channel"

        unchanged_source = await repository.get_source_by_identifier("has-channel")
        assert unchanged_source is not None
        assert unchanged_source.guild_id == "existing-guild"
        assert unchanged_source.channel_id == "existing-channel"

    async def test_migrate_sources_to_channel_empty(self, repository: Repository) -> None:
        migrated_count = await repository.migrate_sources_to_channel(
            guild_id="guild",
            channel_id="channel",
        )

        assert migrated_count == 0


class TestForwardingRuleOperations:
    async def test_add_forwarding_rule(self, repository: Repository) -> None:
        rule = await repository.add_forwarding_rule(
            guild_id="guild-123",
            source_channel_id="source-456",
            source_type="channel",
            destination_channel_id="dest-789",
            destination_type="thread",
        )

        assert rule.id is not None
        assert rule.guild_id == "guild-123"
        assert rule.source_channel_id == "source-456"
        assert rule.source_type == "channel"
        assert rule.destination_channel_id == "dest-789"
        assert rule.destination_type == "thread"
        assert rule.is_active is True
        assert rule.messages_forwarded == 0

    async def test_get_forwarding_rules_for_source(self, repository: Repository) -> None:
        await repository.add_forwarding_rule(
            guild_id="guild-123",
            source_channel_id="source-456",
            source_type="channel",
            destination_channel_id="dest-789",
            destination_type="thread",
        )

        rules = await repository.get_forwarding_rules_for_source("source-456")
        assert len(rules) == 1
        assert rules[0].destination_channel_id == "dest-789"

        empty = await repository.get_forwarding_rules_for_source("nonexistent")
        assert len(empty) == 0

    async def test_get_forwarding_rules_for_source_excludes_inactive(
        self, repository: Repository
    ) -> None:
        await repository.add_forwarding_rule(
            guild_id="guild-123",
            source_channel_id="source-456",
            source_type="channel",
            destination_channel_id="dest-789",
            destination_type="thread",
        )

        await repository.set_forwarding_rule_active("guild-123", "source-456", "dest-789", False)

        rules = await repository.get_forwarding_rules_for_source("source-456")
        assert len(rules) == 0

    async def test_get_forwarding_rules_for_guild(self, repository: Repository) -> None:
        await repository.add_forwarding_rule(
            guild_id="guild-123",
            source_channel_id="source-1",
            source_type="channel",
            destination_channel_id="dest-1",
            destination_type="channel",
        )

        await repository.add_forwarding_rule(
            guild_id="guild-123",
            source_channel_id="source-2",
            source_type="thread",
            destination_channel_id="dest-2",
            destination_type="thread",
        )

        await repository.add_forwarding_rule(
            guild_id="guild-other",
            source_channel_id="source-3",
            source_type="channel",
            destination_channel_id="dest-3",
            destination_type="channel",
        )

        rules = await repository.get_forwarding_rules_for_guild("guild-123")
        assert len(rules) == 2

        other_rules = await repository.get_forwarding_rules_for_guild("guild-other")
        assert len(other_rules) == 1

    async def test_increment_forwarding_count(self, repository: Repository) -> None:
        rule = await repository.add_forwarding_rule(
            guild_id="guild-123",
            source_channel_id="source-456",
            source_type="channel",
            destination_channel_id="dest-789",
            destination_type="thread",
        )

        assert rule.messages_forwarded == 0
        assert rule.last_forwarded_at is None

        await repository.increment_forwarding_count(rule.id)
        await repository.increment_forwarding_count(rule.id)

        rules = await repository.get_forwarding_rules_for_source("source-456")
        assert len(rules) == 1
        assert rules[0].messages_forwarded == 2
        assert rules[0].last_forwarded_at is not None

    async def test_delete_forwarding_rule(self, repository: Repository) -> None:
        await repository.add_forwarding_rule(
            guild_id="guild-123",
            source_channel_id="source-456",
            source_type="channel",
            destination_channel_id="dest-789",
            destination_type="thread",
        )

        deleted = await repository.delete_forwarding_rule("guild-123", "source-456", "dest-789")
        assert deleted is True

        rules = await repository.get_forwarding_rules_for_guild("guild-123")
        assert len(rules) == 0

        not_found = await repository.delete_forwarding_rule("guild-123", "source-456", "dest-789")
        assert not_found is False

    async def test_set_forwarding_rule_active(self, repository: Repository) -> None:
        await repository.add_forwarding_rule(
            guild_id="guild-123",
            source_channel_id="source-456",
            source_type="channel",
            destination_channel_id="dest-789",
            destination_type="thread",
        )

        updated = await repository.set_forwarding_rule_active(
            "guild-123", "source-456", "dest-789", False
        )
        assert updated is True

        rules = await repository.get_forwarding_rules_for_guild("guild-123")
        assert len(rules) == 1
        assert rules[0].is_active is False

        updated = await repository.set_forwarding_rule_active(
            "guild-123", "source-456", "dest-789", True
        )
        assert updated is True

        rules = await repository.get_forwarding_rules_for_guild("guild-123")
        assert rules[0].is_active is True

        not_found = await repository.set_forwarding_rule_active(
            "guild-123", "nonexistent", "dest-789", False
        )
        assert not_found is False
