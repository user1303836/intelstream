import numpy as np

from intelstream.noosphere.shared.baseline import WelfordAccumulator
from intelstream.noosphere.shared.egregore import (
    coherence_centroid,
    coherence_pairwise,
    compute_egregore_index,
    topic_diversity,
)


class TestCoherenceCentroid:
    def test_empty(self) -> None:
        assert coherence_centroid(np.empty((0, 384))) == 0.0

    def test_single(self) -> None:
        emb = np.random.randn(1, 384).astype(np.float32)
        assert coherence_centroid(emb) == 0.0

    def test_identical_embeddings(self) -> None:
        v = np.random.randn(384).astype(np.float32)
        v = v / np.linalg.norm(v)
        embs = np.tile(v, (10, 1))
        result = coherence_centroid(embs)
        assert abs(result - 1.0) < 1e-5

    def test_orthogonal_embeddings(self) -> None:
        embs = np.eye(10, 384, dtype=np.float32)
        for i in range(10):
            embs[i] /= np.linalg.norm(embs[i])
        result = coherence_centroid(embs)
        assert result < 0.5


class TestCoherencePairwise:
    def test_identical(self) -> None:
        v = np.random.randn(384).astype(np.float32)
        v = v / np.linalg.norm(v)
        embs = np.tile(v, (10, 1))
        result = coherence_pairwise(embs)
        assert abs(result - 1.0) < 1e-5

    def test_empty(self) -> None:
        assert coherence_pairwise(np.empty((0, 384))) == 0.0


class TestTopicDiversity:
    def test_empty(self) -> None:
        assert topic_diversity([]) == 0.0

    def test_single_topic(self) -> None:
        assert topic_diversity([100]) == 0.0

    def test_uniform_distribution(self) -> None:
        counts = [10, 10, 10, 10]
        result = topic_diversity(counts)
        assert abs(result - 1.0) < 1e-10

    def test_skewed_distribution(self) -> None:
        counts = [100, 1, 1, 1]
        result = topic_diversity(counts)
        assert result < 0.5

    def test_two_topics_equal(self) -> None:
        counts = [50, 50]
        result = topic_diversity(counts)
        assert abs(result - 1.0) < 1e-10


class TestComputeEgregoreIndex:
    def test_insufficient_data(self) -> None:
        bl = WelfordAccumulator()
        bl.update(0.5)  # only one sample
        result = compute_egregore_index(0.5, 0.5, 0.5, bl, bl, bl)
        assert result == 0.5

    def test_with_baseline(self) -> None:
        coherence_bl = WelfordAccumulator()
        convergence_bl = WelfordAccumulator()
        diversity_bl = WelfordAccumulator()
        for v in [0.3, 0.4, 0.5, 0.6, 0.7]:
            coherence_bl.update(v)
            convergence_bl.update(v)
            diversity_bl.update(v)

        result = compute_egregore_index(0.5, 0.5, 0.5, coherence_bl, convergence_bl, diversity_bl)
        assert 0.0 < result < 1.0

    def test_high_coherence_increases_ei(self) -> None:
        coherence_bl = WelfordAccumulator()
        convergence_bl = WelfordAccumulator()
        diversity_bl = WelfordAccumulator()
        for v in [0.3, 0.4, 0.5, 0.6, 0.7]:
            coherence_bl.update(v)
            convergence_bl.update(v)
            diversity_bl.update(v)

        low = compute_egregore_index(0.3, 0.5, 0.5, coherence_bl, convergence_bl, diversity_bl)
        high = compute_egregore_index(0.9, 0.5, 0.5, coherence_bl, convergence_bl, diversity_bl)
        assert high > low
