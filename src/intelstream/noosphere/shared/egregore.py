from __future__ import annotations

import numpy as np
import structlog

from intelstream.noosphere.shared.baseline import WelfordAccumulator

logger = structlog.get_logger(__name__)

EI_WEIGHTS = (0.4, 0.3, 0.3)


def coherence_centroid(embeddings: np.ndarray) -> float:
    if len(embeddings) < 2:
        return 0.0
    centroid = embeddings.mean(axis=0)
    norm = np.linalg.norm(centroid)
    if norm < 1e-10:
        return 0.0
    centroid = centroid / norm
    sims = embeddings @ centroid
    return float(sims.mean())


def coherence_pairwise(embeddings: np.ndarray) -> float:
    if len(embeddings) < 2:
        return 0.0
    sim_matrix = embeddings @ embeddings.T
    n = len(embeddings)
    mask = ~np.eye(n, dtype=bool)
    return float(sim_matrix[mask].mean())


def topic_diversity(topic_counts: list[int]) -> float:
    if not topic_counts:
        return 0.0
    arr = np.array(topic_counts, dtype=float)
    total = arr.sum()
    if total <= 0:
        return 0.0
    probs = arr / total
    probs = probs[probs > 0]
    n_topics = len(probs)
    if n_topics <= 1:
        return 0.0
    entropy = -float(np.sum(probs * np.log2(probs)))
    return float(entropy / np.log2(n_topics))


def vocabulary_convergence_jsd(dist_a: np.ndarray, dist_b: np.ndarray) -> float:
    from scipy.spatial.distance import jensenshannon

    jsd = jensenshannon(dist_a, dist_b) ** 2
    return float(1.0 - jsd)


def compute_egregore_index(
    coherence: float,
    convergence: float,
    concentration: float,
    coherence_bl: WelfordAccumulator,
    convergence_bl: WelfordAccumulator,
    diversity_bl: WelfordAccumulator,
) -> float:
    if coherence_bl.count < 2:
        return 0.5

    norm_coherence = coherence_bl.normalize(coherence)
    norm_convergence = convergence_bl.normalize(convergence)
    norm_concentration = 1.0 - diversity_bl.normalize(concentration)

    w1, w2, w3 = EI_WEIGHTS
    raw = w1 * norm_coherence + w2 * norm_convergence + w3 * norm_concentration
    return WelfordAccumulator.sigmoid((raw - 0.5) * 6)
