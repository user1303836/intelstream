from datetime import UTC, datetime

from intelstream.noosphere.resonance_mirror.analyzer import (
    bar,
    build_mirror_lines,
    ei_color,
    trend_arrow,
)
from intelstream.noosphere.shared.models import CommunityStateVector


def _make_csv(**overrides: float) -> CommunityStateVector:
    defaults: dict[str, object] = {
        "guild_id": 1,
        "timestamp": datetime(2025, 1, 1, tzinfo=UTC),
        "semantic_coherence": 0.5,
        "vocab_convergence": 0.4,
        "topic_entropy": 0.6,
        "sentiment_alignment": 0.7,
        "activity_rate": 1.0,
        "anthrophony_ratio": 0.1,
        "biophony_ratio": 0.8,
        "geophony_ratio": 0.1,
        "interaction_modularity": 0.3,
        "semantic_momentum": 0.5,
        "topic_churn": 0.2,
        "reply_depth": 2.0,
        "activity_entropy": 0.6,
        "egregore_index": 0.5,
    }
    defaults.update(overrides)
    return CommunityStateVector(**defaults)  # type: ignore[arg-type]


class TestEiColor:
    def test_low_ei_returns_blue(self) -> None:
        assert ei_color(0.1) == 0x3498DB

    def test_medium_ei_returns_green(self) -> None:
        assert ei_color(0.4) == 0x2ECC71

    def test_high_ei_returns_orange(self) -> None:
        assert ei_color(0.7) == 0xF39C12

    def test_very_high_ei_returns_red(self) -> None:
        assert ei_color(0.9) == 0xE74C3C


class TestBar:
    def test_empty_bar(self) -> None:
        result = bar(0.0, 10)
        assert result == "\u2591" * 10

    def test_full_bar(self) -> None:
        result = bar(1.0, 10)
        assert result == "\u2588" * 10

    def test_half_bar(self) -> None:
        result = bar(0.5, 10)
        assert len(result) == 10
        assert "\u2588" in result
        assert "\u2591" in result

    def test_bar_length(self) -> None:
        result = bar(0.7, 20)
        assert len(result) == 20


class TestTrendArrow:
    def test_no_previous(self) -> None:
        assert trend_arrow(0.5, None) == ""

    def test_stable(self) -> None:
        assert trend_arrow(0.5, 0.5) == "\u2192"

    def test_increasing(self) -> None:
        assert trend_arrow(0.8, 0.5) == "\u2191"

    def test_decreasing(self) -> None:
        assert trend_arrow(0.2, 0.5) == "\u2193"


class TestBuildMirrorLines:
    def test_basic_output(self) -> None:
        csv = _make_csv(egregore_index=0.65)
        lines = build_mirror_lines(csv)
        assert len(lines) == 6
        assert "Egregore Index" in lines[0]
        assert "0.65" in lines[0]

    def test_with_previous(self) -> None:
        csv = _make_csv(egregore_index=0.7)
        prev = _make_csv(egregore_index=0.5)
        lines = build_mirror_lines(csv, prev)
        assert "\u2191" in lines[0]

    def test_declining_trend(self) -> None:
        csv = _make_csv(egregore_index=0.3)
        prev = _make_csv(egregore_index=0.6)
        lines = build_mirror_lines(csv, prev)
        assert "\u2193" in lines[0]
