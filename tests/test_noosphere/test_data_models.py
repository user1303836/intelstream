import math
from datetime import UTC, datetime

import numpy as np

from intelstream.noosphere.constants import MessageClassification
from intelstream.noosphere.shared.data_models import CommunityStateVector, ProcessedMessage


class TestProcessedMessage:
    def test_create(self) -> None:
        msg = ProcessedMessage(
            guild_id="g1",
            channel_id="ch1",
            user_id="u1",
            message_id="m1",
            content="hello",
            timestamp=datetime.now(UTC),
            is_bot=False,
            classification=MessageClassification.BIOPHONY,
        )
        assert msg.embedding is None
        assert msg.topic_cluster is None

    def test_with_embedding(self) -> None:
        emb = np.random.randn(384).astype(np.float32)
        msg = ProcessedMessage(
            guild_id="g1",
            channel_id="ch1",
            user_id="u1",
            message_id="m1",
            content="hello",
            timestamp=datetime.now(UTC),
            is_bot=False,
            classification=MessageClassification.BIOPHONY,
            embedding=emb,
        )
        assert msg.embedding is not None
        assert msg.embedding.shape == (384,)


class TestCommunityStateVector:
    def test_defaults(self) -> None:
        v = CommunityStateVector(guild_id="g1", timestamp=datetime.now(UTC))
        assert v.semantic_coherence == 0.0
        assert v.egregore_index == 0.0
        assert v.anthrophony_ratio == 0.0

    def test_phase4_fields_default_to_nan(self) -> None:
        v = CommunityStateVector(guild_id="g1", timestamp=datetime.now(UTC))
        assert math.isnan(v.sentiment_alignment)
        assert math.isnan(v.interaction_modularity)
        assert math.isnan(v.fractal_dimension)
        assert math.isnan(v.lyapunov_exponent)
        assert math.isnan(v.gromov_curvature)
