from __future__ import annotations

import enum
from dataclasses import dataclass
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from intelstream.noosphere.shared.models import CommunityStateVector


class PathologyType(enum.Enum):
    ECHO_CHAMBER = "echo_chamber"
    BOT_DOMINANCE = "bot_dominance"
    SERVER_DEATH = "server_death"
    FLAME_WAR = "flame_war"
    CLIQUE_FORMATION = "clique_formation"


@dataclass
class PathologyAlert:
    pathology: PathologyType
    severity: float
    description: str


@dataclass
class GuildBaseline:
    mean_ei: float = 0.5
    std_ei: float = 0.15
    mean_topic_entropy: float = 0.5
    std_topic_entropy: float = 0.15
    mean_activity_rate: float = 1.0
    std_activity_rate: float = 0.5
    mean_sentiment_var: float = 0.3
    std_sentiment_var: float = 0.1


def _zscore(value: float, mean: float, std: float) -> float:
    if std <= 0:
        return 0.0
    return (value - mean) / std


def detect_echo_chamber(
    csv: CommunityStateVector, baseline: GuildBaseline
) -> PathologyAlert | None:
    ei_z = _zscore(csv.egregore_index, baseline.mean_ei, baseline.std_ei)
    entropy_z = _zscore(csv.topic_entropy, baseline.mean_topic_entropy, baseline.std_topic_entropy)
    if (csv.egregore_index > 0.85 and csv.topic_entropy < 1.0) or (ei_z > 2.0 and entropy_z < -2.0):
        severity = min(1.0, (csv.egregore_index - 0.5) / 0.5)
        return PathologyAlert(
            pathology=PathologyType.ECHO_CHAMBER,
            severity=severity,
            description=(
                f"High coherence ({csv.egregore_index:.2f}) with low topic diversity "
                f"({csv.topic_entropy:.2f})"
            ),
        )
    return None


def detect_bot_dominance(csv: CommunityStateVector) -> PathologyAlert | None:
    if csv.anthrophony_ratio > 0.25:
        severity = min(1.0, csv.anthrophony_ratio / 0.5)
        return PathologyAlert(
            pathology=PathologyType.BOT_DOMINANCE,
            severity=severity,
            description=f"Bot messages at {csv.anthrophony_ratio:.0%} of total",
        )
    return None


def detect_server_death(
    csv: CommunityStateVector, baseline: GuildBaseline
) -> PathologyAlert | None:
    if csv.activity_rate < 0.01:
        return PathologyAlert(
            pathology=PathologyType.SERVER_DEATH,
            severity=1.0,
            description="Near-zero activity detected",
        )
    rate_z = _zscore(csv.activity_rate, baseline.mean_activity_rate, baseline.std_activity_rate)
    if rate_z < -2.0:
        severity = min(1.0, abs(rate_z) / 4.0)
        return PathologyAlert(
            pathology=PathologyType.SERVER_DEATH,
            severity=severity,
            description=f"Activity rate {rate_z:.1f} sigma below baseline",
        )
    return None


def detect_flame_war(csv: CommunityStateVector, baseline: GuildBaseline) -> PathologyAlert | None:
    sentiment_var = 1.0 - csv.sentiment_alignment
    svar_z = _zscore(sentiment_var, baseline.mean_sentiment_var, baseline.std_sentiment_var)
    rate_z = _zscore(csv.activity_rate, baseline.mean_activity_rate, baseline.std_activity_rate)
    if svar_z > 3.0 and rate_z > 2.0:
        severity = min(1.0, svar_z / 5.0)
        return PathologyAlert(
            pathology=PathologyType.FLAME_WAR,
            severity=severity,
            description=(
                f"High sentiment variance ({svar_z:.1f} sigma) with elevated activity "
                f"({rate_z:.1f} sigma)"
            ),
        )
    return None


def detect_clique_formation(csv: CommunityStateVector) -> PathologyAlert | None:
    if csv.interaction_modularity > 0.7:
        severity = min(1.0, (csv.interaction_modularity - 0.5) / 0.5)
        return PathologyAlert(
            pathology=PathologyType.CLIQUE_FORMATION,
            severity=severity,
            description=f"High interaction modularity ({csv.interaction_modularity:.2f})",
        )
    return None


def run_pathology_scan(
    csv: CommunityStateVector,
    baseline: GuildBaseline | None = None,
) -> list[PathologyAlert]:
    bl = baseline or GuildBaseline()
    alerts: list[PathologyAlert] = []
    detectors = [
        detect_echo_chamber(csv, bl),
        detect_bot_dominance(csv),
        detect_server_death(csv, bl),
        detect_flame_war(csv, bl),
        detect_clique_formation(csv),
    ]
    for result in detectors:
        if result is not None:
            alerts.append(result)
    return alerts
