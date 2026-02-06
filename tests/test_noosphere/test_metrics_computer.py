from datetime import datetime

import numpy as np

from intelstream.noosphere.constants import MessageClassification
from intelstream.noosphere.shared.data_models import ProcessedMessage
from intelstream.noosphere.shared.metrics_computer import MetricsComputer
from intelstream.noosphere.shared.soundscape import SoundscapeMonitor


def _make_message(
    guild_id: str = "g1",
    user_id: str = "u1",
    is_bot: bool = False,
    embedding: np.ndarray | None = None,
) -> ProcessedMessage:
    return ProcessedMessage(
        guild_id=guild_id,
        channel_id="ch1",
        user_id=user_id,
        message_id=f"m_{user_id}_{id(embedding)}",
        content="test",
        timestamp=datetime.utcnow(),
        is_bot=is_bot,
        classification=MessageClassification.BIOPHONY
        if not is_bot
        else MessageClassification.ANTHROPHONY,
        embedding=embedding,
    )


class TestMetricsComputer:
    def test_empty_guild(self) -> None:
        soundscape = SoundscapeMonitor()
        mc = MetricsComputer(soundscape)
        vector = mc.compute_hourly("g1")
        assert vector.semantic_coherence == 0.0
        assert vector.activity_entropy == 0.0

    def test_ingest_and_compute(self) -> None:
        soundscape = SoundscapeMonitor()
        mc = MetricsComputer(soundscape)

        rng = np.random.default_rng(42)
        base_vec = rng.standard_normal(384).astype(np.float32)
        base_vec /= np.linalg.norm(base_vec)

        for i in range(10):
            noise = rng.standard_normal(384).astype(np.float32) * 0.1
            emb = base_vec + noise
            emb = emb / np.linalg.norm(emb)
            msg = _make_message(user_id=f"u{i}", embedding=emb)
            mc.ingest_message(msg)

        vector = mc.compute_hourly("g1")
        assert vector.semantic_coherence > 0.5

    def test_activity_entropy_single_user(self) -> None:
        soundscape = SoundscapeMonitor()
        mc = MetricsComputer(soundscape)
        for _ in range(5):
            mc.ingest_message(_make_message(user_id="u1"))
        vector = mc.compute_hourly("g1")
        assert vector.activity_entropy == 0.0

    def test_activity_entropy_uniform(self) -> None:
        soundscape = SoundscapeMonitor()
        mc = MetricsComputer(soundscape)
        for i in range(5):
            mc.ingest_message(_make_message(user_id=f"u{i}"))
        vector = mc.compute_hourly("g1")
        assert abs(vector.activity_entropy - 1.0) < 1e-5

    def test_semantic_momentum(self) -> None:
        soundscape = SoundscapeMonitor()
        mc = MetricsComputer(soundscape)

        rng = np.random.default_rng(42)
        v = rng.standard_normal(384).astype(np.float32)
        v /= np.linalg.norm(v)
        for i in range(10):
            mc.ingest_message(_make_message(user_id=f"u{i}", embedding=v.copy()))

        vector = mc.compute_hourly("g1")
        assert abs(vector.semantic_momentum - 1.0) < 1e-5

    def test_daily_updates_baseline(self) -> None:
        soundscape = SoundscapeMonitor()
        mc = MetricsComputer(soundscape)

        rng = np.random.default_rng(42)
        for i in range(10):
            emb = rng.standard_normal(384).astype(np.float32)
            emb /= np.linalg.norm(emb)
            mc.ingest_message(_make_message(user_id=f"u{i}", embedding=emb))

        mc.compute_daily("g1")
        bl = mc.get_baseline("g1", "coherence")
        assert bl.count == 1

    def test_egregore_index_default(self) -> None:
        soundscape = SoundscapeMonitor()
        mc = MetricsComputer(soundscape)

        rng = np.random.default_rng(42)
        for i in range(10):
            emb = rng.standard_normal(384).astype(np.float32)
            emb /= np.linalg.norm(emb)
            mc.ingest_message(_make_message(user_id=f"u{i}", embedding=emb))

        vector = mc.compute_daily("g1")
        assert vector.egregore_index == 0.5

    def test_get_state_vector(self) -> None:
        soundscape = SoundscapeMonitor()
        mc = MetricsComputer(soundscape)
        assert mc.get_state_vector("g1") is None
        mc.compute_hourly("g1")
        assert mc.get_state_vector("g1") is not None
