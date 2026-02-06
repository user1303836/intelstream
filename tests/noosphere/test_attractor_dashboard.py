from datetime import UTC, datetime

import numpy as np

from intelstream.noosphere.attractor_dashboard.metrics import (
    ChangePoint,
    detect_change_points,
    extract_metric_series,
    find_change_points,
    format_dashboard,
)
from intelstream.noosphere.shared.models import CommunityStateVector


def _make_csv(
    coherence: float = 0.5,
    momentum: float = 0.5,
    topic_entropy: float = 0.6,
    topic_churn: float = 0.2,
    activity_entropy: float = 0.6,
    reply_depth: float = 2.0,
    modularity: float = 0.3,
    anthrophony: float = 0.1,
    biophony: float = 0.8,
) -> CommunityStateVector:
    return CommunityStateVector(
        guild_id=1,
        timestamp=datetime(2025, 1, 1, tzinfo=UTC),
        semantic_coherence=coherence,
        semantic_momentum=momentum,
        topic_entropy=topic_entropy,
        topic_churn=topic_churn,
        activity_entropy=activity_entropy,
        reply_depth=reply_depth,
        interaction_modularity=modularity,
        anthrophony_ratio=anthrophony,
        biophony_ratio=biophony,
    )


class TestExtractMetricSeries:
    def test_extracts_coherence(self) -> None:
        history = [_make_csv(coherence=0.1), _make_csv(coherence=0.5), _make_csv(coherence=0.9)]
        series = extract_metric_series(history, "semantic_coherence")
        np.testing.assert_array_almost_equal(series, [0.1, 0.5, 0.9])

    def test_extracts_modularity(self) -> None:
        history = [_make_csv(modularity=0.2), _make_csv(modularity=0.4)]
        series = extract_metric_series(history, "interaction_modularity")
        np.testing.assert_array_almost_equal(series, [0.2, 0.4])


class TestDetectChangePoints:
    def test_no_change_points_in_constant_series(self) -> None:
        series = np.ones(20, dtype=np.float64)
        cps = detect_change_points(series, min_size=5)
        assert cps == []

    def test_detects_shift(self) -> None:
        series = np.concatenate([np.zeros(15, dtype=np.float64), np.ones(15, dtype=np.float64)])
        cps = detect_change_points(series, min_size=5, penalty=1.0)
        assert len(cps) > 0
        assert any(10 <= cp <= 20 for cp in cps)

    def test_short_series_returns_empty(self) -> None:
        series = np.array([1.0, 2.0], dtype=np.float64)
        cps = detect_change_points(series, min_size=5)
        assert cps == []


class TestFindChangePoints:
    def test_with_shift_in_coherence(self) -> None:
        history = [_make_csv(coherence=0.2) for _ in range(15)]
        history.extend([_make_csv(coherence=0.9) for _ in range(15)])
        results = find_change_points(history, min_size=5, penalty=1.0)
        coherence_cps = [cp for cp in results if cp.metric == "semantic_coherence"]
        assert len(coherence_cps) > 0

    def test_empty_history(self) -> None:
        results = find_change_points([])
        assert results == []


class TestFormatDashboard:
    def test_output_has_nine_lines(self) -> None:
        csv = _make_csv()
        lines = format_dashboard(csv)
        assert len(lines) == 9

    def test_labels_present(self) -> None:
        csv = _make_csv()
        lines = format_dashboard(csv)
        text = "\n".join(lines)
        assert "Coherence" in text
        assert "Momentum" in text
        assert "Topic Entropy" in text
        assert "Modularity" in text

    def test_change_point_flags(self) -> None:
        csv = _make_csv()
        cps = [ChangePoint(metric="semantic_coherence", index=5, direction="up")]
        lines = format_dashboard(csv, cps)
        assert "[!]" in lines[0]

    def test_no_flags_without_change_points(self) -> None:
        csv = _make_csv()
        lines = format_dashboard(csv)
        for line in lines:
            assert "[!]" not in line
