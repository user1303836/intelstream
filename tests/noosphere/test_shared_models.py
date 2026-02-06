import math
from datetime import UTC, datetime

from intelstream.noosphere.shared.models import CommunityStateVector, ProcessedMessage


class TestCommunityStateVector:
    def test_defaults(self) -> None:
        csv = CommunityStateVector(guild_id=1, timestamp=datetime(2025, 1, 1, tzinfo=UTC))
        assert csv.semantic_coherence == 0.0
        assert csv.egregore_index == 0.0
        assert math.isnan(csv.fractal_dimension)
        assert math.isnan(csv.lyapunov_exponent)
        assert math.isnan(csv.gromov_curvature)

    def test_custom_values(self) -> None:
        csv = CommunityStateVector(
            guild_id=42,
            timestamp=datetime(2025, 6, 15, tzinfo=UTC),
            semantic_coherence=0.75,
            topic_entropy=1.5,
            egregore_index=0.6,
        )
        assert csv.guild_id == 42
        assert csv.semantic_coherence == 0.75
        assert csv.topic_entropy == 1.5


class TestProcessedMessage:
    def test_creation(self) -> None:
        msg = ProcessedMessage(
            guild_id=1,
            channel_id=2,
            user_id=3,
            message_id=4,
            content="hello world",
            embedding=[0.1, 0.2, 0.3],
            timestamp=datetime(2025, 1, 1, tzinfo=UTC),
            classification="biophony",
        )
        assert msg.guild_id == 1
        assert msg.content == "hello world"
        assert msg.classification == "biophony"
        assert msg.topic_cluster is None

    def test_with_topic_cluster(self) -> None:
        msg = ProcessedMessage(
            guild_id=1,
            channel_id=2,
            user_id=3,
            message_id=4,
            content="test",
            embedding=[],
            timestamp=datetime(2025, 1, 1, tzinfo=UTC),
            classification="anthrophony",
            topic_cluster=5,
        )
        assert msg.topic_cluster == 5
