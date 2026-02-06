import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from intelstream.database.models import Base
from intelstream.noosphere.models import (
    ArchiveEntry,
    ArchiveLink,
    EgregoreSnapshot,
    GuildMetricsBaseline,
    MessageEmbedding,
    NoosphereGuildState,
)


@pytest.fixture
async def session():
    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    async_session = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)
    async with async_session() as session:
        yield session
    await engine.dispose()


class TestNoosphereGuildState:
    async def test_create_guild_state(self, session: AsyncSession) -> None:
        state = NoosphereGuildState(guild_id="123", mode="integrative", phi_phase=0.5)
        session.add(state)
        await session.commit()

        result = await session.execute(
            select(NoosphereGuildState).where(NoosphereGuildState.guild_id == "123")
        )
        saved = result.scalar_one()
        assert saved.guild_id == "123"
        assert saved.mode == "integrative"
        assert saved.phi_phase == 0.5
        assert saved.is_active is True
        assert saved.cryptobiosis is False


class TestMessageEmbedding:
    async def test_create_embedding(self, session: AsyncSession) -> None:
        import numpy as np

        emb_data = np.random.randn(384).astype(np.float32).tobytes()
        embedding = MessageEmbedding(
            guild_id="123",
            channel_id="456",
            message_id="789",
            author_id="111",
            embedding=emb_data,
            sentiment=0.5,
        )
        session.add(embedding)
        await session.commit()

        result = await session.execute(
            select(MessageEmbedding).where(MessageEmbedding.message_id == "789")
        )
        saved = result.scalar_one()
        assert saved.guild_id == "123"
        assert saved.sentiment == 0.5
        restored = np.frombuffer(saved.embedding, dtype=np.float32)
        assert restored.shape == (384,)


class TestEgregoreSnapshot:
    async def test_create_snapshot(self, session: AsyncSession) -> None:
        snapshot = EgregoreSnapshot(
            guild_id="123",
            semantic_coherence=0.6,
            topic_diversity=0.8,
            vocabulary_convergence=0.4,
            influence_score=0.1,
        )
        session.add(snapshot)
        await session.commit()

        result = await session.execute(
            select(EgregoreSnapshot).where(EgregoreSnapshot.guild_id == "123")
        )
        saved = result.scalar_one()
        assert saved.semantic_coherence == 0.6

    async def test_channel_scoped_snapshot(self, session: AsyncSession) -> None:
        snapshot = EgregoreSnapshot(
            guild_id="123",
            channel_id="456",
            semantic_coherence=0.7,
            topic_diversity=0.5,
            vocabulary_convergence=0.3,
            influence_score=0.2,
        )
        session.add(snapshot)
        await session.commit()

        result = await session.execute(
            select(EgregoreSnapshot).where(EgregoreSnapshot.channel_id == "456")
        )
        saved = result.scalar_one()
        assert saved.channel_id == "456"


class TestArchiveEntry:
    async def test_create_entry(self, session: AsyncSession) -> None:
        entry = ArchiveEntry(
            guild_id="123",
            content="Test knowledge",
            content_hash="abc123",
            fidelity=1.0,
            author_id="user1",
        )
        session.add(entry)
        await session.commit()

        result = await session.execute(select(ArchiveEntry).where(ArchiveEntry.guild_id == "123"))
        saved = result.scalar_one()
        assert saved.content == "Test knowledge"
        assert saved.fidelity == 1.0


class TestArchiveLink:
    async def test_create_link(self, session: AsyncSession) -> None:
        entry1 = ArchiveEntry(guild_id="123", content="A", content_hash="a1", author_id="u1")
        entry2 = ArchiveEntry(guild_id="123", content="B", content_hash="b2", author_id="u2")
        session.add_all([entry1, entry2])
        await session.flush()

        link = ArchiveLink(
            source_id=entry1.id,
            target_id=entry2.id,
            link_type="supports",
            strength=0.8,
        )
        session.add(link)
        await session.commit()

        result = await session.execute(
            select(ArchiveLink).where(ArchiveLink.link_type == "supports")
        )
        saved = result.scalar_one()
        assert saved.strength == 0.8


class TestGuildMetricsBaseline:
    async def test_create_baseline(self, session: AsyncSession) -> None:
        baseline = GuildMetricsBaseline(
            guild_id="123",
            coherence_mean=0.5,
            coherence_var=0.01,
            sample_count=10,
        )
        session.add(baseline)
        await session.commit()

        result = await session.execute(
            select(GuildMetricsBaseline).where(GuildMetricsBaseline.guild_id == "123")
        )
        saved = result.scalar_one()
        assert saved.coherence_mean == 0.5
        assert saved.sample_count == 10
