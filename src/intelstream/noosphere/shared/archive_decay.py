from __future__ import annotations

import math

from intelstream.noosphere.constants import (
    ARCHIVE_BASE_HALF_LIFE_HOURS,
    ARCHIVE_FIDELITY_FLOOR,
    ARCHIVE_REFERENCE_EXTENSION,
)


def relevance_score(
    entry_age_hours: float,
    reference_count: int,
    base_half_life: float = ARCHIVE_BASE_HALF_LIFE_HOURS,
    extension_factor: float = ARCHIVE_REFERENCE_EXTENSION,
    floor: float = ARCHIVE_FIDELITY_FLOOR,
) -> float:
    effective_half_life = base_half_life * (extension_factor**reference_count)
    if effective_half_life <= 0:
        return floor
    decay = 0.5 ** (entry_age_hours / effective_half_life)
    return float(max(floor, decay))


def compute_fidelity(
    created_hours_ago: float,
    interaction_timestamps_hours_ago: list[float],
    reference_count: int,
    base_half_life: float = ARCHIVE_BASE_HALF_LIFE_HOURS,
    extension_factor: float = ARCHIVE_REFERENCE_EXTENSION,
    boost: float = 0.3,
    floor: float = ARCHIVE_FIDELITY_FLOOR,
) -> float:
    effective_half_life = base_half_life * (extension_factor**reference_count)
    if effective_half_life <= 0:
        return floor

    decay_rate = math.log(2) / effective_half_life
    base_fidelity = math.exp(-decay_rate * created_hours_ago)

    interaction_boost = 0.0
    for hours_since in interaction_timestamps_hours_ago:
        if hours_since >= 0:
            interaction_boost += boost * math.exp(-decay_rate * hours_since)

    total = base_fidelity + interaction_boost
    return max(floor, min(1.0, total))
