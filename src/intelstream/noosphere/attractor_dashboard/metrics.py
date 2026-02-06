from __future__ import annotations

from dataclasses import dataclass
from typing import TYPE_CHECKING

import numpy as np
import ruptures

if TYPE_CHECKING:
    from intelstream.noosphere.shared.data_models import CommunityStateVector

METRIC_FIELDS = [
    "semantic_coherence",
    "semantic_momentum",
    "topic_entropy",
    "topic_churn",
    "activity_entropy",
    "reply_depth",
    "interaction_modularity",  # populated by Phase 1 metrics_computer
    "anthrophony_ratio",
    "biophony_ratio",
]

METRIC_LABELS = {
    "semantic_coherence": "Coherence",
    "semantic_momentum": "Momentum",
    "topic_entropy": "Topic Entropy",
    "topic_churn": "Topic Churn",
    "activity_entropy": "Activity Entropy",
    "reply_depth": "Reply Depth",
    "interaction_modularity": "Modularity",
    "anthrophony_ratio": "Anthrophony",
    "biophony_ratio": "Biophony",
}


@dataclass
class ChangePoint:
    metric: str
    index: int
    direction: str


def extract_metric_series(
    history: list[CommunityStateVector], field: str
) -> np.ndarray[tuple[int], np.dtype[np.float64]]:
    return np.array([getattr(csv, field) for csv in history], dtype=np.float64)


def detect_change_points(
    series: np.ndarray[tuple[int], np.dtype[np.float64]],
    min_size: int = 5,
    penalty: float = 3.0,
) -> list[int]:
    if len(series) < min_size * 2:
        return []
    algo = ruptures.Pelt(model="rbf", min_size=min_size).fit(series)
    breakpoints: list[int] = algo.predict(pen=penalty)
    return [bp for bp in breakpoints if bp < len(series)]


def find_change_points(
    history: list[CommunityStateVector],
    min_size: int = 5,
    penalty: float = 3.0,
) -> list[ChangePoint]:
    results: list[ChangePoint] = []
    for field_name in METRIC_FIELDS:
        series = extract_metric_series(history, field_name)
        cps = detect_change_points(series, min_size=min_size, penalty=penalty)
        for cp in cps:
            before = float(np.mean(series[max(0, cp - min_size) : cp]))
            after_end = min(cp + min_size, len(series))
            after = float(np.mean(series[cp:after_end])) if cp < len(series) else before
            direction = "up" if after > before else "down"
            results.append(ChangePoint(metric=field_name, index=cp, direction=direction))
    return results


def format_dashboard(
    csv: CommunityStateVector,
    change_points: list[ChangePoint] | None = None,
) -> list[str]:
    lines: list[str] = []
    cp_map: dict[str, str] = {}
    if change_points:
        for cp in change_points:
            cp_map[cp.metric] = " [!]"

    for field_name in METRIC_FIELDS:
        label = METRIC_LABELS[field_name]
        value = getattr(csv, field_name)
        flag = cp_map.get(field_name, "")
        lines.append(f"{label:<18} {value:>6.3f}{flag}")

    return lines
