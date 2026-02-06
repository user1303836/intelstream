from __future__ import annotations

import math
from dataclasses import dataclass, field
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from datetime import datetime

    import numpy as np

    from intelstream.noosphere.constants import MessageClassification


@dataclass
class ProcessedMessage:
    guild_id: str
    channel_id: str
    user_id: str
    message_id: str
    content: str
    timestamp: datetime
    is_bot: bool
    classification: MessageClassification
    embedding: np.ndarray | None = field(default=None, repr=False)
    topic_cluster: int | None = None


@dataclass
class CommunityStateVector:
    guild_id: str
    timestamp: datetime
    semantic_coherence: float = 0.0
    vocab_convergence: float = 0.0
    topic_entropy: float = 0.0
    activity_rate: float = 0.0
    anthrophony_ratio: float = 0.0
    biophony_ratio: float = 0.0
    geophony_ratio: float = 0.0
    semantic_momentum: float = 0.0
    topic_churn: float = 0.0
    reply_depth: float = 0.0
    activity_entropy: float = 0.0
    egregore_index: float = 0.0
    sentiment_alignment: float = math.nan
    interaction_modularity: float = math.nan
    fractal_dimension: float = math.nan
    lyapunov_exponent: float = math.nan
    gromov_curvature: float = math.nan
