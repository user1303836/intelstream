from __future__ import annotations

from datetime import UTC, datetime

import numpy as np
import structlog

from intelstream.noosphere.shared.baseline import WelfordAccumulator
from intelstream.noosphere.shared.data_models import CommunityStateVector, ProcessedMessage
from intelstream.noosphere.shared.soundscape import SoundscapeMonitor  # noqa: TC001

logger = structlog.get_logger(__name__)

EI_WEIGHT_COHERENCE = 0.4
EI_WEIGHT_CONVERGENCE = 0.3
EI_WEIGHT_CONCENTRATION = 0.3

MAX_MESSAGES_PER_GUILD = 5000
MAX_EMBEDDINGS_PER_GUILD = 5000


class MetricsComputer:
    """Pre-computes CommunityStateVector on a schedule.

    Three-tier scheduling:
    - Hourly: coherence (centroid), anthrophony ratio, activity entropy
    - Daily: pairwise coherence, full state vector snapshot, baseline update
    - Weekly: vocabulary convergence trends, EI trajectory
    """

    def __init__(self, soundscape: SoundscapeMonitor) -> None:
        self._soundscape = soundscape
        self._embeddings: dict[str, list[np.ndarray]] = {}
        self._messages: dict[str, list[ProcessedMessage]] = {}
        self._state_vectors: dict[str, CommunityStateVector] = {}
        self._baselines: dict[str, dict[str, WelfordAccumulator]] = {}

    def ingest_message(self, message: ProcessedMessage) -> None:
        guild_id = message.guild_id
        msgs = self._messages.setdefault(guild_id, [])
        msgs.append(message)
        if len(msgs) > MAX_MESSAGES_PER_GUILD:
            self._messages[guild_id] = msgs[-MAX_MESSAGES_PER_GUILD:]

        if message.embedding is not None:
            embs = self._embeddings.setdefault(guild_id, [])
            embs.append(message.embedding)
            if len(embs) > MAX_EMBEDDINGS_PER_GUILD:
                self._embeddings[guild_id] = embs[-MAX_EMBEDDINGS_PER_GUILD:]

    def get_baseline(self, guild_id: str, metric: str) -> WelfordAccumulator:
        guild_baselines = self._baselines.setdefault(guild_id, {})
        return guild_baselines.setdefault(metric, WelfordAccumulator())

    def compute_hourly(self, guild_id: str) -> CommunityStateVector:
        messages = self._messages.get(guild_id, [])
        embeddings = self._embeddings.get(guild_id, [])

        soundscape_state = self._soundscape.get_state(guild_id)

        coherence = self._compute_centroid_coherence(embeddings)
        anthrophony_ratio = soundscape_state.anthrophony_ratio
        biophony_ratio = soundscape_state.biophony_ratio
        geophony_ratio = soundscape_state.geophony_ratio
        activity_entropy = self._compute_activity_entropy(messages)
        momentum = self._compute_semantic_momentum(embeddings)

        now = datetime.now(UTC)
        vector = CommunityStateVector(
            guild_id=guild_id,
            timestamp=now,
            semantic_coherence=coherence,
            anthrophony_ratio=anthrophony_ratio,
            biophony_ratio=biophony_ratio,
            geophony_ratio=geophony_ratio,
            activity_entropy=activity_entropy,
            semantic_momentum=momentum,
        )
        self._state_vectors[guild_id] = vector
        return vector

    def compute_daily(self, guild_id: str) -> CommunityStateVector:
        vector = self.compute_hourly(guild_id)
        embeddings = self._embeddings.get(guild_id, [])

        if len(embeddings) >= 5:
            pairwise = self._compute_pairwise_coherence(embeddings)
            vector.semantic_coherence = pairwise

        coherence_bl = self.get_baseline(guild_id, "coherence")
        coherence_bl.update(vector.semantic_coherence)

        egregore_index = self._compute_egregore_index(guild_id, vector)
        vector.egregore_index = egregore_index

        self._state_vectors[guild_id] = vector
        return vector

    def get_state_vector(self, guild_id: str) -> CommunityStateVector | None:
        return self._state_vectors.get(guild_id)

    def _compute_centroid_coherence(self, embeddings: list[np.ndarray]) -> float:
        if len(embeddings) < 2:
            return 0.0
        matrix = np.stack(embeddings)
        centroid = matrix.mean(axis=0)
        norm = np.linalg.norm(centroid)
        if norm < 1e-10:
            return 0.0
        centroid = centroid / norm
        sims = matrix @ centroid
        return float(sims.mean())

    def _compute_pairwise_coherence(self, embeddings: list[np.ndarray]) -> float:
        if len(embeddings) < 2:
            return 0.0
        matrix = np.stack(embeddings)
        sim_matrix = matrix @ matrix.T
        n = len(embeddings)
        mask = ~np.eye(n, dtype=bool)
        return float(sim_matrix[mask].mean())

    def _compute_activity_entropy(self, messages: list[ProcessedMessage]) -> float:
        if not messages:
            return 0.0
        user_counts: dict[str, int] = {}
        for msg in messages:
            user_counts[msg.user_id] = user_counts.get(msg.user_id, 0) + 1

        n_users = len(user_counts)
        if n_users <= 1:
            return 0.0

        total = sum(user_counts.values())
        probs = np.array([c / total for c in user_counts.values()])
        probs = probs[probs > 0]
        entropy = -float(np.sum(probs * np.log2(probs)))
        max_entropy = np.log2(n_users)
        if max_entropy < 1e-10:
            return 0.0
        return float(entropy / max_entropy)

    def _compute_semantic_momentum(self, embeddings: list[np.ndarray]) -> float:
        if len(embeddings) < 3:
            return 0.0
        sims = []
        for i in range(len(embeddings) - 1):
            sim = float(np.dot(embeddings[i], embeddings[i + 1]))
            sims.append(sim)
        return float(np.mean(sims))

    def _compute_egregore_index(self, guild_id: str, vector: CommunityStateVector) -> float:
        coherence_bl = self.get_baseline(guild_id, "coherence")
        convergence_bl = self.get_baseline(guild_id, "convergence")
        diversity_bl = self.get_baseline(guild_id, "diversity")

        if coherence_bl.count < 2:
            return 0.5

        norm_coherence = coherence_bl.normalize(vector.semantic_coherence)
        norm_convergence = convergence_bl.normalize(vector.vocab_convergence)
        norm_concentration = 1.0 - diversity_bl.normalize(vector.topic_entropy)

        raw = (
            EI_WEIGHT_COHERENCE * norm_coherence
            + EI_WEIGHT_CONVERGENCE * norm_convergence
            + EI_WEIGHT_CONCENTRATION * norm_concentration
        )

        return WelfordAccumulator.sigmoid((raw - 0.5) * 6)
