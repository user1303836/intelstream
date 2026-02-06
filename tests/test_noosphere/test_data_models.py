from datetime import datetime

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
            timestamp=datetime.utcnow(),
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
            timestamp=datetime.utcnow(),
            is_bot=False,
            classification=MessageClassification.BIOPHONY,
            embedding=emb,
        )
        assert msg.embedding is not None
        assert msg.embedding.shape == (384,)


class TestCommunityStateVector:
    def test_defaults(self) -> None:
        v = CommunityStateVector(guild_id="g1", timestamp=datetime.utcnow())
        assert v.semantic_coherence == 0.0
        assert v.egregore_index == 0.0
        assert v.anthrophony_ratio == 0.0
