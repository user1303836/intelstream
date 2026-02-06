from __future__ import annotations

from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from intelstream.noosphere.shared.data_models import CommunityStateVector


def ei_color(ei: float) -> int:
    if ei < 0.3:
        return 0x3498DB
    if ei < 0.6:
        return 0x2ECC71
    if ei < 0.85:
        return 0xF39C12
    return 0xE74C3C


def bar(value: float, width: int = 10) -> str:
    filled = round(value * width)
    filled = max(0, min(width, filled))
    return "\u2588" * filled + "\u2591" * (width - filled)


def trend_arrow(current: float, previous: float | None) -> str:
    if previous is None:
        return ""
    delta = current - previous
    if abs(delta) < 0.02:
        return "\u2192"
    return "\u2191" if delta > 0 else "\u2193"


def build_mirror_lines(
    csv: CommunityStateVector,
    previous: CommunityStateVector | None = None,
) -> list[str]:
    lines: list[str] = []

    prev_ei = previous.egregore_index if previous else None
    prev_topic = previous.topic_entropy if previous else None
    prev_activity = previous.activity_entropy if previous else None
    prev_coherence = previous.semantic_coherence if previous else None

    lines.append(
        f"Egregore Index: {bar(csv.egregore_index)} "
        f"{csv.egregore_index:.2f} {trend_arrow(csv.egregore_index, prev_ei)}"
    )
    lines.append(
        f"Coherence:      {bar(csv.semantic_coherence)} "
        f"{csv.semantic_coherence:.2f} {trend_arrow(csv.semantic_coherence, prev_coherence)}"
    )
    lines.append(
        f"Topic Entropy:  {bar(csv.topic_entropy)} "
        f"{csv.topic_entropy:.2f} {trend_arrow(csv.topic_entropy, prev_topic)}"
    )
    lines.append(
        f"Activity Ent.:  {bar(csv.activity_entropy)} "
        f"{csv.activity_entropy:.2f} {trend_arrow(csv.activity_entropy, prev_activity)}"
    )
    lines.append(f"Biophony:       {bar(csv.biophony_ratio)} {csv.biophony_ratio:.2f}")
    lines.append(f"Anthrophony:    {bar(csv.anthrophony_ratio)} {csv.anthrophony_ratio:.2f}")

    return lines
