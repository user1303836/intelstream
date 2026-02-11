from datetime import datetime

from sqlalchemy import Float, ForeignKey, Integer, LargeBinary, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column

from intelstream.database.models import Base


class NoosphereGuildState(Base):
    __tablename__ = "noosphere_guild_state"
    id: Mapped[int] = mapped_column(primary_key=True)
    guild_id: Mapped[str] = mapped_column(String(32), unique=True, index=True)
    is_active: Mapped[bool] = mapped_column(default=True)
    mode: Mapped[str] = mapped_column(String(32), default="integrative")
    phi_phase: Mapped[float] = mapped_column(default=0.0)
    cryptobiosis: Mapped[bool] = mapped_column(default=False)
    cryptobiosis_snapshot: Mapped[str | None] = mapped_column(Text, nullable=True)
    last_activity: Mapped[datetime] = mapped_column(default=func.now())
    created_at: Mapped[datetime] = mapped_column(default=func.now())


class MessageEmbedding(Base):
    __tablename__ = "noosphere_message_embeddings"
    id: Mapped[int] = mapped_column(primary_key=True)
    guild_id: Mapped[str] = mapped_column(String(32), index=True)
    channel_id: Mapped[str] = mapped_column(String(32), index=True)
    message_id: Mapped[str] = mapped_column(String(32), unique=True, index=True)
    author_id: Mapped[str] = mapped_column(String(32), index=True)
    embedding: Mapped[bytes] = mapped_column(LargeBinary)
    sentiment: Mapped[float] = mapped_column(Float, default=0.0)
    topic_cluster: Mapped[int | None] = mapped_column(Integer, nullable=True)
    created_at: Mapped[datetime] = mapped_column(default=func.now())


class EgregoreSnapshot(Base):
    __tablename__ = "noosphere_egregore_snapshots"
    id: Mapped[int] = mapped_column(primary_key=True)
    guild_id: Mapped[str] = mapped_column(String(32), index=True)
    channel_id: Mapped[str | None] = mapped_column(String(32), nullable=True, index=True)
    semantic_coherence: Mapped[float] = mapped_column(Float)
    topic_diversity: Mapped[float] = mapped_column(Float)
    vocabulary_convergence: Mapped[float] = mapped_column(Float)
    influence_score: Mapped[float] = mapped_column(Float)
    created_at: Mapped[datetime] = mapped_column(default=func.now())


class UserBioelectricState(Base):
    __tablename__ = "noosphere_user_states"
    id: Mapped[int] = mapped_column(primary_key=True)
    guild_id: Mapped[str] = mapped_column(String(32), index=True)
    user_id: Mapped[str] = mapped_column(String(32), index=True)
    activity_frequency: Mapped[float] = mapped_column(Float)
    topic_vector: Mapped[bytes] = mapped_column(LargeBinary)
    sentiment_avg: Mapped[float] = mapped_column(Float, default=0.0)
    engagement_level: Mapped[float] = mapped_column(Float, default=0.0)
    last_active: Mapped[datetime] = mapped_column(default=func.now())
    created_at: Mapped[datetime] = mapped_column(default=func.now())


class SoundscapeSnapshot(Base):
    __tablename__ = "noosphere_soundscape"
    id: Mapped[int] = mapped_column(primary_key=True)
    guild_id: Mapped[str] = mapped_column(String(32), index=True)
    geophony: Mapped[float] = mapped_column(Float)
    biophony: Mapped[float] = mapped_column(Float)
    anthrophony: Mapped[float] = mapped_column(Float)
    bot_anthrophony: Mapped[float] = mapped_column(Float)
    health_score: Mapped[float] = mapped_column(Float)
    created_at: Mapped[datetime] = mapped_column(default=func.now())


class AttractorSnapshot(Base):
    __tablename__ = "noosphere_attractor"
    id: Mapped[int] = mapped_column(primary_key=True)
    guild_id: Mapped[str] = mapped_column(String(32), index=True)
    fractal_dimension: Mapped[float | None] = mapped_column(Float, nullable=True)
    lyapunov_exponent: Mapped[float | None] = mapped_column(Float, nullable=True)
    curvature: Mapped[float | None] = mapped_column(Float, nullable=True)
    created_at: Mapped[datetime] = mapped_column(default=func.now())


class ArchiveEntry(Base):
    __tablename__ = "noosphere_archive"
    id: Mapped[int] = mapped_column(primary_key=True)
    guild_id: Mapped[str] = mapped_column(String(32), index=True)
    content: Mapped[str] = mapped_column(Text)
    content_hash: Mapped[str] = mapped_column(String(64))
    fidelity: Mapped[float] = mapped_column(Float, default=1.0)
    interaction_count: Mapped[int] = mapped_column(Integer, default=0)
    last_interacted: Mapped[datetime] = mapped_column(default=func.now())
    dependencies: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(default=func.now())
    author_id: Mapped[str] = mapped_column(String(32))


class ArchiveLink(Base):
    __tablename__ = "noosphere_archive_links"
    id: Mapped[int] = mapped_column(primary_key=True)
    source_id: Mapped[int] = mapped_column(ForeignKey("noosphere_archive.id"))
    target_id: Mapped[int] = mapped_column(ForeignKey("noosphere_archive.id"))
    link_type: Mapped[str] = mapped_column(String(32))
    strength: Mapped[float] = mapped_column(Float, default=1.0)
    created_at: Mapped[datetime] = mapped_column(default=func.now())


class CrystalRoom(Base):
    __tablename__ = "noosphere_crystal_rooms"
    id: Mapped[int] = mapped_column(primary_key=True)
    guild_id: Mapped[str] = mapped_column(String(32), index=True)
    channel_id: Mapped[str] = mapped_column(String(32), unique=True)
    mode: Mapped[str] = mapped_column(String(32), default="number_station")
    is_sealed: Mapped[bool] = mapped_column(default=False)
    tier: Mapped[str] = mapped_column(String(16), default="harmonic")
    member_ids: Mapped[str] = mapped_column(Text)
    sealed_at: Mapped[datetime | None] = mapped_column(nullable=True)
    created_at: Mapped[datetime] = mapped_column(default=func.now())


class GuildMetricsBaseline(Base):
    __tablename__ = "noosphere_metrics_baseline"
    id: Mapped[int] = mapped_column(primary_key=True)
    guild_id: Mapped[str] = mapped_column(String(32), unique=True, index=True)
    coherence_mean: Mapped[float] = mapped_column(Float, default=0.0)
    coherence_var: Mapped[float] = mapped_column(Float, default=0.0)
    convergence_mean: Mapped[float] = mapped_column(Float, default=0.0)
    convergence_var: Mapped[float] = mapped_column(Float, default=0.0)
    diversity_mean: Mapped[float] = mapped_column(Float, default=0.0)
    diversity_var: Mapped[float] = mapped_column(Float, default=0.0)
    sample_count: Mapped[int] = mapped_column(Integer, default=0)
    updated_at: Mapped[datetime] = mapped_column(default=func.now())
