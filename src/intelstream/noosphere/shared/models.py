from __future__ import annotations

import math
from dataclasses import dataclass, field
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from datetime import datetime


@dataclass
class CommunityStateVector:
    guild_id: int
    timestamp: datetime

    semantic_coherence: float = 0.0
    vocab_convergence: float = 0.0
    topic_entropy: float = 0.0
    sentiment_alignment: float = 0.0
    activity_rate: float = 0.0
    anthrophony_ratio: float = 0.0
    biophony_ratio: float = 0.0
    geophony_ratio: float = 0.0
    interaction_modularity: float = 0.0
    semantic_momentum: float = 0.0
    topic_churn: float = 0.0
    reply_depth: float = 0.0
    activity_entropy: float = 0.0

    egregore_index: float = 0.0

    fractal_dimension: float = field(default_factory=lambda: math.nan)
    lyapunov_exponent: float = field(default_factory=lambda: math.nan)
    gromov_curvature: float = field(default_factory=lambda: math.nan)


@dataclass
class ProcessedMessage:
    guild_id: int
    channel_id: int
    user_id: int
    message_id: int
    content: str
    embedding: list[float]
    timestamp: datetime
    classification: str
    topic_cluster: int | None = None
