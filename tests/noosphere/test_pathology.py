from datetime import UTC, datetime

from intelstream.noosphere.pathology import (
    GuildBaseline,
    PathologyType,
    detect_bot_dominance,
    detect_clique_formation,
    detect_echo_chamber,
    detect_flame_war,
    detect_server_death,
    run_pathology_scan,
)
from intelstream.noosphere.shared.data_models import CommunityStateVector


def _make_csv(**overrides: float) -> CommunityStateVector:
    defaults: dict[str, object] = {
        "guild_id": "1",
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


class TestDetectEchoChamber:
    def test_healthy(self) -> None:
        csv = _make_csv(egregore_index=0.5, topic_entropy=2.0)
        assert detect_echo_chamber(csv, GuildBaseline()) is None

    def test_detected_absolute(self) -> None:
        csv = _make_csv(egregore_index=0.9, topic_entropy=0.5)
        alert = detect_echo_chamber(csv, GuildBaseline())
        assert alert is not None
        assert alert.pathology == PathologyType.ECHO_CHAMBER

    def test_detected_zscore(self) -> None:
        baseline = GuildBaseline(
            mean_ei=0.3, std_ei=0.1, mean_topic_entropy=0.8, std_topic_entropy=0.1
        )
        csv = _make_csv(egregore_index=0.55, topic_entropy=0.5)
        alert = detect_echo_chamber(csv, baseline)
        assert alert is not None


class TestDetectBotDominance:
    def test_healthy(self) -> None:
        csv = _make_csv(anthrophony_ratio=0.1)
        assert detect_bot_dominance(csv) is None

    def test_detected(self) -> None:
        csv = _make_csv(anthrophony_ratio=0.35)
        alert = detect_bot_dominance(csv)
        assert alert is not None
        assert alert.pathology == PathologyType.BOT_DOMINANCE

    def test_severity_scales(self) -> None:
        csv_low = _make_csv(anthrophony_ratio=0.26)
        csv_high = _make_csv(anthrophony_ratio=0.45)
        alert_low = detect_bot_dominance(csv_low)
        alert_high = detect_bot_dominance(csv_high)
        assert alert_low is not None and alert_high is not None
        assert alert_high.severity > alert_low.severity


class TestDetectServerDeath:
    def test_healthy(self) -> None:
        csv = _make_csv(activity_rate=1.0)
        assert detect_server_death(csv, GuildBaseline()) is None

    def test_detected_zero_activity(self) -> None:
        csv = _make_csv(activity_rate=0.0)
        alert = detect_server_death(csv, GuildBaseline())
        assert alert is not None
        assert alert.pathology == PathologyType.SERVER_DEATH
        assert alert.severity == 1.0

    def test_detected_zscore(self) -> None:
        baseline = GuildBaseline(mean_activity_rate=5.0, std_activity_rate=1.0)
        csv = _make_csv(activity_rate=2.0)
        alert = detect_server_death(csv, baseline)
        assert alert is not None


class TestDetectFlameWar:
    def test_healthy(self) -> None:
        csv = _make_csv(sentiment_alignment=0.7, activity_rate=1.0)
        assert detect_flame_war(csv, GuildBaseline()) is None

    def test_detected(self) -> None:
        baseline = GuildBaseline(
            mean_sentiment_var=0.1,
            std_sentiment_var=0.05,
            mean_activity_rate=1.0,
            std_activity_rate=0.3,
        )
        csv = _make_csv(sentiment_alignment=0.5, activity_rate=2.0)
        alert = detect_flame_war(csv, baseline)
        assert alert is not None
        assert alert.pathology == PathologyType.FLAME_WAR


class TestDetectCliqueFormation:
    def test_healthy(self) -> None:
        csv = _make_csv(interaction_modularity=0.3)
        assert detect_clique_formation(csv) is None

    def test_detected(self) -> None:
        csv = _make_csv(interaction_modularity=0.8)
        alert = detect_clique_formation(csv)
        assert alert is not None
        assert alert.pathology == PathologyType.CLIQUE_FORMATION


class TestRunPathologyScan:
    def test_healthy_server(self) -> None:
        csv = _make_csv()
        alerts = run_pathology_scan(csv)
        assert alerts == []

    def test_multiple_pathologies(self) -> None:
        csv = _make_csv(
            egregore_index=0.95,
            topic_entropy=0.3,
            anthrophony_ratio=0.4,
            interaction_modularity=0.8,
        )
        alerts = run_pathology_scan(csv)
        types = {a.pathology for a in alerts}
        assert PathologyType.ECHO_CHAMBER in types
        assert PathologyType.BOT_DOMINANCE in types
        assert PathologyType.CLIQUE_FORMATION in types
