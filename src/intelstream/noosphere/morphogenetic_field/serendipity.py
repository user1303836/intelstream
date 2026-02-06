from __future__ import annotations

import random
from dataclasses import dataclass, field
from datetime import UTC, datetime

import structlog

logger = structlog.get_logger(__name__)


@dataclass
class SerendipityBridge:
    source_topic: str
    target_topic: str
    similarity: float
    message: str
    timestamp: datetime = field(default_factory=lambda: datetime.now(UTC))


class SerendipityInjector:
    """Generates cross-topic bridges from archive and topic keywords.

    Adds controlled noise to similarity scores to surface unexpected
    connections. Bridges topics that are related enough to be relevant
    but different enough to surprise.
    """

    def __init__(
        self,
        noise_sigma: float = 0.2,
        similarity_min: float = 0.3,
        similarity_max: float = 0.6,
    ):
        self._noise_sigma = noise_sigma
        self._similarity_min = similarity_min
        self._similarity_max = similarity_max

    def find_bridges(
        self,
        current_topics: list[str],
        archive_topics: list[str],
        similarities: dict[tuple[str, str], float] | None = None,
    ) -> list[SerendipityBridge]:
        """Find serendipitous connections between current and archived topics."""
        bridges: list[SerendipityBridge] = []

        if not current_topics or not archive_topics:
            return bridges

        for current in current_topics:
            for archived in archive_topics:
                if current == archived:
                    continue

                if similarities:
                    base_sim = similarities.get((current, archived), 0.0)
                else:
                    base_sim = self._estimate_similarity(current, archived)

                noisy_sim = base_sim + random.gauss(0, self._noise_sigma)
                noisy_sim = max(0.0, min(1.0, noisy_sim))

                if self._similarity_min <= noisy_sim <= self._similarity_max:
                    message = self._generate_bridge_message(current, archived)
                    bridges.append(
                        SerendipityBridge(
                            source_topic=current,
                            target_topic=archived,
                            similarity=noisy_sim,
                            message=message,
                        )
                    )

        bridges.sort(key=lambda b: b.similarity, reverse=True)
        return bridges[:3]

    def select_injection(
        self,
        current_topics: list[str],
        archive_topics: list[str],
        similarities: dict[tuple[str, str], float] | None = None,
    ) -> SerendipityBridge | None:
        """Select the best serendipity injection, if any."""
        bridges = self.find_bridges(current_topics, archive_topics, similarities)
        if not bridges:
            return None
        return bridges[0]

    def _estimate_similarity(self, topic_a: str, topic_b: str) -> float:
        """Rough word-overlap similarity when embeddings are unavailable."""
        words_a = set(topic_a.lower().split())
        words_b = set(topic_b.lower().split())
        if not words_a or not words_b:
            return 0.0
        intersection = words_a & words_b
        union = words_a | words_b
        return len(intersection) / len(union) if union else 0.0

    def _generate_bridge_message(self, source: str, target: str) -> str:
        templates = [
            f"This discussion about {source} has an interesting parallel with {target} from the archive.",
            f"Has anyone noticed the connection between {source} and the earlier thread on {target}?",
            f"The pattern in {source} echoes something from {target} -- worth exploring?",
        ]
        return random.choice(templates)
